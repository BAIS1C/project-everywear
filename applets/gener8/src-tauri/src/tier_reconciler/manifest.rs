//! Manifest loader: models/manifest.json (v1.3.1 schema).
//!
//! Ported unchanged from S3 Studio. Read-only view of the model manifest.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub tiers: BTreeMap<String, TierSpec>,
    #[serde(default)]
    pub models: Vec<ModelSpec>,
    #[serde(default)]
    pub upgrade_packs: BTreeMap<String, UpgradePack>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TierSpec {
    #[serde(default)]
    pub required_model_ids: Vec<String>,
    #[serde(default)]
    pub inherits_upgrade_packs: Vec<String>,
    #[serde(default)]
    pub adds_upgrade_pack: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelSpec {
    pub id: String,
    pub file: String,
    #[serde(default)]
    pub required: bool,
    pub tier: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpgradePack {
    pub tier: String,
    #[serde(default)]
    pub pro_only: bool,
    #[serde(default)]
    pub creator_only: bool,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub vram_gated_quants: BTreeMap<String, VramGatedQuant>,
    #[serde(default)]
    pub vram_gated_components: BTreeMap<String, VramGatedComponent>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VramGatedQuant {
    pub file: String,
    pub min_vram_mb: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VramGatedComponent {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub vram_gated_quants: BTreeMap<String, VramGatedComponentQuant>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VramGatedComponentQuant {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub file_pair: Vec<String>,
    pub min_vram_mb: u32,
}

impl Manifest {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read(path)
            .with_context(|| format!("reading manifest at {}", path.display()))?;
        let m: Manifest = serde_json::from_slice(&raw)
            .with_context(|| format!("parsing manifest at {}", path.display()))?;
        Ok(m)
    }

    pub fn tier(&self, id: &str) -> Result<&TierSpec> {
        self.tiers
            .get(id)
            .ok_or_else(|| anyhow!("unknown tier id in manifest: {}", id))
    }

    pub fn model_file(&self, id: &str) -> Option<&str> {
        self.models
            .iter()
            .find(|m| m.id == id)
            .map(|m| m.file.as_str())
    }

    pub fn pick_quant<'a, T>(
        quants: &'a BTreeMap<String, T>,
        vram_mb: u32,
        min_vram_of: impl Fn(&T) -> u32,
    ) -> Option<&'a T> {
        quants
            .values()
            .filter(|q| min_vram_of(q) <= vram_mb)
            .max_by_key(|q| min_vram_of(q))
    }
}
