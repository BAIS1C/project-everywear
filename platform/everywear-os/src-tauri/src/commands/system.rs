use crate::{gpu, state::AppState};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct ImagenEngineStatus {
    pub engine_loaded: bool,
    pub loaded_model: Option<String>,
    pub available_models: Vec<model_manager::ModelInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImagenRecommendedStack {
    pub primary_model_key: String,
    pub required_model_keys: Vec<String>,
    pub detected_vram_mb: Option<u64>,
    pub quality_label: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemInfoReport {
    pub os: String,
    pub os_version: String,
    pub gpu_name: String,
    pub vram_total_gb: f64,
    pub cuda_version: String,
    pub app_version: String,
    pub session_duration_seconds: u64,
    pub models_available: Vec<String>,
    pub sidecars_running: Vec<String>,
}

/// 1magen UI compatibility: when 1magen is inline-mounted in the shell
/// webview, launch-time status invokes hit the shell process. The heavy
/// image engine still belongs to the managed onemagen runtime; this bridge
/// prevents the shell workbench from failing before the runtime handoff.
#[tauri::command]
pub async fn get_status() -> Result<ImagenEngineStatus, String> {
    Ok(ImagenEngineStatus {
        engine_loaded: false,
        loaded_model: None,
        available_models: Vec::new(),
    })
}

/// 1magen UI compatibility: mirrors the standalone onemagen
/// get_recommended_stack command using the shell's GPU detection state.
#[tauri::command]
pub async fn get_recommended_stack(
    state: tauri::State<'_, AppState>,
) -> Result<ImagenRecommendedStack, String> {
    let gpu_state = state.gpu.lock().await;
    let detected_vram_mb = Some(u64::from(gpu_state.total_vram_mb));

    if gpu_state.total_vram_mb >= 10_240 {
        return Ok(ImagenRecommendedStack {
            primary_model_key: "z-image-turbo-q8".into(),
            required_model_keys: vec![
                "z-image-turbo-q8".into(),
                "qwen3-4b-encoder-q4".into(),
                "pig-flux-vae".into(),
            ],
            detected_vram_mb,
            quality_label: "High Quality".into(),
            rationale: format!(
                "Detected ~{} MB VRAM, so the higher-quality local 1magen stack is appropriate.",
                gpu_state.total_vram_mb
            ),
        });
    }

    Ok(ImagenRecommendedStack {
        primary_model_key: "z-image-turbo-q4km".into(),
        required_model_keys: vec![
            "z-image-turbo-q4km".into(),
            "qwen3-4b-encoder-q4".into(),
            "pig-flux-vae".into(),
        ],
        detected_vram_mb,
        quality_label: "Standard".into(),
        rationale: format!(
            "Detected ~{} MB VRAM, so the lighter standard local 1magen stack is recommended.",
            gpu_state.total_vram_mb
        ),
    })
}

/// 1magen UI compatibility: when 1magen is inline-mounted in the shell
/// webview, its invokes hit the shell process, which previously did not
/// register this command ("Command get_default_output_dir not found" in QA).
/// Mirrors applets/1magen/src-tauri default_output_dir() semantics.
/// (Handoff 2026-06-07.)
#[tauri::command]
pub async fn get_default_output_dir() -> Result<String, String> {
    let base = dirs::picture_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = base.join("Everywear");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.display().to_string())
}

/// Save a bug report to local disk for QA capture, with no external send
/// path. Writes to ~/.everywear/reports/ and returns the absolute path.
/// (Handoff 2026-06-07: bug report modal needs safe local QA capture.)
#[tauri::command]
pub async fn save_bug_report(report_text: String) -> Result<String, String> {
    let reports_dir = everywear_paths::root().join("reports");
    std::fs::create_dir_all(&reports_dir)
        .map_err(|error| format!("Failed to create reports directory: {error}"))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let path = reports_dir.join(format!("bug-report-{timestamp}.txt"));
    std::fs::write(&path, report_text)
        .map_err(|error| format!("Failed to write bug report: {error}"))?;
    Ok(path.display().to_string())
}

/// Return a local Avatar Studio asset root. The frontend converts this path
/// with Tauri's asset protocol so the 3D payload stays local without being
/// embedded into the web dist or fetched from runtime CDN/R2.
#[tauri::command]
pub async fn get_character_studio_asset_root(app: tauri::AppHandle) -> Result<String, String> {
    let root = character_studio_asset_candidates(&app)
        .into_iter()
        .find(|path| path.join("manifest.json").is_file())
        .ok_or_else(|| {
            "Avatar Studio local assets are missing. Expected manifest.json under ~/.everywear/data/character-studio, app resources, or the repo public asset tree.".to_string()
        })?;
    Ok(root.display().to_string())
}

fn character_studio_asset_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = vec![
        everywear_paths::data_dir("character-studio").join("public"),
        everywear_paths::data_dir("character-studio"),
    ];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("character-studio"));
        candidates.push(resource_dir.join("cs-assets"));
    }

    if let Some(repo_public) = repo_character_studio_public() {
        candidates.push(repo_public);
    }

    candidates
}

fn repo_character_studio_public() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    loop {
        let candidate = current
            .join("applets")
            .join("character-studio")
            .join("public");
        if candidate.join("manifest.json").is_file() {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

#[tauri::command]
pub async fn get_system_info(
    state: tauri::State<'_, AppState>,
) -> Result<SystemInfoReport, String> {
    let gpu_state = state.gpu.lock().await;
    let active_applet = state.active_applet.lock().await.clone();
    let gpu_name = gpu_state
        .primary_gpu
        .clone()
        .unwrap_or_else(|| gpu_state.backend.label());
    let cuda_version = match &gpu_state.backend {
        gpu::ComputeBackend::Cuda { cuda, .. } => cuda
            .toolkit_version
            .clone()
            .unwrap_or_else(|| cuda.driver_version.clone()),
        _ => String::new(),
    };
    let sidecars_running = active_applet.into_iter().collect::<Vec<_>>();

    Ok(SystemInfoReport {
        os: std::env::consts::OS.to_string(),
        os_version: std::env::consts::ARCH.to_string(),
        gpu_name,
        vram_total_gb: (gpu_state.total_vram_mb as f64 / 1024.0 * 10.0).round() / 10.0,
        cuda_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        session_duration_seconds: 0,
        models_available: Vec::new(),
        sidecars_running,
    })
}
