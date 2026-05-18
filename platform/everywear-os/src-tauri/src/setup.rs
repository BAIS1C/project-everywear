use crate::{model_commands, video_encoder, AppState};
use model_manager::{ResolutionResult, ResolutionStatus};
use serde::Serialize;

#[derive(Serialize)]
pub struct RuntimeSetupStatus {
    pub ffmpeg_available: bool,
    pub ffmpeg_path: Option<String>,
    pub cuda_available: bool,
    pub compute_backend: String,
    pub total_vram_mb: u64,
    pub uv_available: bool,
    pub model_resolution: Vec<ResolutionResult>,
    pub total_models_found_locally: usize,
    pub total_models_available: usize,
    pub total_models_need_download: usize,
    pub total_models_incompatible: usize,
    pub total_estimated_download_gb: f64,
}

// CLAUDE_INTERFACE: Check runtime setup including local-first model resolution
// Command: "check_runtime_setup"
// Args: {}
// Returns: RuntimeSetupStatus with ffmpeg/cuda/uv checks and full model_resolution map
// Usage: Call on first-run setup mount. Never starts downloads; model discovery is read-only.
#[tauri::command]
pub async fn check_runtime_setup(
    state: tauri::State<'_, AppState>,
) -> Result<RuntimeSetupStatus, String> {
    let ffmpeg_path = video_encoder::detect_ffmpeg_path();
    let uv_available = which::which("uv").is_ok();
    let gpu_state = state.gpu.lock().await.clone();
    let model_resolution = {
        let resolver = state.model_resolver.lock().await;
        resolver.resolve_all().map_err(|error| error.to_string())?
    };
    let summary = model_commands::summarize_resolution(&model_resolution);

    Ok(RuntimeSetupStatus {
        ffmpeg_available: ffmpeg_path.is_some(),
        ffmpeg_path: ffmpeg_path.map(|path| path.to_string_lossy().to_string()),
        cuda_available: matches!(gpu_state.backend, crate::gpu::ComputeBackend::Cuda { .. }),
        compute_backend: gpu_state.backend.label().to_string(),
        total_vram_mb: gpu_state.total_vram_mb,
        uv_available,
        model_resolution,
        total_models_found_locally: summary.total_models_found_locally,
        total_models_available: summary.total_models_available,
        total_models_need_download: summary.total_models_need_download,
        total_models_incompatible: summary.total_models_incompatible,
        total_estimated_download_gb: summary.total_estimated_download_gb,
    })
}

pub fn count_downloads(results: &[ResolutionResult]) -> usize {
    results
        .iter()
        .filter(|result| matches!(result.status, ResolutionStatus::NeedsDownload { .. }))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_manager::{HfSource, ModelSource};

    #[test]
    fn count_downloads_only_counts_needs_download() {
        let results = vec![
            ResolutionResult {
                everywear_model_id: "available".into(),
                status: ResolutionStatus::Available,
                source: ModelSource::EverywearVault,
                details: String::new(),
            },
            ResolutionResult {
                everywear_model_id: "missing".into(),
                status: ResolutionStatus::NeedsDownload {
                    hf_source: HfSource {
                        repo: None,
                        file: None,
                        expected_size_bytes: None,
                    },
                },
                source: ModelSource::HuggingFace,
                details: String::new(),
            },
        ];
        assert_eq!(count_downloads(&results), 1);
    }
}
