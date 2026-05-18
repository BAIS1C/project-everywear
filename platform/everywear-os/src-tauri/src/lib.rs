//! Everywear OS: AI platform shell.
//!
//! The shell owns GPU detection, model registry, VRAM arbitration,
//! user identity, wallet, Discourse integration, and the applet launcher.
//! Applets are thin UI layers that request resources via IPC.

mod applet_resolver;
mod assessment;
mod auth;
mod budget;
#[cfg(feature = "discourse-native")]
mod discourse;
mod engine_registry;
mod engine_router;
mod gpu;
mod launcher;
mod mait_bridge;
mod manifest_parser;
mod model_commands;
mod migration;
mod profile;
mod registry;
mod setup;
mod vault_commands;
mod video_encoder;
mod vram_scheduler;
mod wallet;

use applet_ipc::{CommandKind, IpcEnvelope, ResponseStatus};
use engine_registry::{EngineAvailability, EngineLifecycle};
use serde::Serialize;
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
    #[cfg(feature = "discourse-native")]
    pub discourse: Arc<Mutex<discourse::DiscourseClient>>,
    // ── Bridge: VRAM lifecycle ──
    pub budget: Arc<Mutex<budget::VramBudget>>,
    pub model_mgr: Arc<Mutex<model_manager::ModelManager>>,
    pub model_resolver: Arc<Mutex<model_manager::ModelResolver>>,
    pub active_applet: Arc<Mutex<Option<String>>>,
    /// Running binary applet: child process + IPC channel.
    /// Held for unload_model, shutdown, and lifecycle management.
    pub applet_process: Arc<Mutex<Option<launcher::AppletProcess>>>,
    /// Runtime-discovered engine capabilities advertised by applets.
    pub engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    /// Runtime engine/heartbeat lifecycle scheduler.
    pub vram_scheduler: Arc<Mutex<vram_scheduler::VramScheduler>>,
    /// Recent shell-side tool calls requested by Kasai.
    pub kasai_tool_calls: Arc<Mutex<Vec<serde_json::Value>>>,
    /// Current user licence tier (determines upgrade pack entitlement).
    /// Defaults to Demo; updated on Supabase auth hydration via
    /// `active_tier()` RPC. Shell is read-only for tier; Hub is the
    /// single writer (payment webhook -> subscriptions upsert).
    pub licence_tier: Arc<Mutex<model_manager::LicenceTier>>,
    /// Authenticated user session (from Supabase JWT).
    /// None until the EWDS frontend pushes auth state via `push_auth_state`.
    /// Shell owns the session; applets receive identity via `get_auth_context`.
    pub user_session: Arc<Mutex<Option<auth::UserClaim>>>,
    /// Shared NVENC video-encoder sidecar (ref-counted, shell-owned).
    pub video_encoder: Arc<Mutex<video_encoder::VideoEncoderService>>,
    /// Shared vault index used by commands and lifecycle auto-registration.
    pub vault: vault_commands::VaultState,
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiChatResponse {
    pub session_id: String,
    pub reply: Option<String>,
    pub status: ChatStatus,
    pub tool_calls_initiated: u64,
    pub first_tool_call_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub enum ChatStatus {
    Streaming,
    Complete,
    ToolExecuting,
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiSlotInfo {
    pub slot_id: String,
    pub model_name: Option<String>,
    pub model_size_gb: Option<f64>,
    pub vram_used_gb: Option<f64>,
    pub status: String,
    pub current_activity: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiStatusResponse {
    pub runtime_status: String,
    pub slots: Vec<KasaiSlotInfo>,
    pub swap_mode: String,
    pub total_vram_gb: f64,
    pub available_vram_gb: f64,
    pub active_session_id: Option<String>,
    pub tool_call_log_size: usize,
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

#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_oauth_url(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mut client = state.discourse.lock().await;
    Ok(client.oauth_url())
}

// CLAUDE_INTERFACE: This command completes Discourse OAuth callback handling.
// Command: "discourse_complete_oauth"
// Args: { code: string, state: string }
// Returns: { username, name?, avatar_url?, trust_level, unread_notifications }
// Error: "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_complete_oauth(
    state: tauri::State<'_, AppState>,
    code: String,
    oauth_state: String,
) -> Result<discourse::DiscourseUser, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .complete_oauth(&code, &oauth_state)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_user(
    state: tauri::State<'_, AppState>,
) -> Result<Option<discourse::DiscourseUser>, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.get_user().await.map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_latest(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<discourse::DiscoursePost>, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .latest_posts(limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_get_topics"
// Args: { category_id?: number, page?: number }
// Returns: { topics: Array<{id, title, slug, posts_count, created_at}>, total: number }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_get_topics(
    state: tauri::State<'_, AppState>,
    category_id: Option<u64>,
    page: Option<u32>,
) -> Result<discourse::DiscourseTopicList, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client
        .list_topics(category_id, page)
        .await
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_read_post"
// Args: { post_id: number }
// Returns: { id, topic_id?, topic_slug?, author, raw?, cooked?, created_at }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_read_post(
    state: tauri::State<'_, AppState>,
    post_id: u64,
) -> Result<discourse::DiscoursePostDetail, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.read_post(post_id).await.map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: This command is available for frontend wiring
// Command: "discourse_create_post"
// Args: { request: { title?: string, raw: string, topic_id?: number, category?: number } }
// Returns: { id, topic_id?, topic_slug?, author, raw?, cooked?, created_at }
// Error: "DISCOURSE_NOT_AUTHENTICATED" | "DISCOURSE_API_ERROR"
#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_create_post(
    state: tauri::State<'_, AppState>,
    request: discourse::CreatePostRequest,
) -> Result<discourse::DiscoursePostDetail, String> {
    let user = state.user_session.lock().await.clone();
    let mut client = state.discourse.lock().await;
    client.set_everywear_identity(user.as_ref());
    client.create_post(request).await.map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
#[tauri::command]
async fn discourse_refresh_token(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.discourse.lock().await;
    client
        .refresh_access_token()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "discourse-native")]
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

// CLAUDE_INTERFACE: Focus an applet's external window
// Command: "focus_applet_window"
// Args: { label: string }
// Returns: boolean (true if window found and focused, false if not running)
// Known shell-owned labels: "main", "studio". Standalone applets such as 1magen use "main" inside their own Tauri process, so the shell can only focus them when they are represented by a shell-owned window label.
// Usage: Shell sidebar clicks for 1magen/Gener8 call this instead of rendering inline
#[tauri::command]
async fn focus_applet_window(label: String, app: tauri::AppHandle) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(true)
}

// CLAUDE_INTERFACE: Check if applet window is open
// Command: "is_applet_window_open"
// Args: { label: string }
// Returns: boolean
// Usage: Shell sidebar can show green dot for running applets
#[tauri::command]
async fn is_applet_window_open(label: String, app: tauri::AppHandle) -> Result<bool, String> {
    Ok(app.get_webview_window(&label).is_some())
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

    // Frontend-only applets: no backend binary, just navigate the studio
    // webview. Used by applets like Vid Studio that rely on shell-owned
    // shared services (video-encoder sidecar) instead of their own backend.
    if applet.launch_binary.is_none() {
        if let Some(port) = applet.frontend_port {
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
                "Frontend-only applet opened in studio window (no backend)"
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
        return Err("Applet has no launch_url, launch_binary, or frontend_port".into());
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
                app.clone(),
                applet_id.clone(),
                event_rx,
                state.engine_registry.clone(),
                state.vram_scheduler.clone(),
                state.kasai_tool_calls.clone(),
                state.profile.clone(),
                state.vault.clone(),
            );
        }

        let mut proc_lock = state.applet_process.lock().await;
        *proc_lock = Some(proc);
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
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            maybe_auto_register_to_vault(
                state.profile.clone(),
                state.vault.clone(),
                &engine.applet_id,
                &detail,
            )
            .await;
            Ok(detail)
        }
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
        Err(error) => tracing::warn!(
            applet = applet_id,
            error,
            "Vault auto-registration skipped"
        ),
    }
}

// CLAUDE_INTERFACE: Updated kasai_forward_chat response
// Command: "kasai_forward_chat"
// Args: { message: string, session_id?: string }
// Returns: KasaiChatResponse { session_id, reply?, status, tool_calls_initiated, first_tool_call_index? }
// Note: status "ToolExecuting" means reply is not final - subscribe to tool-call events for progress
// Error: "KASAI_NOT_ACTIVE" | "KASAI_IPC_UNAVAILABLE" | "KASAI_API_ERROR"
#[tauri::command]
async fn kasai_forward_chat(
    state: tauri::State<'_, AppState>,
    message: String,
    session_id: Option<String>,
) -> Result<KasaiChatResponse, String> {
    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some("kasai") {
        return Err("KASAI_NOT_ACTIVE".into());
    }
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let first_candidate = next_kasai_tool_call_index(&state.kasai_tool_calls).await;

    let job = serde_json::json!({
        "job_id": uuid::Uuid::new_v4().to_string(),
        "requesting_applet": "shell",
        "requesting_module": "kasai_shell_proxy",
        "engine_id": "kasai.chat",
        "capability": "chat",
        "input_payload": {
            "message": message.clone(),
            "session_id": session_id.clone(),
        },
        "messages": [
            { "role": "user", "content": message }
        ],
        "session_id": session_id.clone(),
    });

    let response = {
        let mut proc_lock = state.applet_process.lock().await;
        let applet_proc = proc_lock
            .as_mut()
            .ok_or_else(|| "KASAI_IPC_UNAVAILABLE".to_string())?;

        applet_proc
            .ipc
            .send_envelope_command(
                CommandKind::ExecuteJob { job },
                std::time::Duration::from_secs(600),
            )
            .await
            .map_err(|error| format!("KASAI_API_ERROR: {error}"))?
    };

    match response.status {
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            let reply = detail
                .get("response")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let (tool_calls_initiated, first_tool_call_index) =
                kasai_tool_call_turn_summary(&state.kasai_tool_calls, &session_id, first_candidate)
                    .await;
            Ok(KasaiChatResponse {
                session_id,
                reply,
                status: ChatStatus::Complete,
                tool_calls_initiated,
                first_tool_call_index,
            })
        }
        ResponseStatus::Error => Err(response.detail.unwrap_or_else(|| "KASAI_API_ERROR".into())),
    }
}

// CLAUDE_INTERFACE: Get Kasai runtime status with slot detail
// Command: "kasai_get_status"
// Args: {}
// Returns: KasaiStatusResponse { runtime_status, slots: KasaiSlotInfo[], swap_mode, total_vram_gb, available_vram_gb, active_session_id, tool_call_log_size }
// KasaiSlotInfo: { slot_id, model_name, model_size_gb, vram_used_gb, status, current_activity, error }
// slot_id values: "orchestrator" | "agent" | "embedder"
// status values: "empty" | "loading" | "loaded" | "unloading" | "error"
// current_activity values: "planning" | "executing_tools" | "auditing" | "idle" | null
// Poll every 3 seconds in SlotStatusPanel
#[tauri::command]
async fn kasai_get_status(state: tauri::State<'_, AppState>) -> Result<KasaiStatusResponse, String> {
    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some("kasai") {
        return Ok(empty_kasai_status(&state).await);
    }

    let response = {
        let mut proc_lock = state.applet_process.lock().await;
        let applet_proc = proc_lock
            .as_mut()
            .ok_or_else(|| "KASAI_IPC_UNAVAILABLE".to_string())?;

        applet_proc
            .ipc
            .send_envelope_command(CommandKind::QueryStatus, std::time::Duration::from_secs(10))
            .await
            .map_err(|error| format!("KASAI_API_ERROR: {error}"))?
    };

    match response.status {
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            Ok(kasai_status_from_runtime(&state, detail).await)
        }
        ResponseStatus::Error => Err(response.detail.unwrap_or_else(|| "KASAI_API_ERROR".into())),
    }
}

async fn empty_kasai_status(state: &tauri::State<'_, AppState>) -> KasaiStatusResponse {
    let gpu = state.gpu.lock().await;
    let calls = state.kasai_tool_calls.lock().await;
    KasaiStatusResponse {
        runtime_status: "stopped".into(),
        slots: default_kasai_slots(),
        swap_mode: kasai_swap_mode(gpu.total_vram_mb),
        total_vram_gb: mb_to_gb(gpu.total_vram_mb),
        available_vram_gb: mb_to_gb(gpu.total_free_mb),
        active_session_id: None,
        tool_call_log_size: calls.len(),
    }
}

async fn kasai_status_from_runtime(
    state: &tauri::State<'_, AppState>,
    detail: serde_json::Value,
) -> KasaiStatusResponse {
    let gpu = state.gpu.lock().await;
    let calls = state.kasai_tool_calls.lock().await;
    let runtime_status = detail
        .get("status")
        .and_then(|value| value.as_str())
        .map(runtime_status_label)
        .unwrap_or_else(|| "running".into());
    let slot_values = detail
        .get("slots")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut slots = default_kasai_slots();
    for slot in slot_values {
        if let Some(info) = kasai_slot_from_value(&slot) {
            if let Some(existing) = slots
                .iter_mut()
                .find(|candidate| candidate.slot_id == info.slot_id)
            {
                *existing = info;
            } else {
                slots.push(info);
            }
        }
    }

    KasaiStatusResponse {
        runtime_status,
        slots,
        swap_mode: kasai_swap_mode(gpu.total_vram_mb),
        total_vram_gb: mb_to_gb(gpu.total_vram_mb),
        available_vram_gb: mb_to_gb(gpu.total_free_mb),
        active_session_id: calls
            .last()
            .and_then(|call| call.get("session_id"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        tool_call_log_size: calls.len(),
    }
}

fn default_kasai_slots() -> Vec<KasaiSlotInfo> {
    ["orchestrator", "agent", "embedder"]
        .into_iter()
        .map(|slot_id| KasaiSlotInfo {
            slot_id: slot_id.into(),
            model_name: None,
            model_size_gb: None,
            vram_used_gb: None,
            status: "empty".into(),
            current_activity: None,
            error: None,
        })
        .collect()
}

fn kasai_slot_from_value(value: &serde_json::Value) -> Option<KasaiSlotInfo> {
    let slot_id = value
        .get("slot")
        .and_then(|slot| slot.as_str())
        .map(str::to_string)?;
    let path = value.get("path").and_then(|path| path.as_str());
    let loaded = value
        .get("loaded")
        .and_then(|loaded| loaded.as_bool())
        .unwrap_or(false);
    let size_bytes = value
        .get("size_bytes")
        .and_then(|size| size.as_u64())
        .unwrap_or_default();
    let vram_mb = value
        .get("vram_mb")
        .and_then(|vram| vram.as_u64())
        .unwrap_or_default();

    Some(KasaiSlotInfo {
        slot_id,
        model_name: path.and_then(|path| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        }),
        model_size_gb: (size_bytes > 0).then_some(bytes_to_gb(size_bytes)),
        vram_used_gb: (loaded && vram_mb > 0).then_some(mb_to_gb(vram_mb)),
        status: if loaded { "loaded" } else { "empty" }.into(),
        current_activity: loaded.then_some("idle".into()),
        error: None,
    })
}

fn runtime_status_label(status: &str) -> String {
    match status {
        "models_handed_off" | "warm" | "completed" => "running".into(),
        "waiting_for_models" => "stopped".into(),
        "error" => "error".into(),
        other => other.to_string(),
    }
}

fn kasai_swap_mode(total_vram_mb: u64) -> String {
    if total_vram_mb >= 24_000 {
        "dual_resident".into()
    } else {
        "single_slot".into()
    }
}

fn mb_to_gb(value: u64) -> f64 {
    ((value as f64 / 1024.0) * 100.0).round() / 100.0
}

fn bytes_to_gb(value: u64) -> f64 {
    ((value as f64 / 1_073_741_824.0) * 100.0).round() / 100.0
}

// CLAUDE_INTERFACE: Updated kasai_get_tool_calls response
// Command: "kasai_get_tool_calls"
// Args: { since_index?: number }
// Returns: { calls: ToolCallInfo[], total_count: number }
// Note: ToolCallInfo now includes tool_args (JSON), result (JSON), duration_ms, audit_result
// Error: never, unless state lock is poisoned
#[tauri::command]
async fn kasai_get_tool_calls(
    state: tauri::State<'_, AppState>,
    since_index: Option<u64>,
) -> Result<serde_json::Value, String> {
    let calls = state.kasai_tool_calls.lock().await;
    let since = since_index.unwrap_or(0);
    let slice = calls
        .iter()
        .filter(|call| {
            call.get("index")
                .and_then(|value| value.as_u64())
                .map_or(true, |index| index >= since)
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "calls": slice,
        "total_count": calls.len(),
    }))
}

async fn next_kasai_tool_call_index(log: &Arc<Mutex<Vec<serde_json::Value>>>) -> u64 {
    let calls = log.lock().await;
    calls
        .iter()
        .filter_map(|call| call.get("index").and_then(|value| value.as_u64()))
        .max()
        .map(|index| index.saturating_add(1))
        .unwrap_or(0)
}

async fn kasai_tool_call_turn_summary(
    log: &Arc<Mutex<Vec<serde_json::Value>>>,
    session_id: &str,
    first_candidate: u64,
) -> (u64, Option<u64>) {
    let calls = log.lock().await;
    let mut count = 0_u64;
    let mut first: Option<u64> = None;
    for call in calls.iter() {
        let matches_session = call
            .get("session_id")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value == session_id);
        let index = call.get("index").and_then(|value| value.as_u64());
        if matches_session && index.is_some_and(|index| index >= first_candidate) {
            count = count.saturating_add(1);
            first = match (first, index) {
                (Some(current), Some(index)) => Some(current.min(index)),
                (None, Some(index)) => Some(index),
                (existing, None) => existing,
            };
        }
    }
    (count, first)
}

// CLAUDE_INTERFACE: Kasai tool call event (Tauri event, NOT invoke)
// Event: "kasai://tool-call/update"
// Payload: ToolCallInfo { index, session_id, timestamp, tool_name, tool_args, status, result, error, duration_ms, source_slot, audit_result }
// Fired: On every tool execution state transition
// Subscribe: listen("kasai://tool-call/update", handler)
//
// CLAUDE_INTERFACE: Kasai tool call complete event (Tauri event)
// Event: "kasai://tool-call/complete"
// Payload: ToolCallInfo (same shape, status is always terminal)
// Fired: When tool reaches Success/Failed/Timeout
async fn record_kasai_tool_call_update(
    app: &tauri::AppHandle,
    log: &Arc<Mutex<Vec<serde_json::Value>>>,
    tool_call: serde_json::Value,
    complete: bool,
) {
    {
        let mut calls = log.lock().await;
        let index = tool_call.get("index").and_then(|value| value.as_u64());
        if let Some(index) = index {
            if let Some(existing) = calls.iter_mut().find(|call| {
                call.get("index")
                    .and_then(|value| value.as_u64())
                    .is_some_and(|candidate| candidate == index)
            }) {
                *existing = tool_call.clone();
            } else {
                calls.push(tool_call.clone());
            }
        } else {
            calls.push(tool_call.clone());
        }

        calls.sort_by_key(|call| {
            call.get("index")
                .and_then(|value| value.as_u64())
                .unwrap_or(0)
        });
        let overflow = calls.len().saturating_sub(200);
        if overflow > 0 {
            calls.drain(0..overflow);
        }
    }

    let _ = app.emit("kasai://tool-call/update", &tool_call);
    if complete {
        let _ = app.emit("kasai://tool-call/complete", &tool_call);
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
                        record_kasai_tool_call_update(&app, &kasai_tool_calls, tool_call, false)
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
                        record_kasai_tool_call_update(&app, &kasai_tool_calls, tool_call, true)
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

// ─── Video Encoder Sidecar (shared, ref-counted) ───────────────────────────

/// Acquire the shared video-encoder sidecar. Boots it on first consumer.
/// Returns the WebSocket port (9877) for RGBA frame streaming.
#[tauri::command]
async fn request_video_encoder(state: tauri::State<'_, AppState>) -> Result<u16, String> {
    let ffmpeg_path = video_encoder::detect_ffmpeg_path();
    let mut encoder = state.video_encoder.lock().await;
    encoder
        .acquire(ffmpeg_path.as_ref())
        .map_err(|e| e.to_string())
}

/// Release one consumer from the video-encoder sidecar.
/// Stops the sidecar process when the last consumer releases.
#[tauri::command]
async fn release_video_encoder(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut encoder = state.video_encoder.lock().await;
    encoder.release();
    Ok(())
}

/// Health-check the running video-encoder sidecar.
#[tauri::command]
async fn video_encoder_health() -> Result<video_encoder::EncoderHealth, String> {
    let client = reqwest::Client::new();
    video_encoder::health_probe(&client)
        .await
        .map_err(|e| e.to_string())
}

// ─── Platform Status ────────────────────────────────────────────────────────

#[tauri::command]
async fn platform_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let gpu_state = state.gpu.lock().await;
    let profile_mgr = state.profile.lock().await;
    let wallet = state.wallet.lock().await;
    let registry = state.registry.lock().await;
    #[cfg(feature = "discourse-native")]
    let discourse = state.discourse.lock().await;
    #[cfg(feature = "discourse-native")]
    let discourse_connected = discourse.is_connected();
    #[cfg(not(feature = "discourse-native"))]
    let discourse_connected = false;
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
            "connected": discourse_connected,
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
        if !unique.iter().any(|existing: &model_manager::ModelRequirement| {
            existing.everywear_model_id == requirement.everywear_model_id
        }) {
            unique.push(requirement);
        }
    }
    unique
}

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
            applet_process: Arc::new(Mutex::new(None)),
            engine_registry: Arc::new(Mutex::new(engine_registry::EngineRegistry::new())),
            vram_scheduler: Arc::new(Mutex::new(vram_scheduler)),
            kasai_tool_calls: Arc::new(Mutex::new(Vec::new())),
            licence_tier: Arc::new(Mutex::new(model_manager::LicenceTier::Demo)),
            user_session: Arc::new(Mutex::new(None)),
            video_encoder: Arc::new(Mutex::new(video_encoder::VideoEncoderService::new())),
            vault: vault_state.clone(),
        })
        .manage::<vault_commands::VaultState>(vault_state)
        .manage::<mait_bridge::MaitStoreState>(Arc::new(Mutex::new(mait_store)))
        .invoke_handler(tauri::generate_handler![
            // GPU
            get_gpu_status,
            poll_vram,
            get_compute_backend,
            get_vram_tier,
            list_model_assessments,
            setup::check_runtime_setup,
            model_commands::resolve_all_models,
            model_commands::adopt_local_model,
            model_commands::add_custom_model_path,
            model_commands::get_custom_model_paths,
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
            #[cfg(feature = "discourse-native")]
            discourse_oauth_url,
            #[cfg(feature = "discourse-native")]
            discourse_complete_oauth,
            #[cfg(feature = "discourse-native")]
            discourse_user,
            #[cfg(feature = "discourse-native")]
            discourse_latest,
            #[cfg(feature = "discourse-native")]
            discourse_get_topics,
            #[cfg(feature = "discourse-native")]
            discourse_read_post,
            #[cfg(feature = "discourse-native")]
            discourse_create_post,
            #[cfg(feature = "discourse-native")]
            discourse_refresh_token,
            #[cfg(feature = "discourse-native")]
            discourse_disconnect,
            // Registry
            list_applets,
            get_applet,
            focus_applet_window,
            is_applet_window_open,
            launch_applet,
            // Bridge: VRAM lifecycle
            get_vram_budget,
            get_active_applet,
            check_applet_requirements,
            request_applet_switch,
            close_applet_webview,
            submit_engine_job,
            kasai_forward_chat,
            kasai_get_status,
            kasai_get_tool_calls,
            // Video encoder sidecar
            request_video_encoder,
            release_video_encoder,
            video_encoder_health,
            // Migration
            get_phase5_migration_plan,
            run_phase5_migration,
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
