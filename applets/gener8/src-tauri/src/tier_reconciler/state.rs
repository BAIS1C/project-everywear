//! Persistent reconciler state.
//!
//! Ported from S3 Studio. Only change: LicenceTier import path.
//!
//! Lives at `<data_dir>/reconciler_state.json`. Tracks current tier,
//! last tier sync, and downgrade grace arithmetic.
//!
//! Grace rules (locked 2026-04-21):
//!   - On downgrade, unentitled files move to .disabled/ immediately
//!   - Grace window: 30 days
//!   - Warnings at 7 and 1 day(s) remaining
//!   - Re-upgrade within grace: files move back, grace cleared
//!   - After grace expires: sweep deletes .disabled/ contents

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::LicenceTier;

pub const GRACE_DAYS: i64 = 30;
pub const WARNING_DAYS: &[i64] = &[7, 1];
pub const STATE_FILE: &str = "reconciler_state.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TierChange {
    Unchanged,
    Upgrade {
        from: LicenceTier,
        to: LicenceTier,
        grace_cleared: bool,
    },
    Downgrade {
        from: LicenceTier,
        to: LicenceTier,
        grace_expires_at: DateTime<Utc>,
    },
    Lateral {
        from: LicenceTier,
        to: LicenceTier,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcilerState {
    pub current_tier: LicenceTier,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub prior_tier: Option<LicenceTier>,
    pub downgrade_at: Option<DateTime<Utc>>,
    pub grace_expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub warnings_emitted: Vec<i64>,
}

impl ReconcilerState {
    pub fn fresh() -> Self {
        Self {
            current_tier: LicenceTier::Demo,
            last_synced_at: None,
            prior_tier: None,
            downgrade_at: None,
            grace_expires_at: None,
            warnings_emitted: Vec::new(),
        }
    }

    pub fn state_path(data_dir: &Path) -> PathBuf {
        data_dir.join(STATE_FILE)
    }

    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = Self::state_path(data_dir);
        if !path.exists() {
            return Ok(Self::fresh());
        }
        let raw = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
        let s: Self =
            serde_json::from_slice(&raw).with_context(|| format!("parse {}", path.display()))?;
        Ok(s)
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let path = Self::state_path(data_dir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(self).context("serialize reconciler state")?;
        std::fs::write(&tmp, bytes).with_context(|| format!("write {}", tmp.display()))?;
        std::fs::rename(&tmp, &path)
            .with_context(|| format!("rename {} -> {}", tmp.display(), path.display()))?;
        Ok(())
    }

    pub fn apply_tier_change(&mut self, incoming: LicenceTier, now: DateTime<Utc>) -> TierChange {
        self.last_synced_at = Some(now);

        let from = self.current_tier;
        let to = incoming;
        let change = classify_change(from, to);

        match change {
            TierChange::Unchanged => {}
            TierChange::Upgrade { .. } => {
                let grace_was_active = self.grace_expires_at.is_some();
                self.prior_tier = None;
                self.downgrade_at = None;
                self.grace_expires_at = None;
                self.warnings_emitted.clear();
                self.current_tier = to;
                if grace_was_active {
                    return TierChange::Upgrade {
                        from,
                        to,
                        grace_cleared: true,
                    };
                }
            }
            TierChange::Downgrade { .. } => {
                if self.grace_expires_at.is_none() {
                    self.prior_tier = Some(from);
                    self.downgrade_at = Some(now);
                    self.grace_expires_at = Some(now + Duration::days(GRACE_DAYS));
                    self.warnings_emitted.clear();
                }
                self.current_tier = to;
                return TierChange::Downgrade {
                    from,
                    to,
                    grace_expires_at: self.grace_expires_at.expect("grace set above"),
                };
            }
            TierChange::Lateral { .. } => {
                self.current_tier = to;
            }
        }

        change
    }

    pub fn days_remaining(&self, now: DateTime<Utc>) -> Option<i64> {
        self.grace_expires_at.map(|exp| (exp - now).num_days())
    }

    pub fn pending_warnings(&self, now: DateTime<Utc>) -> Vec<i64> {
        let Some(days) = self.days_remaining(now) else {
            return vec![];
        };
        let mut out = Vec::new();
        for &threshold in WARNING_DAYS {
            if days <= threshold && !self.warnings_emitted.contains(&threshold) {
                out.push(threshold);
            }
        }
        out
    }

    pub fn mark_warning_emitted(&mut self, threshold: i64) {
        if !self.warnings_emitted.contains(&threshold) {
            self.warnings_emitted.push(threshold);
        }
    }

    pub fn grace_expired(&self, now: DateTime<Utc>) -> bool {
        matches!(self.grace_expires_at, Some(exp) if now >= exp)
    }

    pub fn clear_grace(&mut self) {
        self.prior_tier = None;
        self.downgrade_at = None;
        self.grace_expires_at = None;
        self.warnings_emitted.clear();
    }
}

fn classify_change(from: LicenceTier, to: LicenceTier) -> TierChange {
    let rank = |t: LicenceTier| -> u8 {
        match t {
            LicenceTier::Demo => 0,
            LicenceTier::Gener8 => 1,
            LicenceTier::Gener8Pro => 2,
            LicenceTier::CreatorStudio => 3,
        }
    };
    if from == to {
        TierChange::Unchanged
    } else if rank(to) > rank(from) {
        TierChange::Upgrade {
            from,
            to,
            grace_cleared: false,
        }
    } else if rank(to) < rank(from) {
        TierChange::Downgrade {
            from,
            to,
            grace_expires_at: Utc::now(),
        }
    } else {
        TierChange::Lateral { from, to }
    }
}
