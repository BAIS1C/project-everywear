//! Wire protocol: newline-delimited JSON messages.
//!
//! Two protocol modes:
//! - **Legacy** (v1): raw `Command` / `Response` on the wire. Used by current
//!   1magen standalone. Still accepted for backward compatibility.
//! - **Envelope** (v2): all messages wrapped in `IpcEnvelope`. Used by
//!   migration-era applets. Supports events, async results, HMAC auth.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Environment variable the shell sets on the child process: IPC port.
pub const ENV_CMD_PORT: &str = "EVERYWEAR_CMD_PORT";

/// Environment variable the shell sets: shared secret for HMAC authentication.
pub const ENV_IPC_SECRET: &str = "EVERYWEAR_IPC_SECRET";

// ---------------------------------------------------------------------------
// Legacy wire types (v1, backward compat)
// ---------------------------------------------------------------------------

/// Commands the shell can send to a running applet (legacy wire format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    /// Unique request ID for correlation (UUID v4).
    pub id: String,
    pub kind: CommandKind,
}

/// All command variants, both legacy and migration-era.
///
/// Legacy commands (UnloadModel, Shutdown, Ping) remain unchanged.
/// New commands are additive; old applets simply ignore unknown variants
/// via `#[serde(other)]` on their local copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum CommandKind {
    // --- Legacy (v1) ---
    /// Release all models from GPU. Applet must free VRAM before responding.
    UnloadModel,
    /// Graceful shutdown. Applet should unload, flush state, and exit.
    Shutdown,
    /// Health check. Applet responds with status info.
    Ping,

    // --- Engine discovery (applet -> shell, via Event envelope) ---
    /// Applet advertises what engines/capabilities it provides.
    AdvertiseCapabilities { capabilities: serde_json::Value },
    /// Applet withdraws a previously advertised engine.
    WithdrawCapabilities { engine_id: String },

    // --- Job execution (shell -> engine applet) ---
    /// Shell tells engine applet to execute a job.
    ExecuteJob { job: serde_json::Value },
    /// Shell tells engine applet to cancel a running/queued job.
    CancelJob { job_id: String },
    /// Shell tells engine applet to run a warmup pass (dummy inference
    /// at minimal resolution to compile CUDA kernels).
    Warmup { capability: String },

    // --- Job submission (applet -> shell, via Event envelope) ---
    /// Applet submits a single ad-hoc job to the shell router.
    SubmitJob { job: serde_json::Value },
    /// Applet submits an entire plan atomically (all-or-nothing enqueue).
    SubmitPlan { plan: serde_json::Value },

    // --- Job results (shell -> requesting applet, via Event envelope) ---
    /// Job completed successfully.
    JobComplete {
        job_id: String,
        result: serde_json::Value,
    },
    /// Job failed.
    JobFailed { job_id: String, error: String },
    /// Job progress update.
    JobProgress { job_id: String, percent: u8 },

    // --- Lifecycle ---
    /// Shell tells applet to prepare for inference: here are the model paths.
    /// Applet loads into its own GPU context.
    StartInference { model_paths: Vec<ModelPath> },
    /// Shell queries applet status (loaded models, VRAM usage, etc.)
    QueryStatus,

    // --- Auth / tier (shell -> applet, HMAC signed) ---
    /// Shell pushes signed tier state. Applet verifies HMAC before accepting.
    TierSync {
        tier: String,
        exp: Option<i64>,
        signature: String,
    },
    /// Shell provides auth context (JWT + user ID) on applet launch.
    AuthContext { token: String, user_id: String },
}

/// A model path reference sent from shell to applet during StartInference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPath {
    /// Role of this model: "primary", "encoder", "vae", "lora", "dit", etc.
    pub role: String,
    /// Absolute path to the model file (resolved by shell via model-manager).
    pub path: PathBuf,
    /// Expected VRAM consumption in MB.
    pub vram_mb: u32,
}

/// Responses the applet sends back to the shell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    /// Echoes the request ID.
    pub id: String,
    pub status: ResponseStatus,
    /// Optional detail message (error reason, timing info, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    Ok,
    Error,
}

impl Command {
    pub fn new(kind: CommandKind) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            kind,
        }
    }
}

impl Response {
    pub fn ok(id: &str) -> Self {
        Self {
            id: id.to_string(),
            status: ResponseStatus::Ok,
            detail: None,
        }
    }

    pub fn ok_with(id: &str, detail: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            status: ResponseStatus::Ok,
            detail: Some(detail.into()),
        }
    }

    pub fn error(id: &str, detail: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            status: ResponseStatus::Error,
            detail: Some(detail.into()),
        }
    }
}
