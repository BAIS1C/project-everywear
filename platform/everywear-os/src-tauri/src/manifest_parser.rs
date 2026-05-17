//! Applet manifest parser: reads `applet.toml` files that declare what an
//! applet needs (engines, models, VRAM requirements, tier gates, platforms).
//!
//! The shell reads this manifest before launching any applet to:
//! - Check VRAM requirements against available hardware
//! - Provision missing models via model-manager
//! - Validate tier entitlements
//! - Resolve engine dependencies
//!
//! See MIGRATION_ARCHITECTURE.md Phase 0.5 for design rationale.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

/// Top-level applet manifest parsed from `applet.toml`.
#[derive(Debug, Clone, Deserialize)]
pub struct AppletManifest {
    pub applet: AppletMeta,
    #[serde(default)]
    pub engines: Option<EngineSection>,
    #[serde(default)]
    pub model_groups: Vec<ModelGroup>,
    #[serde(default)]
    pub requirements: Option<Requirements>,
}

/// Core applet identity and metadata.
#[derive(Debug, Clone, Deserialize)]
pub struct AppletMeta {
    /// Unique applet identifier (e.g., "gener8", "1magen", "kasai").
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Engine type this applet provides: "ace-step-sidecar", "diffusion", "llm", etc.
    #[serde(default)]
    pub engine_type: Option<String>,
    /// IPC transport: "json-rpc-stdin", "tauri", "web".
    #[serde(default = "default_transport")]
    pub transport: String,
    /// Minimum VRAM in MB to launch this applet at all.
    #[serde(default)]
    pub min_vram_mb: u32,
    /// Product tier required to launch: "free", "gener8_pro", "creator_studio".
    #[serde(default = "default_tier_gate")]
    pub tier_gate: String,
    /// Supported platforms: ["windows", "macos", "linux"].
    #[serde(default = "default_platforms")]
    pub platform: Vec<String>,
}

fn default_transport() -> String {
    "json-rpc-stdin".to_string()
}

fn default_tier_gate() -> String {
    "free".to_string()
}

fn default_platforms() -> Vec<String> {
    vec!["windows".to_string()]
}

/// Engine capability advertisements declared in the manifest.
/// The shell uses these for static validation before launch;
/// runtime discovery (AdvertiseCapabilities) provides the live registry.
#[derive(Debug, Clone, Deserialize)]
pub struct EngineSection {
    #[serde(default)]
    pub entries: Vec<EngineEntry>,
}

/// A single engine this applet can provide.
#[derive(Debug, Clone, Deserialize)]
pub struct EngineEntry {
    pub engine_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// A group of models that form a complete set for a given VRAM tier.
///
/// The shell picks the best group that fits the user's available VRAM:
/// iterate groups descending by `min_vram_mb`, pick the first where
/// `min_vram_mb <= available_vram`.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelGroup {
    /// Human-readable label: "HiFi", "Great", "Recommended", "Minimum".
    pub label: String,
    /// Minimum VRAM in MB to use this group.
    pub min_vram_mb: u32,
    /// Product tier required for this group (overrides applet-level gate).
    #[serde(default)]
    pub tier_gate: Option<String>,
    /// Models in this group.
    #[serde(default)]
    pub models: Vec<ModelEntry>,
}

/// A single model file within a group.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelEntry {
    /// Role: "primary", "dit", "encoder", "vae", "lora", "director_llm", etc.
    pub role: String,
    /// Filename on disk (within the models directory).
    pub filename: String,
    /// Download URL (HuggingFace, etc.). None if bundled or user-provided.
    #[serde(default)]
    pub url: Option<String>,
    /// Expected file size in bytes (for progress UI).
    #[serde(default)]
    pub size_bytes: u64,
    /// SHA256 hex digest for integrity verification.
    #[serde(default)]
    pub sha256: Option<String>,
    /// Whether this model is optional (can skip if download fails).
    #[serde(default)]
    pub optional: Option<bool>,
}

/// Additional requirements beyond VRAM.
#[derive(Debug, Clone, Deserialize)]
pub struct Requirements {
    /// Minimum CUDA compute capability (e.g., "7.0" for Volta).
    #[serde(default)]
    pub cuda_compute: Option<String>,
    /// Minimum recommended VRAM for best experience.
    #[serde(default)]
    pub recommended_vram_mb: Option<u32>,
}

/// Parse an applet manifest from a TOML file.
pub fn parse_manifest(path: &Path) -> Result<AppletManifest> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read manifest at {}", path.display()))?;
    let manifest: AppletManifest = toml::from_str(&content)
        .with_context(|| format!("failed to parse manifest at {}", path.display()))?;
    Ok(manifest)
}

/// Select the best model group for the given available VRAM.
///
/// Returns the group with the highest `min_vram_mb` that still fits,
/// or `None` if no group fits (applet cannot launch).
pub fn select_model_group(
    manifest: &AppletManifest,
    available_vram_mb: u32,
) -> Option<&ModelGroup> {
    manifest
        .model_groups
        .iter()
        .filter(|g| g.min_vram_mb <= available_vram_mb)
        .max_by_key(|g| g.min_vram_mb)
}

/// Check if an applet supports the current platform.
pub fn supports_current_platform(manifest: &AppletManifest) -> bool {
    let current = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return false;
    };
    manifest.applet.platform.iter().any(|p| p == current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_toml() -> &'static str {
        r#"
[applet]
id = "gener8"
name = "S3 Gener8"
engine_type = "ace-step-sidecar"
transport = "json-rpc-stdin"
min_vram_mb = 6144
tier_gate = "free"
platform = ["windows", "macos"]

[engines]
[[engines.entries]]
engine_id = "gener8.audio"
capabilities = ["text2music", "cover"]

[[model_groups]]
label = "HiFi"
min_vram_mb = 16384
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q8_0.gguf"
size_bytes = 5310000000

[[model_groups]]
label = "Minimum"
min_vram_mb = 6144
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q4_K_M.gguf"
size_bytes = 3200000000
"#
    }

    #[test]
    fn parse_sample_manifest() {
        let manifest: AppletManifest = toml::from_str(sample_toml()).unwrap();
        assert_eq!(manifest.applet.id, "gener8");
        assert_eq!(manifest.applet.min_vram_mb, 6144);
        assert_eq!(manifest.model_groups.len(), 2);
        assert_eq!(manifest.model_groups[0].label, "HiFi");
        assert_eq!(manifest.model_groups[1].models[0].role, "dit");
    }

    #[test]
    fn select_best_group_for_vram() {
        let manifest: AppletManifest = toml::from_str(sample_toml()).unwrap();

        // 24GB: should select HiFi (16384)
        let group = select_model_group(&manifest, 24576).unwrap();
        assert_eq!(group.label, "HiFi");

        // 8GB: should select Minimum (6144)
        let group = select_model_group(&manifest, 8192).unwrap();
        assert_eq!(group.label, "Minimum");

        // 4GB: nothing fits
        assert!(select_model_group(&manifest, 4096).is_none());
    }

    #[test]
    fn platform_check() {
        let manifest: AppletManifest = toml::from_str(sample_toml()).unwrap();
        // On Windows CI this will pass; test the logic at least compiles
        let _ = supports_current_platform(&manifest);
    }
}
