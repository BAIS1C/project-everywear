//! Model manifest types, parsing, and TOML loading.
//!
//! Defines the types used across all applet manifests and the shell's
//! model registry. Applet manifests (applet.toml) declare model groups
//! with fallback quantization; the shell selects the best group that
//! fits the current VRAM budget.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Core model types
// ---------------------------------------------------------------------------

/// Metadata about a single model file (GGUF, ONNX, safetensors, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub key: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub hf_repo: String,
    pub hf_file: String,
    pub model_type: ModelType,
    /// Resolved local path (set after discovery or download).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// Whether the file exists on disk.
    #[serde(default)]
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModelType {
    TextToImage,
    ImageEdit,
    Encoder,
    Vae,
    Llm,
    Audio,
}

// ---------------------------------------------------------------------------
// Model roles (for VRAM budgeting)
// ---------------------------------------------------------------------------

/// Role of a model within an applet's model group. Determines purge priority.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModelRole {
    /// Main inference model. Purged first under PurgePrimary policy.
    Primary,
    /// Text/image encoder. Kept if small enough under PurgePrimary.
    Encoder,
    /// VAE decoder. Usually small, kept under PurgePrimary.
    Vae,
    /// LoRA adapters. Optional, purged with primary.
    Lora,
    /// Video/text projection module.
    Projection,
    /// Video VAE decoder.
    VideoVae,
    /// Audio VAE decoder.
    AudioVae,
    /// Text encoder using applet-specific naming.
    TextEncoder,
}

// ---------------------------------------------------------------------------
// Model groups (applet.toml schema)
// ---------------------------------------------------------------------------

/// A complete set of models that an applet can use. Ordered by quality
/// (highest first). The shell picks the first group that fits VRAM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelGroup {
    pub label: String,
    pub min_vram_mb: u64,
    pub models: Vec<ModelRequirement>,
}

/// A single model requirement within a group.
///
/// The core fields (key, role, required, vram_mb) are always present.
/// Download metadata fields are optional: if present, the shell can
/// provision models it hasn't seen before without needing a separate
/// manifest builder in the applet's Rust code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRequirement {
    pub key: String,
    pub role: ModelRole,
    pub required: bool,
    pub vram_mb: u64,
    /// Local filename on disk (e.g. "vae-BF16.gguf").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    /// HuggingFace repo (e.g. "Serveurperso/ACE-Step-1.5-GGUF").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hf_repo: Option<String>,
    /// Remote filename on HF (may differ from local filename).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hf_file: Option<String>,
    /// Expected file size in bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// SHA256 hex digest for post-download integrity verification.
    /// Required for production remote downloads; optional only while a
    /// manifest is still being drafted and the exact artifact is not pinned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

// ---------------------------------------------------------------------------
// Licence tiers (shared across shell + applets)
// ---------------------------------------------------------------------------

/// User licence tier. Determines which upgrade packs are entitled.
///
/// Canonical tiers from Supabase `public.subscriptions.tier` column,
/// matching s-gener8's `licence.rs` enum. The Ord derive gives the
/// entitlement ladder: Demo < Gener8 < Gener8Pro < CreatorStudio.
///
/// Authority: Hub (Supabase) is the ONLY writer of tier. Shell reads
/// via `active_tier()` RPC on auth hydration. Applets receive tier
/// via HMAC-signed TierSync over IPC.
///
/// Demo: 1hr/day for 7 days, server-clocked. Gets base model pack
///       locally (the time limit is enforced by the shim, not by
///       absence of weights).
/// Gener8: $5/mo. Base model pack (xl-turbo + shared).
/// Gener8Pro: $12.99/mo. Adds better_models upgrade pack (xl-base).
/// CreatorStudio: $30/mo. 16GB VRAM floor. Inherits Pro + adds
///                creator_studio_bundle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenceTier {
    Demo,
    Gener8,
    Gener8Pro,
    CreatorStudio,
}

impl Default for LicenceTier {
    fn default() -> Self {
        LicenceTier::Demo
    }
}

impl LicenceTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            LicenceTier::Demo => "demo",
            LicenceTier::Gener8 => "gener8",
            LicenceTier::Gener8Pro => "gener8_pro",
            LicenceTier::CreatorStudio => "creator_studio",
        }
    }

    /// Parse from the tier string that Supabase returns.
    /// Accepts both canonical and legacy/alias forms.
    pub fn from_tier_str(s: &str) -> Option<Self> {
        match s {
            "demo" => Some(LicenceTier::Demo),
            "gener8" | "gener8_base" => Some(LicenceTier::Gener8),
            "gener8_pro" => Some(LicenceTier::Gener8Pro),
            "creator_studio" => Some(LicenceTier::CreatorStudio),
            _ => None,
        }
    }

    /// True if this tier is at least as high as `required`.
    pub fn satisfies(&self, required: LicenceTier) -> bool {
        *self >= required
    }

    pub fn is_pro(&self) -> bool {
        matches!(self, LicenceTier::Gener8Pro | LicenceTier::CreatorStudio)
    }

    pub fn is_paid(&self) -> bool {
        !matches!(self, LicenceTier::Demo)
    }

    pub fn is_creator_studio(&self) -> bool {
        matches!(self, LicenceTier::CreatorStudio)
    }
}

// ---------------------------------------------------------------------------
// Upgrade packs (licence-gated model additions)
// ---------------------------------------------------------------------------

/// A licence-gated upgrade pack that adds models beyond the base install.
/// Parsed from `[upgrade_packs.<id>]` sections in applet.toml.
///
/// Each pack has a minimum licence tier and either a single file or a
/// VRAM-gated quant ladder. The shell provisions entitled packs after
/// the base model_groups pipeline completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradePack {
    /// Human label for UI ("Better Models (Pro)")
    pub label: String,
    /// Minimum licence tier required to download this pack
    pub min_tier: LicenceTier,
    /// What this pack adds (shown in consent card)
    #[serde(default)]
    pub description: String,
    /// Pack IDs this one inherits (e.g. creator_studio inherits better_models)
    #[serde(default)]
    pub inherits: Vec<String>,
    /// Single-file pack (no VRAM gating). Mutually exclusive with `quants`.
    #[serde(default)]
    pub file: Option<UpgradePackFile>,
    /// VRAM-gated quant ladder. Shell picks the highest quant that fits.
    #[serde(default)]
    pub quants: Vec<UpgradePackQuant>,
    /// Feature keys this pack unlocks (for UI gating, e.g. "cover_full_quality")
    #[serde(default)]
    pub unlocks: Vec<String>,
    /// Status: "active" (downloadable) or "placeholder" (not yet available)
    #[serde(default = "default_pack_status")]
    pub status: String,
}

fn default_pack_status() -> String {
    "active".to_string()
}

/// A single file within an upgrade pack (no VRAM gating).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradePackFile {
    /// Model key for ModelManager lookup
    pub key: String,
    pub role: ModelRole,
    /// Local filename on disk
    pub filename: String,
    /// HuggingFace repo
    pub hf_repo: String,
    /// Remote filename on HF (may differ from local for renames)
    pub hf_file: String,
    pub size_bytes: u64,
    /// SHA256 hex digest for post-download integrity verification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// A single quant tier within a VRAM-gated upgrade pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradePackQuant {
    /// Quant label for display ("Q4_K_M", "Q8_0")
    pub quant: String,
    /// Minimum VRAM to select this quant
    pub min_vram_mb: u64,
    /// Model key for ModelManager lookup
    pub key: String,
    pub role: ModelRole,
    /// Local filename on disk (post-rename if applicable)
    pub filename: String,
    /// HuggingFace repo
    pub hf_repo: String,
    /// Remote filename on HF
    pub hf_file: String,
    pub size_bytes: u64,
    /// SHA256 hex digest for post-download integrity verification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

// ---------------------------------------------------------------------------
// Applet manifest (parsed from applet.toml)
// ---------------------------------------------------------------------------

/// Parsed applet manifest. The shell reads this to understand what
/// models and resources an applet needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletManifest {
    pub applet: AppletMeta,
    pub engine: EngineMeta,
    pub model_groups: Vec<ModelGroup>,
    #[serde(default)]
    pub upgrade_packs: std::collections::HashMap<String, UpgradePack>,
    #[serde(default)]
    pub requirements: Requirements,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub icon: String,
    /// "tauri" | "web" | "hybrid"
    pub transport: String,
    /// Port the applet's web frontend listens on (e.g. 3001 for Gener8's axum shim).
    /// Shell creates a WebviewWindow pointing at http://127.0.0.1:{frontend_port}
    /// after the headless backend is running.
    #[serde(default)]
    pub frontend_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineMeta {
    /// "diffusion" | "llm" | "audio" | "custom"
    #[serde(rename = "type")]
    pub engine_type: String,
    /// "ffi" (in-process) | "server" (sidecar)
    pub backend: String,
    #[serde(default)]
    pub server_binary: String,
    /// Sidecar provisioning: declares the binary bundle that must exist
    /// at `~/.everywear/bin/<server_binary>/` before the applet can launch.
    /// Only relevant when `backend = "server"`.
    #[serde(default)]
    pub sidecar: Option<SidecarBundle>,
}

/// Declares a sidecar engine binary bundle that the shell must provision
/// into `~/.everywear/bin/<name>/` before applet launch.
///
/// Source resolution order:
///   1. `source_dir` (absolute path to a local build, e.g. acestep.cpp/build/Release)
///   2. `source_url` (download URL for a release archive)
///   3. Shell errors if neither resolves to a valid binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarBundle {
    /// Directory name under `~/.everywear/bin/`. Defaults to `server_binary` if omitted.
    #[serde(default)]
    pub name: Option<String>,
    /// Primary executable filename (platform-specific).
    pub executable: String,
    /// Additional files that must accompany the executable (DLLs, codecs, etc.).
    #[serde(default)]
    pub companions: Vec<String>,
    /// Local directory containing pre-built binaries (dev/build machines).
    /// Shell copies from here if it exists. Supports `~` and env var expansion.
    #[serde(default)]
    pub source_dir: Option<String>,
    /// URL to a release archive (.zip/.tar.gz) containing the binary bundle.
    /// Shell downloads and extracts if source_dir is unavailable.
    #[serde(default)]
    pub source_url: Option<String>,
    /// SHA256 of the primary executable for integrity verification.
    #[serde(default)]
    pub sha256: Option<String>,
    /// Human-readable version tag for the sidecar build.
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Requirements {
    #[serde(default)]
    pub cuda_compute: Option<String>,
}

impl AppletManifest {
    /// Parse an applet.toml file.
    pub fn from_toml(content: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(content)
    }

    /// Load from a file path.
    pub fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("failed to read {}: {e}", path.display()))?;
        Self::from_toml(&content)
            .map_err(|e| anyhow::anyhow!("failed to parse {}: {e}", path.display()))
    }

    /// Total VRAM required by the cheapest (last) model group.
    pub fn min_vram_mb(&self) -> u64 {
        self.model_groups.last().map(|g| g.min_vram_mb).unwrap_or(0)
    }

    /// Return all upgrade packs the given tier is entitled to, resolved
    /// with inheritance. E.g. CreatorStudio gets its own packs plus any
    /// packs inherited from Pro.
    pub fn entitled_packs(&self, tier: LicenceTier) -> Vec<(&str, &UpgradePack)> {
        let mut entitled = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut queue: Vec<&str> = self
            .upgrade_packs
            .iter()
            .filter(|(_, pack)| tier.satisfies(pack.min_tier) && pack.status == "active")
            .map(|(id, _)| id.as_str())
            .collect();

        while let Some(pack_id) = queue.pop() {
            if !seen.insert(pack_id.to_string()) {
                continue;
            }
            if let Some(pack) = self.upgrade_packs.get(pack_id) {
                entitled.push((pack_id, pack));
                // Chase inheritance
                for inherited_id in &pack.inherits {
                    if let Some(inherited) = self.upgrade_packs.get(inherited_id.as_str()) {
                        if !seen.contains(inherited_id.as_str()) && inherited.status == "active" {
                            queue.push(inherited_id.as_str());
                        }
                    }
                }
            }
        }
        entitled
    }

    /// Select the best quant from a VRAM-gated upgrade pack for the
    /// given VRAM budget. Returns None if no quant fits.
    pub fn select_pack_quant(pack: &UpgradePack, vram_mb: u64) -> Option<&UpgradePackQuant> {
        pack.quants
            .iter()
            .filter(|q| q.min_vram_mb <= vram_mb)
            .max_by_key(|q| q.min_vram_mb)
    }
}

/// Select the highest-VRAM model group that fits the available VRAM budget.
pub fn plan_for_vram(manifest: &AppletManifest, vram_mb: u32) -> Option<&ModelGroup> {
    let available = u64::from(vram_mb);
    manifest
        .model_groups
        .iter()
        .filter(|group| group.min_vram_mb <= available)
        .max_by_key(|group| group.min_vram_mb)
}

/// Flat model manifest for simple use cases (e.g. applets that don't
/// need model groups). Wraps a Vec<ModelInfo>.
pub struct ModelManifest {
    pub models: Vec<ModelInfo>,
}

impl ModelManifest {
    pub fn new(models: Vec<ModelInfo>) -> Self {
        Self { models }
    }

    pub fn get(&self, key: &str) -> Option<&ModelInfo> {
        self.models.iter().find(|m| m.key == key)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut ModelInfo> {
        self.models.iter_mut().find(|m| m.key == key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> AppletManifest {
        AppletManifest {
            applet: AppletMeta {
                id: "test".to_string(),
                name: "Test".to_string(),
                version: "0.1.0".to_string(),
                description: "Test applet".to_string(),
                icon: "icon.png".to_string(),
                transport: "tauri".to_string(),
                frontend_port: None,
            },
            engine: EngineMeta {
                engine_type: "llm".to_string(),
                backend: "server".to_string(),
                server_binary: String::new(),
                sidecar: None,
            },
            model_groups: vec![
                ModelGroup {
                    label: "small".to_string(),
                    min_vram_mb: 4_096,
                    models: Vec::new(),
                },
                ModelGroup {
                    label: "medium".to_string(),
                    min_vram_mb: 8_192,
                    models: Vec::new(),
                },
                ModelGroup {
                    label: "large".to_string(),
                    min_vram_mb: 12_288,
                    models: Vec::new(),
                },
            ],
            upgrade_packs: std::collections::HashMap::new(),
            requirements: Requirements::default(),
        }
    }

    #[test]
    fn plan_for_vram_selects_best_fit() {
        let manifest = sample_manifest();
        assert_eq!(
            plan_for_vram(&manifest, 4_095).map(|g| g.label.as_str()),
            None
        );
        assert_eq!(plan_for_vram(&manifest, 4_096).unwrap().label, "small");
        assert_eq!(plan_for_vram(&manifest, 10_000).unwrap().label, "medium");
        assert_eq!(plan_for_vram(&manifest, 24_000).unwrap().label, "large");
    }
}
