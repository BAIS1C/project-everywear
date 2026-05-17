use applet_ipc::{CommandKind, IpcEnvelope, IpcKind, IpcSource, Response};
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

const APPLET_ID: &str = "kasai";
const ENGINE_ID: &str = "kasai.planning";

type HmacSha256 = Hmac<Sha256>;
type SharedWriter = Arc<Mutex<OwnedWriteHalf>>;

pub async fn run() {
    let port = match std::env::var(applet_ipc::ENV_CMD_PORT) {
        Ok(port) => port,
        Err(_) => {
            tracing::info!("No EVERYWEAR_CMD_PORT env var; Kasai stub running standalone");
            return;
        }
    };
    let secret = match std::env::var(applet_ipc::ENV_IPC_SECRET) {
        Ok(s) if !s.is_empty() => s,
        _ => {
            tracing::error!(
                "No {} env var set. HMAC authentication requires the shared secret.",
                applet_ipc::ENV_IPC_SECRET
            );
            return;
        }
    };

    let stream = match TcpStream::connect(format!("127.0.0.1:{port}")).await {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(%error, "Failed to connect to shell IPC");
            return;
        }
    };
    let (reader_half, writer_half) = stream.into_split();
    let writer = Arc::new(Mutex::new(writer_half));
    let seq = Arc::new(AtomicU64::new(1));
    let disconnected = Arc::new(AtomicBool::new(false));
    let source = IpcSource::Applet {
        applet_id: APPLET_ID.to_string(),
    };

    if let Err(error) = advertise(&writer, &seq, source.clone(), &secret).await {
        tracing::warn!(%error, "Failed to advertise Kasai capabilities");
        disconnected.store(true, Ordering::SeqCst);
    }

    spawn_heartbeat(
        writer.clone(),
        seq.clone(),
        source.clone(),
        disconnected.clone(),
    );
    spawn_shutdown_monitor(disconnected.clone());

    let mut reader = BufReader::new(reader_half);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                disconnected.store(true, Ordering::SeqCst);
                break;
            }
            Ok(_) => handle_line(line.trim(), writer.clone(), seq.clone(), source.clone()).await,
            Err(error) => {
                tracing::warn!(%error, "Shell IPC read failed");
                disconnected.store(true, Ordering::SeqCst);
                break;
            }
        }
    }
}

async fn advertise(
    writer: &SharedWriter,
    seq: &AtomicU64,
    source: IpcSource,
    secret: &str,
) -> anyhow::Result<()> {
    let capabilities = json!({
        "applet_id": APPLET_ID,
        "engines": [{
            "engine_id": ENGINE_ID,
            "label": "Kasai local planning stub",
            "capabilities": ["plan", "expand_prompt", "classify", "orchestrate"],
            "status": "stub",
        }],
    });
    let payload = serde_json::to_value(CommandKind::AdvertiseCapabilities { capabilities })?;
    let hmac = hmac_hex(secret.as_bytes(), &serde_json::to_vec(&payload)?);
    let envelope = IpcEnvelope::event(source, payload)
        .with_seq(seq.fetch_add(1, Ordering::SeqCst))
        .with_hmac(hmac);
    write_envelope(writer, &envelope).await
}

fn spawn_heartbeat(
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
    disconnected: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(5)).await;
            if disconnected.load(Ordering::SeqCst) {
                break;
            }
            let envelope = IpcEnvelope::event(
                source.clone(),
                json!({"event": "heartbeat", "applet_id": APPLET_ID, "engine_id": ENGINE_ID}),
            )
            .with_seq(seq.fetch_add(1, Ordering::SeqCst));
            if let Err(error) = write_envelope(&writer, &envelope).await {
                tracing::warn!(%error, "Heartbeat failed");
                disconnected.store(true, Ordering::SeqCst);
                break;
            }
        }
    });
}

fn spawn_shutdown_monitor(disconnected: Arc<AtomicBool>) {
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(1)).await;
            if !disconnected.load(Ordering::SeqCst) {
                continue;
            }
            tracing::warn!("Shell IPC lost; starting 10-second Kasai self-shutdown timer");
            sleep(Duration::from_secs(10)).await;
            if disconnected.load(Ordering::SeqCst) {
                unload_models().await;
                std::process::exit(0);
            }
        }
    });
}

async fn handle_line(line: &str, writer: SharedWriter, seq: Arc<AtomicU64>, source: IpcSource) {
    let envelope = match serde_json::from_str::<IpcEnvelope>(line) {
        Ok(envelope) if envelope.kind == IpcKind::Command => envelope,
        Ok(_) => return,
        Err(error) => {
            tracing::warn!(%error, raw = line, "Failed to parse IPC envelope");
            return;
        }
    };
    let command = match serde_json::from_value::<CommandKind>(envelope.payload.clone()) {
        Ok(command) => command,
        Err(error) => {
            tracing::warn!(%error, "Failed to parse IPC command");
            return;
        }
    };
    let result = handle_command(command).await;
    let response = match result {
        Ok(detail) => Response::ok_with(&envelope.id, detail.to_string()),
        Err(error) => Response::error(&envelope.id, error),
    };
    let payload = match serde_json::to_value(response) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(%error, "Failed to serialize response");
            return;
        }
    };
    let envelope = IpcEnvelope::response(&envelope.id, source, payload)
        .with_seq(seq.fetch_add(1, Ordering::SeqCst));
    if let Err(error) = write_envelope(&writer, &envelope).await {
        tracing::warn!(%error, "Failed to write response");
    }
}

async fn handle_command(command: CommandKind) -> Result<serde_json::Value, String> {
    match command {
        CommandKind::Ping | CommandKind::QueryStatus => {
            Ok(json!({"status": "alive", "engine_id": ENGINE_ID, "stub": true}))
        }
        CommandKind::UnloadModel => {
            unload_models().await;
            Ok(json!({"status": "unloaded"}))
        }
        CommandKind::Shutdown => {
            unload_models().await;
            std::process::exit(0);
        }
        CommandKind::ExecuteJob { .. } => Err("Kasai is a stub in Phase 4.3".to_string()),
        other => Err(format!("unsupported command: {other:?}")),
    }
}

async fn unload_models() {
    tracing::info!("Kasai stub unload requested; no models loaded");
}

async fn write_envelope(writer: &SharedWriter, envelope: &IpcEnvelope) -> anyhow::Result<()> {
    let mut line = serde_json::to_string(envelope)?;
    line.push('\n');
    let mut writer = writer.lock().await;
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}

fn hmac_hex(secret: &[u8], payload: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts all key sizes");
    mac.update(payload);
    hex::encode(mac.finalize().into_bytes())
}
