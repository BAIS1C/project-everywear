//! Model resolution orchestration.
//!
//! Resolver order is intentionally local-first:
//! Everywear vault, known local tool installs, custom user paths, then
//! HuggingFace only as a final unresolved state.

use crate::local_discovery::{
    Compatibility, DiscoveredModel, LocalModelScanner, ModelSourceTool,
};
use crate::requirements::ModelRequirement;
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub struct ModelResolver {
    scanner: LocalModelScanner,
    requirements: Vec<ModelRequirement>,
    everywear_models_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolutionResult {
    pub everywear_model_id: String,
    pub status: ResolutionStatus,
    pub source: ModelSource,
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum ResolutionStatus {
    /// Already in Everywear vault, ready to use.
    Available,
    /// Found locally in another tool, needs to be linked/copied.
    FoundLocally {
        discovered: DiscoveredModel,
        action: SuggestedAction,
    },
    /// Not found anywhere, needs download.
    NeedsDownload { hf_source: HfSource },
    /// Found locally but incompatible.
    Incompatible { reason: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum SuggestedAction {
    Symlink,
    Copy,
    Move,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum ModelSource {
    EverywearVault,
    LmStudio,
    Ollama,
    ComfyUI,
    Automatic1111,
    Fooocus,
    LtxDesktop,
    RawDownload,
    CustomPath(PathBuf),
    HuggingFace,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfSource {
    pub repo: Option<String>,
    pub file: Option<String>,
    pub expected_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdoptedModel {
    pub vault_path: PathBuf,
    pub source_path: PathBuf,
    pub action_taken: SuggestedAction,
    pub file_size_bytes: u64,
}

impl ModelResolver {
    pub fn new(
        scanner: LocalModelScanner,
        requirements: Vec<ModelRequirement>,
        everywear_models_dir: PathBuf,
    ) -> Self {
        Self {
            scanner,
            requirements,
            everywear_models_dir,
        }
    }

    pub fn scanner(&self) -> &LocalModelScanner {
        &self.scanner
    }

    pub fn scanner_mut(&mut self) -> &mut LocalModelScanner {
        &mut self.scanner
    }

    pub fn requirements(&self) -> &[ModelRequirement] {
        &self.requirements
    }

    pub fn add_custom_path(&mut self, path: PathBuf) {
        if !self.scanner.custom_paths.iter().any(|existing| existing == &path) {
            self.scanner.custom_paths.push(path);
        }
    }

    /// Resolve all model requirements across all applets.
    pub fn resolve_all(&self) -> Result<Vec<ResolutionResult>> {
        let discovered = self.scanner.scan_all()?;
        self.requirements
            .iter()
            .map(|req| self.resolve_single(req, &discovered))
            .collect()
    }

    /// Resolve a single model requirement.
    pub fn resolve_single(
        &self,
        req: &ModelRequirement,
        discovered: &[DiscoveredModel],
    ) -> Result<ResolutionResult> {
        if let Some(path) = self.find_in_vault(req) {
            return Ok(ResolutionResult {
                everywear_model_id: req.everywear_model_id.clone(),
                status: ResolutionStatus::Available,
                source: ModelSource::EverywearVault,
                details: format!("Found at {}", path.display()),
            });
        }

        let mut compatible = Vec::new();
        let mut incompatible_reasons = Vec::new();
        for item in discovered {
            let compatibility = self.scanner.check_compatibility(item, req);
            match compatibility {
                Compatibility::Exact | Compatibility::Compatible { .. } => {
                    let mut clone = item.clone();
                    clone.everywear_compatibility = compatibility;
                    clone.suggested_everywear_model_id = Some(req.everywear_model_id.clone());
                    compatible.push(clone);
                }
                Compatibility::Incompatible { reason } => {
                    if item.filename_contains_any(&req.filename_patterns) {
                        incompatible_reasons.push(format!("{}: {}", item.filename, reason));
                    }
                }
                Compatibility::Possible { .. } => {}
            }
        }

        compatible.sort_by(|a, b| {
            compatibility_rank(&a.everywear_compatibility)
                .cmp(&compatibility_rank(&b.everywear_compatibility))
                .then_with(|| b.size_bytes.cmp(&a.size_bytes))
        });

        if let Some(best) = compatible.first() {
            let action = if best.source_path.is_symlink() {
                SuggestedAction::Copy
            } else {
                SuggestedAction::Symlink
            };
            return Ok(ResolutionResult {
                everywear_model_id: req.everywear_model_id.clone(),
                status: ResolutionStatus::FoundLocally {
                    discovered: best.clone(),
                    action,
                },
                source: ModelSource::from_tool(&best.source_tool),
                details: format!(
                    "Found {} in {} ({})",
                    best.filename,
                    source_tool_label(&best.source_tool),
                    compatibility_label(&best.everywear_compatibility)
                ),
            });
        }

        if !incompatible_reasons.is_empty() {
            return Ok(ResolutionResult {
                everywear_model_id: req.everywear_model_id.clone(),
                status: ResolutionStatus::Incompatible {
                    reason: incompatible_reasons.join("; "),
                },
                source: ModelSource::Unknown,
                details: "Local files were found but none were compatible.".into(),
            });
        }

        Ok(ResolutionResult {
            everywear_model_id: req.everywear_model_id.clone(),
            status: ResolutionStatus::NeedsDownload {
                hf_source: HfSource::from_requirement(req),
            },
            source: ModelSource::HuggingFace,
            details: "Not found locally. Download required as last resort.".into(),
        })
    }

    /// Execute the suggested action for a FoundLocally result.
    pub fn adopt_model(
        &self,
        result: &ResolutionResult,
        action: SuggestedAction,
    ) -> Result<AdoptedModel> {
        let discovered = match &result.status {
            ResolutionStatus::FoundLocally { discovered, .. } => discovered,
            _ => return Err(anyhow!("resolution result is not a local model")),
        };

        let req = self
            .requirements
            .iter()
            .find(|req| req.everywear_model_id == result.everywear_model_id)
            .ok_or_else(|| anyhow!("unknown model id {}", result.everywear_model_id))?;
        self.adopt_discovered(req, discovered, action)
    }

    /// Resolve then adopt by Everywear model id.
    pub fn adopt_model_by_id(
        &self,
        everywear_model_id: &str,
        action: SuggestedAction,
    ) -> Result<AdoptedModel> {
        let result = self
            .resolve_all()?
            .into_iter()
            .find(|result| result.everywear_model_id == everywear_model_id)
            .ok_or_else(|| anyhow!("unknown model id {everywear_model_id}"))?;
        self.adopt_model(&result, action)
    }

    fn adopt_discovered(
        &self,
        req: &ModelRequirement,
        discovered: &DiscoveredModel,
        action: SuggestedAction,
    ) -> Result<AdoptedModel> {
        let vault_dir = self.everywear_models_dir.join(&req.applet_id);
        std::fs::create_dir_all(&vault_dir)
            .with_context(|| format!("create {}", vault_dir.display()))?;

        let filename = req
            .exact_filename_match
            .as_deref()
            .unwrap_or(&discovered.filename);
        let vault_path = vault_dir.join(filename);
        if vault_path.exists() {
            return Ok(AdoptedModel {
                vault_path,
                source_path: discovered.source_path.clone(),
                action_taken: SuggestedAction::Symlink,
                file_size_bytes: discovered.size_bytes,
            });
        }

        match action {
            SuggestedAction::Symlink => symlink_file(&discovered.source_path, &vault_path)
                .or_else(|_| {
                    std::fs::copy(&discovered.source_path, &vault_path).map(|_| ())
                })
                .with_context(|| {
                    format!(
                        "adopt {} -> {}",
                        discovered.source_path.display(),
                        vault_path.display()
                    )
                })?,
            SuggestedAction::Copy => {
                std::fs::copy(&discovered.source_path, &vault_path).with_context(|| {
                    format!(
                        "copy {} -> {}",
                        discovered.source_path.display(),
                        vault_path.display()
                    )
                })?;
            }
            SuggestedAction::Move => {
                std::fs::rename(&discovered.source_path, &vault_path).or_else(|_| {
                    std::fs::copy(&discovered.source_path, &vault_path)?;
                    std::fs::remove_file(&discovered.source_path)?;
                    Ok::<_, std::io::Error>(())
                })?;
            }
        }

        Ok(AdoptedModel {
            vault_path,
            source_path: discovered.source_path.clone(),
            action_taken: action,
            file_size_bytes: discovered.size_bytes,
        })
    }

    fn find_in_vault(&self, req: &ModelRequirement) -> Option<PathBuf> {
        let vault_path = self.everywear_models_dir.join(&req.applet_id);
        if let Some(exact_match) = req.exact_filename_match.as_ref() {
            let full_path = vault_path.join(exact_match);
            if full_path.exists() {
                return Some(full_path);
            }
        }

        let entries = std::fs::read_dir(&vault_path).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()?.to_string_lossy();
            if req.filename_patterns.iter().any(|pattern| {
                filename
                    .to_ascii_lowercase()
                    .contains(&pattern.to_ascii_lowercase().replace('*', ""))
            }) {
                return Some(path);
            }
        }
        None
    }
}

impl HfSource {
    pub fn from_requirement(req: &ModelRequirement) -> Self {
        Self {
            repo: req.hf_repo.clone(),
            file: req.hf_file.clone().or(req.exact_filename_match.clone()),
            expected_size_bytes: req.size_bytes,
        }
    }
}

impl ModelSource {
    pub fn from_tool(tool: &ModelSourceTool) -> Self {
        match tool {
            ModelSourceTool::LmStudio => ModelSource::LmStudio,
            ModelSourceTool::Ollama => ModelSource::Ollama,
            ModelSourceTool::ComfyUI => ModelSource::ComfyUI,
            ModelSourceTool::Automatic1111 => ModelSource::Automatic1111,
            ModelSourceTool::Fooocus => ModelSource::Fooocus,
            ModelSourceTool::LtxDesktop => ModelSource::LtxDesktop,
            ModelSourceTool::RawDownload => ModelSource::RawDownload,
            ModelSourceTool::EverywearVault => ModelSource::EverywearVault,
            ModelSourceTool::Unknown => ModelSource::Unknown,
        }
    }
}

trait FilenameContains {
    fn filename_contains_any(&self, patterns: &[String]) -> bool;
}

impl FilenameContains for DiscoveredModel {
    fn filename_contains_any(&self, patterns: &[String]) -> bool {
        let filename = self.filename.to_ascii_lowercase();
        patterns.iter().any(|pattern| {
            let pattern = pattern.to_ascii_lowercase().replace('*', "");
            !pattern.is_empty() && filename.contains(&pattern)
        })
    }
}

fn compatibility_rank(compatibility: &Compatibility) -> u8 {
    match compatibility {
        Compatibility::Exact => 0,
        Compatibility::Compatible { .. } => 1,
        Compatibility::Possible { .. } => 2,
        Compatibility::Incompatible { .. } => 3,
    }
}

fn compatibility_label(compatibility: &Compatibility) -> &str {
    match compatibility {
        Compatibility::Exact => "exact match",
        Compatibility::Compatible { note } => note.as_str(),
        Compatibility::Possible { note } => note.as_str(),
        Compatibility::Incompatible { reason } => reason.as_str(),
    }
}

fn source_tool_label(tool: &ModelSourceTool) -> &'static str {
    match tool {
        ModelSourceTool::LmStudio => "LM Studio",
        ModelSourceTool::Ollama => "Ollama",
        ModelSourceTool::ComfyUI => "ComfyUI",
        ModelSourceTool::Automatic1111 => "Automatic1111",
        ModelSourceTool::Fooocus => "Fooocus",
        ModelSourceTool::LtxDesktop => "LTX Desktop",
        ModelSourceTool::RawDownload => "raw downloads",
        ModelSourceTool::EverywearVault => "Everywear vault",
        ModelSourceTool::Unknown => "custom path",
    }
}

#[cfg(windows)]
fn symlink_file(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, target)
}

#[cfg(not(windows))]
fn symlink_file(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_discovery::{GgufMetadata, ModelFormat};

    fn req() -> ModelRequirement {
        ModelRequirement {
            everywear_model_id: "kasai-lite-qwen3-4b-q4km".into(),
            applet_id: "kasai".into(),
            accepted_formats: vec![ModelFormat::GGUF],
            accepted_architectures: vec!["qwen3".into(), "qwen2.5".into()],
            preferred_quant: Some("Q4_K_M".into()),
            accepted_quants: vec!["Q4_K_M".into(), "Q8_0".into()],
            min_layers: None,
            max_size_gb: Some(8.0),
            min_context_length: Some(4096),
            exact_filename_match: Some("Qwen3-4B-Q4_K_M.gguf".into()),
            filename_patterns: vec!["Qwen3-4B".into()],
            hf_repo: Some("repo".into()),
            hf_file: Some("Qwen3-4B-Q4_K_M.gguf".into()),
            size_bytes: Some(2_500_000_000),
        }
    }

    fn discovered(path: PathBuf) -> DiscoveredModel {
        DiscoveredModel {
            filename: path.file_name().unwrap().to_string_lossy().to_string(),
            source_path: path,
            source_tool: ModelSourceTool::LmStudio,
            size_bytes: 2_500_000_000,
            format: ModelFormat::GGUF,
            gguf_metadata: Some(GgufMetadata {
                architecture: "qwen3".into(),
                quantization: "Q4_K_M".into(),
                context_length: 8192,
                embedding_length: 2560,
                layer_count: 36,
                head_count: 20,
            }),
            safetensors_metadata: None,
            everywear_compatibility: Compatibility::Possible { note: String::new() },
            suggested_everywear_model_id: None,
        }
    }

    #[test]
    fn available_when_model_is_in_vault() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("models");
        let applet_dir = vault.join("kasai");
        std::fs::create_dir_all(&applet_dir).unwrap();
        std::fs::write(applet_dir.join("Qwen3-4B-Q4_K_M.gguf"), [0u8; 16]).unwrap();
        let resolver = ModelResolver::new(
            LocalModelScanner::with_targets(Vec::new(), Vec::new()),
            vec![req()],
            vault,
        );

        let results = resolver.resolve_all().unwrap();
        assert!(matches!(results[0].status, ResolutionStatus::Available));
    }

    #[test]
    fn found_locally_when_compatible_discovery_exists() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Qwen3-4B-Q4_K_M.gguf");
        std::fs::write(&source, vec![0u8; 2048]).unwrap();
        let resolver = ModelResolver::new(
            LocalModelScanner::with_targets(Vec::new(), Vec::new()),
            vec![req()],
            dir.path().join("vault"),
        );
        let result = resolver
            .resolve_single(&req(), &[discovered(source)])
            .unwrap();
        assert!(matches!(result.status, ResolutionStatus::FoundLocally { .. }));
        assert_eq!(result.source, ModelSource::LmStudio);
    }

    #[test]
    fn needs_download_only_when_no_local_match_exists() {
        let dir = tempfile::tempdir().unwrap();
        let resolver = ModelResolver::new(
            LocalModelScanner::with_targets(Vec::new(), Vec::new()),
            vec![req()],
            dir.path().join("vault"),
        );
        let result = resolver.resolve_single(&req(), &[]).unwrap();
        assert!(matches!(result.status, ResolutionStatus::NeedsDownload { .. }));
    }

    #[test]
    fn incompatible_when_matching_filename_has_wrong_architecture() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Qwen3-4B-Q4_K_M.gguf");
        let mut item = discovered(source);
        item.gguf_metadata.as_mut().unwrap().architecture = "llama".into();
        let resolver = ModelResolver::new(
            LocalModelScanner::with_targets(Vec::new(), Vec::new()),
            vec![req()],
            dir.path().join("vault"),
        );
        let result = resolver.resolve_single(&req(), &[item]).unwrap();
        assert!(matches!(result.status, ResolutionStatus::Incompatible { .. }));
    }

    #[test]
    fn adopt_model_copies_or_links_into_vault() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Qwen3-4B-Q4_K_M.gguf");
        std::fs::write(&source, vec![1u8; 2048]).unwrap();
        let vault = dir.path().join("vault");
        let resolver = ModelResolver::new(
            LocalModelScanner::with_targets(Vec::new(), Vec::new()),
            vec![req()],
            vault.clone(),
        );
        let result = resolver
            .resolve_single(&req(), &[discovered(source.clone())])
            .unwrap();

        let adopted = resolver
            .adopt_model(&result, SuggestedAction::Copy)
            .unwrap();
        assert!(adopted.vault_path.exists());
        assert!(adopted.vault_path.starts_with(vault));
        assert_eq!(adopted.source_path, source);
    }
}
