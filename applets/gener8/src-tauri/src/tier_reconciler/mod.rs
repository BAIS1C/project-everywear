//! Tier Reconciler for the Everywear-migrated Gener8 applet.
//!
//! Ported from S3 Studio's tier_reconciler/. Key migration changes:
//!   - No Tauri AppHandle: events are sent via IPC to the shell
//!   - No TierClaim from SPA: tier arrives via HMAC-verified TierSync
//!     IPC command from the shell. The HMAC check happens in ipc_handler.rs
//!     BEFORE the reconciler ever sees the tier change.
//!   - Paths use everywear_paths instead of util::app_data_dir()
//!   - LicenceTier is crate::LicenceTier (not licence::LicenceTier)
//!
//! What the reconciler does:
//!   1. On every tier sync, computes entitled file set from manifest.json + VRAM
//!   2. Moves unentitled files from models/ into models/.disabled/
//!   3. Moves previously-disabled files back if user re-upgrades within grace
//!   4. Grace period: 30 days, warnings at 7 and 1 day(s), sweep on expiry

pub mod entitlement;
pub mod manifest;
pub mod mover;
pub mod state;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::LicenceTier;

use self::manifest::Manifest;
use self::state::{ReconcilerState, TierChange};

/// Outcome of a reconcile pass.
#[derive(Debug, Clone, Serialize)]
pub struct ReconcileReport {
    pub tier: &'static str,
    pub entitled_count: usize,
    pub moved_to_disabled: usize,
    pub moved_to_active: usize,
    pub missing: Vec<String>,
}

/// Reconciler handle. Clone is cheap (Arc inside).
#[derive(Clone)]
pub struct Reconciler(Arc<Inner>);

struct Inner {
    data_dir: PathBuf,
    models_dir: PathBuf,
    manifest_path: PathBuf,
    /// Shared with AppState.tier.
    tier: Arc<Mutex<LicenceTier>>,
    state: Mutex<ReconcilerState>,
    manifest: Mutex<Option<Manifest>>,
}

impl Reconciler {
    /// Build a reconciler. No I/O at construction; manifest + state load lazily.
    pub fn new(data_dir: PathBuf, tier: Arc<Mutex<LicenceTier>>) -> Self {
        let models_dir = everywear_paths::models_dir();
        let manifest_path = models_dir.join("manifest.json");
        Self(Arc::new(Inner {
            data_dir,
            models_dir,
            manifest_path,
            tier,
            state: Mutex::new(ReconcilerState::fresh()),
            manifest: Mutex::new(None),
        }))
    }

    /// Hydrate state from disk if not yet loaded.
    pub async fn ensure_loaded(&self) -> Result<()> {
        {
            let mut st = self.0.state.lock().await;
            if st.last_synced_at.is_none() && st.current_tier == LicenceTier::Demo {
                match ReconcilerState::load(&self.0.data_dir) {
                    Ok(loaded) => {
                        *st = loaded;
                        let mut tier = self.0.tier.lock().await;
                        *tier = st.current_tier;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "tier_reconciler: could not load state ({}); using fresh",
                            e
                        );
                    }
                }
            }
        }
        {
            let mut mf = self.0.manifest.lock().await;
            if mf.is_none() && self.0.manifest_path.exists() {
                match Manifest::load(&self.0.manifest_path) {
                    Ok(loaded) => *mf = Some(loaded),
                    Err(e) => {
                        tracing::warn!(
                            "tier_reconciler: manifest load failed ({}); reconciler idle",
                            e
                        );
                    }
                }
            }
        }
        Ok(())
    }

    /// Reload manifest from disk.
    pub async fn refresh_manifest(&self) -> Result<()> {
        let mut mf = self.0.manifest.lock().await;
        *mf = Some(Manifest::load(&self.0.manifest_path)?);
        Ok(())
    }

    /// Run a reconcile pass with the current cached tier.
    /// Called from ipc_handler after a TierSync command updates the tier.
    pub async fn reconcile_once(&self) -> Result<ReconcileReport> {
        self.ensure_loaded().await?;

        let tier = { *self.0.tier.lock().await };
        let mf = self.0.manifest.lock().await;
        let Some(manifest) = mf.as_ref() else {
            tracing::warn!(
                "tier_reconciler: manifest absent at {}; tier={} but file movement skipped",
                self.0.manifest_path.display(),
                tier.as_str()
            );
            return Ok(ReconcileReport {
                tier: tier.as_str(),
                entitled_count: 0,
                moved_to_disabled: 0,
                moved_to_active: 0,
                missing: vec!["manifest.json".to_string()],
            });
        };

        // VRAM detection: read from NVML if available, else estimate
        let vram_mb = detect_vram_mb();

        let entitled = entitlement::compute(manifest, tier, vram_mb);
        let plan = mover::plan(&self.0.models_dir, &entitled)?;

        let moved_to_disabled = plan
            .items
            .iter()
            .filter(|i| i.to == mover::Location::Disabled)
            .count();
        let moved_to_active = plan
            .items
            .iter()
            .filter(|i| i.to == mover::Location::Active)
            .count();

        if !plan.is_empty() {
            mover::apply(&self.0.models_dir, &plan)?;
        }

        let report = ReconcileReport {
            tier: tier.as_str(),
            entitled_count: entitled.len(),
            moved_to_disabled,
            moved_to_active,
            missing: plan.missing,
        };

        tracing::info!(
            "Reconcile complete: tier={}, entitled={}, disabled={}, restored={}",
            report.tier,
            report.entitled_count,
            report.moved_to_disabled,
            report.moved_to_active,
        );

        Ok(report)
    }

    /// Grace tick: hourly background task. Fires pending grace warnings
    /// and sweeps .disabled/ after grace expires.
    pub async fn grace_tick(&self) {
        if let Err(e) = self.grace_tick_inner().await {
            tracing::warn!("tier_reconciler: grace_tick failed: {}", e);
        }
    }

    async fn grace_tick_inner(&self) -> Result<()> {
        self.ensure_loaded().await?;
        let now = Utc::now();

        // Pending warnings
        let pending = {
            let st = self.0.state.lock().await;
            st.pending_warnings(now)
        };
        for threshold in pending {
            let days_remaining = {
                let st = self.0.state.lock().await;
                st.days_remaining(now).unwrap_or(0)
            };
            tracing::warn!(
                "tier_reconciler: grace warning: {} days remaining",
                days_remaining
            );
            let mut st = self.0.state.lock().await;
            st.mark_warning_emitted(threshold);
            st.save(&self.0.data_dir).ok();
        }

        // Expiry sweep
        let expired = {
            let st = self.0.state.lock().await;
            st.grace_expired(now)
        };
        if expired {
            let swept = mover::sweep_disabled(&self.0.models_dir).unwrap_or(0);
            tracing::info!("tier_reconciler: grace expired; swept {} files", swept);
            let mut st = self.0.state.lock().await;
            st.clear_grace();
            st.save(&self.0.data_dir).ok();
        }

        Ok(())
    }

    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }

    pub async fn current_tier(&self) -> LicenceTier {
        *self.0.tier.lock().await
    }
}

/// Best-effort VRAM detection for reconciler entitlement computation.
/// The shell owns the authoritative GPU state; this is just for local
/// manifest resolution when the shell hasn't sent us explicit VRAM info.
fn detect_vram_mb() -> u32 {
    let mut command = std::process::Command::new("nvidia-smi");
    command.args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    if let Ok(output) = command.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Ok(mb) = stdout.trim().parse::<u32>() {
            return mb;
        }
    }
    // Fallback: assume 8 GB
    8192
}

fn parse_tier(s: &str) -> Result<LicenceTier> {
    match s {
        "demo" => Ok(LicenceTier::Demo),
        "gener8" | "gener8_base" => Ok(LicenceTier::Gener8),
        "gener8_pro" => Ok(LicenceTier::Gener8Pro),
        "creator_studio" => Ok(LicenceTier::CreatorStudio),
        other => Err(anyhow!("unknown tier id: {}", other)),
    }
}
