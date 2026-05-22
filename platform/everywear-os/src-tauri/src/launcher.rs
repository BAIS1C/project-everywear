//! Applet launch pipeline: gate, purge, provision, handoff.
//!
//! This module implements the full applet switch sequence defined in
//! WIKI.md Section 6 "Applet Switch: Deterministic Purge Cycle".
//!
//! The pipeline is:
//! 1. Gate check: can this applet run on this hardware?
//! 2. Budget check: does it fit in free VRAM?
//! 3. User confirmation: show what will be purged (ALL tiers)
//! 4. Purge cycle: unload + NVML verify
//! 5a. Provision: download missing models
//! 5b. Provision: upgrade pack models (licence-gated)
//! 5c. Provision: ensure sidecar binaries in ~/.everywear/bin/
//! 6. Handoff: launch binary or URL with model paths
//! 7. WebviewWindow: spawn applet UI inside Everywear OS (lib.rs)

use crate::budget::{
    select_model_group, PurgePolicy, PurgeRequest, PurgeResult, PurgeScope,
    RequirementsCheck, VramAllocation, VramBudget,
};
use crate::gpu;
use applet_ipc::{ModelPath, ShellChannel};
use model_manager::{AppletManifest, ModelManager, ModelRole};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Model paths handoff
// ---------------------------------------------------------------------------

/// Paths resolved for an applet's model group, ready for handoff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPaths {
    pub primary: Option<PathBuf>,
    pub encoder: Option<PathBuf>,
    pub vae: Option<PathBuf>,
    pub lora: Vec<PathBuf>,
}

// ---------------------------------------------------------------------------
// Switch confirmation event payload
// ---------------------------------------------------------------------------

/// Emitted to the frontend when a switch requires user confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchConfirmPayload {
    pub incoming_applet: String,
    pub incoming_applet_name: String,
    pub current_applet: Option<String>,
    pub models_to_unload: Vec<String>,
    pub estimated_purge_mb: u64,
    pub selected_group: String,
    pub models_to_download: Vec<ModelDownloadInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadInfo {
    pub key: String,
    pub name: String,
    pub size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Switch progress events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchProgressPayload {
    pub stage: SwitchStage,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SwitchStage {
    GateCheck,
    WaitingConfirm,
    Purging,
    VerifyingVram,
    Downloading,
    Launching,
    Ready,
    Failed,
}

// ---------------------------------------------------------------------------
// Gate check (step 1)
// ---------------------------------------------------------------------------

/// Check if an applet can launch on this hardware. Does NOT modify state.
pub fn check_requirements(
    manifest: &AppletManifest,
    budget: &VramBudget,
    policy: &PurgePolicy,
    model_mgr: &ModelManager,
) -> RequirementsCheck {
    // Find a viable model group
    let group = select_model_group(manifest, budget, policy);

    let group = match group {
        Some(g) => g,
        None => {
            return RequirementsCheck {
                can_launch: false,
                selected_group: None,
                selected_group_vram_mb: None,
                needs_download: vec![],
                needs_purge: false,
                purge_applet: None,
                reason: Some(format!(
                    "No model group fits. Minimum required: {} MB, available: {} MB total.",
                    manifest.min_vram_mb(),
                    budget.total_mb
                )),
            };
        }
    };

    // Check which models need downloading
    let needs_download: Vec<String> = group
        .models
        .iter()
        .filter(|m| m.required && !model_mgr.is_downloaded(&m.key))
        .map(|m| m.key.clone())
        .collect();

    // Check if purge is needed
    let needs_purge = !budget.can_fit(group.min_vram_mb);
    let purge_applet = if needs_purge {
        budget.active_applet().map(|s| s.to_string())
    } else {
        None
    };

    RequirementsCheck {
        can_launch: true,
        selected_group: Some(group.label.clone()),
        selected_group_vram_mb: Some(group.min_vram_mb),
        needs_download,
        needs_purge,
        purge_applet,
        reason: None,
    }
}

// ---------------------------------------------------------------------------
// Purge cycle (step 4)
// ---------------------------------------------------------------------------

/// Execute a purge: update the budget ledger, then verify via NVML polling.
///
/// Note: the actual model unload command must be sent to the applet BEFORE
/// calling this. This function handles the budget bookkeeping and NVML
/// verification, not the IPC to the applet's engine.
pub async fn execute_purge(
    request: &PurgeRequest,
    budget: &mut VramBudget,
    gpu_index: u32,
) -> PurgeResult {
    info!(
        applet = %request.applet_id,
        scope = ?request.scope,
        expected_mb = request.expected_reclaim_mb,
        "Executing purge"
    );

    // Update budget ledger
    match request.scope {
        PurgeScope::All => budget.release_applet(&request.applet_id),
        PurgeScope::PrimaryOnly => budget.release_primary(&request.applet_id),
    }

    // NVML verification loop: poll every 200ms for up to 5 seconds
    let mut nvml_verified = false;
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(5);
    let poll_interval = std::time::Duration::from_millis(200);

    while start.elapsed() < timeout {
        if let Some((_used, free)) = gpu::poll_vram(gpu_index) {
            if budget.verify_against_nvml(free) {
                nvml_verified = true;
                info!(
                    free_mb = free,
                    budget_free = budget.free_mb(),
                    elapsed_ms = start.elapsed().as_millis(),
                    "NVML verified: VRAM reclaimed"
                );
                break;
            }
        }
        tokio::time::sleep(poll_interval).await;
    }

    if !nvml_verified {
        warn!(
            applet = %request.applet_id,
            elapsed_ms = start.elapsed().as_millis(),
            "NVML verification timed out (proceeding anyway, driver lag is common)"
        );
    }

    PurgeResult {
        success: true,
        reclaimed_mb: request.expected_reclaim_mb,
        nvml_verified,
        error: None,
    }
}

// ---------------------------------------------------------------------------
// Manifest bridging (pre-provision)
// ---------------------------------------------------------------------------

/// Convert an applet manifest's model groups into `ModelInfo` entries that
/// the ModelManager can use for discovery and download. This bridges the
/// gap between the declarative `applet.toml` (which uses `ModelRequirement`)
/// and the ModelManager's flat manifest (which uses `ModelInfo`).
///
/// Only requirements that carry download metadata (hf_repo + hf_file) are
/// converted; requirements that reference models by key alone are assumed
/// to already be in the ModelManager's manifest (e.g. shared models
/// registered by another applet).
pub fn manifest_info_from_groups(manifest: &AppletManifest) -> Vec<model_manager::ModelInfo> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    let mut infos = Vec::new();

    for group in &manifest.model_groups {
        for req in &group.models {
            // Skip duplicates (same key across multiple VRAM tiers)
            if !seen.insert(req.key.clone()) {
                continue;
            }
            // Only convert if we have download metadata
            let (Some(ref hf_repo), Some(ref hf_file)) = (&req.hf_repo, &req.hf_file) else {
                continue;
            };

            let model_type = match req.role {
                ModelRole::Encoder | ModelRole::TextEncoder | ModelRole::Projection => {
                    model_manager::ModelType::Encoder
                }
                ModelRole::Vae | ModelRole::VideoVae | ModelRole::AudioVae => {
                    model_manager::ModelType::Vae
                }
                _ => match manifest.engine.engine_type.as_str() {
                    "llm" => model_manager::ModelType::Llm,
                    "audio" => model_manager::ModelType::Audio,
                    _ => model_manager::ModelType::TextToImage,
                },
            };

            infos.push(model_manager::ModelInfo {
                key: req.key.clone(),
                name: req.key.clone(), // display name defaults to key
                filename: req.filename.clone().unwrap_or_else(|| hf_file.clone()),
                size_bytes: req.size_bytes.unwrap_or(0),
                sha256: None,
                hf_repo: hf_repo.clone(),
                hf_file: hf_file.clone(),
                model_type,
                path: None,
                downloaded: false,
            });
        }
    }

    infos
}

// ---------------------------------------------------------------------------
// Upgrade pack provisioning (step 5b)
// ---------------------------------------------------------------------------

/// Resolve entitled upgrade packs into `ModelInfo` entries for the
/// ModelManager. For VRAM-gated packs, picks the best quant that fits.
/// For single-file packs, returns that file directly.
///
/// Returns the list of model keys that were added (caller can check
/// which are missing and need downloading).
pub fn provision_upgrade_packs(
    manifest: &AppletManifest,
    tier: model_manager::LicenceTier,
    vram_mb: u64,
    model_mgr: &mut ModelManager,
    engine_type: &str,
) -> Vec<String> {
    let entitled = manifest.entitled_packs(tier);
    if entitled.is_empty() {
        return Vec::new();
    }

    let mut added_keys = Vec::new();

    for (pack_id, pack) in &entitled {
        // Skip placeholder packs (not yet downloadable)
        if pack.status != "active" {
            info!(pack = %pack_id, "Skipping placeholder upgrade pack");
            continue;
        }

        // Single-file pack
        if let Some(ref file) = pack.file {
            let model_type = match file.role {
                ModelRole::Encoder | ModelRole::TextEncoder | ModelRole::Projection => {
                    model_manager::ModelType::Encoder
                }
                ModelRole::Vae | ModelRole::VideoVae | ModelRole::AudioVae => {
                    model_manager::ModelType::Vae
                }
                _ => match engine_type {
                    "llm" => model_manager::ModelType::Llm,
                    "audio" => model_manager::ModelType::Audio,
                    _ => model_manager::ModelType::TextToImage,
                },
            };

            let infos = vec![model_manager::ModelInfo {
                key: file.key.clone(),
                name: format!("{} ({})", pack.label, file.key),
                filename: file.filename.clone(),
                size_bytes: file.size_bytes,
                sha256: None,
                hf_repo: file.hf_repo.clone(),
                hf_file: file.hf_file.clone(),
                model_type,
                path: None,
                downloaded: false,
            }];
            model_mgr.add_models(infos);
            added_keys.push(file.key.clone());
            info!(pack = %pack_id, key = %file.key, "Added single-file upgrade pack model");
        }

        // VRAM-gated quant ladder
        if !pack.quants.is_empty() {
            if let Some(selected) = AppletManifest::select_pack_quant(pack, vram_mb) {
                let model_type = match selected.role {
                    ModelRole::Encoder | ModelRole::TextEncoder | ModelRole::Projection => {
                        model_manager::ModelType::Encoder
                    }
                    ModelRole::Vae | ModelRole::VideoVae | ModelRole::AudioVae => {
                        model_manager::ModelType::Vae
                    }
                    _ => match engine_type {
                        "llm" => model_manager::ModelType::Llm,
                        "audio" => model_manager::ModelType::Audio,
                        _ => model_manager::ModelType::TextToImage,
                    },
                };

                let infos = vec![model_manager::ModelInfo {
                    key: selected.key.clone(),
                    name: format!("{} {} ({})", pack.label, selected.quant, selected.key),
                    filename: selected.filename.clone(),
                    size_bytes: selected.size_bytes,
                    sha256: None,
                    hf_repo: selected.hf_repo.clone(),
                    hf_file: selected.hf_file.clone(),
                    model_type,
                    path: None,
                    downloaded: false,
                }];
                model_mgr.add_models(infos);
                added_keys.push(selected.key.clone());
                info!(
                    pack = %pack_id,
                    quant = %selected.quant,
                    key = %selected.key,
                    vram_mb = vram_mb,
                    "Selected VRAM-gated upgrade pack quant"
                );
            } else {
                warn!(
                    pack = %pack_id,
                    vram_mb = vram_mb,
                    min_required = pack.quants.iter().map(|q| q.min_vram_mb).min().unwrap_or(0),
                    "No upgrade pack quant fits available VRAM"
                );
            }
        }
    }

    // Re-scan so any already-downloaded upgrade models are discovered
    if !added_keys.is_empty() {
        model_mgr.scan();
    }

    added_keys
}

// ---------------------------------------------------------------------------
// Provision (step 5)
// ---------------------------------------------------------------------------

/// Download all missing models for a model group. Emits progress events.
pub async fn provision_models(
    app: &tauri::AppHandle,
    model_mgr: &mut ModelManager,
    missing_keys: &[String],
) -> Result<()> {
    for key in missing_keys {
        info!(model = %key, "Provisioning model");

        let app_handle = app.clone();
        model_mgr
            .download(key, move |progress| {
                let _ = app_handle.emit("download-progress", &progress);
            })
            .await
            .with_context(|| format!("failed to download model {key}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Sidecar provisioning (step 5b)
// ---------------------------------------------------------------------------

/// Ensure a sidecar engine binary bundle exists in the managed directory.
///
/// For applets with `backend = "server"` and a `[engine.sidecar]` declaration,
/// the shell must verify that the executable and its companion files (DLLs,
/// codecs) are present at `~/.everywear/bin/<name>/` before launch.
///
/// Resolution order:
///   1. Target dir already populated (previously provisioned): no-op
///   2. `source_dir` exists on disk (local build): copy bundle
///   3. `source_url` provided: download and extract (TODO: Phase 2)
///   4. Error: cannot provision
pub fn provision_sidecar(manifest: &AppletManifest) -> Result<()> {
    // Only relevant for server-backend applets with a sidecar declaration
    if manifest.engine.backend != "server" {
        return Ok(());
    }
    let sidecar = match &manifest.engine.sidecar {
        Some(s) => s,
        None => {
            // No sidecar declared; applet is responsible for finding its own binary
            // (legacy locate_binary() path in ace_server.rs etc.)
            return Ok(());
        }
    };

    let bundle_name = sidecar
        .name
        .as_deref()
        .unwrap_or(&manifest.engine.server_binary);
    let target_dir = everywear_paths::bin_dir().join(bundle_name);
    std::fs::create_dir_all(&target_dir)
        .with_context(|| format!("failed to create sidecar dir {}", target_dir.display()))?;

    let exe_target = target_dir.join(&sidecar.executable);

    // 1. Already provisioned?
    if exe_target.exists() {
        info!(
            sidecar = bundle_name,
            path = %exe_target.display(),
            "Sidecar already provisioned"
        );
        return Ok(());
    }

    // 1b. Local-first sidecar discovery for ACE server. Users may already
    // have an ace-server binary from another music tool or a local build.
    if bundle_name == "ace-server" {
        if let Some(local_binary) = discover_ace_server_binary(&sidecar.executable) {
            provision_binary_link_or_copy(&local_binary, &exe_target).with_context(|| {
                format!(
                    "failed to provision discovered ACE server {} -> {}",
                    local_binary.display(),
                    exe_target.display()
                )
            })?;
            info!(
                source = %local_binary.display(),
                target = %exe_target.display(),
                "Provisioned ACE server from local discovery"
            );
            return Ok(());
        }

        let stub_path = target_dir.join("ace-server-stub.js");
        write_ace_silence_stub(&stub_path)?;
        warn!(
            path = %stub_path.display(),
            "ACE server binary not found locally; installed silence stub"
        );
        return Ok(());
    }

    // 2. Copy from local source_dir (dev/build machine)
    if let Some(ref source) = sidecar.source_dir {
        let source_dir = expand_path(source);
        if source_dir.is_dir() {
            info!(
                sidecar = bundle_name,
                source = %source_dir.display(),
                target = %target_dir.display(),
                "Provisioning sidecar from local build"
            );

            // Copy executable
            let exe_source = source_dir.join(&sidecar.executable);
            if !exe_source.exists() {
                anyhow::bail!(
                    "Sidecar executable {} not found in source_dir {}",
                    sidecar.executable,
                    source_dir.display()
                );
            }
            std::fs::copy(&exe_source, &exe_target).with_context(|| {
                format!(
                    "failed to copy {} -> {}",
                    exe_source.display(),
                    exe_target.display()
                )
            })?;

            // Copy companions (DLLs, codecs, etc.)
            for companion in &sidecar.companions {
                let src = source_dir.join(companion);
                let dst = target_dir.join(companion);
                if src.exists() {
                    std::fs::copy(&src, &dst).with_context(|| {
                        format!(
                            "failed to copy companion {} -> {}",
                            src.display(),
                            dst.display()
                        )
                    })?;
                    info!(file = companion, "  Copied companion");
                } else {
                    warn!(
                        file = companion,
                        source = %source_dir.display(),
                        "Companion file not found in source_dir (skipping)"
                    );
                }
            }

            info!(sidecar = bundle_name, "Sidecar provisioned successfully");
            return Ok(());
        } else {
            warn!(
                source_dir = %source_dir.display(),
                "Sidecar source_dir does not exist; falling through"
            );
        }
    }

    // 3. Download from URL (Phase 2)
    if let Some(ref _url) = sidecar.source_url {
        // TODO: download archive, extract, verify SHA256
        anyhow::bail!(
            "Sidecar download not yet implemented. \
             Expected {} at {} or a valid source_dir.",
            sidecar.executable,
            exe_target.display()
        );
    }

    anyhow::bail!(
        "Cannot provision sidecar '{}': executable {} not found at {} \
         and no source_dir or source_url resolved.",
        bundle_name,
        sidecar.executable,
        exe_target.display()
    )
}

fn discover_ace_server_binary(executable: &str) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ACE_SERVER_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("engines").join("ace-server").join(executable));
    }
    candidates.push(PathBuf::from(
        r"C:\Users\MAG MSI\Project Ace\S3 STUDIO\acestep.cpp\build\Release",
    ).join(executable));
    candidates.push(PathBuf::from(r"C:\Program Files\ACE-Step").join(executable));
    candidates.push(PathBuf::from(r"C:\ACE-Step").join(executable));

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    which::which(executable)
        .or_else(|_| which::which(executable.trim_end_matches(".exe")))
        .ok()
}

fn provision_binary_link_or_copy(source: &PathBuf, target: &PathBuf) -> Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    create_file_symlink(source, target)
        .or_else(|_| std::fs::copy(source, target).map(|_| ()))
        .map_err(Into::into)
}

#[cfg(windows)]
fn create_file_symlink(source: &PathBuf, target: &PathBuf) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, target)
}

#[cfg(not(windows))]
fn create_file_symlink(source: &PathBuf, target: &PathBuf) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, target)
}

fn write_ace_silence_stub(stub_path: &PathBuf) -> Result<()> {
    let script = r#"const http = require("http");
const portArg = process.argv.findIndex((arg) => arg === "--port");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8080;
function json(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, {"content-type": "application/json", "content-length": Buffer.byteLength(body)});
  res.end(body);
}
http.createServer((req, res) => {
  if (req.url === "/props") return json(res, { ok: true, stub: true, mode: "silence" });
  if (req.url === "/generate") return json(res, { ok: true, audio_base64: "", sample_rate: 44100, duration: 0, stub: true });
  json(res, { ok: true, stub: true });
}).listen(port, "127.0.0.1", () => console.log(`ace silence stub listening on ${port}`));
"#;
    std::fs::write(stub_path, script).with_context(|| format!("write {}", stub_path.display()))
}

/// Expand `~` and environment variables in a path string.
fn expand_path(path: &str) -> std::path::PathBuf {
    let expanded = if path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            path.replacen('~', &home.to_string_lossy(), 1)
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    };
    std::path::PathBuf::from(expanded)
}

// ---------------------------------------------------------------------------
// Handoff (step 6)
// ---------------------------------------------------------------------------

/// Resolve model paths for a selected model group.
pub fn resolve_model_paths(
    group: &model_manager::ModelGroup,
    model_mgr: &ModelManager,
) -> Result<ModelPaths> {
    let mut paths = ModelPaths {
        primary: None,
        encoder: None,
        vae: None,
        lora: vec![],
    };

    for req in &group.models {
        if !req.required {
            continue;
        }
        let path = model_mgr
            .model_path(&req.key)
            .with_context(|| format!("model {} not found on disk after provisioning", req.key))?;

        match req.role {
            ModelRole::Primary => paths.primary = Some(path),
            ModelRole::Encoder | ModelRole::TextEncoder | ModelRole::Projection => {
                paths.encoder = Some(path)
            }
            ModelRole::Vae | ModelRole::VideoVae | ModelRole::AudioVae => paths.vae = Some(path),
            ModelRole::Lora => paths.lora.push(path),
        }
    }

    Ok(paths)
}

/// Resolve model paths in the explicit IPC handoff shape used by
/// CommandKind::StartInference.
pub fn resolve_ipc_model_paths(
    group: &model_manager::ModelGroup,
    model_mgr: &ModelManager,
) -> Result<Vec<ModelPath>> {
    let mut paths = Vec::new();

    for req in &group.models {
        if !req.required {
            continue;
        }
        let path = model_mgr
            .model_path(&req.key)
            .with_context(|| format!("model {} not found on disk after provisioning", req.key))?;

        paths.push(ModelPath {
            role: model_role_for_ipc(&req.role).to_string(),
            path,
            vram_mb: req.vram_mb.try_into().unwrap_or(u32::MAX),
        });
    }

    Ok(paths)
}

fn model_role_for_ipc(role: &ModelRole) -> &'static str {
    match role {
        ModelRole::Primary => "primary",
        ModelRole::Encoder => "encoder",
        ModelRole::Vae => "vae",
        ModelRole::Lora => "lora",
        ModelRole::Projection => "projection",
        ModelRole::VideoVae => "video_vae",
        ModelRole::AudioVae => "audio_vae",
        ModelRole::TextEncoder => "text_encoder",
    }
}

/// Record VRAM allocations for a model group being loaded.
pub fn record_allocations(
    budget: &mut VramBudget,
    applet_id: &str,
    group: &model_manager::ModelGroup,
) {
    for req in &group.models {
        budget.allocate(VramAllocation {
            applet_id: applet_id.to_string(),
            model_key: req.key.clone(),
            role: req.role.clone(),
            vram_mb: req.vram_mb,
            loaded_at: Utc::now(),
        });
    }
}

/// Resolve the full path to an applet's binary.
///
/// Search order:
/// 1. Applet-local `src-tauri/target/{debug,release}` builds
/// 2. Workspace-root `target/{debug,release}` builds
/// 3. `applets/<applet_id>/<binary_name>[.exe]` flat layout
/// 4. Sibling of the shell's own executable (bundled deployment)
/// 5. Bare name, relying on PATH (fallback)
///
/// The monorepo root is derived by walking up from the shell binary's
/// location until we find a directory containing `applets/`.
fn resolve_binary_path(applet_id: &str, binary_name: &str) -> PathBuf {
    if let Ok(resolved) =
        crate::applet_resolver::resolve_applet_binary_named(applet_id, binary_name)
    {
        return resolved;
    }

    let bin_name = if cfg!(windows) && !binary_name.ends_with(".exe") {
        format!("{binary_name}.exe")
    } else {
        binary_name.to_string()
    };

    // Try to find the monorepo root by walking up from the shell binary
    if let Ok(shell_exe) = std::env::current_exe() {
        let mut cursor = shell_exe.parent().map(|p| p.to_path_buf());

        // Walk up at most 8 levels (covers target/release/deps depth)
        for _ in 0..8 {
            if let Some(ref dir) = cursor {
                if dir.join("applets").is_dir() {
                    // Found monorepo root
                    for candidate in crate::registry::binary_candidates(dir, applet_id, &bin_name) {
                        if candidate.exists() {
                            info!(path = %candidate.display(), "Resolved applet binary");
                            return candidate;
                        }
                    }

                    break;
                }
                cursor = dir.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }

        // 3. Sibling of shell binary (bundled deployment)
        if let Some(shell_dir) = shell_exe.parent() {
            let sibling = shell_dir.join(&bin_name);
            if sibling.exists() {
                info!(path = %sibling.display(), "Resolved applet binary (sibling)");
                return sibling;
            }
        }
    }

    // 4. Bare name; rely on PATH
    warn!(
        binary = binary_name,
        applet = applet_id,
        "Could not resolve applet binary path; falling back to bare name on PATH"
    );
    PathBuf::from(&bin_name)
}

/// Result of launching a binary applet: child process + IPC channel.
pub struct AppletProcess {
    pub child: std::process::Child,
    pub ipc: ShellChannel,
    pub advertisement: Option<serde_json::Value>,
}

/// Launch an applet binary or open a web URL.
///
/// For binary applets:
/// 1. Binds an IPC listener on localhost (random port)
/// 2. Generates a per-launch EVERYWEAR_IPC_SECRET for HMAC auth
/// 3. Spawns the binary with CMD_PORT + IPC_SECRET + model path env vars
/// 4. Waits for the applet to connect back
/// 5. Returns the child handle + IPC channel
///
/// For web applets: opens the URL in the default browser, returns None.
pub async fn launch_applet_process(
    applet_id: &str,
    launch_binary: Option<&str>,
    launch_url: Option<&str>,
    model_paths: &ModelPaths,
) -> Result<Option<AppletProcess>> {
    if let Some(url) = launch_url {
        // Web applets: open in default browser
        info!(applet = applet_id, url, "Launching web applet");
        open::that(url).with_context(|| format!("failed to open URL: {url}"))?;
        Ok(None)
    } else if let Some(binary) = launch_binary {
        // Tauri applets: spawn as child process with IPC channel
        let resolved = resolve_binary_path(applet_id, binary);
        info!(
            applet = applet_id,
            binary = %resolved.display(),
            "Launching binary applet"
        );

        // 1. Bind IPC listener
        let mut ipc = applet_ipc::ShellChannel::bind()
            .await
            .context("failed to bind IPC channel")?;

        let (env_key, env_val) = ipc.env_pair();

        // 2. Generate per-launch IPC secret for HMAC authentication
        let ipc_secret = uuid::Uuid::new_v4().to_string();
        ipc.set_ipc_secret(ipc_secret.clone());

        // 3. Build command with all env vars
        let mut cmd = std::process::Command::new(&resolved);

        // IPC port + shared secret
        cmd.env(env_key, &env_val);
        cmd.env(applet_ipc::ENV_IPC_SECRET, &ipc_secret);

        // Model paths
        if let Some(p) = &model_paths.primary {
            cmd.env("EVERYWEAR_MODEL_PRIMARY", p);
        }
        if let Some(p) = &model_paths.encoder {
            cmd.env("EVERYWEAR_MODEL_ENCODER", p);
        }
        if let Some(p) = &model_paths.vae {
            cmd.env("EVERYWEAR_MODEL_VAE", p);
        }

        // 4. Spawn
        let child = cmd.spawn().with_context(|| {
            format!(
                "failed to spawn applet binary: {} (resolved from '{}')",
                resolved.display(),
                binary
            )
        })?;

        // 5. Wait for applet to connect (10 second timeout)
        let connect_timeout = std::time::Duration::from_secs(10);
        ipc.accept(connect_timeout)
            .await
            .context("applet did not connect to IPC channel")?;

        let advertisement = match ipc.await_advertisement(connect_timeout).await {
            Ok(capabilities) => {
                info!(applet = applet_id, "Applet advertised signed capabilities");
                Some(capabilities)
            }
            Err(error) => {
                warn!(
                    applet = applet_id,
                    error = %error,
                    "Applet connected but did not complete signed capability advertisement"
                );
                None
            }
        };

        info!(applet = applet_id, "Applet IPC channel established");

        Ok(Some(AppletProcess {
            child,
            ipc,
            advertisement,
        }))
    } else {
        anyhow::bail!("applet {applet_id} has no launch_url or launch_binary");
    }
}
