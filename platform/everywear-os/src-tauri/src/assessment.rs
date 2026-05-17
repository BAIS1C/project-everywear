//! Base model assessment for Everywear OS.
//!
//! This module answers the platform-level question:
//! given the detected hardware, which local model group should the OS
//! recommend before any applet-specific provisioning flow starts?
//!
//! Today this reads applet manifests from `applets/*/applet.toml` and
//! returns a simple readiness assessment for each discovered manifest.

use crate::gpu::{ComputeBackend, SystemGpuState};
use model_manager::{AppletManifest, ModelRole};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::warn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssessmentStatus {
    Ready,
    Reduced,
    SetupRequired,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAssessment {
    pub applet_id: String,
    pub applet_name: String,
    pub status: AssessmentStatus,
    pub total_vram_mb: u64,
    pub min_required_vram_mb: u64,
    pub recommended_group: Option<String>,
    pub recommended_vram_mb: Option<u64>,
    pub recommended_primary_model: Option<String>,
    pub rationale: String,
}

pub fn list_model_assessments(gpu_state: &SystemGpuState) -> Vec<ModelAssessment> {
    manifest_paths()
        .into_iter()
        .filter_map(|path| match AppletManifest::load(&path) {
            Ok(manifest) => Some(assess_manifest(&manifest, gpu_state)),
            Err(err) => {
                warn!(path = %path.display(), error = %err, "Skipping invalid applet manifest");
                None
            }
        })
        .collect()
}

fn assess_manifest(manifest: &AppletManifest, gpu_state: &SystemGpuState) -> ModelAssessment {
    let total_vram_mb = gpu_state.total_vram_mb;
    let min_required_vram_mb = manifest.min_vram_mb();

    let unsupported = |reason: String| ModelAssessment {
        applet_id: manifest.applet.id.clone(),
        applet_name: manifest.applet.name.clone(),
        status: AssessmentStatus::Unsupported,
        total_vram_mb,
        min_required_vram_mb,
        recommended_group: None,
        recommended_vram_mb: None,
        recommended_primary_model: None,
        rationale: reason,
    };

    if let Some(required_cc) = manifest.requirements.cuda_compute.as_deref() {
        let required = match parse_compute_capability(required_cc) {
            Some(parsed) => parsed,
            None => {
                return unsupported(format!(
                    "Manifest compute requirement '{}' could not be parsed.",
                    required_cc
                ));
            }
        };

        match &gpu_state.backend {
            ComputeBackend::Cuda { cuda, .. } => {
                if let Some(actual) = cuda.compute_capability {
                    if !meets_compute_capability(actual, required) {
                        return unsupported(format!(
                            "{} currently requires CUDA SM {}.{}+. Detected SM {}.{}.",
                            manifest.applet.name, required.0, required.1, actual.0, actual.1
                        ));
                    }
                } else {
                    return unsupported(format!(
                        "{} requires CUDA compute capability {}, but the GPU did not report one.",
                        manifest.applet.name, required_cc
                    ));
                }
            }
            other => {
                return unsupported(format!(
                    "{} currently expects a CUDA-capable NVIDIA path. Detected {} instead.",
                    manifest.applet.name,
                    backend_kind(other)
                ));
            }
        }
    }

    let selected_group = manifest
        .model_groups
        .iter()
        .find(|group| group.min_vram_mb <= total_vram_mb);

    let Some(group) = selected_group else {
        return unsupported(format!(
            "{} needs at least {} MB VRAM for its smallest local model group. Detected {} MB.",
            manifest.applet.name, min_required_vram_mb, total_vram_mb
        ));
    };

    let primary_model = group
        .models
        .iter()
        .find(|model| model.role == ModelRole::Primary)
        .map(|model| model.key.clone());

    let best_group_label = manifest
        .model_groups
        .first()
        .map(|best| best.label.as_str())
        .unwrap_or("");

    let (status, rationale) = match &gpu_state.backend {
        ComputeBackend::Cuda {
            needs_provisioning, ..
        } if *needs_provisioning => (
            AssessmentStatus::SetupRequired,
            format!(
                "{} fits the '{}' local group on this GPU, but CUDA runtime provisioning is still required before launch.",
                manifest.applet.name, group.label
            ),
        ),
        _ if group.label == best_group_label => (
            AssessmentStatus::Ready,
            format!(
                "{} fits the '{}' local group on this machine.",
                manifest.applet.name, group.label
            ),
        ),
        _ => (
            AssessmentStatus::Reduced,
            format!(
                "{} can run locally with the '{}' group, but higher weights do not fit this VRAM tier.",
                manifest.applet.name, group.label
            ),
        ),
    };

    ModelAssessment {
        applet_id: manifest.applet.id.clone(),
        applet_name: manifest.applet.name.clone(),
        status,
        total_vram_mb,
        min_required_vram_mb,
        recommended_group: Some(group.label.clone()),
        recommended_vram_mb: Some(group.min_vram_mb),
        recommended_primary_model: primary_model,
        rationale,
    }
}

fn backend_kind(backend: &ComputeBackend) -> &'static str {
    match backend {
        ComputeBackend::Cuda { .. } => "CUDA",
        ComputeBackend::Vulkan { .. } => "Vulkan",
        ComputeBackend::Cpu { .. } => "CPU",
    }
}

fn parse_compute_capability(raw: &str) -> Option<(u32, u32)> {
    let mut parts = raw.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor))
}

fn meets_compute_capability(actual: (u32, u32), required: (u32, u32)) -> bool {
    actual >= required
}

fn manifest_paths() -> Vec<PathBuf> {
    let Some(root) = find_workspace_root() else {
        return Vec::new();
    };

    let applets_dir = root.join("applets");
    let Ok(entries) = std::fs::read_dir(applets_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok().map(|item| item.path().join("applet.toml")))
        .filter(|path| path.is_file())
        .collect()
}

fn find_workspace_root() -> Option<PathBuf> {
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(root) = walk_up_for_workspace(&cwd) {
            return Some(root);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return walk_up_for_workspace(parent);
        }
    }

    None
}

fn walk_up_for_workspace(start: &Path) -> Option<PathBuf> {
    let mut cursor = Some(start.to_path_buf());

    for _ in 0..8 {
        let dir = cursor?;
        if dir.join("applets").is_dir() {
            return Some(dir);
        }
        cursor = dir.parent().map(|parent| parent.to_path_buf());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::{ComputeBackend, CudaStatus, SystemGpuState, VramTier};

    fn fake_gpu(vram_mb: u64, provisioning: bool) -> SystemGpuState {
        SystemGpuState {
            gpus: vec![],
            nvml_available: false,
            total_vram_mb: vram_mb,
            total_free_mb: vram_mb,
            primary_gpu: Some("RTX Test".into()),
            backend: ComputeBackend::Cuda {
                device_name: "RTX Test".into(),
                vram_mb: vram_mb as u32,
                cuda: CudaStatus {
                    driver_version: "12.8".into(),
                    toolkit_version: Some("12.8".into()),
                    cublas_available: !provisioning,
                    cublas_path: None,
                    compute_capability: Some((8, 6)),
                },
                needs_provisioning: provisioning,
            },
            vram_tier: VramTier::from_vram_mb(vram_mb as u32),
        }
    }

    fn manifest() -> AppletManifest {
        AppletManifest::from_toml(
            r#"
[applet]
id = "1magen"
name = "1magen"
version = "0.1.0"
description = "Test"
icon = "icon.png"
transport = "tauri"

[engine]
type = "diffusion"
backend = "ffi"
server_binary = ""

[[model_groups]]
label = "High Quality"
min_vram_mb = 10240

  [[model_groups.models]]
  key = "model-q8"
  role = "Primary"
  required = true
  vram_mb = 7200

[[model_groups]]
label = "Standard"
min_vram_mb = 7400

  [[model_groups.models]]
  key = "model-q4"
  role = "Primary"
  required = true
  vram_mb = 4800

[requirements]
cuda_compute = "7.0"
"#,
        )
        .expect("inline manifest should parse")
    }

    #[test]
    fn picks_best_group_when_vram_fits() {
        let assessment = assess_manifest(&manifest(), &fake_gpu(16384, false));
        assert_eq!(assessment.status, AssessmentStatus::Ready);
        assert_eq!(
            assessment.recommended_group.as_deref(),
            Some("High Quality")
        );
        assert_eq!(
            assessment.recommended_primary_model.as_deref(),
            Some("model-q8")
        );
    }

    #[test]
    fn falls_back_to_reduced_group() {
        let assessment = assess_manifest(&manifest(), &fake_gpu(8192, false));
        assert_eq!(assessment.status, AssessmentStatus::Reduced);
        assert_eq!(assessment.recommended_group.as_deref(), Some("Standard"));
        assert_eq!(
            assessment.recommended_primary_model.as_deref(),
            Some("model-q4")
        );
    }

    #[test]
    fn marks_runtime_setup_required() {
        let assessment = assess_manifest(&manifest(), &fake_gpu(16384, true));
        assert_eq!(assessment.status, AssessmentStatus::SetupRequired);
    }
}
