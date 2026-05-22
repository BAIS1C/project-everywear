//! Engine Client: async job submission + event listeners.
//!
//! The Gener8 applet is both an engine (executes audio_gen jobs via ACE) and
//! a consumer (submits plans to the shell router for cross-engine orchestration).
//!
//! Outbound path (applet → shell):
//!   - SubmitJob: single ad-hoc job → shell router validates + enqueues
//!   - SubmitPlan: atomic multi-job plan → shell validates all-or-nothing
//!   Both return immediately; results arrive as JobComplete/JobFailed events.
//!
//! Inbound path (shell → applet):
//!   - ExecuteJob: shell tells us to run an audio_gen job locally
//!   - JobComplete/JobFailed/JobProgress: results from jobs we submitted

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use applet_ipc::{IpcEnvelope, IpcSource, ModelPath, Response};

use crate::{AppState, APPLET_ID};

fn applet_source() -> IpcSource {
    IpcSource::Applet {
        applet_id: APPLET_ID.to_string(),
    }
}

fn response_envelope(request_id: &str, response: Response) -> IpcEnvelope {
    let payload = serde_json::to_value(response).unwrap_or_else(|error| {
        serde_json::json!({
            "id": request_id,
            "status": "error",
            "detail": format!("failed to serialize response: {error}"),
        })
    });
    IpcEnvelope::response(request_id, applet_source(), payload)
}

// ---------------------------------------------------------------------------
// Job tracking
// ---------------------------------------------------------------------------

/// Tracks pending jobs this applet has submitted to the shell.
/// Key: job_id, Value: callback/state for when the result arrives.
#[derive(Debug, Clone)]
pub struct PendingJob {
    pub job_id: String,
    pub capability: String,
    pub submitted_at: std::time::Instant,
}

/// Tracks jobs the shell has asked us to execute locally.
#[derive(Debug, Clone)]
pub struct ActiveJob {
    pub job_id: String,
    pub capability: String,
    pub started_at: std::time::Instant,
    /// Cancel token: set to true to request cancellation.
    pub cancelled: bool,
}

// These would be stored in AppState in a real impl; for now they're module-level
// behind a mutex. When the shim and other handlers need access, they go through
// the functions below.
static PENDING_JOBS: Mutex<Option<HashMap<String, PendingJob>>> = Mutex::const_new(None);
static ACTIVE_JOBS: Mutex<Option<HashMap<String, ActiveJob>>> = Mutex::const_new(None);

fn ensure_pending() -> &'static Mutex<Option<HashMap<String, PendingJob>>> {
    &PENDING_JOBS
}
fn ensure_active() -> &'static Mutex<Option<HashMap<String, ActiveJob>>> {
    &ACTIVE_JOBS
}

async fn get_pending() -> tokio::sync::MutexGuard<'static, Option<HashMap<String, PendingJob>>> {
    let mut guard = ensure_pending().lock().await;
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

async fn get_active() -> tokio::sync::MutexGuard<'static, Option<HashMap<String, ActiveJob>>> {
    let mut guard = ensure_active().lock().await;
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

// ---------------------------------------------------------------------------
// Outbound: submit jobs to the shell
// ---------------------------------------------------------------------------

/// Submit a single ad-hoc job to the shell router. Non-blocking.
/// Returns the job_id for tracking.
pub async fn submit_job(
    state: &Arc<AppState>,
    capability: &str,
    params: serde_json::Value,
) -> String {
    let job_id = uuid::Uuid::new_v4().to_string();

    let job_payload = serde_json::json!({
        "cmd": "submit_job",
        "job": {
            "job_id": &job_id,
            "capability": capability,
            "applet_id": APPLET_ID,
            "params": params,
        }
    });

    let envelope = IpcEnvelope::event(
        IpcSource::Applet {
            applet_id: APPLET_ID.to_string(),
        },
        job_payload,
    );

    // Track the pending job
    {
        let mut pending = get_pending().await;
        if let Some(ref mut map) = *pending {
            map.insert(
                job_id.clone(),
                PendingJob {
                    job_id: job_id.clone(),
                    capability: capability.to_string(),
                    submitted_at: std::time::Instant::now(),
                },
            );
        }
    }

    let _ = state.ipc_tx.send(envelope);
    info!(job_id = %job_id, capability = capability, "Submitted job to shell");
    job_id
}

/// Submit an atomic multi-job plan to the shell router. Non-blocking.
/// Returns the plan_id. All jobs in the plan are enqueued atomically.
pub async fn submit_plan(state: &Arc<AppState>, jobs: Vec<serde_json::Value>) -> String {
    let plan_id = uuid::Uuid::new_v4().to_string();

    let plan_payload = serde_json::json!({
        "cmd": "submit_plan",
        "plan": {
            "plan_id": &plan_id,
            "applet_id": APPLET_ID,
            "jobs": jobs,
        }
    });

    let envelope = IpcEnvelope::event(
        IpcSource::Applet {
            applet_id: APPLET_ID.to_string(),
        },
        plan_payload,
    );

    // Track each job in the plan
    {
        let mut pending = get_pending().await;
        if let Some(ref mut map) = *pending {
            for job in &jobs {
                if let Some(job_id) = job.get("job_id").and_then(|v| v.as_str()) {
                    let cap = job
                        .get("capability")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    map.insert(
                        job_id.to_string(),
                        PendingJob {
                            job_id: job_id.to_string(),
                            capability: cap.to_string(),
                            submitted_at: std::time::Instant::now(),
                        },
                    );
                }
            }
        }
    }

    let _ = state.ipc_tx.send(envelope);
    info!(plan_id = %plan_id, job_count = jobs.len(), "Submitted plan to shell");
    plan_id
}

// ---------------------------------------------------------------------------
// Inbound: shell tells us to execute a job
// ---------------------------------------------------------------------------

/// Handle an ExecuteJob command from the shell. This means the shell has
/// routed a job to our engine and expects us to run inference locally.
pub async fn handle_execute_job(state: &Arc<AppState>, request_id: &str, job: serde_json::Value) {
    let job_id = job
        .get("job_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let capability = job
        .get("capability")
        .and_then(|v| v.as_str())
        .unwrap_or("audio_gen")
        .to_string();

    info!(job_id = %job_id, capability = %capability, "Executing job locally");

    // Track as active
    {
        let mut active = get_active().await;
        if let Some(ref mut map) = *active {
            map.insert(
                job_id.clone(),
                ActiveJob {
                    job_id: job_id.clone(),
                    capability: capability.clone(),
                    started_at: std::time::Instant::now(),
                    cancelled: false,
                },
            );
        }
    }

    // ACK the command immediately
    let detail = serde_json::json!({ "job_id": &job_id }).to_string();
    let ack = response_envelope(request_id, Response::ok_with(request_id, detail));
    let _ = state.ipc_tx.send(ack);

    // Spawn the actual inference work
    let state_clone = state.clone();
    let jid = job_id.clone();
    tokio::spawn(async move {
        match execute_audio_gen(&state_clone, &jid, &job).await {
            Ok(result) => {
                // Report success back to shell
                let complete = IpcEnvelope::event(
                    applet_source(),
                    serde_json::json!({
                        "cmd": "job_complete",
                        "job_id": &jid,
                        "result": result,
                    }),
                );
                let _ = state_clone.ipc_tx.send(complete);
            }
            Err(e) => {
                error!(job_id = %jid, error = %e, "Job execution failed");
                let failed = IpcEnvelope::event(
                    applet_source(),
                    serde_json::json!({
                        "cmd": "job_failed",
                        "job_id": &jid,
                        "error": e.to_string(),
                    }),
                );
                let _ = state_clone.ipc_tx.send(failed);
            }
        }

        // Remove from active jobs
        let mut active = get_active().await;
        if let Some(ref mut map) = *active {
            map.remove(&jid);
        }
    });
}

/// Execute an audio generation job via the local ACE server.
async fn execute_audio_gen(
    state: &Arc<AppState>,
    job_id: &str,
    job: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let params = job.get("params").cloned().unwrap_or(serde_json::json!({}));

    // Send progress: 0%
    send_progress(state, job_id, 0).await;

    // Proxy the generation request to ace-server on :8080
    let ace_url = format!("http://127.0.0.1:{}/generate", crate::ACE_PORT);
    let resp = state
        .http
        .post(&ace_url)
        .json(&params)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("ace-server request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("ace-server returned {}: {}", status, body));
    }

    // Send progress: 50% (generation complete, saving)
    send_progress(state, job_id, 50).await;

    let result = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse ace-server response: {}", e))?;

    // Send progress: 100%
    send_progress(state, job_id, 100).await;

    Ok(result)
}

async fn send_progress(state: &Arc<AppState>, job_id: &str, percent: u8) {
    let progress = IpcEnvelope::event(
        applet_source(),
        serde_json::json!({
            "cmd": "job_progress",
            "job_id": job_id,
            "percent": percent,
        }),
    );
    let _ = state.ipc_tx.send(progress);
}

/// Handle a CancelJob command from the shell.
pub async fn handle_cancel_job(state: &Arc<AppState>, request_id: &str, job_id: &str) {
    let mut cancelled = false;
    {
        let mut active = get_active().await;
        if let Some(ref mut map) = *active {
            if let Some(job) = map.get_mut(job_id) {
                job.cancelled = true;
                cancelled = true;
            }
        }
    }

    let response = if cancelled {
        Response::ok_with(request_id, "cancellation requested")
    } else {
        Response::error(request_id, "job not found")
    };
    let resp = response_envelope(request_id, response);
    let _ = state.ipc_tx.send(resp);
}

/// Handle a Warmup command: run a minimal inference pass to compile CUDA kernels.
pub async fn handle_warmup(state: &Arc<AppState>, request_id: &str, capability: &str) {
    info!(capability = capability, "Running warmup pass");

    // Warmup is a lightweight ping to ace-server's /props
    let ace_url = format!("http://127.0.0.1:{}/props", crate::ACE_PORT);
    let warmup_ok = state.http.get(&ace_url).send().await.is_ok();

    let detail = serde_json::json!({ "capability": capability }).to_string();
    let response = if warmup_ok {
        Response::ok_with(request_id, detail)
    } else {
        Response::error(request_id, detail)
    };
    let resp = response_envelope(request_id, response);
    let _ = state.ipc_tx.send(resp);
}

/// Handle StartInference: shell tells us to load models into GPU context.
pub async fn handle_start_inference(
    state: &Arc<AppState>,
    request_id: &str,
    model_paths: Vec<ModelPath>,
) {
    info!(models = model_paths.len(), "StartInference: loading models");

    // For ACE-Step, the model paths inform which GGUFs to load.
    // The ace-server discovers models from its --models dir argument,
    // so we just need to ensure ace-server is running with the right dir.
    let models_dir = everywear_paths::models_dir();
    let ace = state.ace.lock().await;

    let status = if ace.is_running() {
        "ok"
    } else {
        // ACE server not running yet; it will be started by the boot sequence
        "pending"
    };

    let detail = serde_json::json!({
        "status": status,
        "models_dir": models_dir.to_string_lossy(),
        "model_count": model_paths.len(),
    })
    .to_string();
    let resp = response_envelope(request_id, Response::ok_with(request_id, detail));
    let _ = state.ipc_tx.send(resp);
}

// ---------------------------------------------------------------------------
// Event callbacks (results from jobs we submitted)
// ---------------------------------------------------------------------------

/// Called when a job we submitted completes successfully.
pub async fn on_job_complete(_state: &Arc<AppState>, job_id: &str, result: serde_json::Value) {
    info!(job_id = job_id, "Job completed");

    // Remove from pending
    let mut pending = get_pending().await;
    if let Some(ref mut map) = *pending {
        if let Some(job) = map.remove(job_id) {
            info!(
                job_id = job_id,
                capability = %job.capability,
                elapsed_ms = job.submitted_at.elapsed().as_millis() as u64,
                "Pending job resolved"
            );
        }
    }

    // Future: notify the shim / frontend about the result
    // For now, results are logged and available via the library index
}

/// Called when a job we submitted fails.
pub async fn on_job_failed(_state: &Arc<AppState>, job_id: &str, error: &str) {
    warn!(job_id = job_id, error = error, "Job failed");

    let mut pending = get_pending().await;
    if let Some(ref mut map) = *pending {
        map.remove(job_id);
    }
}

/// Called when a job we submitted reports progress.
pub async fn on_job_progress(_state: &Arc<AppState>, job_id: &str, percent: u8) {
    info!(job_id = job_id, percent = percent, "Job progress");
    // Future: relay to shim / frontend via SSE or websocket
}

// ---------------------------------------------------------------------------
// FileRef helpers
// ---------------------------------------------------------------------------

/// A reference to a file in the staging area or output directory.
/// Used for passing large payloads between shell and applet without
/// embedding them in IPC messages.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileRef {
    /// Absolute path to the file.
    pub path: std::path::PathBuf,
    /// SHA256 hash for integrity verification.
    pub sha256: Option<String>,
    /// Size in bytes.
    pub size_bytes: Option<u64>,
    /// MIME type hint.
    pub content_type: Option<String>,
}

impl FileRef {
    /// Create a FileRef pointing to a file in the applet's data directory.
    pub fn in_data_dir(relative: &str) -> Self {
        let path = everywear_paths::data_dir(APPLET_ID).join(relative);
        Self {
            path,
            sha256: None,
            size_bytes: None,
            content_type: None,
        }
    }

    /// Create a FileRef pointing to a file in the staging directory.
    pub fn in_staging(relative: &str) -> Self {
        let path = everywear_paths::staging_dir().join(relative);
        Self {
            path,
            sha256: None,
            size_bytes: None,
            content_type: None,
        }
    }

    /// Verify the file exists and optionally check its SHA256 hash.
    pub async fn verify(&self) -> anyhow::Result<()> {
        let meta = tokio::fs::metadata(&self.path)
            .await
            .map_err(|e| anyhow::anyhow!("FileRef path does not exist: {}", e))?;

        if let Some(expected_size) = self.size_bytes {
            if meta.len() != expected_size {
                return Err(anyhow::anyhow!(
                    "FileRef size mismatch: expected {}, got {}",
                    expected_size,
                    meta.len()
                ));
            }
        }

        if let Some(ref expected_hash) = self.sha256 {
            use sha2::{Digest, Sha256};
            let bytes = tokio::fs::read(&self.path).await?;
            let hash = hex::encode(Sha256::digest(&bytes));
            if &hash != expected_hash {
                return Err(anyhow::anyhow!(
                    "FileRef SHA256 mismatch: expected {}, got {}",
                    expected_hash,
                    hash
                ));
            }
        }

        Ok(())
    }
}
