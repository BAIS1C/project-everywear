use applet_ipc::{CommandKind, IpcEnvelope, IpcKind, IpcSource, Response};
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

const APPLET_ID: &str = "3nvizen";
const ENGINE_ID: &str = "3nvizen.video";
// CODEX_NEEDED: 3nvizen frontend uses direct fetch() to the LTX adapter at
// http://127.0.0.1:8787 for generation/progress/model calls. This Rust IPC
// path remains for shell lifecycle, legacy ExecuteJob dispatch, and unload.
// If the shell later proxies all applet traffic, forward to /api/generate here.

type HmacSha256 = Hmac<Sha256>;
type SharedWriter = Arc<Mutex<OwnedWriteHalf>>;

pub async fn run() {
    let port = match std::env::var(applet_ipc::ENV_CMD_PORT) {
        Ok(port) => port,
        Err(_) => {
            tracing::info!("No EVERYWEAR_CMD_PORT env var; 3nvizen running standalone");
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
        tracing::warn!(%error, "Failed to advertise 3nvizen capabilities");
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
            "label": "3nvizen local video engine",
            "capabilities": ["text2video", "image2video", "segment_generate", "lipdub"],
            "output": ["video/mp4", "application/json"],
            "sandbox": {
                "output_roots": [
                    everywear_paths::staging_dir(),
                    everywear_paths::data_dir(APPLET_ID),
                ]
            }
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
            let payload = json!({
                "event": "heartbeat",
                "applet_id": APPLET_ID,
                "engine_id": ENGINE_ID,
            });
            let envelope = IpcEnvelope::event(source.clone(), payload)
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
            tracing::warn!("Shell IPC lost; starting 10-second 3nvizen self-shutdown timer");
            sleep(Duration::from_secs(10)).await;
            if disconnected.load(Ordering::SeqCst) {
                let _ = unload_models().await;
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

    let result = handle_command(command, writer.clone(), seq.clone(), source.clone()).await;
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
    let response = IpcEnvelope::response(&envelope.id, source, payload)
        .with_seq(seq.fetch_add(1, Ordering::SeqCst));
    if let Err(error) = write_envelope(&writer, &response).await {
        tracing::warn!(%error, "Failed to write IPC response");
    }
}

async fn handle_command(
    command: CommandKind,
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
) -> Result<serde_json::Value, String> {
    match command {
        CommandKind::Ping => Ok(json!({"status": "alive"})),
        CommandKind::QueryStatus => query_status().await,
        CommandKind::StartInference { model_paths } => start_inference(model_paths).await,
        CommandKind::UnloadModel => {
            let status = unload_models().await;
            Ok(status)
        }
        CommandKind::Shutdown => {
            let _ = unload_models().await;
            std::process::exit(0);
        }
        CommandKind::ExecuteJob { job } => {
            let job_id = job_id(&job);
            let result = execute_job(job).await;
            let event = match &result {
                Ok(result) => CommandKind::JobComplete {
                    job_id,
                    result: result.clone(),
                },
                Err(error) => CommandKind::JobFailed {
                    job_id,
                    error: error.clone(),
                },
            };
            send_event(writer, seq, source, event).await;
            result
        }
        other => Err(format!("unsupported command: {other:?}")),
    }
}

async fn execute_job(job: serde_json::Value) -> Result<serde_json::Value, String> {
    let output_target = output_target(&job)?;
    ensure_sandboxed_output(&output_target)?;

    let capability = job
        .get("capability")
        .or_else(|| job.get("capability_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("segment_generate")
        .to_ascii_lowercase();

    let sidecar_url = std::env::var("THREENVIZEN_SIDECAR_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8787".to_string());
    let client = reqwest::Client::new();

    let endpoint = if capability.contains("lipdub") {
        "/api/v1/patches/lipdub"
    } else {
        "/api/v1/segments/generate"
    };
    let response = client
        .post(format!("{sidecar_url}{endpoint}"))
        .json(&job)
        .send()
        .await
        .map_err(|error| format!("sidecar request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("sidecar HTTP {}", response.status()));
    }
    let sidecar_result: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("sidecar JSON decode failed: {error}"))?;

    if let Some(video_path) = sidecar_result
        .get("video_path")
        .and_then(|value| value.as_str())
    {
        copy_output(Path::new(video_path), &output_target)?;
    } else {
        write_json_output(&output_target, &sidecar_result)?;
    }

    Ok(json!({
        "engine_id": ENGINE_ID,
        "output_path": output_target,
        "sidecar": sidecar_result,
    }))
}

async fn unload_models() -> serde_json::Value {
    let sidecar_url = sidecar_url();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return json!({
                "status": "error",
                "engine_id": ENGINE_ID,
                "sidecar_url": sidecar_url,
                "error": format!("failed to build HTTP client: {error}"),
            });
        }
    };

    tracing::info!(%sidecar_url, "3nvizen unload requested");

    let before = probe_sidecar(&client, &sidecar_url).await;
    if matches!(before.state, SidecarProbeState::Unreachable) {
        tracing::info!(%sidecar_url, "3nvizen sidecar is not reachable; treating models as unloaded");
        return json!({
            "status": "sidecar_unreachable",
            "engine_id": ENGINE_ID,
            "sidecar_url": sidecar_url,
            "models_loaded": false,
            "probe": before.payload,
        });
    }

    let unload = send_unload_signal(&client, &sidecar_url).await;
    let after = probe_sidecar(&client, &sidecar_url).await;
    let models_loaded = after.models_loaded();
    let status = if unload.ok && !models_loaded {
        "unloaded"
    } else if unload.ok {
        "unload_sent"
    } else {
        "unload_failed"
    };

    tracing::info!(
        %sidecar_url,
        unload_ok = unload.ok,
        models_loaded,
        "3nvizen unload sequence completed"
    );

    json!({
        "status": status,
        "engine_id": ENGINE_ID,
        "sidecar_url": sidecar_url,
        "unload_endpoint": unload.endpoint,
        "unload_response": unload.payload,
        "models_loaded": models_loaded,
        "pre_unload_probe": before.payload,
        "post_unload_probe": after.payload,
    })
}

async fn query_status() -> Result<serde_json::Value, String> {
    let sidecar_url = sidecar_url();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let probe = probe_sidecar(&client, &sidecar_url).await;
    Ok(json!({
        "status": "alive",
        "engine_id": ENGINE_ID,
        "sidecar_url": sidecar_url,
        "sidecar_status": probe.state.as_str(),
        "models_loaded": probe.models_loaded(),
        "sidecar": probe.payload,
    }))
}

async fn start_inference(
    model_paths: Vec<applet_ipc::ModelPath>,
) -> Result<serde_json::Value, String> {
    let sidecar_url = sidecar_url();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let probe = probe_sidecar(&client, &sidecar_url).await;
    let models = model_paths
        .into_iter()
        .map(|model| {
            json!({
                "role": model.role,
                "path": model.path,
                "vram_mb": model.vram_mb,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "status": "lifecycle_ready",
        "engine_id": ENGINE_ID,
        "sidecar_url": sidecar_url,
        "sidecar_status": probe.state.as_str(),
        "models_loaded": probe.models_loaded(),
        "model_paths": models,
        "sidecar": probe.payload,
        "note": "3nvizen Rust IPC lifecycle accepted StartInference; live LTX model loading and generation remain owned by the HTTP sidecar.",
    }))
}

fn sidecar_url() -> String {
    std::env::var("THREENVIZEN_SIDECAR_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8787".to_string())
        .trim_end_matches('/')
        .to_string()
}

#[derive(Debug)]
struct UnloadAttempt {
    ok: bool,
    endpoint: Option<String>,
    payload: serde_json::Value,
}

#[derive(Debug)]
struct SidecarProbe {
    state: SidecarProbeState,
    payload: serde_json::Value,
}

#[derive(Debug)]
enum SidecarProbeState {
    Healthy,
    Error,
    Unreachable,
}

impl SidecarProbeState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Error => "error",
            Self::Unreachable => "unreachable",
        }
    }
}

impl SidecarProbe {
    fn models_loaded(&self) -> bool {
        self.payload
            .get("models_loaded")
            .or_else(|| self.payload.get("loaded"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    }
}

async fn send_unload_signal(client: &reqwest::Client, sidecar_url: &str) -> UnloadAttempt {
    let candidates = [
        "/api/v1/models/unload",
        "/api/v1/unload",
        "/api/v1/runtime/unload",
        "/unload",
    ];

    let mut last_error = json!({"error": "no unload endpoint attempted"});
    for endpoint in candidates {
        let url = format!("{sidecar_url}{endpoint}");
        match client
            .post(&url)
            .json(&json!({ "engine_id": ENGINE_ID, "reason": "shell_unload" }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                let payload = response
                    .json()
                    .await
                    .unwrap_or_else(|_| json!({ "status": "ok" }));
                return UnloadAttempt {
                    ok: true,
                    endpoint: Some(endpoint.to_string()),
                    payload,
                };
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                last_error = json!({
                    "endpoint": endpoint,
                    "status": status.as_u16(),
                    "body": body,
                });
            }
            Err(error) => {
                last_error = json!({
                    "endpoint": endpoint,
                    "error": error.to_string(),
                });
            }
        }
    }

    UnloadAttempt {
        ok: false,
        endpoint: None,
        payload: last_error,
    }
}

async fn probe_sidecar(client: &reqwest::Client, sidecar_url: &str) -> SidecarProbe {
    for endpoint in ["/api/v1/status", "/api/v1/health", "/health"] {
        let url = format!("{sidecar_url}{endpoint}");
        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                let payload = response
                    .json()
                    .await
                    .unwrap_or_else(|_| json!({ "status": "ok" }));
                return SidecarProbe {
                    state: SidecarProbeState::Healthy,
                    payload,
                };
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return SidecarProbe {
                    state: SidecarProbeState::Error,
                    payload: json!({
                        "endpoint": endpoint,
                        "status": status.as_u16(),
                        "body": body,
                    }),
                };
            }
            Err(error) => {
                let _ = error;
                continue;
            }
        }
    }

    SidecarProbe {
        state: SidecarProbeState::Unreachable,
        payload: json!({ "status": "unreachable" }),
    }
}

async fn send_event(
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
    command: CommandKind,
) {
    let payload = match serde_json::to_value(command) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(%error, "Failed to serialize event");
            return;
        }
    };
    let envelope = IpcEnvelope::event(source, payload).with_seq(seq.fetch_add(1, Ordering::SeqCst));
    if let Err(error) = write_envelope(&writer, &envelope).await {
        tracing::warn!(%error, "Failed to send event");
    }
}

async fn write_envelope(writer: &SharedWriter, envelope: &IpcEnvelope) -> anyhow::Result<()> {
    let mut line = serde_json::to_string(envelope)?;
    line.push('\n');
    let mut writer = writer.lock().await;
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}

fn job_id(job: &serde_json::Value) -> String {
    job.get("job_id")
        .or_else(|| job.get("id"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

fn output_target(job: &serde_json::Value) -> Result<PathBuf, String> {
    job.get("output_target")
        .or_else(|| job.get("output_path"))
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .ok_or_else(|| "job missing output_target".to_string())
}

fn ensure_sandboxed_output(output_target: &Path) -> Result<(), String> {
    let absolute = if output_target.is_absolute() {
        output_target.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(output_target)
    };
    let allowed = [
        everywear_paths::staging_dir(),
        everywear_paths::data_dir(APPLET_ID),
    ];
    if allowed.iter().any(|root| absolute.starts_with(root)) {
        Ok(())
    } else {
        Err(format!(
            "output_target outside allowed sandbox: {}",
            absolute.display()
        ))
    }
}

fn copy_output(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("mkdir: {error}"))?;
    }
    std::fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| format!("copy output: {error}"))
}

fn write_json_output(target: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("mkdir: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(target, bytes).map_err(|error| format!("write output: {error}"))
}

fn hmac_hex(secret: &[u8], payload: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts all key sizes");
    mac.update(payload);
    hex::encode(mac.finalize().into_bytes())
}
