use crate::{gpu, state::AppState};
use serde::Serialize;

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
