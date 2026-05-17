//! Gener8 applet binary for the Everywear platform.
//!
//! This is NOT a standalone Tauri app. It is a headless process spawned by
//! the Everywear OS shell. Communication with the shell is via IPC over
//! TCP on localhost (applet-ipc crate, envelope v2 protocol).
//!
//! Lifecycle:
//!   1. Shell spawns this binary with EVERYWEAR_CMD_PORT + EVERYWEAR_IPC_SECRET
//!   2. Binary connects to shell IPC, authenticates with HMAC handshake
//!   3. Sends AdvertiseCapabilities for "gener8.audio" engine
//!   4. Enters main loop: heartbeat (5s), command dispatch, event handling
//!   5. On IPC loss (10s without shell contact): graceful unload → exit
//!   6. On Shutdown command: unload all, flush state, exit(0)
//!
//! The applet does NOT own GPU detection, VRAM arbitration, or model downloads.
//! Those are shell responsibilities. The applet owns:
//!   - ACE inference server (spawned sidecar on :8080)
//!   - In-process axum shim (translates REST → ace-server)
//!   - Audio library index (library.json)
//!   - User settings (settings.json)
//!   - DAW engine (load-on-demand)
//!   - Tier reconciler (HMAC-verified TierSync from shell)
//!   - AI Director shot planning (Creator Studio feature gate)

mod ace_server;
mod ai_director;
mod beats;
mod daw_engine;
mod engine_client;
mod ipc_handler;
mod library;
mod settings;
mod shim;
mod storage;
mod tier_reconciler;
mod video_encoder;
mod whisper_align;

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, Notify};
use tracing::{error, info, warn};

use applet_ipc::{
    AppletListener, CommandKind, IpcEnvelope, IpcKind, IpcSource, Response, ENV_CMD_PORT,
    ENV_IPC_SECRET,
};

/// Applet identity. Must match the shell's applet registry entry.
pub const APPLET_ID: &str = "gener8";

/// Engine ID advertised to the shell registry.
pub const ENGINE_ID: &str = "gener8.audio";

/// ACE inference server port (spawned sidecar).
pub const ACE_PORT: u16 = 8080;

/// In-process axum shim port.
pub const SHIM_PORT: u16 = 3001;

/// Video encoder sidecar port.
pub const VIDEO_ENCODER_PORT: u16 = 9877;

/// Heartbeat interval (shell expects pings at this cadence).
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// Maximum time without shell contact before self-shutdown.
const IPC_LOSS_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// Shared applet state
// ---------------------------------------------------------------------------

/// Licence tier (received from shell via TierSync, HMAC-verified).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum LicenceTier {
    Demo,
    Gener8,
    Gener8Pro,
    CreatorStudio,
}

impl LicenceTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Demo => "demo",
            Self::Gener8 => "gener8",
            Self::Gener8Pro => "gener8_pro",
            Self::CreatorStudio => "creator_studio",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "gener8" => Self::Gener8,
            "gener8_pro" => Self::Gener8Pro,
            "creator_studio" => Self::CreatorStudio,
            _ => Self::Demo,
        }
    }
}

/// Shared state accessible from the IPC handler, shim, and background tasks.
pub struct AppState {
    /// ACE inference server manager.
    pub ace: Arc<Mutex<ace_server::AceServerManager>>,
    /// Video encoder manager.
    pub encoder: Arc<Mutex<video_encoder::VideoEncoderManager>>,
    /// Current licence tier (HMAC-verified from shell).
    pub tier: Arc<Mutex<LicenceTier>>,
    /// HTTP client for proxying to ace-server and health probes.
    pub http: reqwest::Client,
    /// IPC shared secret for HMAC verification.
    pub ipc_secret: Vec<u8>,
    /// Last time we heard from the shell (heartbeat or any command).
    pub last_shell_contact: Arc<Mutex<Instant>>,
    /// Signal to initiate graceful shutdown.
    pub shutdown: Arc<Notify>,
    /// Tier reconciler.
    pub reconciler: Option<tier_reconciler::Reconciler>,
    /// DAW engine (load-on-demand).
    pub daw_engine: Arc<Mutex<Option<daw_engine::DawEngine>>>,
    /// Beats analysis cache.
    pub beats_cache: Arc<beats::BeatsCache>,
    /// Sender half of the IPC outbound channel. IPC handler reads from the
    /// receiver and writes envelopes to the TCP stream.
    pub ipc_tx: mpsc::UnboundedSender<IpcEnvelope>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    // --- Logging ---
    let logs_dir = everywear_paths::logs_dir();
    let _ = std::fs::create_dir_all(&logs_dir);
    let session_log = logs_dir.join(format!(
        "gener8_{}.log",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    ));
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&session_log)
        .expect("failed to open session log file");
    let (file_writer, _guard) = tracing_appender::non_blocking(log_file);
    let _guard: &'static _ = Box::leak(Box::new(_guard));

    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stdout)
                .with_ansi(true),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(file_writer)
                .with_ansi(false),
        )
        .init();

    info!("Gener8 applet starting; log: {}", session_log.display());

    // --- Ensure applet data directory ---
    if let Err(e) = everywear_paths::ensure_applet_dir(APPLET_ID) {
        error!("Failed to create applet data dir: {}", e);
        std::process::exit(1);
    }

    // --- Read IPC env vars ---
    let ipc_port: u16 = match std::env::var(ENV_CMD_PORT) {
        Ok(p) => p.parse().expect("invalid EVERYWEAR_CMD_PORT"),
        Err(_) => {
            error!(
                "No {} env var set. Gener8 must be launched by the Everywear shell.",
                ENV_CMD_PORT
            );
            std::process::exit(1);
        }
    };
    let ipc_secret = match std::env::var(ENV_IPC_SECRET) {
        Ok(s) => s.into_bytes(),
        Err(_) => {
            error!(
                "No {} env var set. HMAC authentication requires the shared secret.",
                ENV_IPC_SECRET
            );
            std::process::exit(1);
        }
    };

    info!(port = ipc_port, "Connecting to shell IPC");

    // --- Connect to shell IPC ---
    let stream = match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", ipc_port)).await {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to connect to shell IPC on port {}: {}", ipc_port, e);
            std::process::exit(1);
        }
    };
    info!(port = ipc_port, "Connected to shell IPC channel");

    // --- Build shared state ---
    let (ipc_tx, ipc_rx) = mpsc::unbounded_channel::<IpcEnvelope>();
    let shutdown = Arc::new(Notify::new());

    let data_dir = everywear_paths::data_dir(APPLET_ID);
    let beats_dir = data_dir.join("cache").join("beats");
    let _ = std::fs::create_dir_all(&beats_dir);

    let tier_handle = Arc::new(Mutex::new(LicenceTier::Demo));

    let reconciler =
        tier_reconciler::Reconciler::new(everywear_paths::data_dir(APPLET_ID), tier_handle.clone());

    let state = Arc::new(AppState {
        ace: Arc::new(Mutex::new(ace_server::AceServerManager::new())),
        encoder: Arc::new(Mutex::new(video_encoder::VideoEncoderManager::new())),
        tier: tier_handle,
        http: reqwest::Client::new(),
        ipc_secret: ipc_secret.clone(),
        last_shell_contact: Arc::new(Mutex::new(Instant::now())),
        shutdown: shutdown.clone(),
        reconciler: Some(reconciler.clone()),
        daw_engine: Arc::new(Mutex::new(None)),
        beats_cache: Arc::new(beats::BeatsCache::new(beats_dir)),
        ipc_tx: ipc_tx.clone(),
    });

    // Bring up the S3/Gener8 local service surface. The shim is the web/API
    // compatibility layer used by the existing Studio UI, while ACE and the
    // video encoder are best-effort sidecars managed by this applet process.
    if let Err(e) = shim::boot(
        state.http.clone(),
        SHIM_PORT,
        ACE_PORT,
        state.beats_cache.clone(),
        state.reconciler.clone(),
        0,
        state.ace.clone(),
        state.daw_engine.clone(),
    )
    .await
    {
        warn!(error = %e, "Gener8 shim failed to boot");
    }

    {
        let ace_mgr = state.ace.clone();
        tokio::spawn(async move {
            if let Err(e) = ace_server::boot(ace_mgr).await {
                warn!(error = %e, "ACE server did not boot; audio generation will be unavailable");
            }
        });
    }

    {
        let encoder_mgr = state.encoder.clone();
        tokio::spawn(async move {
            if let Err(e) = video_encoder::boot(encoder_mgr, None).await {
                warn!(error = %e, "Video encoder sidecar did not boot");
            }
        });
    }

    // --- Send HMAC handshake + AdvertiseCapabilities ---
    let capabilities_payload = serde_json::json!({
        "engine_id": ENGINE_ID,
        "capabilities": ["audio_gen", "music_gen"],
        "input_schemas": {
            "audio_gen": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "style": { "type": "string" },
                    "duration": { "type": "number" },
                    "seed": { "type": "integer" }
                }
            }
        },
        "output_schemas": {
            "audio_gen": {
                "type": "object",
                "properties": {
                    "audio_key": { "type": "string" },
                    "duration": { "type": "number" }
                }
            }
        },
        "vram_requirement_mb": 4096
    });

    let adv_envelope = IpcEnvelope::event(
        IpcSource::Applet {
            applet_id: APPLET_ID.to_string(),
        },
        serde_json::json!({
            "cmd": "advertise_capabilities",
            "capabilities": capabilities_payload,
        }),
    );

    // Sign the handshake envelope
    let adv_payload_bytes = serde_json::to_vec(&adv_envelope.payload).unwrap_or_default();
    let hmac_sig = applet_ipc::envelope::compute_hmac(&ipc_secret, &adv_payload_bytes);
    let adv_envelope = adv_envelope.with_hmac(hmac_sig);

    let _ = ipc_tx.send(adv_envelope);
    info!("Sent AdvertiseCapabilities for engine {}", ENGINE_ID);

    // --- Spawn background tasks ---

    // 1. IPC read/write loop
    let ipc_state = state.clone();
    let ipc_shutdown = shutdown.clone();
    let ipc_handle = tokio::spawn(ipc_handler::run_ipc_loop(
        stream,
        ipc_rx,
        ipc_state,
        ipc_shutdown,
    ));

    // 2. Heartbeat sender (5s interval)
    let hb_tx = ipc_tx.clone();
    let hb_shutdown = shutdown.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let ping = IpcEnvelope::event(
                        IpcSource::Applet { applet_id: APPLET_ID.to_string() },
                        serde_json::json!({ "cmd": "ping" }),
                    );
                    if hb_tx.send(ping).is_err() {
                        warn!("Heartbeat channel closed");
                        break;
                    }
                }
                _ = hb_shutdown.notified() => {
                    info!("Heartbeat task shutting down");
                    break;
                }
            }
        }
    });

    // 3. IPC health monitor (10s timeout → self-shutdown)
    let health_state = state.clone();
    let health_shutdown = shutdown.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let last = *health_state.last_shell_contact.lock().await;
                    if last.elapsed() > IPC_LOSS_TIMEOUT {
                        warn!(
                            "Shell contact lost for {:?}; initiating self-shutdown",
                            last.elapsed()
                        );
                        health_shutdown.notify_waiters();
                        break;
                    }
                }
                _ = health_shutdown.notified() => {
                    break;
                }
            }
        }
    });

    // 4. Tier reconciler grace tick (hourly)
    let grace_reconciler = reconciler.clone();
    let grace_shutdown = shutdown.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    grace_reconciler.grace_tick().await;
                }
                _ = grace_shutdown.notified() => {
                    break;
                }
            }
        }
    });

    // --- Wait for shutdown signal ---
    shutdown.notified().await;
    info!("Shutdown signal received; cleaning up");

    // --- Graceful cleanup ---
    {
        let mut ace = state.ace.lock().await;
        ace.stop();
    }
    {
        let mut enc = state.encoder.lock().await;
        enc.stop();
    }

    // Send WithdrawCapabilities before disconnecting
    let withdraw = IpcEnvelope::event(
        IpcSource::Applet {
            applet_id: APPLET_ID.to_string(),
        },
        serde_json::json!({
            "cmd": "withdraw_capabilities",
            "engine_id": ENGINE_ID,
        }),
    );
    let _ = ipc_tx.send(withdraw);

    // Give IPC a moment to flush
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Abort the IPC loop
    ipc_handle.abort();

    info!("Gener8 applet exiting cleanly");
    std::process::exit(0);
}
