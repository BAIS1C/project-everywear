//! VRAM budget tracker and purge policy.
//!
//! The shell maintains a runtime ledger of what's loaded on the GPU.
//! The budget tracker is authoritative for allocation decisions and
//! cross-checked against NVML readings after every purge.
//!
//! See WIKI.md Section 6 "VRAM Lifecycle and Purge Policy" for the
//! full design spec.

use crate::gpu::VramTier;
use chrono::{DateTime, Utc};
use model_manager::{AppletManifest, ModelGroup, ModelRole};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// PurgePolicy: tier-based eviction strategy
// ---------------------------------------------------------------------------

/// Eviction strategy selected by VramTier. Not just a UI label: this
/// determines what gets unloaded when switching applets.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum PurgePolicy {
    /// 8-11GB: One applet at a time. Full purge on every switch.
    /// No background model retention.
    Exclusive,

    /// 12-15GB: Purge primary model on switch. Keep sub-1GB
    /// auxiliary models (VAE, small encoders) if budget allows.
    PurgePrimary,

    /// 16-23GB: Keep one applet's models warm if total fits.
    /// LRU eviction when budget exceeded.
    WarmSwitch,

    /// 24GB+: Full LRU. Keep everything loaded until budget
    /// forces eviction. Background models deprioritised.
    Lru,
}

impl PurgePolicy {
    pub fn from_tier(tier: VramTier) -> Self {
        match tier {
            VramTier::Minimal => PurgePolicy::Exclusive,
            VramTier::Constrained => PurgePolicy::PurgePrimary,
            VramTier::Standard => PurgePolicy::WarmSwitch,
            VramTier::Ultra => PurgePolicy::Lru,
            VramTier::CpuFallback => PurgePolicy::Exclusive,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            PurgePolicy::Exclusive => "Exclusive (full purge)",
            PurgePolicy::PurgePrimary => "PurgePrimary (keep aux)",
            PurgePolicy::WarmSwitch => "WarmSwitch (keep one warm)",
            PurgePolicy::Lru => "LRU (keep until full)",
        }
    }
}

// ---------------------------------------------------------------------------
// VRAM allocation tracking
// ---------------------------------------------------------------------------

/// A single VRAM reservation: one model loaded for one applet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VramAllocation {
    pub applet_id: String,
    pub model_key: String,
    pub role: ModelRole,
    pub vram_mb: u64,
    pub loaded_at: DateTime<Utc>,
}

/// Runtime ledger of GPU memory allocations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VramBudget {
    pub total_mb: u64,
    pub allocations: Vec<VramAllocation>,
}

impl VramBudget {
    pub fn new(total_mb: u64) -> Self {
        Self {
            total_mb,
            allocations: Vec::new(),
        }
    }

    /// Estimated free VRAM based on our allocation ledger.
    pub fn free_mb(&self) -> u64 {
        let allocated: u64 = self.allocations.iter().map(|a| a.vram_mb).sum();
        self.total_mb.saturating_sub(allocated)
    }

    /// Total VRAM currently allocated.
    pub fn allocated_mb(&self) -> u64 {
        self.allocations.iter().map(|a| a.vram_mb).sum()
    }

    /// Check if a given amount fits in the current free budget.
    pub fn can_fit(&self, required_mb: u64) -> bool {
        self.free_mb() >= required_mb
    }

    /// Reserve VRAM for a model load.
    pub fn allocate(&mut self, alloc: VramAllocation) {
        info!(
            applet = %alloc.applet_id,
            model = %alloc.model_key,
            vram = alloc.vram_mb,
            "Allocating VRAM"
        );
        self.allocations.push(alloc);
    }

    /// Release all allocations for an applet.
    pub fn release_applet(&mut self, applet_id: &str) {
        let before = self.allocations.len();
        self.allocations.retain(|a| a.applet_id != applet_id);
        let released = before - self.allocations.len();
        info!(applet = applet_id, released, "Released applet allocations");
    }

    /// Release only the primary model for an applet (PurgePrimary policy).
    pub fn release_primary(&mut self, applet_id: &str) {
        self.allocations
            .retain(|a| !(a.applet_id == applet_id && a.role == ModelRole::Primary));
    }

    /// Get all allocations for a specific applet.
    pub fn applet_allocations(&self, applet_id: &str) -> Vec<&VramAllocation> {
        self.allocations
            .iter()
            .filter(|a| a.applet_id == applet_id)
            .collect()
    }

    /// Cross-check budget against actual NVML readings.
    /// Called after purge to detect leaks. Returns true if within tolerance.
    pub fn verify_against_nvml(&self, nvml_free_mb: u64) -> bool {
        let drift = (self.free_mb() as i64 - nvml_free_mb as i64).abs();
        if drift >= 512 {
            warn!(
                budget_free = self.free_mb(),
                nvml_free = nvml_free_mb,
                drift,
                "VRAM budget drift exceeds 512MB tolerance"
            );
        }
        drift < 512
    }

    /// Get the active applet (most recent allocation).
    pub fn active_applet(&self) -> Option<&str> {
        self.allocations.last().map(|a| a.applet_id.as_str())
    }
}

// ---------------------------------------------------------------------------
// Model group selection
// ---------------------------------------------------------------------------

/// Select the best model group that fits the current VRAM situation.
///
/// Walks groups top-down (highest quality first), selects the first
/// where `min_vram_mb` fits the available VRAM. Under Exclusive/PurgePrimary
/// policies, "available" includes reclaimable VRAM from current allocations.
pub fn select_model_group<'a>(
    manifest: &'a AppletManifest,
    budget: &VramBudget,
    policy: &PurgePolicy,
) -> Option<&'a ModelGroup> {
    let available = match policy {
        PurgePolicy::Exclusive | PurgePolicy::PurgePrimary => {
            // We'll reclaim current allocations before loading
            let reclaimable: u64 = budget
                .allocations
                .iter()
                .filter(|a| match policy {
                    PurgePolicy::Exclusive => true,
                    PurgePolicy::PurgePrimary => a.role == ModelRole::Primary,
                    _ => false,
                })
                .map(|a| a.vram_mb)
                .sum();
            budget.free_mb() + reclaimable
        }
        PurgePolicy::WarmSwitch | PurgePolicy::Lru => budget.free_mb(),
    };

    info!(
        available_mb = available,
        policy = ?policy,
        groups = manifest.model_groups.len(),
        "Selecting model group"
    );

    manifest
        .model_groups
        .iter()
        .find(|g| g.min_vram_mb <= available)
}

// ---------------------------------------------------------------------------
// Purge execution types
// ---------------------------------------------------------------------------

/// Request to purge models from GPU before loading new ones.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeRequest {
    /// Applet whose models should be unloaded.
    pub applet_id: String,
    /// Which models to purge (all, or just primaries).
    pub scope: PurgeScope,
    /// Expected VRAM reclaim in MB.
    pub expected_reclaim_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PurgeScope {
    /// Remove all models for the applet.
    All,
    /// Remove only primary models; keep aux (VAE, encoder) if small.
    PrimaryOnly,
}

/// Result of a purge operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeResult {
    pub success: bool,
    pub reclaimed_mb: u64,
    pub nvml_verified: bool,
    pub error: Option<String>,
}

/// Build a purge request based on the current policy and state.
pub fn build_purge_request(
    current_applet: &str,
    budget: &VramBudget,
    policy: &PurgePolicy,
) -> PurgeRequest {
    let scope = match policy {
        PurgePolicy::Exclusive | PurgePolicy::Lru => PurgeScope::All,
        PurgePolicy::PurgePrimary => PurgeScope::PrimaryOnly,
        PurgePolicy::WarmSwitch => {
            // WarmSwitch: purge all if we need the space
            PurgeScope::All
        }
    };

    let expected_reclaim_mb: u64 = budget
        .allocations
        .iter()
        .filter(|a| {
            a.applet_id == current_applet
                && match scope {
                    PurgeScope::All => true,
                    PurgeScope::PrimaryOnly => a.role == ModelRole::Primary,
                }
        })
        .map(|a| a.vram_mb)
        .sum();

    PurgeRequest {
        applet_id: current_applet.to_string(),
        scope,
        expected_reclaim_mb,
    }
}

// ---------------------------------------------------------------------------
// Requirements check (gate)
// ---------------------------------------------------------------------------

/// Result of checking whether an applet can launch on this hardware.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequirementsCheck {
    pub can_launch: bool,
    pub selected_group: Option<String>,
    pub selected_group_vram_mb: Option<u64>,
    pub needs_download: Vec<String>,
    pub needs_purge: bool,
    pub purge_applet: Option<String>,
    pub reason: Option<String>,
}
