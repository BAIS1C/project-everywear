//! Everywear OS: AI platform shell.
//!
//! The shell owns GPU detection, model registry, VRAM arbitration,
//! user identity, wallet, Discourse integration, and the applet launcher.
//! Applets are thin UI layers that request resources via IPC.

mod applet_resolver;
mod assessment;
mod auth;
mod budget;
mod commands;
mod crash;
#[cfg(feature = "discourse-native")]
mod discourse;
mod engine_registry;
mod engine_router;
mod gener8_engine;
mod gpu;
mod launcher;
mod mait_bridge;
mod manifest_parser;
mod migration;
mod model_commands;
mod profile;
mod registry;
mod setup;
mod state;
mod vault_commands;
mod video_encoder;
mod vram_scheduler;
mod wallet;

use applet_ipc::{CommandKind, IpcEnvelope, ResponseStatus};
use engine_registry::{EngineAvailability, EngineLifecycle};
use state::AppState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

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

#[tauri::command]
async fn quit_everywear(app: tauri::AppHandle) -> Result<(), String> {
    tracing::info!("Everywear quit requested from shell titlebar");
    app.exit(0);
    Ok(())
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

    match applet.launch_kind {
        registry::AppletLaunchKind::ExternalUrl => {
            let url = applet
                .launch_url
                .as_deref()
                .ok_or("ExternalUrl applet is missing launch_url")?;
            tracing::info!(applet = %applet_id, url, "Launching external applet URL");
            open::that(url).map_err(|e| format!("Failed to open URL: {e}"))?;
            return Ok(());
        }
        registry::AppletLaunchKind::FrontendInline => {
            let port = applet
                .frontend_port
                .ok_or("FrontendInline applet is missing frontend_port")?;
            let route = applet.frontend_route.as_deref().unwrap_or("");
            let frontend_url = format!("http://127.0.0.1:{}{}", port, route);

            let win = app.get_webview_window("studio").ok_or_else(|| {
                "studio window missing from tauri.conf.json (expected label 'studio')".to_string()
            })?;

            let nav = format!("window.location.href = '{}';", frontend_url);
            win.eval(&nav)
                .map_err(|e| format!("Failed to navigate studio window: {e}"))?;
            win.set_title(&applet.name)
                .map_err(|e| format!("Failed to set title: {e}"))?;
            win.show()
                .map_err(|e| format!("Failed to show studio window: {e}"))?;
            win.set_focus()
                .map_err(|e| format!("Failed to focus studio window: {e}"))?;

            tracing::info!(
                applet = %applet_id,
                url = %frontend_url,
                "Frontend-only applet opened in studio window"
            );
            let _ = app.emit(
                "applet-webview-opened",
                serde_json::json!({
                    "applet_id": applet_id,
                    "name": applet.name,
                    "url": frontend_url,
                }),
            );
            let _ = app.emit(
                "applet-switch-progress",
                launcher::SwitchProgressPayload {
                    stage: launcher::SwitchStage::Ready,
                    message: format!("{} is ready", applet.name),
                },
            );
            return Ok(());
        }
        registry::AppletLaunchKind::Placeholder => {
            return Err("Applet is a placeholder and has no runtime yet.".into());
        }
        registry::AppletLaunchKind::BinaryLocal => {}
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
                let mut proc_lock = state.applet_processes.lock().await;
                if let Some(ref mut applet_proc) = proc_lock.get_mut(current_id) {
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

    // Resolve model paths for both env-var handoff and the explicit
    // StartInference IPC handoff.
    let (model_paths, ipc_model_paths) = {
        let model_mgr_lock = state.model_mgr.lock().await;
        let model_paths = launcher::resolve_model_paths(selected_group, &model_mgr_lock)
            .map_err(|e| format!("Failed to resolve model paths: {e}"))?;
        let ipc_model_paths = launcher::resolve_ipc_model_paths(selected_group, &model_mgr_lock)
            .map_err(|e| format!("Failed to resolve IPC model paths: {e}"))?;
        (model_paths, ipc_model_paths)
    };

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

        let start_response = proc
            .ipc
            .send_envelope_command(
                CommandKind::StartInference {
                    model_paths: ipc_model_paths.clone(),
                },
                std::time::Duration::from_secs(300),
            )
            .await
            .map_err(|e| format!("StartInference failed: {e}"))?;
        if start_response.status == ResponseStatus::Error {
            return Err(start_response
                .detail
                .unwrap_or_else(|| "StartInference returned an error".to_string()));
        }

        state
            .vram_scheduler
            .lock()
            .await
            .register_connection(&applet_id);

        if let Some(event_rx) = proc.ipc.take_event_rx() {
            spawn_applet_event_pump(
                app.clone(),
                applet_id.clone(),
                event_rx,
                state.engine_registry.clone(),
                state.active_applet.clone(),
                state.applet_processes.clone(),
                state.vram_scheduler.clone(),
                state.kasai_tool_calls.clone(),
                state.profile.clone(),
                state.vault.clone(),
            );
        }

        let mut proc_lock = state.applet_processes.lock().await;
        proc_lock.insert(applet_id.clone(), proc);
    }

    // ── 7. Show applet UI in the studio window ──
    // Mirrors the S³ Gener8 pattern: one `studio` window declared hidden
    // in tauri.conf.json. Navigate it to the applet's frontend URL via
    // eval(), then show() + set_focus(). Same window for every applet.
    if let Some(port) = applet.frontend_port {
        let win = app.get_webview_window("studio").ok_or_else(|| {
            "studio window missing from tauri.conf.json (expected label 'studio')".to_string()
        })?;

        let route = applet.frontend_route.as_deref().unwrap_or("");
        let frontend_url = format!("http://127.0.0.1:{}{}", port, route);
        let nav = format!("window.location.href = '{}';", frontend_url);
        win.eval(&nav)
            .map_err(|e| format!("Failed to navigate studio window: {e}"))?;
        win.set_title(&applet.name)
            .map_err(|e| format!("Failed to set title: {e}"))?;
        win.show()
            .map_err(|e| format!("Failed to show studio window: {e}"))?;
        win.set_focus()
            .map_err(|e| format!("Failed to focus studio window: {e}"))?;

        tracing::info!(
            applet = %applet_id,
            url = %frontend_url,
            "Applet UI opened in studio window"
        );
        let _ = app.emit(
            "applet-webview-opened",
            serde_json::json!({
                "applet_id": applet_id,
                "name": applet.name,
                "url": frontend_url,
            }),
        );
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
    route_active_engine_job(
        job,
        state.engine_registry.clone(),
        state.active_applet.clone(),
        state.applet_processes.clone(),
        state.profile.clone(),
        state.vault.clone(),
        true,
    )
    .await
    .map(|(_, detail)| detail)
}

async fn route_active_engine_job(
    job: engine_router::EngineJob,
    engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    _active_applet: Arc<Mutex<Option<String>>>,
    applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    profile: Arc<Mutex<profile::ProfileManager>>,
    vault: vault_commands::VaultState,
    auto_register: bool,
) -> Result<(String, serde_json::Value), String> {
    let engine = {
        let registry = engine_registry.lock().await;
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

    // Router v2: look up by engine's owning applet instead of requiring single active applet
    let target_applet_id = engine.applet_id.clone();

    {
        let mut registry = engine_registry.lock().await;
        registry.set_lifecycle(&job.engine_id, EngineLifecycle::Generating);
    }

    let timeout = engine_router::resolve_timeout(&job);
    let command_payload = serde_json::to_value(&job)
        .map_err(|error| format!("failed to serialize engine job: {error}"))?;

    let response = {
        let mut proc_lock = applet_processes.lock().await;
        let applet_proc = proc_lock
            .get_mut(&target_applet_id)
            .ok_or_else(|| format!("no IPC process for applet '{target_applet_id}'"))?;

        applet_proc
            .ipc
            .send_envelope_command(
                CommandKind::ExecuteJob {
                    job: command_payload,
                },
                timeout,
            )
            .await
            .map_err(|error| format!("engine IPC dispatch failed: {error}"))
    };

    {
        let mut registry = engine_registry.lock().await;
        registry.set_lifecycle(&job.engine_id, EngineLifecycle::Idle);
    }

    let response = response?;

    match response.status {
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            if auto_register {
                maybe_auto_register_to_vault(profile, vault, &engine.applet_id, &detail).await;
            }
            Ok((engine.applet_id, detail))
        }
        ResponseStatus::Error => Err(response
            .detail
            .unwrap_or_else(|| format!("engine '{}' returned an error", job.engine_id))),
    }
}

pub(crate) fn response_detail_to_json(detail: Option<String>) -> serde_json::Value {
    match detail {
        Some(detail) => serde_json::from_str(&detail)
            .unwrap_or_else(|_| serde_json::json!({ "detail": detail })),
        None => serde_json::json!({ "status": "ok" }),
    }
}

async fn vault_auto_register_enabled(profile: Arc<Mutex<profile::ProfileManager>>) -> bool {
    let profile = profile.lock().await;
    profile
        .get_pref("vault_auto_register")
        .map(|value| !matches!(value.as_str(), "false" | "0" | "off" | "no"))
        .unwrap_or(true)
}

async fn maybe_auto_register_to_vault(
    profile: Arc<Mutex<profile::ProfileManager>>,
    vault: vault_commands::VaultState,
    applet_id: &str,
    result: &serde_json::Value,
) {
    if !vault_auto_register_enabled(profile).await {
        return;
    }

    match vault_commands::auto_register_job_result(vault, applet_id, result).await {
        Ok(Some(item)) => tracing::info!(
            applet = applet_id,
            item_id = %ew_vault::item_id(&item),
            "Auto-registered applet output to vault"
        ),
        Ok(None) => {}
        Err(error) => tracing::warn!(applet = applet_id, error, "Vault auto-registration skipped"),
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
    app: tauri::AppHandle,
    applet_id: String,
    mut event_rx: mpsc::Receiver<IpcEnvelope>,
    engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    active_applet: Arc<Mutex<Option<String>>>,
    applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    vram_scheduler: Arc<Mutex<vram_scheduler::VramScheduler>>,
    kasai_tool_calls: Arc<Mutex<Vec<serde_json::Value>>>,
    profile: Arc<Mutex<profile::ProfileManager>>,
    vault: vault_commands::VaultState,
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

            if payload
                .get("event")
                .and_then(|value| value.as_str())
                .is_some_and(|event| event == "kasai_tool_call_update")
            {
                if applet_id == "kasai" {
                    if let Some(tool_call) = payload.get("tool_call").cloned() {
                        commands::kasai::record_kasai_tool_call_update(
                            &app,
                            &kasai_tool_calls,
                            tool_call,
                            false,
                        )
                        .await;
                    }
                }
                continue;
            }

            if payload
                .get("event")
                .and_then(|value| value.as_str())
                .is_some_and(|event| event == "kasai_tool_call_complete")
            {
                if applet_id == "kasai" {
                    if let Some(tool_call) = payload.get("tool_call").cloned() {
                        commands::kasai::record_kasai_tool_call_update(
                            &app,
                            &kasai_tool_calls,
                            tool_call,
                            true,
                        )
                        .await;
                    }
                }
                continue;
            }

            if payload
                .get("event")
                .and_then(|value| value.as_str())
                .is_some_and(|event| event == "kasai_shell_tool_call")
            {
                tracing::info!(
                    applet = %applet_id,
                    request_id = payload.get("request_id").and_then(|value| value.as_str()).unwrap_or(""),
                    tool_name = payload.get("tool_name").and_then(|value| value.as_str()).unwrap_or(""),
                    arguments = ?payload.get("arguments"),
                    "Kasai requested shell-side tool execution"
                );
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
                CommandKind::SubmitJob { job } => {
                    spawn_submitted_job_route(
                        applet_id.clone(),
                        job,
                        engine_registry.clone(),
                        active_applet.clone(),
                        applet_processes.clone(),
                        profile.clone(),
                        vault.clone(),
                    );
                }
                CommandKind::SubmitPlan { plan } => {
                    spawn_submitted_plan_route(
                        applet_id.clone(),
                        plan,
                        engine_registry.clone(),
                        active_applet.clone(),
                        applet_processes.clone(),
                        profile.clone(),
                        vault.clone(),
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
                    maybe_auto_register_to_vault(
                        profile.clone(),
                        vault.clone(),
                        &applet_id,
                        &result,
                    )
                    .await;
                    let _ = send_shell_event_to_applet(
                        applet_processes.clone(),
                        &applet_id,
                        CommandKind::JobComplete {
                            job_id: job_id.clone(),
                            result,
                        },
                    )
                    .await;
                }
                CommandKind::JobFailed { job_id, error } => {
                    tracing::warn!(
                        applet = %applet_id,
                        job_id = %job_id,
                        error = %error,
                        "Applet job failed"
                    );
                    let _ = send_shell_event_to_applet(
                        applet_processes.clone(),
                        &applet_id,
                        CommandKind::JobFailed {
                            job_id: job_id.clone(),
                            error,
                        },
                    )
                    .await;
                }
                CommandKind::JobProgress { job_id, percent } => {
                    tracing::debug!(
                        applet = %applet_id,
                        job_id = %job_id,
                        percent,
                        "Applet job progress"
                    );
                    let _ = send_shell_event_to_applet(
                        applet_processes.clone(),
                        &applet_id,
                        CommandKind::JobProgress {
                            job_id: job_id.clone(),
                            percent,
                        },
                    )
                    .await;
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

fn spawn_submitted_job_route(
    source_applet: String,
    job_value: serde_json::Value,
    engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    active_applet: Arc<Mutex<Option<String>>>,
    applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    profile: Arc<Mutex<profile::ProfileManager>>,
    vault: vault_commands::VaultState,
) {
    tokio::spawn(async move {
        let fallback_job_id = job_value
            .get("job_id")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();

        let job = match parse_submitted_engine_job(job_value, &source_applet) {
            Ok(job) => job,
            Err(error) => {
                let _ = send_shell_event_to_applet(
                    applet_processes,
                    &source_applet,
                    CommandKind::JobFailed {
                        job_id: fallback_job_id,
                        error,
                    },
                )
                .await;
                return;
            }
        };

        let job_id = job.job_id.clone();
        match route_active_engine_job(
            job,
            engine_registry,
            active_applet,
            applet_processes.clone(),
            profile,
            vault,
            false,
        )
        .await
        {
            Ok((_engine_applet, ack)) => {
                tracing::info!(
                    requester = %source_applet,
                    job_id = %job_id,
                    ack = ?ack,
                    "Applet-submitted job accepted by engine router"
                );
            }
            Err(error) => {
                let _ = send_shell_event_to_applet(
                    applet_processes,
                    &source_applet,
                    CommandKind::JobFailed { job_id, error },
                )
                .await;
            }
        }
    });
}

fn spawn_submitted_plan_route(
    source_applet: String,
    plan_value: serde_json::Value,
    engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    active_applet: Arc<Mutex<Option<String>>>,
    applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    profile: Arc<Mutex<profile::ProfileManager>>,
    vault: vault_commands::VaultState,
) {
    tokio::spawn(async move {
        let fallback_plan_id = plan_value
            .get("plan_id")
            .and_then(|value| value.as_str())
            .unwrap_or("plan")
            .to_string();
        let jobs = match parse_submitted_plan_jobs(plan_value, &source_applet) {
            Ok(jobs) => jobs,
            Err(error) => {
                let _ = send_shell_event_to_applet(
                    applet_processes,
                    &source_applet,
                    CommandKind::JobFailed {
                        job_id: fallback_plan_id,
                        error,
                    },
                )
                .await;
                return;
            }
        };

        for job in jobs {
            let job_id = job.job_id.clone();
            match route_active_engine_job(
                job,
                engine_registry.clone(),
                active_applet.clone(),
                applet_processes.clone(),
                profile.clone(),
                vault.clone(),
                false,
            )
            .await
            {
                Ok((_engine_applet, ack)) => tracing::info!(
                    requester = %source_applet,
                    job_id = %job_id,
                    ack = ?ack,
                    "Applet-submitted plan job accepted by engine router"
                ),
                Err(error) => {
                    let _ = send_shell_event_to_applet(
                        applet_processes.clone(),
                        &source_applet,
                        CommandKind::JobFailed { job_id, error },
                    )
                    .await;
                }
            }
        }
    });
}

fn parse_submitted_engine_job(
    job_value: serde_json::Value,
    source_applet: &str,
) -> Result<engine_router::EngineJob, String> {
    let job: engine_router::EngineJob = serde_json::from_value(job_value)
        .map_err(|error| format!("SubmitJob payload must be a full EngineJob: {error}"))?;
    if job.requesting_applet != source_applet {
        return Err(format!(
            "SubmitJob requesting_applet '{}' does not match IPC applet '{}'",
            job.requesting_applet, source_applet
        ));
    }
    Ok(job)
}

fn parse_submitted_plan_jobs(
    plan_value: serde_json::Value,
    source_applet: &str,
) -> Result<Vec<engine_router::EngineJob>, String> {
    let raw_jobs = if let Some(jobs) = plan_value.as_array() {
        jobs.clone()
    } else {
        plan_value
            .get("jobs")
            .and_then(|value| value.as_array())
            .cloned()
            .ok_or_else(|| "SubmitPlan payload must be an array or contain jobs[]".to_string())?
    };

    raw_jobs
        .into_iter()
        .map(|job| parse_submitted_engine_job(job, source_applet))
        .collect()
}

async fn send_shell_event_to_applet(
    applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    applet_id: &str,
    event: CommandKind,
) -> Result<(), String> {
    let mut proc_lock = applet_processes.lock().await;
    let applet_proc = proc_lock
        .get_mut(applet_id)
        .ok_or_else(|| format!("no IPC process for applet '{applet_id}'"))?;
    applet_proc
        .ipc
        .send_envelope_event(event)
        .await
        .map_err(|error| format!("failed to send shell event to applet '{applet_id}': {error}"))
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

/// Hide the studio window and return to the launcher.
/// The window stays alive (same as S³ Gener8 pattern); just hidden.
/// Does NOT stop the backend process (purge handles that on next switch).
#[tauri::command]
async fn close_applet_webview(
    app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    applet_id: String,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("studio") {
        win.hide()
            .map_err(|e| format!("Failed to hide studio window: {e}"))?;
        tracing::info!(applet = %applet_id, "Studio window hidden");
        let _ = app.emit(
            "applet-webview-closed",
            serde_json::json!({
                "applet_id": applet_id,
            }),
        );
    }
    Ok(())
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

// ─── App Builder ────────────────────────────────────────────────────────────

fn build_model_resolver(profile_mgr: &profile::ProfileManager) -> model_manager::ModelResolver {
    let custom_paths = profile_mgr
        .get_pref(model_commands::CUSTOM_MODEL_PATHS_PREF)
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();

    let scanner = model_manager::LocalModelScanner::new(custom_paths);
    let requirements = load_model_requirements_from_applets();
    model_manager::ModelResolver::new(scanner, requirements, everywear_paths::models_dir())
}

fn load_model_requirements_from_applets() -> Vec<model_manager::ModelRequirement> {
    let mut requirements = Vec::new();
    let applets_dir = std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join("applets"))
        .unwrap_or_else(|| PathBuf::from("applets"));

    if let Ok(entries) = std::fs::read_dir(&applets_dir) {
        for entry in entries.flatten() {
            let manifest_path = entry.path().join("applet.toml");
            if !manifest_path.exists() {
                continue;
            }
            match model_manager::AppletManifest::load(&manifest_path) {
                Ok(manifest) => requirements.extend(
                    model_manager::requirements::build_requirements_from_manifest(
                        &manifest.applet.id,
                        &manifest,
                    ),
                ),
                Err(error) => tracing::warn!(
                    path = %manifest_path.display(),
                    error = %error,
                    "Skipping applet model requirements"
                ),
            }
        }
    }

    if requirements.is_empty() {
        requirements = model_manager::requirements::known_requirements();
    }

    let mut unique = Vec::new();
    for requirement in requirements {
        if !unique
            .iter()
            .any(|existing: &model_manager::ModelRequirement| {
                existing.everywear_model_id == requirement.everywear_model_id
            })
        {
            unique.push(requirement);
        }
    }
    unique
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crash::install_panic_crash_report_hook();

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
    #[cfg(feature = "discourse-native")]
    let discourse_client = discourse::DiscourseClient::new();
    everywear_paths::ensure_vault_dirs().expect("failed to initialize Everywear Vault directories");
    let vault_index = ew_vault::VaultIndex::open_or_create(everywear_paths::vault_index_dir())
        .expect("failed to initialize Everywear Vault index");
    let vault_state: vault_commands::VaultState = Arc::new(Mutex::new(vault_index));
    let mait_store = mait::MaitStore::new(everywear_paths::data_dir("kasai").join("mait"));
    mait_store.init().expect("failed to initialize MAIT store");

    // Initialize bridge: VRAM budget from detected GPU state
    let vram_budget = budget::VramBudget::new(gpu_state.total_vram_mb);
    let vram_scheduler = vram_scheduler::VramScheduler::from_gpu_state(&gpu_state);
    let model_mgr = model_manager::ModelManager::global();
    let model_resolver = build_model_resolver(&profile_mgr);

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
            #[cfg(feature = "discourse-native")]
            discourse: Arc::new(Mutex::new(discourse_client)),
            // Bridge
            budget: Arc::new(Mutex::new(vram_budget)),
            model_mgr: Arc::new(Mutex::new(model_mgr)),
            model_resolver: Arc::new(Mutex::new(model_resolver)),
            active_applet: Arc::new(Mutex::new(None)),
            applet_processes: Arc::new(Mutex::new(HashMap::new())),
            engine_registry: Arc::new(Mutex::new(engine_registry::EngineRegistry::new())),
            vram_scheduler: Arc::new(Mutex::new(vram_scheduler)),
            kasai_tool_calls: Arc::new(Mutex::new(Vec::new())),
            licence_tier: Arc::new(Mutex::new(model_manager::LicenceTier::Demo)),
            user_session: Arc::new(Mutex::new(None)),
            video_encoder: Arc::new(Mutex::new(video_encoder::VideoEncoderService::new())),
            gener8_engine: Arc::new(Mutex::new(gener8_engine::Gener8EngineState::default())),
            vault: vault_state.clone(),
        })
        .manage::<vault_commands::VaultState>(vault_state)
        .manage::<mait_bridge::MaitStoreState>(Arc::new(Mutex::new(mait_store)))
        .invoke_handler(tauri::generate_handler![
            // GPU
            commands::gpu::get_gpu_status,
            commands::gpu::poll_vram,
            commands::gpu::get_compute_backend,
            commands::gpu::get_vram_tier,
            commands::gpu::list_model_assessments,
            setup::check_runtime_setup,
            model_commands::resolve_all_models,
            model_commands::adopt_local_model,
            model_commands::add_custom_model_path,
            model_commands::get_custom_model_paths,
            // Profile
            commands::profile::get_profile,
            commands::profile::update_profile,
            commands::profile::set_preference,
            commands::profile::get_preference,
            // Wallet
            commands::wallet::wallet_generate,
            commands::wallet::wallet_info,
            commands::wallet::wallet_transactions,
            commands::wallet::wallet_disconnect,
            // Discourse
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_oauth_url,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_complete_oauth,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_user,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_latest,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_get_topics,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_read_post,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_create_post,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_refresh_token,
            #[cfg(feature = "discourse-native")]
            commands::discourse::discourse_disconnect,
            // Registry
            commands::registry::list_applets,
            commands::registry::get_applet,
            commands::registry::focus_applet_window,
            commands::registry::is_applet_window_open,
            launch_applet,
            // Bridge: VRAM lifecycle
            get_vram_budget,
            get_active_applet,
            quit_everywear,
            check_applet_requirements,
            request_applet_switch,
            close_applet_webview,
            submit_engine_job,
            commands::kasai::kasai_forward_chat,
            commands::kasai::kasai_get_status,
            commands::kasai::kasai_get_tool_calls,
            // Video encoder sidecar
            commands::video_encoder::request_video_encoder,
            commands::video_encoder::release_video_encoder,
            commands::video_encoder::video_encoder_health,
            // Gener8 shell-owned engine bridge
            gener8_engine::gener8_upload_audio,
            gener8_engine::gener8_generate,
            gener8_engine::gener8_generation_status,
            gener8_engine::gener8_engine_models,
            // Migration
            commands::migration::get_phase5_migration_plan,
            commands::migration::run_phase5_migration,
            commands::migration::run_gener8_vault_audio_import,
            // Vault
            vault_commands::vault_search,
            vault_commands::vault_get_item,
            vault_commands::vault_set_favorite,
            vault_commands::vault_set_tags,
            vault_commands::vault_delete_item,
            vault_commands::vault_get_stats,
            vault_commands::vault_register_image,
            vault_commands::vault_register_audio,
            vault_commands::vault_register_video,
            // MAIT bridge
            mait_bridge::kasai_load_avatar_manifest,
            // Platform
            commands::platform::platform_status,
            commands::system::get_system_info,
            crash::take_pending_crash_report,
            // Auth (Supabase session + licence tier)
            auth::push_auth_state,
            auth::get_auth_context,
            auth::check_licence,
            auth::clear_auth,
        ])
        .run(tauri::generate_context!())
        .expect("error running Everywear OS");
}
