use crate::{assessment, gpu, state::AppState};

#[tauri::command]
pub async fn get_gpu_status(
    state: tauri::State<'_, AppState>,
) -> Result<gpu::SystemGpuState, String> {
    let gpu_state = gpu::detect_gpus();
    let mut stored = state.gpu.lock().await;
    *stored = gpu_state.clone();
    Ok(gpu_state)
}

#[tauri::command]
pub async fn poll_vram(
    _state: tauri::State<'_, AppState>,
    gpu_index: u32,
) -> Result<serde_json::Value, String> {
    match gpu::poll_vram(gpu_index) {
        Some((used, free)) => Ok(serde_json::json!({ "used_mb": used, "free_mb": free })),
        None => Err("GPU not available".into()),
    }
}

#[tauri::command]
pub async fn get_compute_backend(
    state: tauri::State<'_, AppState>,
) -> Result<gpu::ComputeBackend, String> {
    let stored = state.gpu.lock().await;
    Ok(stored.backend.clone())
}

#[tauri::command]
pub async fn get_vram_tier(state: tauri::State<'_, AppState>) -> Result<gpu::VramTier, String> {
    let stored = state.gpu.lock().await;
    Ok(stored.vram_tier)
}

#[tauri::command]
pub async fn list_model_assessments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<assessment::ModelAssessment>, String> {
    let gpu_state = gpu::detect_gpus();
    let mut stored = state.gpu.lock().await;
    *stored = gpu_state.clone();
    Ok(assessment::list_model_assessments(&gpu_state))
}
