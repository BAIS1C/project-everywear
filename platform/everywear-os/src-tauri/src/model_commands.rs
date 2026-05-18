use crate::{profile, AppState};
use model_manager::{ResolutionResult, ResolutionStatus, SuggestedAction};
use serde::Serialize;
use std::path::PathBuf;

pub const CUSTOM_MODEL_PATHS_PREF: &str = "model.custom_scan_paths";

// CLAUDE_INTERFACE: Resolve all models — check local sources first
// Command: "resolve_all_models"
// Args: {}
// Returns: ResolutionResult[] — one per model requirement across all applets
// Each result has: everywear_model_id, status (Available|FoundLocally|NeedsDownload|Incompatible), source, details
// FoundLocally includes: discovered model info (source_path, source_tool, filename, size, format, metadata, compatibility)
// Usage: Call on setup panel mount. Show each model's status. For FoundLocally, show "Adopt" button.
#[tauri::command]
pub async fn resolve_all_models(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ResolutionResult>, String> {
    let resolver = state.model_resolver.lock().await;
    resolver.resolve_all().map_err(|error| error.to_string())
}

// CLAUDE_INTERFACE: Adopt a locally discovered model into Everywear vault
// Command: "adopt_local_model"
// Args: { everywear_model_id: string, action: "symlink"|"copy"|"move" }
// Returns: AdoptResult { vault_path, source_path, action_taken, file_size_bytes }
// Usage: When user clicks "Adopt" on a FoundLocally model in the setup panel
// Note: For large files, this may take several seconds. Show progress indicator.
#[tauri::command]
pub async fn adopt_local_model(
    everywear_model_id: String,
    action: String,
    state: tauri::State<'_, AppState>,
) -> Result<AdoptResult, String> {
    let action = parse_action(&action)?;
    let resolver = state.model_resolver.lock().await;
    let adopted = resolver
        .adopt_model_by_id(&everywear_model_id, action)
        .map_err(|error| error.to_string())?;
    Ok(AdoptResult {
        vault_path: adopted.vault_path.to_string_lossy().to_string(),
        source_path: adopted.source_path.to_string_lossy().to_string(),
        action_taken: action_label(&adopted.action_taken).to_string(),
        file_size_bytes: adopted.file_size_bytes,
    })
}

// CLAUDE_INTERFACE: Add custom model scan directory
// Command: "add_custom_model_path"
// Args: { path: string }
// Returns: {}
// Usage: "Add custom path" button in setup panel. Opens folder picker, adds to scan list.
// Persists across sessions via profile preferences.
#[tauri::command]
pub async fn add_custom_model_path(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("custom model path does not exist: {}", path.display()));
    }

    {
        let mut resolver = state.model_resolver.lock().await;
        resolver.add_custom_path(path.clone());
    }

    let profile = state.profile.lock().await;
    let mut paths = custom_paths_from_profile(&profile);
    let path_string = path.to_string_lossy().to_string();
    if !paths.iter().any(|existing| existing == &path_string) {
        paths.push(path_string);
    }
    let json = serde_json::to_string(&paths).map_err(|error| error.to_string())?;
    profile
        .set_pref(CUSTOM_MODEL_PATHS_PREF, &json)
        .map_err(|error| error.to_string())
}

// CLAUDE_INTERFACE: Get custom model scan directories
// Command: "get_custom_model_paths"
// Args: {}
// Returns: string[]
#[tauri::command]
pub async fn get_custom_model_paths(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let profile = state.profile.lock().await;
    Ok(custom_paths_from_profile(&profile))
}

#[derive(Serialize)]
pub struct AdoptResult {
    pub vault_path: String,
    pub source_path: String,
    pub action_taken: String,
    pub file_size_bytes: u64,
}

pub fn summarize_resolution(results: &[ResolutionResult]) -> ModelResolutionSummary {
    let total_models_available = results
        .iter()
        .filter(|result| matches!(result.status, ResolutionStatus::Available))
        .count();
    let total_models_found_locally = results
        .iter()
        .filter(|result| matches!(result.status, ResolutionStatus::FoundLocally { .. }))
        .count();
    let total_models_need_download = results
        .iter()
        .filter(|result| matches!(result.status, ResolutionStatus::NeedsDownload { .. }))
        .count();
    let total_models_incompatible = results
        .iter()
        .filter(|result| matches!(result.status, ResolutionStatus::Incompatible { .. }))
        .count();
    let total_estimated_download_gb = results
        .iter()
        .filter_map(|result| match &result.status {
            ResolutionStatus::NeedsDownload { hf_source } => hf_source.expected_size_bytes,
            _ => None,
        })
        .map(|bytes| bytes as f64 / 1_073_741_824.0)
        .sum();

    ModelResolutionSummary {
        total_models_found_locally,
        total_models_available,
        total_models_need_download,
        total_models_incompatible,
        total_estimated_download_gb,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelResolutionSummary {
    pub total_models_found_locally: usize,
    pub total_models_available: usize,
    pub total_models_need_download: usize,
    pub total_models_incompatible: usize,
    pub total_estimated_download_gb: f64,
}

fn custom_paths_from_profile(profile: &profile::ProfileManager) -> Vec<String> {
    profile
        .get_pref(CUSTOM_MODEL_PATHS_PREF)
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn parse_action(action: &str) -> Result<SuggestedAction, String> {
    match action {
        "symlink" => Ok(SuggestedAction::Symlink),
        "copy" => Ok(SuggestedAction::Copy),
        "move" => Ok(SuggestedAction::Move),
        _ => Err("action must be one of: symlink, copy, move".into()),
    }
}

fn action_label(action: &SuggestedAction) -> &'static str {
    match action {
        SuggestedAction::Symlink => "symlink",
        SuggestedAction::Copy => "copy",
        SuggestedAction::Move => "move",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_manager::{HfSource, ModelSource};

    #[test]
    fn parse_action_accepts_supported_values() {
        assert_eq!(parse_action("symlink").unwrap(), SuggestedAction::Symlink);
        assert_eq!(parse_action("copy").unwrap(), SuggestedAction::Copy);
        assert!(parse_action("download").is_err());
    }

    #[test]
    fn summarizes_model_resolution_counts() {
        let results = vec![
            ResolutionResult {
                everywear_model_id: "a".into(),
                status: ResolutionStatus::Available,
                source: ModelSource::EverywearVault,
                details: String::new(),
            },
            ResolutionResult {
                everywear_model_id: "b".into(),
                status: ResolutionStatus::NeedsDownload {
                    hf_source: HfSource {
                        repo: Some("repo".into()),
                        file: Some("file".into()),
                        expected_size_bytes: Some(1_073_741_824),
                    },
                },
                source: ModelSource::HuggingFace,
                details: String::new(),
            },
        ];

        let summary = summarize_resolution(&results);
        assert_eq!(summary.total_models_available, 1);
        assert_eq!(summary.total_models_need_download, 1);
        assert_eq!(summary.total_estimated_download_gb, 1.0);
    }

    #[test]
    fn model_summary_counts_incompatible_results() {
        let results = vec![ResolutionResult {
            everywear_model_id: "bad".into(),
            status: ResolutionStatus::Incompatible {
                reason: "wrong architecture".into(),
            },
            source: ModelSource::Unknown,
            details: String::new(),
        }];

        let summary = summarize_resolution(&results);
        assert_eq!(summary.total_models_incompatible, 1);
        assert_eq!(summary.total_models_need_download, 0);
    }
}
