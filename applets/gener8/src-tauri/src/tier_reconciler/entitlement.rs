//! Entitlement computer.
//!
//! Ported from S3 Studio. Only change: LicenceTier import path.
//!
//! Given a tier + detected VRAM, produces the set of filenames that
//! SHOULD live in models/ (as opposed to models/.disabled/).

use std::collections::BTreeSet;

use crate::LicenceTier;

use super::manifest::Manifest;

/// Filenames that should be live in models/ at the current tier.
pub type EntitledSet = BTreeSet<String>;

/// Compute the entitled file set for (tier, vram).
pub fn compute(manifest: &Manifest, tier: LicenceTier, vram_mb: u32) -> EntitledSet {
    let mut out = BTreeSet::new();

    let effective_tier_id = match tier {
        LicenceTier::Demo | LicenceTier::Gener8 => "gener8_base",
        LicenceTier::Gener8Pro => "gener8_pro",
        LicenceTier::CreatorStudio => "creator_studio",
    };

    let ladder: &[&str] = match effective_tier_id {
        "gener8_base" => &["gener8_base"],
        "gener8_pro" => &["gener8_base", "gener8_pro"],
        "creator_studio" => &["gener8_base", "gener8_pro", "creator_studio"],
        _ => &[],
    };

    // Required models per tier in the ladder.
    for tier_id in ladder {
        let Ok(tier_spec) = manifest.tier(tier_id) else {
            continue;
        };
        for model_id in &tier_spec.required_model_ids {
            if let Some(file) = manifest.model_file(model_id) {
                out.insert(file.to_string());
            }
        }
    }

    // Tier-activated upgrade packs.
    let top_tier = ladder.last().copied().unwrap_or("gener8_base");
    let mut active_packs: Vec<&str> = Vec::new();
    if let Ok(top) = manifest.tier(top_tier) {
        if let Some(added) = &top.adds_upgrade_pack {
            active_packs.push(added.as_str());
        }
        for inherited in &top.inherits_upgrade_packs {
            active_packs.push(inherited.as_str());
        }
    }
    for tier_id in &ladder[..ladder.len().saturating_sub(1)] {
        if let Ok(ts) = manifest.tier(tier_id) {
            if let Some(pack) = &ts.adds_upgrade_pack {
                if !active_packs.iter().any(|p| p == &pack.as_str()) {
                    active_packs.push(pack.as_str());
                }
            }
        }
    }

    for pack_id in active_packs {
        let Some(pack) = manifest.upgrade_packs.get(pack_id) else {
            continue;
        };
        if let Some(file) = &pack.file {
            out.insert(file.clone());
        }
        if !pack.vram_gated_quants.is_empty() {
            if let Some(q) =
                Manifest::pick_quant(&pack.vram_gated_quants, vram_mb, |q| q.min_vram_mb)
            {
                out.insert(q.file.clone());
            }
        }
        for component in pack.vram_gated_components.values() {
            if let Some(file) = &component.file {
                out.insert(file.clone());
            }
            if !component.vram_gated_quants.is_empty() {
                if let Some(q) =
                    Manifest::pick_quant(&component.vram_gated_quants, vram_mb, |q| q.min_vram_mb)
                {
                    if let Some(f) = &q.file {
                        out.insert(f.clone());
                    }
                    for f in &q.file_pair {
                        out.insert(f.clone());
                    }
                }
            }
        }
    }

    out
}
