//! IPC message dispatch loop for the Gener8 applet.
//!
//! Runs as a long-lived tokio task. Reads envelopes from the shell TCP stream,
//! dispatches commands to the appropriate handler, and writes outbound envelopes
//! (heartbeats, events, responses) back to the stream.
//!
//! All inbound HMAC verification for privileged commands (TierSync, AuthContext)
//! happens here before dispatch.

use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Notify};
use tracing::{error, info, warn};

use applet_ipc::{envelope::verify_hmac, CommandKind, IpcEnvelope, IpcKind, IpcSource, Response};

use crate::{engine_client, AppState, LicenceTier, APPLET_ID};

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

/// Run the bidirectional IPC loop until shutdown or connection loss.
///
/// - Reads newline-delimited JSON envelopes from the shell
/// - Dispatches commands to handlers
/// - Writes outbound envelopes from the `ipc_rx` channel
pub async fn run_ipc_loop(
    stream: TcpStream,
    mut ipc_rx: mpsc::UnboundedReceiver<IpcEnvelope>,
    state: Arc<AppState>,
    shutdown: Arc<Notify>,
) {
    let (reader_half, mut writer_half) = stream.into_split();
    let mut reader = BufReader::new(reader_half);
    let mut line = String::new();
    let mut seq_out: u64 = 0;

    loop {
        tokio::select! {
            // --- Inbound: read from shell ---
            result = reader.read_line(&mut line) => {
                match result {
                    Ok(0) => {
                        info!("Shell closed IPC connection");
                        shutdown.notify_waiters();
                        break;
                    }
                    Ok(_) => {
                        // Update last contact time
                        {
                            let mut last = state.last_shell_contact.lock().await;
                            *last = std::time::Instant::now();
                        }

                        // Try envelope (v2) first, fall back to legacy command
                        if let Ok(envelope) = serde_json::from_str::<IpcEnvelope>(line.trim()) {
                            handle_envelope(&state, &envelope).await;
                        } else if let Ok(cmd) = serde_json::from_str::<applet_ipc::Command>(line.trim()) {
                            let resp = handle_legacy_command(&state, &cmd).await;
                            let mut msg = serde_json::to_string(&resp).unwrap_or_default();
                            msg.push('\n');
                            if let Err(e) = writer_half.write_all(msg.as_bytes()).await {
                                error!("IPC write failed: {}", e);
                                shutdown.notify_waiters();
                                break;
                            }
                            let _ = writer_half.flush().await;
                        } else {
                            warn!(raw = %line.trim(), "Failed to parse IPC message");
                        }

                        line.clear();
                    }
                    Err(e) => {
                        error!("IPC read error: {}", e);
                        shutdown.notify_waiters();
                        break;
                    }
                }
            }

            // --- Outbound: write from internal channel ---
            Some(mut envelope) = ipc_rx.recv() => {
                envelope = envelope.with_seq(seq_out);
                seq_out += 1;

                let mut msg = match serde_json::to_string(&envelope) {
                    Ok(m) => m,
                    Err(e) => {
                        error!("Failed to serialize outbound envelope: {}", e);
                        continue;
                    }
                };
                msg.push('\n');

                if let Err(e) = writer_half.write_all(msg.as_bytes()).await {
                    error!("IPC write failed: {}", e);
                    shutdown.notify_waiters();
                    break;
                }
                let _ = writer_half.flush().await;
            }

            // --- Shutdown signal ---
            _ = shutdown.notified() => {
                info!("IPC loop received shutdown signal");
                break;
            }
        }
    }
}

/// Handle an envelope-protocol (v2) message from the shell.
async fn handle_envelope(state: &Arc<AppState>, envelope: &IpcEnvelope) {
    // Only process commands and events from the shell
    if envelope.source != IpcSource::Shell {
        warn!(
            "Ignoring envelope from non-shell source: {:?}",
            envelope.source
        );
        return;
    }

    match envelope.kind {
        IpcKind::Command => {
            // Parse the command kind from the payload
            if let Ok(cmd_kind) = serde_json::from_value::<CommandKind>(envelope.payload.clone()) {
                match cmd_kind {
                    CommandKind::Shutdown => {
                        info!("Received Shutdown command from shell");
                        // Respond OK before shutting down
                        let resp = response_envelope(&envelope.id, Response::ok(&envelope.id));
                        let _ = state.ipc_tx.send(resp);
                        state.shutdown.notify_waiters();
                    }

                    CommandKind::UnloadModel => {
                        info!("Received UnloadModel command");
                        let mut ace = state.ace.lock().await;
                        ace.stop();
                        let resp = response_envelope(&envelope.id, Response::ok(&envelope.id));
                        let _ = state.ipc_tx.send(resp);
                    }

                    CommandKind::Ping => {
                        let detail = serde_json::json!({ "applet_id": APPLET_ID }).to_string();
                        let resp = response_envelope(
                            &envelope.id,
                            Response::ok_with(&envelope.id, detail),
                        );
                        let _ = state.ipc_tx.send(resp);
                    }

                    CommandKind::ExecuteJob { job } => {
                        info!("Received ExecuteJob");
                        engine_client::handle_execute_job(state, &envelope.id, job).await;
                    }

                    CommandKind::CancelJob { job_id } => {
                        info!(job_id = %job_id, "Received CancelJob");
                        engine_client::handle_cancel_job(state, &envelope.id, &job_id).await;
                    }

                    CommandKind::Warmup { capability } => {
                        info!(capability = %capability, "Received Warmup");
                        engine_client::handle_warmup(state, &envelope.id, &capability).await;
                    }

                    CommandKind::StartInference { model_paths } => {
                        info!(models = model_paths.len(), "Received StartInference");
                        engine_client::handle_start_inference(state, &envelope.id, model_paths)
                            .await;
                    }

                    CommandKind::QueryStatus => {
                        let tier = state.tier.lock().await;
                        let ace = state.ace.lock().await;
                        let detail = serde_json::json!({
                            "applet_id": APPLET_ID,
                            "tier": tier.as_str(),
                            "ace_running": ace.is_running(),
                        })
                        .to_string();
                        let resp = response_envelope(
                            &envelope.id,
                            Response::ok_with(&envelope.id, detail),
                        );
                        let _ = state.ipc_tx.send(resp);
                    }

                    CommandKind::TierSync {
                        tier,
                        exp,
                        signature,
                    } => {
                        handle_tier_sync(state, envelope, &tier, exp, &signature).await;
                    }

                    CommandKind::AuthContext { token, user_id } => {
                        handle_auth_context(state, envelope, &token, &user_id).await;
                    }

                    _ => {
                        warn!("Unhandled command kind: {:?}", cmd_kind);
                    }
                }
            } else {
                warn!("Failed to parse CommandKind from envelope payload");
            }
        }

        IpcKind::Event => {
            // Events from shell: JobComplete, JobFailed, JobProgress
            if let Some(cmd_str) = envelope.payload.get("cmd").and_then(|v| v.as_str()) {
                match cmd_str {
                    "job_complete" => {
                        let job_id = envelope
                            .payload
                            .get("job_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let result = envelope
                            .payload
                            .get("result")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        engine_client::on_job_complete(state, job_id, result).await;
                    }
                    "job_failed" => {
                        let job_id = envelope
                            .payload
                            .get("job_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let error = envelope
                            .payload
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown error");
                        engine_client::on_job_failed(state, job_id, error).await;
                    }
                    "job_progress" => {
                        let job_id = envelope
                            .payload
                            .get("job_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let percent = envelope
                            .payload
                            .get("percent")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u8;
                        engine_client::on_job_progress(state, job_id, percent).await;
                    }
                    _ => {
                        info!(cmd = cmd_str, "Received shell event");
                    }
                }
            }
        }

        IpcKind::Response => {
            // Responses to our submitted jobs/plans
            info!(id = %envelope.id, "Received response from shell");
        }
    }
}

/// Handle TierSync with HMAC verification.
async fn handle_tier_sync(
    state: &Arc<AppState>,
    envelope: &IpcEnvelope,
    tier_str: &str,
    exp: Option<i64>,
    signature: &str,
) {
    // HMAC verification: the shell signs the tier + exp with the shared secret
    let verify_data = match exp {
        Some(e) => format!("{}:{}", tier_str, e),
        None => tier_str.to_string(),
    };

    if !verify_hmac(&state.ipc_secret, verify_data.as_bytes(), signature) {
        warn!("TierSync HMAC verification failed; rejecting tier change");
        let resp = response_envelope(
            &envelope.id,
            Response::error(&envelope.id, "HMAC verification failed"),
        );
        let _ = state.ipc_tx.send(resp);
        return;
    }

    // Check expiry
    if let Some(exp_ts) = exp {
        let now = chrono::Utc::now().timestamp();
        if now > exp_ts {
            warn!("TierSync expired (exp={}, now={}); rejecting", exp_ts, now);
            let resp = response_envelope(
                &envelope.id,
                Response::error(&envelope.id, "tier claim expired"),
            );
            let _ = state.ipc_tx.send(resp);
            return;
        }
    }

    let new_tier = LicenceTier::from_str(tier_str);
    info!(tier = tier_str, "TierSync accepted (HMAC verified)");

    {
        let mut current = state.tier.lock().await;
        *current = new_tier;
    }

    // Trigger reconciler to apply tier-gated model changes
    if let Some(ref reconciler) = state.reconciler {
        if let Err(e) = reconciler.reconcile_once().await {
            tracing::warn!(error = %e, "Tier reconciliation failed after TierSync");
        }
    }

    let detail = serde_json::json!({ "tier": tier_str }).to_string();
    let resp = response_envelope(&envelope.id, Response::ok_with(&envelope.id, detail));
    let _ = state.ipc_tx.send(resp);
}

/// Handle AuthContext from shell (JWT + user ID relay).
async fn handle_auth_context(
    state: &Arc<AppState>,
    envelope: &IpcEnvelope,
    _token: &str,
    _user_id: &str,
) {
    // Verify HMAC on the envelope
    if let Some(ref hmac_sig) = envelope.hmac {
        let payload_bytes = serde_json::to_vec(&envelope.payload).unwrap_or_default();
        if !verify_hmac(&state.ipc_secret, &payload_bytes, hmac_sig) {
            warn!("AuthContext HMAC verification failed");
            return;
        }
    } else {
        warn!("AuthContext missing HMAC signature");
        return;
    }

    info!("AuthContext received (user context established)");
    // Future: store user_id for per-user data scoping
}

/// Handle a legacy (v1) command. Backward compatibility with older shell versions.
async fn handle_legacy_command(state: &Arc<AppState>, cmd: &applet_ipc::Command) -> Response {
    match &cmd.kind {
        CommandKind::Shutdown => {
            info!("Legacy Shutdown command");
            state.shutdown.notify_waiters();
            Response::ok(&cmd.id)
        }
        CommandKind::UnloadModel => {
            info!("Legacy UnloadModel command");
            let mut ace = state.ace.lock().await;
            ace.stop();
            Response::ok(&cmd.id)
        }
        CommandKind::Ping => Response::ok_with(&cmd.id, "gener8 alive"),
        _ => {
            warn!(kind = ?cmd.kind, "Unhandled legacy command");
            Response::error(&cmd.id, "unhandled command")
        }
    }
}
