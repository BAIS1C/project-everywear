use crate::engine::{GenerationResult, Img2ImgRequest, InferenceEngine, Txt2ImgRequest};
use applet_ipc::{Command, CommandKind, IpcEnvelope, IpcKind, IpcSource, ModelPath, Response};
use base64::Engine as _;
use serde_json::json;
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

const APPLET_ID: &str = "1magen";
const ENGINE_ID: &str = "1magen.image";

type SharedWriter = Arc<Mutex<OwnedWriteHalf>>;

pub async fn start(engine: Arc<Mutex<InferenceEngine>>) {
    let port = match std::env::var(applet_ipc::ENV_CMD_PORT) {
        Ok(port) => port,
        Err(_) => {
            tracing::info!("No EVERYWEAR_CMD_PORT env var; running 1magen standalone");
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

    tracing::info!("Shell IPC connected; advertising 1magen capabilities");
    let (reader_half, writer_half) = stream.into_split();
    let writer = Arc::new(Mutex::new(writer_half));
    let seq = Arc::new(AtomicU64::new(1));
    let disconnected = Arc::new(AtomicBool::new(false));
    let source = IpcSource::Applet {
        applet_id: APPLET_ID.to_string(),
    };

    if let Err(error) = advertise(&writer, &seq, source.clone(), &secret).await {
        tracing::warn!(%error, "Failed to advertise capabilities");
        disconnected.store(true, Ordering::SeqCst);
    }

    spawn_heartbeat(
        writer.clone(),
        seq.clone(),
        source.clone(),
        disconnected.clone(),
    );
    spawn_shutdown_monitor(engine.clone(), disconnected.clone());

    let mut reader = BufReader::new(reader_half);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                tracing::warn!("Shell IPC disconnected");
                disconnected.store(true, Ordering::SeqCst);
                break;
            }
            Ok(_) => {
                handle_line(
                    line.trim(),
                    engine.clone(),
                    writer.clone(),
                    seq.clone(),
                    source.clone(),
                )
                .await;
            }
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
            "label": "1magen local image engine",
            "capabilities": ["text2image", "image_edit", "warmup"],
            "output": ["image/png"],
        }],
    });
    let payload = serde_json::to_value(CommandKind::AdvertiseCapabilities { capabilities })?;
    let payload_bytes = serde_json::to_vec(&payload)?;
    let hmac = hmac_sha256_hex(secret.as_bytes(), &payload_bytes);
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
                tracing::warn!(%error, "Heartbeat failed; marking IPC disconnected");
                disconnected.store(true, Ordering::SeqCst);
                break;
            }
        }
    });
}

fn spawn_shutdown_monitor(engine: Arc<Mutex<InferenceEngine>>, disconnected: Arc<AtomicBool>) {
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(1)).await;
            if !disconnected.load(Ordering::SeqCst) {
                continue;
            }

            tracing::warn!("Shell IPC lost; starting 10-second self-shutdown timer");
            sleep(Duration::from_secs(10)).await;
            if disconnected.load(Ordering::SeqCst) {
                let mut engine = engine.lock().await;
                engine.unload();
                tracing::warn!("Shell IPC still disconnected; unloaded 1magen models and exiting");
                std::process::exit(0);
            }
        }
    });
}

async fn handle_line(
    line: &str,
    engine: Arc<Mutex<InferenceEngine>>,
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
) {
    if line.is_empty() {
        return;
    }

    if let Ok(envelope) = serde_json::from_str::<IpcEnvelope>(line) {
        if envelope.kind != IpcKind::Command {
            return;
        }

        let command = match serde_json::from_value::<CommandKind>(envelope.payload.clone()) {
            Ok(command) => command,
            Err(error) => {
                tracing::warn!(%error, "Failed to parse envelope command payload");
                return;
            }
        };

        handle_envelope_command(envelope.id, command, engine, writer, seq, source).await;
        return;
    }

    match serde_json::from_str::<Command>(line) {
        Ok(command) => {
            let id = command.id.clone();
            let response = handle_command(command.kind, engine, writer.clone(), seq, source)
                .await
                .map(|detail| Response::ok_with(&id, detail.to_string()))
                .unwrap_or_else(|error| Response::error(&id, error));
            if let Err(error) = write_legacy_response(&writer, &response).await {
                tracing::warn!(%error, "Failed to write legacy IPC response");
            }
        }
        Err(error) => {
            tracing::warn!(%error, raw = line, "Failed to parse IPC message");
        }
    }
}

async fn handle_envelope_command(
    request_id: String,
    command: CommandKind,
    engine: Arc<Mutex<InferenceEngine>>,
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
) {
    let result = handle_command(command, engine, writer.clone(), seq.clone(), source.clone()).await;
    let response = match result {
        Ok(detail) => Response::ok_with(&request_id, detail.to_string()),
        Err(error) => Response::error(&request_id, error),
    };

    let payload = match serde_json::to_value(response) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(%error, "Failed to serialize IPC response payload");
            return;
        }
    };
    let envelope = IpcEnvelope::response(&request_id, source, payload)
        .with_seq(seq.fetch_add(1, Ordering::SeqCst));
    if let Err(error) = write_envelope(&writer, &envelope).await {
        tracing::warn!(%error, "Failed to write IPC response envelope");
    }
}

async fn handle_command(
    command: CommandKind,
    engine: Arc<Mutex<InferenceEngine>>,
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
) -> Result<serde_json::Value, String> {
    match command {
        CommandKind::UnloadModel | CommandKind::Shutdown => {
            let mut engine = engine.lock().await;
            engine.unload();
            if matches!(command, CommandKind::Shutdown) {
                std::process::exit(0);
            }
            Ok(json!({"status": "unloaded"}))
        }
        CommandKind::Ping | CommandKind::QueryStatus => {
            let engine = engine.lock().await;
            Ok(json!({
                "status": "alive",
                "engine_loaded": engine.is_loaded(),
                "loaded_model": engine.loaded_model(),
            }))
        }
        CommandKind::StartInference { model_paths } => {
            load_model_paths(engine, model_paths).await?;
            Ok(json!({"status": "loaded"}))
        }
        CommandKind::Warmup { capability } => {
            if capability != "warmup" && capability != "text2image" && capability != ENGINE_ID {
                return Err(format!("unsupported warmup capability: {capability}"));
            }
            let target = std::env::temp_dir().join("1magen_warmup.png");
            execute_txt2img(engine, warmup_job(&target)).await?;
            Ok(json!({"status": "warm"}))
        }
        CommandKind::ExecuteJob { job } => {
            let job_id = job_id(&job);
            let result = execute_job(engine, job).await;
            match &result {
                Ok(value) => {
                    send_job_event(
                        writer,
                        seq,
                        source,
                        CommandKind::JobComplete {
                            job_id,
                            result: value.clone(),
                        },
                    )
                    .await;
                }
                Err(error) => {
                    send_job_event(
                        writer,
                        seq,
                        source,
                        CommandKind::JobFailed {
                            job_id,
                            error: error.clone(),
                        },
                    )
                    .await;
                }
            }
            result
        }
        other => Err(format!("unsupported command: {other:?}")),
    }
}

async fn load_model_paths(
    engine: Arc<Mutex<InferenceEngine>>,
    model_paths: Vec<ModelPath>,
) -> Result<(), String> {
    let mut primary = None;
    let mut vae = None;
    let mut llm = None;

    for model_path in model_paths {
        match model_path.role.to_ascii_lowercase().as_str() {
            "primary" | "dit" | "diffusion" => primary = Some(model_path.path),
            "vae" => vae = Some(model_path.path),
            "encoder" | "text_encoder" | "llm" => llm = Some(model_path.path),
            _ => {}
        }
    }

    let primary = primary.ok_or_else(|| "StartInference missing primary model path".to_string())?;
    let mut engine = engine.lock().await;
    engine
        .load_model(&primary, vae.as_deref(), llm.as_deref())
        .map_err(|error| error.to_string())
}

async fn execute_job(
    engine: Arc<Mutex<InferenceEngine>>,
    job: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let capability = job
        .get("capability")
        .or_else(|| job.get("capability_id"))
        .or_else(|| job.get("engine_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("text2image")
        .to_ascii_lowercase();

    if capability.contains("edit")
        || capability.contains("img2img")
        || job.get("image_path").is_some()
    {
        execute_img2img(engine, job).await
    } else {
        execute_txt2img(engine, job).await
    }
}

async fn execute_txt2img(
    engine: Arc<Mutex<InferenceEngine>>,
    job: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let output_target = output_target(&job)?;
    let request = Txt2ImgRequest {
        prompt: string_field(&job, "prompt")
            .unwrap_or_else(|| "A studio quality image".to_string()),
        negative_prompt: string_field(&job, "negative_prompt").unwrap_or_default(),
        width: u32_field(&job, "width").unwrap_or(1024),
        height: u32_field(&job, "height").unwrap_or(1024),
        steps: u32_field(&job, "steps").unwrap_or(9),
        cfg_scale: f32_field(&job, "cfg_scale").unwrap_or(1.0),
        seed: i64_field(&job, "seed").unwrap_or(-1),
    };

    let result = {
        let mut engine = engine.lock().await;
        engine.txt2img(request).map_err(|error| error.to_string())?
    };
    write_generation_result(&result, &output_target)?;
    Ok(json!({
        "engine_id": ENGINE_ID,
        "output_path": output_target,
        "seed": result.seed,
        "elapsed_secs": result.elapsed_secs,
    }))
}

async fn execute_img2img(
    engine: Arc<Mutex<InferenceEngine>>,
    job: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let output_target = output_target(&job)?;
    let image_path = string_field(&job, "image_path")
        .or_else(|| string_field(&job, "input_image"))
        .ok_or_else(|| "image edit job missing image_path".to_string())?;
    let request = Img2ImgRequest {
        image_path: PathBuf::from(image_path),
        prompt: string_field(&job, "prompt").unwrap_or_else(|| "Edit the image".to_string()),
        strength: f32_field(&job, "strength").unwrap_or(0.65),
        steps: u32_field(&job, "steps").unwrap_or(9),
        seed: i64_field(&job, "seed").unwrap_or(-1),
    };

    let result = {
        let mut engine = engine.lock().await;
        engine.img2img(request).map_err(|error| error.to_string())?
    };
    write_generation_result(&result, &output_target)?;
    Ok(json!({
        "engine_id": ENGINE_ID,
        "output_path": output_target,
        "seed": result.seed,
        "elapsed_secs": result.elapsed_secs,
    }))
}

fn warmup_job(target: &Path) -> serde_json::Value {
    json!({
        "prompt": "warmup",
        "width": 64,
        "height": 64,
        "steps": 1,
        "cfg_scale": 1.0,
        "seed": 1,
        "output_target": target,
    })
}

fn write_generation_result(result: &GenerationResult, output_target: &Path) -> Result<(), String> {
    if let Some(parent) = output_target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("mkdir: {error}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&result.image_base64)
        .map_err(|error| format!("base64 decode: {error}"))?;
    std::fs::write(output_target, bytes).map_err(|error| format!("write: {error}"))
}

async fn send_job_event(
    writer: SharedWriter,
    seq: Arc<AtomicU64>,
    source: IpcSource,
    command: CommandKind,
) {
    let payload = match serde_json::to_value(command) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(%error, "Failed to serialize job event");
            return;
        }
    };
    let envelope = IpcEnvelope::event(source, payload).with_seq(seq.fetch_add(1, Ordering::SeqCst));
    if let Err(error) = write_envelope(&writer, &envelope).await {
        tracing::warn!(%error, "Failed to write job event");
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

async fn write_legacy_response(writer: &SharedWriter, response: &Response) -> anyhow::Result<()> {
    let mut line = serde_json::to_string(response)?;
    line.push('\n');
    let mut writer = writer.lock().await;
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}

fn job_id(job: &serde_json::Value) -> String {
    string_field(job, "job_id")
        .or_else(|| string_field(job, "id"))
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

fn output_target(job: &serde_json::Value) -> Result<PathBuf, String> {
    string_field(job, "output_target")
        .or_else(|| string_field(job, "output_path"))
        .map(PathBuf::from)
        .ok_or_else(|| "job missing output_target".to_string())
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn u32_field(value: &serde_json::Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
}

fn i64_field(value: &serde_json::Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|value| value.as_i64())
}

fn f32_field(value: &serde_json::Value, key: &str) -> Option<f32> {
    value
        .get(key)
        .and_then(|value| value.as_f64())
        .map(|value| value as f32)
}

fn hmac_sha256_hex(secret: &[u8], data: &[u8]) -> String {
    let mut key = [0_u8; 64];
    if secret.len() > 64 {
        key[..32].copy_from_slice(&sha256(secret));
    } else {
        key[..secret.len()].copy_from_slice(secret);
    }

    let mut ipad = [0x36_u8; 64];
    let mut opad = [0x5c_u8; 64];
    for i in 0..64 {
        ipad[i] ^= key[i];
        opad[i] ^= key[i];
    }

    let mut inner = Vec::with_capacity(64 + data.len());
    inner.extend_from_slice(&ipad);
    inner.extend_from_slice(data);
    let inner_hash = sha256(&inner);

    let mut outer = Vec::with_capacity(96);
    outer.extend_from_slice(&opad);
    outer.extend_from_slice(&inner_hash);
    hex_encode(&sha256(&outer))
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (input.len() as u64) * 8;
    let mut msg = input.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0_u32; 64];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            let j = i * 4;
            *word = u32::from_be_bytes([chunk[j], chunk[j + 1], chunk[j + 2], chunk[j + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0_u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
