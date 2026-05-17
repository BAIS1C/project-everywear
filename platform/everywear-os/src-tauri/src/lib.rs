//! Everywear OS: AI platform shell.
//!
//! The shell owns GPU detection, model registry, VRAM arbitration,
//! user identity, wallet, Discourse integration, and the applet launcher.
//! Applets are thin UI layers that request resources via IPC.

mod applet_resolver;
mod assessment;
mod auth;
mod budget;
mod discourse;
mod engine_registry;
mod engine_router;
mod gpu;
mod launcher;
mod manifest_parser;
mod migration;
mod profile;
mod registry;
mod vram_scheduler;
mod wallet;

use applet_ipc::{CommandKind, IpcEnvelope, ResponseStatus};
use engine_registry::{EngineAvailability, EngineLifecycle};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

/// Shared application state injected into all IPC commands.
pub struct AppState {
    pub gpu: Arc<Mutex<gpu::SystemGpuState>>,
    pub profile: Arc<Mutex<profile::ProfileManager>>,
    pub wallet: Arc<Mutex<wallet::WalletManager>>,
    pub registry: Arc<Mutex<registry::AppletRegistry>>,
    pub discourse: Arc<Mutex<discourse::DiscourseClient>>,
    // ── Bridge: VRAM lifecycle ──
    pub budget: Arc<Mutex<budget::VramBudget>>,
    pub model_mgr: Arc<Mutex<model_manager::ModelManager>>,
    pub active_applet: Arc<Mutex<Option<String>>>,
    /// Running binary applet: child process + IPC channel.
    /// Held for unload_model, shutdown, and lifecycle management.
    pub applet_process: Arc<Mutex<Option<launcher::AppletProcess>>>,
    /// Runtime-discovered engine capabilities advertised by applets.
    pub engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    /// Runtime engine/heartbeat lifecycle scheduler.
    pub vram_scheduler: Arc<Mutex<vram_scheduler::VramScheduler>>,
    /// Current user licence tier (determines upgrade pack entitlement).
    /// Defaults to Demo; updated on Supabase auth hydration via
    /// `active_tier()` RPC. Shell is read-only for tier; Hub is the
    /// single writer (payment webhook -> subscriptions upsert).
    pub licence_tier: Arc<Mutex<model_manager::LicenceTier>>,
    /// Authenticated user session (from Supabase JWT).
    /// None until the EWDS frontend pushes auth state via `push_auth_state`.
    /// Shell owns the session; applets receive identity via `get_auth_context`.
    pub user_session: Arc<Mutex<Option<auth::UserClaim>>>,
}

// ─── GPU Commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn get_gpu_status(state: tauri::State<'_, AppState>) -> Result<gpu::SystemGpuState, String> {
    let gpu_state = gpu::detect_gpus();
    let mut stored = state.gpu.lock().await;
    *stored = gpu_state.clone();
    Ok(gpu_state)
}

#[tauri::command]
async fn poll_vram(
    state: tauri::State<'_, AppState>,
    gpu_index: u32,
) -> Result<serde_json::Value, String> {
    match gpu::poll_vram(gpu_index) {
        Some((used, free)) => Ok(serde_json::json!({ "used_mb": used, "free_mb": free })),
        None => Err("GPU not available".into()),
    }
}

#[tauri::command]
async fn get_compute_backend(
    state: tauri::State<'_, AppState>,
) -> Result<gpu::ComputeBackend, String> {
    let stored = state.gpu.lock().await;
    Ok(stored.backend.clone())
}

#[tauri::command]
async fn get_vram_tier(state: tauri::State<'_, AppState>) -> Result<gpu::VramTier, String> {
    let stored = state.gpu.lock().await;
    Ok(stored.vram_tier)
}

#[tauri::command]
async fn list_model_assessments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<assessment::ModelAssessment>, String> {
    let gpu_state = gpu::detect_gpus();
    let mut stored = state.gpu.lock().await;
    *stored = gpu_state.clone();
    Ok(assessment::list_model_assessments(&gpu_state))
}

// ─── Profile Commands ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_profile(state: tauri::State<'_, AppState>) -> Result<profile::UserProfile, String> {
    let mgr = state.profile.lock().await;
    mgr.get_profile().map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_profile(
    state: tauri::State<'_, AppState>,
    update: profile::ProfileUpdate,
) -> Result<profile::UserProfile, String> {
    let mgr = state.profile.lock().await;
    mgr.update_profile(update).map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_preference(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let mgr = state.profile.lock().await;
    mgr.set_pref(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_preference(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let mgr = state.profile.lock().await;
    Ok(mgr.get_pref(&key))
}

// ─── Wallet Commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn wallet_generate(state: tauri::State<'_, AppState>) -> Result<wallet::WalletInfo, String> {
    let mut w = state.wallet.lock().await;
    w.generate_keypair().map_err(|e| e.to_string())
}

#[tauri::command]
async fn wallet_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<wallet::WalletInfo>, String> {
    let w = state.wallet.lock().await;
    Ok(w.get_info())
}

#[tauri::command]
async fn wallet_transactions(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<wallet::Transaction>, String> {
    let w = state.wallet.lock().await;
    Ok(w.get_transactions(limit.unwrap_or(20)))
}

#[tauri::command]
async fn wallet_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut w = state.wallet.lock().await;
    w.disconnect();
    Ok(())
}

// ─── Discourse Commands ─────────────────────────────────────────────────────

#[tauri::command]
async fn discourse_oauth_url(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let client = state.discourse.lock().await;
    Ok(client.oauth_url())
}

#[tauri::command]
async fn discourse_user(
    state: tauri::State<'_, AppState>,
) -> Result<Option<discourse::DiscourseUser>, String> {
    let client = state.discourse.lock().await;
    client.get_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn discourse_latest(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<discourse::DiscoursePost>, String> {
    let client = state.discourse.lock().await;
    client
        .latest_posts(limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn discourse_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.discourse.lock().await;
    client.disconnect();
    Ok(())
}

// ─── Registry Commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn list_applets(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<registry::AppletEntry>, String> {
    let reg = state.registry.lock().await;
    Ok(reg.launchable())
}

#[tauri::command]
async fn get_applet(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Option<registry::AppletEntry>, String> {
    let reg = state.registry.lock().await;
    Ok(reg.get(&id).cloned())
}

// ─── VRAM Budget Commands (NEW: Bridge) ─────────────────────────────────────

#[tauri::command]
async fn get_vram_budget(state: tauri::State<'_, AppState>) -> Result<budget::VramBudget, String> {
    let b = state.budget.lock().await;
    Ok(b.clone())
}

#[tauri::command]
async fn get_active_applet(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let active = state.active_applet.lock().await;
    Ok(active.clone())
}

/// Check if an applet can launch without modifying state.
/// Frontend uses this to show UI hints (download required, purge needed, etc.)
#[tauri::command]
async fn check_applet_requirements(
    state: tauri::State<'_, AppState>,
    applet_id: String,
) -> Result<budget::RequirementsCheck, String> {
    let gpu_state = state.gpu.lock().await;
    let b = state.budget.lock().await;
    let model_mgr = state.model_mgr.lock().await;

    let policy = budget::PurgePolicy::from_tier(gpu_state.vram_tier);

    // Try to load manifest from applets/<id>/applet.toml
    let manifest_path = PathBuf::from(format!("applets/{}/applet.toml", applet_id));
    let manifest = match model_manager::AppletManifest::load(&manifest_path) {
        Ok(m) => m,
        Err(e) => {
            return Ok(budget::RequirementsCheck {
                can_launch: false,
                selected_group: None,
                selected_group_vram_mb: None,
                needs_download: vec![],
                needs_purge: false,
                purge_applet: None,
                reason: Some(format!("Failed to load manifest: {e}")),
            });
        }
    };

    Ok(launcher::check_requirements(
        &manifest, &b, &policy, &model_mgr,
    ))
}

// ─── Applet Launch Pipeline (NEW: Bridge) ───────────────────────────────────

/// Full applet switch pipeline: gate -> purge -> provision -> handoff.
///
/// This replaces the old stub `launch_applet`. The frontend should call
/// `check_applet_requirements` first to show the user what will happen,
/// then call this after user confirmation.
#[tauri::command]
async fn request_applet_switch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    applet_id: String,
) -> Result<(), String> {
    let _ = app.emit(
        "applet-switch-progress",
        launcher::SwitchProgressPayload {
            stage: launcher::SwitchStage::GateCheck,
            message: "Checking requirements...".into(),
        },
    );

    // ── 1. Gate check ──
    let gpu_state = state.gpu.lock().await;
    let policy = budget::PurgePolicy::from_tier(gpu_state.vram_tier);
    drop(gpu_state); // release lock early

    let reg = state.registry.lock().await;
    let applet = reg
        .get(&applet_id)
        .ok_or_else(|| format!("Applet '{applet_id}' not found"))?
        .clone();
    drop(reg);

    if applet.status == registry::AppletStatus::Locked {
        return Err("Applet is locked. Purchase or subscribe to unlock.".into());
    }
    if applet.status == registry::AppletStatus::NotBuilt {
        return Err("Applet is not yet available.".into());
    }

    // Web applets: just open the URL, no VRAM management needed
    if let Some(url) = &applet.launch_url {
        tracing::info!(applet = %applet_id, url, "Launching web applet (no VRAM)");
        open::that(url).map_err(|e| format!("Failed to open URL: {e}"))?;
        return Ok(());
    }

    // Tauri binary applets: full pipeline
    // Resolve manifest path relative to monorepo root (not CWD, which
    // may be target/release/ during dev builds).
    let manifest_path = {
        let monorepo =
            registry::find_monorepo_root_from_exe().unwrap_or_else(|| PathBuf::from("."));
        monorepo.join(format!("applets/{}/applet.toml", applet_id))
    };
    let manifest = model_manager::AppletManifest::load(&manifest_path)
        .map_err(|e| format!("Failed to load manifest: {e}"))?;

    let mut budget_lock = state.budget.lock().await;

    // Populate ModelManager with download metadata from applet.toml so that
    // is_downloaded() can find models by key and download() knows where to
    // fetch them from. Must happen before check_requirements reads the manifest.
    {
        let mut mgr = state.model_mgr.lock().await;
        let infos = launcher::manifest_info_from_groups(&manifest);
        if !infos.is_empty() {
            tracing::info!(
                applet = %applet_id,
                models = infos.len(),
                "Populated ModelManager from applet.toml"
            );
            mgr.add_models(infos);
            mgr.scan(); // re-scan so newly registered models get discovered on disk
        }
    }

    let model_mgr_lock = state.model_mgr.lock().await;
    let check = launcher::check_requirements(&manifest, &budget_lock, &policy, &model_mgr_lock);
    if !check.can_launch {
        return Err(check.reason.unwrap_or("Cannot launch applet".into()));
    }

    let selected_group_label = check.selected_group.clone().unwrap_or_default();
    let selected_group = manifest
        .model_groups
        .iter()
        .find(|g| g.label == selected_group_label)
        .ok_or("Selected model group not found in manifest")?;

    drop(model_mgr_lock); // need mutable borrow later

    // ── 4. Purge cycle (if needed) ──
    if check.needs_purge {
        if let Some(current_id) = check.purge_applet.as_deref() {
            let _ = app.emit(
                "applet-switch-progress",
                launcher::SwitchProgressPayload {
                    stage: launcher::SwitchStage::Purging,
                    message: format!("Unloading {}...", current_id),
                },
            );

            let purge_req = budget::build_purge_request(current_id, &budget_lock, &policy);

            // Send unload_model to the running applet via IPC channel
            {
                let mut proc_lock = state.applet_process.lock().await;
                if let Some(ref mut applet_proc) = *proc_lock {
                    let unload_timeout = std::time::Duration::from_secs(30);
                    match applet_proc.ipc.unload_model(unload_timeout).await {
                        Ok(resp) => {
                            if resp.status == ResponseStatus::Ok {
                                tracing::info!(
                                    applet = current_id,
                                    "Applet acknowledged unload_model"
                                );
                            } else {
                                tracing::warn!(
                                    applet = current_id,
                                    detail = ?resp.detail,
                                    "Applet returned error for unload_model (proceeding)"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                applet = current_id,
                                error = %e,
                                "IPC unload_model failed (proceeding with purge anyway)"
                            );
                        }
                    }
                } else {
                    tracing::info!(
                        applet = current_id,
                        "No IPC channel; skipping unload command"
                    );
                }
            }

            let _ = app.emit(
                "applet-switch-progress",
                launcher::SwitchProgressPayload {
                    stage: launcher::SwitchStage::VerifyingVram,
                    message: "Verifying VRAM reclaimed...".into(),
                },
            );

            let purge_result = launcher::execute_purge(&purge_req, &mut budget_lock, 0).await;
            if !purge_result.success {
                return Err(purge_result.error.unwrap_or("Purge failed".into()));
            }
        }
    }

    // ── 5. Provision (download missing models) ──
    if !check.needs_download.is_empty() {
        let _ = app.emit(
            "applet-switch-progress",
            launcher::SwitchProgressPayload {
                stage: launcher::SwitchStage::Downloading,
                message: format!("Downloading {} models...", check.needs_download.len()),
            },
        );

        let mut model_mgr_mut = state.model_mgr.lock().await;
        launcher::provision_models(&app, &mut model_mgr_mut, &check.needs_download)
            .await
            .map_err(|e| format!("Provisioning failed: {e}"))?;
        drop(model_mgr_mut);
    }

    // ── 5b. Upgrade pack provisioning (licence-gated) ──
    {
        let tier = *state.licence_tier.lock().await;
        let gpu_state = state.gpu.lock().await;
        let vram_mb = u64::from(gpu_state.total_vram_mb);
        drop(gpu_state);

        let mut model_mgr_mut = state.model_mgr.lock().await;
        let added_keys = launcher::provision_upgrade_packs(
            &manifest,
            tier,
            vram_mb,
            &mut model_mgr_mut,
            &manifest.engine.engine_type,
        );

        // Download any upgrade pack models that aren't on disk yet
        let upgrade_missing: Vec<String> = added_keys
            .into_iter()
            .filter(|k| !model_mgr_mut.is_downloaded(k))
            .collect();

        if !upgrade_missing.is_empty() {
            let _ = app.emit(
                "applet-switch-progress",
                launcher::SwitchProgressPayload {
                    stage: launcher::SwitchStage::Downloading,
                    message: format!(
                        "Downloading {} upgrade pack model(s)...",
                        upgrade_missing.len()
                    ),
                },
            );

            launcher::provision_models(&app, &mut model_mgr_mut, &upgrade_missing)
                .await
                .map_err(|e| format!("Upgrade pack provisioning failed: {e}"))?;
        }
        drop(model_mgr_mut);
    }

    // ── 5c. Sidecar engine provisioning ──
    if manifest.engine.backend == "server" && manifest.engine.sidecar.is_some() {
        let _ = app.emit(
            "applet-switch-progress",
            launcher::SwitchProgressPayload {
                stage: launcher::SwitchStage::Downloading,
                message: format!(
                    "Provisioning {} engine binary...",
                    manifest.engine.server_binary
                ),
            },
        );
        launcher::provision_sidecar(&manifest)
            .map_err(|e| format!("Sidecar provisioning failed: {e}"))?;
    }

    // ── 6. Handoff ──
    let _ = app.emit(
        "applet-switch-progress",
        launcher::SwitchProgressPayload {
            stage: launcher::SwitchStage::Launching,
            message: format!("Launching {}...", applet.name),
        },
    );

    // Resolve model paths
    let model_mgr_lock = state.model_mgr.lock().await;
    let model_paths = launcher::resolve_model_paths(selected_group, &model_mgr_lock)
        .map_err(|e| format!("Failed to resolve model paths: {e}"))?;
    drop(model_mgr_lock);

    // Record VRAM allocations
    launcher::record_allocations(&mut budget_lock, &applet_id, selected_group);

    // Update active applet
    let mut active = state.active_applet.lock().await;
    *active = Some(applet_id.clone());
    drop(active);
    drop(budget_lock);

    // Launch with IPC channel
    let applet_proc = launcher::launch_applet_process(
        &applet_id,
        applet.launch_binary.as_deref(),
        applet.launch_url.as_deref(),
        &model_paths,
    )
    .await
    .map_err(|e| format!("Launch failed: {e}"))?;

    // Store process handle + IPC channel for lifecycle management
    if let Some(mut proc) = applet_proc {
        if let Some(advertisement) = proc.advertisement.as_ref() {
            register_advertised_engines(
                &state,
                &applet_id,
                advertisement,
                selected_group.min_vram_mb,
            )
            .await;
        }

        state
            .vram_scheduler
            .lock()
            .await
            .register_connection(&applet_id);

        if let Some(event_rx) = proc.ipc.take_event_rx() {
            spawn_applet_event_pump(
                applet_id.clone(),
                event_rx,
                state.engine_registry.clone(),
                state.vram_scheduler.clone(),
            );
        }

        let mut proc_lock = state.applet_process.lock().await;
        *proc_lock = Some(proc);
    }

    let _ = app.emit(
        "applet-switch-progress",
        launcher::SwitchProgressPayload {
            stage: launcher::SwitchStage::Ready,
            message: format!("{} is ready", applet.name),
        },
    );

    Ok(())
}

#[tauri::command]
async fn submit_engine_job(
    state: tauri::State<'_, AppState>,
    job: engine_router::EngineJob,
) -> Result<serde_json::Value, String> {
    let engine = {
        let registry = state.engine_registry.lock().await;
        registry
            .get(&job.engine_id)
            .cloned()
            .ok_or_else(|| format!("engine '{}' not found in runtime registry", job.engine_id))?
    };

    if engine.availability != EngineAvailability::Ready {
        return Err(format!("engine '{}' is not ready", job.engine_id));
    }

    if !engine.capabilities.iter().any(|cap| cap == &job.capability) {
        return Err(format!(
            "engine '{}' does not advertise capability '{}'",
            job.engine_id, job.capability
        ));
    }

    engine_router::validate_output_target(&job.output_target, &job.requesting_applet)
        .map_err(|error| error.to_string())?;
    engine_router::validate_input_files(&job.input_files, &job.job_id)
        .map_err(|error| error.to_string())?;

    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some(engine.applet_id.as_str()) {
        return Err(format!(
            "engine '{}' is owned by applet '{}', but active applet is '{}'",
            job.engine_id,
            engine.applet_id,
            active.unwrap_or_else(|| "none".to_string())
        ));
    }

    {
        let mut registry = state.engine_registry.lock().await;
        registry.set_lifecycle(&job.engine_id, EngineLifecycle::Generating);
    }

    let timeout = engine_router::resolve_timeout(&job);
    let command_payload = serde_json::to_value(&job)
        .map_err(|error| format!("failed to serialize engine job: {error}"))?;

    let response = {
        let mut proc_lock = state.applet_process.lock().await;
        let applet_proc = proc_lock
            .as_mut()
            .ok_or_else(|| "no active applet IPC process".to_string())?;

        applet_proc
            .ipc
            .send_envelope_command(
                CommandKind::ExecuteJob {
                    job: command_payload,
                },
                timeout,
            )
            .await
            .map_err(|error| format!("engine IPC dispatch failed: {error}"))?
    };

    {
        let mut registry = state.engine_registry.lock().await;
        registry.set_lifecycle(&job.engine_id, EngineLifecycle::Idle);
    }

    match response.status {
        ResponseStatus::Ok => Ok(response_detail_to_json(response.detail)),
        ResponseStatus::Error => Err(response
            .detail
            .unwrap_or_else(|| format!("engine '{}' returned an error", job.engine_id))),
    }
}

fn response_detail_to_json(detail: Option<String>) -> serde_json::Value {
    match detail {
        Some(detail) => serde_json::from_str(&detail)
            .unwrap_or_else(|_| serde_json::json!({ "detail": detail })),
        None => serde_json::json!({ "status": "ok" }),
    }
}

async fn register_advertised_engines(
    state: &tauri::State<'_, AppState>,
    applet_id: &str,
    advertisement: &serde_json::Value,
    fallback_vram_mb: u64,
) {
    let mut registry = state.engine_registry.lock().await;

    if let Some(engines) = advertisement
        .get("engines")
        .and_then(|value| value.as_array())
    {
        for engine in engines {
            let mut payload = engine.clone();
            if payload.get("vram_requirement_mb").is_none() {
                if let Some(object) = payload.as_object_mut() {
                    object.insert(
                        "vram_requirement_mb".to_string(),
                        serde_json::json!(fallback_vram_mb),
                    );
                }
            }

            match engine_registry::engine_entry_from_advertisement(applet_id, &payload) {
                Ok(entry) => registry.register(entry),
                Err(error) => tracing::warn!(
                    applet = applet_id,
                    error = %error,
                    payload = ?payload,
                    "Ignoring invalid advertised engine"
                ),
            }
        }
        return;
    }

    match engine_registry::engine_entry_from_advertisement(applet_id, advertisement) {
        Ok(entry) => registry.register(entry),
        Err(error) => tracing::warn!(
            applet = applet_id,
            error = %error,
            payload = ?advertisement,
            "Ignoring invalid advertised capability payload"
        ),
    }
}

fn spawn_applet_event_pump(
    applet_id: String,
    mut event_rx: mpsc::Receiver<IpcEnvelope>,
    engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    vram_scheduler: Arc<Mutex<vram_scheduler::VramScheduler>>,
) {
    tokio::spawn(async move {
        while let Some(envelope) = event_rx.recv().await {
            let payload = envelope.payload.clone();

            if payload
                .get("event")
                .and_then(|value| value.as_str())
                .is_some_and(|event| event == "heartbeat")
            {
                vram_scheduler.lock().await.record_heartbeat(&applet_id);
                continue;
            }

            let command = match serde_json::from_value::<CommandKind>(payload) {
                Ok(command) => command,
                Err(error) => {
                    tracing::debug!(
                        applet = %applet_id,
                        error = %error,
                        "Ignoring applet event with non-command payload"
                    );
                    continue;
                }
            };

            match command {
                CommandKind::AdvertiseCapabilities { capabilities } => {
                    register_engine_payload(
                        &mut *engine_registry.lock().await,
                        &applet_id,
                        &capabilities,
                    );
                }
                CommandKind::WithdrawCapabilities { engine_id } => {
                    engine_registry.lock().await.unregister(&engine_id);
                }
                CommandKind::JobComplete { job_id, result } => {
                    tracing::info!(
                        applet = %applet_id,
                        job_id = %job_id,
                        result = ?result,
                        "Applet job completed"
                    );
                }
                CommandKind::JobFailed { job_id, error } => {
                    tracing::warn!(
                        applet = %applet_id,
                        job_id = %job_id,
                        error = %error,
                        "Applet job failed"
                    );
                }
                CommandKind::JobProgress { job_id, percent } => {
                    tracing::debug!(
                        applet = %applet_id,
                        job_id = %job_id,
                        percent,
                        "Applet job progress"
                    );
                }
                other => {
                    tracing::debug!(
                        applet = %applet_id,
                        event = ?other,
                        "Ignoring applet event"
                    );
                }
            }
        }

        engine_registry.lock().await.purge_applet(&applet_id);
        vram_scheduler
            .lock()
            .await
            .unregister_connection(&applet_id);
        tracing::warn!(applet = %applet_id, "Applet IPC event stream closed");
    });
}

fn register_engine_payload(
    registry: &mut engine_registry::EngineRegistry,
    applet_id: &str,
    capabilities: &serde_json::Value,
) {
    if let Some(engines) = capabilities
        .get("engines")
        .and_then(|value| value.as_array())
    {
        for engine in engines {
            match engine_registry::engine_entry_from_advertisement(applet_id, engine) {
                Ok(entry) => registry.register(entry),
                Err(error) => tracing::warn!(
                    applet = applet_id,
                    error = %error,
                    payload = ?engine,
                    "Ignoring invalid applet engine event"
                ),
            }
        }
    } else if let Ok(entry) =
        engine_registry::engine_entry_from_advertisement(applet_id, capabilities)
    {
        registry.register(entry);
    }
}

/// Legacy launch_applet: now delegates to request_applet_switch for binary
/// applets and handles web applets directly.
#[tauri::command]
async fn launch_applet(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let reg = state.registry.lock().await;
    let applet = reg
        .get(&id)
        .ok_or_else(|| format!("Applet '{id}' not found"))?
        .clone();
    drop(reg);

    if applet.status == registry::AppletStatus::Locked {
        return Err("Applet is locked. Purchase or subscribe to unlock.".into());
    }
    if applet.status == registry::AppletStatus::NotBuilt {
        return Err("Applet is not yet available.".into());
    }

    // Web applets: just open
    if let Some(url) = &applet.launch_url {
        open::that(url).map_err(|e| format!("Failed to open URL: {e}"))?;
        return Ok(());
    }

    // Binary applets: delegate to full pipeline
    // NOTE: In production, the frontend should call check_applet_requirements
    // first to show the user what will happen, get confirmation, then call
    // request_applet_switch. This fallback exists for backward compatibility.
    request_applet_switch(app, state, id).await
}

// ─── Platform Status ────────────────────────────────────────────────────────

#[tauri::command]
async fn platform_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let gpu_state = state.gpu.lock().await;
    let profile_mgr = state.profile.lock().await;
    let wallet = state.wallet.lock().await;
    let registry = state.registry.lock().await;
    let discourse = state.discourse.lock().await;
    let budget_state = state.budget.lock().await;
    let active = state.active_applet.lock().await;
    let tier = state.licence_tier.lock().await;
    let session = state.user_session.lock().await;

    let profile = profile_mgr.get_profile().map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "gpu": {
            "available": gpu_state.nvml_available,
            "primary": gpu_state.primary_gpu,
            "total_vram_mb": gpu_state.total_vram_mb,
            "free_vram_mb": gpu_state.total_free_mb,
            "backend": gpu_state.backend.label(),
            "vram_tier": gpu_state.vram_tier.label(),
        },
        "auth": {
            "authenticated": session.is_some(),
            "user_id": session.as_ref().map(|c| &c.sub),
            "handle": session.as_ref().and_then(|c| c.handle.as_deref()),
            "email": session.as_ref().and_then(|c| c.email.as_deref()),
            "tier": tier.as_str(),
            "is_paid": tier.is_paid(),
            "is_pro": tier.is_pro(),
        },
        "profile": {
            "display_name": profile.display_name,
            "alias": profile.alias,
        },
        "wallet": {
            "connected": wallet.is_connected(),
            "address": wallet.address(),
        },
        "discourse": {
            "connected": discourse.is_connected(),
        },
        "applets": {
            "active": registry.launchable().len(),
            "current": *active,
        },
        "engines": {
            "registered": state.engine_registry.lock().await.len(),
        },
        "vram_budget": {
            "total_mb": budget_state.total_mb,
            "free_mb": budget_state.free_mb(),
            "allocated_mb": budget_state.allocated_mb(),
            "allocations": budget_state.allocations.len(),
            "policy": budget::PurgePolicy::from_tier(gpu_state.vram_tier).label(),
        },
    }))
}

// ─── Migration Commands ─────────────────────────────────────────────────────

#[tauri::command]
async fn get_phase5_migration_plan() -> Result<migration::MigrationPlan, String> {
    migration::plan().map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_phase5_migration(
    dry_run: Option<bool>,
) -> Result<migration::MigrationSummary, String> {
    migration::run(dry_run.unwrap_or(true)).map_err(|e| e.to_string())
}

// ─── App Builder ────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "everywear_os=debug,info".parse().unwrap()),
        )
        .init();

    // Initialize subsystems
    let gpu_state = gpu::detect_gpus();
    let profile_mgr = profile::ProfileManager::new();
    let wallet_mgr = wallet::WalletManager::new();
    let app_registry = registry::AppletRegistry::new();
    let discourse_client = discourse::DiscourseClient::new();

    // Initialize bridge: VRAM budget from detected GPU state
    let vram_budget = budget::VramBudget::new(gpu_state.total_vram_mb);
    let vram_scheduler = vram_scheduler::VramScheduler::from_gpu_state(&gpu_state);
    let model_mgr = model_manager::ModelManager::global();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            gpu: Arc::new(Mutex::new(gpu_state)),
            profile: Arc::new(Mutex::new(profile_mgr)),
            wallet: Arc::new(Mutex::new(wallet_mgr)),
            registry: Arc::new(Mutex::new(app_registry)),
            discourse: Arc::new(Mutex::new(discourse_client)),
            // Bridge
            budget: Arc::new(Mutex::new(vram_budget)),
            model_mgr: Arc::new(Mutex::new(model_mgr)),
            active_applet: Arc::new(Mutex::new(None)),
            applet_process: Arc::new(Mutex::new(None)),
            engine_registry: Arc::new(Mutex::new(engine_registry::EngineRegistry::new())),
            vram_scheduler: Arc::new(Mutex::new(vram_scheduler)),
            licence_tier: Arc::new(Mutex::new(model_manager::LicenceTier::Demo)),
            user_session: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            // GPU
            get_gpu_status,
            poll_vram,
            get_compute_backend,
            get_vram_tier,
            list_model_assessments,
            // Profile
            get_profile,
            update_profile,
            set_preference,
            get_preference,
            // Wallet
            wallet_generate,
            wallet_info,
            wallet_transactions,
            wallet_disconnect,
            // Discourse
            discourse_oauth_url,
            discourse_user,
            discourse_latest,
            discourse_disconnect,
            // Registry
            list_applets,
            get_applet,
            launch_applet,
            // Bridge: VRAM lifecycle
            get_vram_budget,
            get_active_applet,
            check_applet_requirements,
            request_applet_switch,
            submit_engine_job,
            // Migration
            get_phase5_migration_plan,
            run_phase5_migration,
            // Platform
            platform_status,
            // Auth (Supabase session + licence tier)
            auth::push_auth_state,
            auth::get_auth_context,
            auth::check_licence,
            auth::clear_auth,
        ])
        .run(tauri::generate_context!())
        .expect("error running Everywear OS");
}
