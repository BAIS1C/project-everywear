//! model-manager: unified GGUF discovery, manifest registry, and download manager.
//!
//! Shared crate used by the Everywear OS shell and all applets that need
//! model files. Handles:
//! - GGUF discovery across LM Studio, Ollama, HF Hub cache, GPT4All
//! - Declarative model manifests per engine type
//! - Streaming download from HuggingFace with progress callbacks
//! - SHA256 verification before trust
//! - Applet manifest parsing (applet.toml with model_groups)

pub mod discovery;
pub mod download;
pub mod local_discovery;
pub mod manifest;
pub mod requirements;
pub mod resolution;
pub mod verify;
pub mod vram;

// Re-export core types.
pub use download::DownloadProgress;
pub use local_discovery::{
    Compatibility, DiscoveredModel, GgufMetadata, LocalModelScanner, ModelFormat, ModelSourceTool,
    SafetensorsMetadata, ScanTarget,
};
pub use manifest::{
    plan_for_vram, AppletManifest, LicenceTier, ModelGroup, ModelInfo, ModelManifest,
    ModelRequirement as ManifestModelRequirement, ModelRole, ModelType, SidecarBundle,
    UpgradePack, UpgradePackFile, UpgradePackQuant,
};
pub use requirements::ModelRequirement;
pub use resolution::{
    AdoptedModel, HfSource, ModelResolver, ModelSource, ResolutionResult, ResolutionStatus,
    SuggestedAction,
};
pub use vram::{LlamaFlags, VramTier};

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// High-level ModelManager (used by shell and applets)
// ---------------------------------------------------------------------------

/// Unified model manager. Owns the models directory and a flat manifest.
/// For applet-level use: create with a manifest, scan for existing files,
/// download what's missing. For shell-level use: the shell creates one
/// of these for each applet being provisioned.
pub struct ModelManager {
    models_dir: PathBuf,
    manifest: Vec<ModelInfo>,
}

impl ModelManager {
    /// Create a model manager for a given models directory and manifest.
    pub fn new(models_dir: PathBuf, manifest: Vec<ModelInfo>) -> Self {
        let mut mgr = Self {
            models_dir,
            manifest,
        };
        mgr.scan();
        mgr
    }

    /// Create a model manager for the global Everywear models cache.
    pub fn global() -> Self {
        let models_dir = everywear_paths::models_dir();

        Self {
            models_dir,
            manifest: Vec::new(),
        }
    }

    /// Scan all discovery paths for existing model files.
    pub fn scan(&mut self) {
        discovery::scan_manifest(&mut self.manifest, &self.models_dir);
    }

    /// List all models in the manifest with their download status.
    pub fn list_available(&self) -> Vec<ModelInfo> {
        self.manifest.clone()
    }

    /// Get the local path for a downloaded model.
    pub fn model_path(&self, key: &str) -> Option<PathBuf> {
        self.manifest
            .iter()
            .find(|m| m.key == key)
            .and_then(|m| m.path.clone())
    }

    /// Check if a model is downloaded.
    pub fn is_downloaded(&self, key: &str) -> bool {
        self.manifest
            .iter()
            .find(|m| m.key == key)
            .map(|m| m.downloaded)
            .unwrap_or(false)
    }

    /// Download a model by its manifest key.
    /// Takes a progress callback for UI updates.
    pub async fn download<F>(&mut self, model_key: &str, on_progress: F) -> Result<PathBuf>
    where
        F: FnMut(DownloadProgress),
    {
        let model = self
            .manifest
            .iter()
            .find(|m| m.key == model_key)
            .context("model not found in manifest")?
            .clone();

        // Already downloaded?
        if let Some(path) = &model.path {
            if path.exists() {
                info!(model = %model_key, "Model already downloaded");
                return Ok(path.clone());
            }
        }

        // Ensure models dir exists
        std::fs::create_dir_all(&self.models_dir).context("failed to create models directory")?;

        let dest = self.models_dir.join(&model.filename);
        let url = download::hf_download_url(&model.hf_repo, &model.hf_file);

        info!(url = %url, dest = %dest.display(), "Downloading model");

        let expected_sha256 = model.sha256.as_deref().unwrap_or("");
        if let Err(e) = download::download_with_resume_and_progress(
            &url,
            &dest,
            &model.key,
            expected_sha256,
            on_progress,
        )
        .await
        {
            warn!(model = %model_key, error = %e, "Download or SHA256 verification failed, removing partial output");
            std::fs::remove_file(&dest).ok();
            std::fs::remove_file(dest.with_extension("part")).ok();
            return Err(e);
        }

        // Update manifest
        if let Some(m) = self.manifest.iter_mut().find(|m| m.key == model_key) {
            m.path = Some(dest.clone());
            m.downloaded = true;
        }

        Ok(dest)
    }

    /// Get the models directory path.
    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    /// Add models to the manifest (e.g. from an applet.toml model group).
    /// Skips any model whose key already exists in the manifest to prevent
    /// duplicates when the same applet is launched multiple times.
    pub fn add_models(&mut self, models: Vec<ModelInfo>) {
        for model in models {
            if !self.manifest.iter().any(|m| m.key == model.key) {
                self.manifest.push(model);
            }
        }
    }

    /// Get all model keys that are NOT yet downloaded.
    pub fn missing_models(&self) -> Vec<String> {
        self.manifest
            .iter()
            .filter(|m| !m.downloaded)
            .map(|m| m.key.clone())
            .collect()
    }
}
