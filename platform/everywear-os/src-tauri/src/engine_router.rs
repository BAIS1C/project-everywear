//! Engine Router: job submission, path sandboxing, entitlement gating.
//!
//! Contract 3 from MIGRATION_ARCHITECTURE.md.
//!
//! How applets submit work to engines through the shell's router.
//! Event-driven results, not blocking request-response.
//!
//! Flow:
//! 1. Applet submits SubmitJob or SubmitPlan (event, non-blocking)
//! 2. Shell validates: engine exists in registry, tier entitlement OK,
//!    output_target sandboxed, input_files verified
//! 3. Shell enqueues with timeout derived from priority
//! 4. Shell checks VRAM scheduler for engine availability
//! 5. If engine not loaded: provision, StartInference, Warmup
//! 6. Shell forwards ExecuteJob to engine applet
//! 7. Engine executes, writes to output_target
//! 8. Shell relays JobComplete/JobFailed event to requesting applet

use crate::engine_registry::{EngineAvailability, EngineRegistry};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Job types (Contract 3)
// ---------------------------------------------------------------------------

/// A job submitted to an engine via the shell router.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineJob {
    pub job_id: String,
    pub requesting_applet: String,
    pub requesting_module: String,
    pub engine_id: String,
    pub capability: String,
    pub input_payload: serde_json::Value,
    pub input_files: Vec<FileRef>,
    pub output_target: PathBuf,
    pub priority: JobPriority,
    pub vram_policy: VramPolicy,
    pub cancellation_token: String,
    pub plan_ref: Option<PlanRef>,
    pub timeout_ms: Option<u64>,
}

/// Large file references passed via filesystem, not JSON channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRef {
    pub role: String,
    pub path: PathBuf,
    pub mime: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobPriority {
    High,
    Normal,
    Low,
    Background,
}

impl JobPriority {
    /// Default timeout for this priority tier.
    pub fn default_timeout(&self) -> Duration {
        match self {
            JobPriority::High => Duration::from_secs(300),
            JobPriority::Normal => Duration::from_secs(120),
            JobPriority::Low => Duration::from_secs(60),
            JobPriority::Background => Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VramPolicy {
    /// Default: purge active engine before loading.
    Exclusive,
    /// Use if already warm, skip if not.
    WarmIfLoaded,
    /// Can interrupt lower-priority jobs.
    Preemptive,
}

/// Back-reference to a ShotPlan for dependency tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanRef {
    pub plan_id: String,
    pub shot_id: String,
    pub asset_type: String,
}

// ---------------------------------------------------------------------------
// Job result events (relayed via IPC)
// ---------------------------------------------------------------------------

/// Result of a completed job, sent as IpcKind::Event to requesting applet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job_id: String,
    pub output_path: PathBuf,
    pub duration_ms: u64,
    pub metadata: serde_json::Value,
}

/// Job failure info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobError {
    pub job_id: String,
    pub error: String,
    pub retriable: bool,
}

// ---------------------------------------------------------------------------
// Entitlement gate
// ---------------------------------------------------------------------------

/// Product tier entitlements loaded from bundles/entitlements.toml.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierEntitlements {
    pub applets: Vec<String>,
    pub engines: Vec<String>,
    pub features: Vec<String>,
}

/// Full entitlement manifest: tier_name -> entitlements.
#[derive(Debug, Clone, Default)]
pub struct EntitlementManifest {
    tiers: HashMap<String, TierEntitlements>,
}

impl EntitlementManifest {
    /// Load from bundles/entitlements.toml.
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read entitlements: {}", path.display()))?;

        let raw: toml::Value =
            toml::from_str(&content).with_context(|| "failed to parse entitlements.toml")?;

        let table = raw
            .as_table()
            .ok_or_else(|| anyhow!("entitlements.toml must be a TOML table"))?;

        let mut tiers = HashMap::new();
        for (tier_name, tier_val) in table {
            let applets: Vec<String> = tier_val
                .get("applets")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let engines: Vec<String> = tier_val
                .get("engines")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let features: Vec<String> = tier_val
                .get("features")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            tiers.insert(
                tier_name.clone(),
                TierEntitlements {
                    applets,
                    engines,
                    features,
                },
            );
        }

        Ok(Self { tiers })
    }

    /// Check if a tier is entitled to use a specific applet.
    pub fn can_use_applet(&self, tier: &str, applet_id: &str) -> bool {
        self.tiers
            .get(tier)
            .map(|t| t.applets.iter().any(|a| a == applet_id))
            .unwrap_or(false)
    }

    /// Check if a tier is entitled to use a specific engine.
    pub fn can_use_engine(&self, tier: &str, engine_id: &str) -> bool {
        self.tiers
            .get(tier)
            .map(|t| t.engines.iter().any(|e| e == engine_id))
            .unwrap_or(false)
    }

    /// Check if a tier has a specific feature flag.
    pub fn has_feature(&self, tier: &str, feature: &str) -> bool {
        self.tiers
            .get(tier)
            .map(|t| t.features.iter().any(|f| f == feature))
            .unwrap_or(false)
    }

    /// Get entitlements for a tier (for diagnostics).
    pub fn get_tier(&self, tier: &str) -> Option<&TierEntitlements> {
        self.tiers.get(tier)
    }
}

// ---------------------------------------------------------------------------
// Path sandboxing
// ---------------------------------------------------------------------------

/// Validate that an output_target is within the applet's allowed data directory.
/// Prevents applets from writing to arbitrary filesystem locations.
pub fn validate_output_target(target: &Path, applet_id: &str) -> Result<PathBuf> {
    // Canonicalize, falling back to the raw path if it doesn't exist yet
    // (it may be a new directory the engine will create).
    let canonical = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    let allowed_base = everywear_paths::data_dir(applet_id);

    if canonical.starts_with(&allowed_base) {
        Ok(canonical)
    } else {
        Err(anyhow!(
            "output_target {} outside allowed directory {}",
            canonical.display(),
            allowed_base.display()
        ))
    }
}

/// Validate that all input files are within allowed paths (staging or models)
/// and that their SHA256 checksums match.
pub fn validate_input_files(files: &[FileRef], job_id: &str) -> Result<()> {
    let staging = everywear_paths::staging_dir().join(job_id);
    let models = everywear_paths::models_dir();

    for f in files {
        let canonical = f
            .path
            .canonicalize()
            .with_context(|| format!("input file not found: {}", f.path.display()))?;

        if !canonical.starts_with(&staging) && !canonical.starts_with(&models) {
            return Err(anyhow!(
                "input file {} outside allowed paths (staging={}, models={})",
                canonical.display(),
                staging.display(),
                models.display()
            ));
        }

        // Integrity check
        let actual_hash = sha256_file(&canonical)?;
        if actual_hash != f.sha256 {
            return Err(anyhow!(
                "input file {} hash mismatch: expected {}, got {}",
                f.path.display(),
                f.sha256,
                actual_hash
            ));
        }
    }

    Ok(())
}

/// Compute SHA256 of a file, returned as lowercase hex.
fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("failed to read file for hash: {}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

// ---------------------------------------------------------------------------
// Job validation (pre-routing checks)
// ---------------------------------------------------------------------------

/// Validation errors for a submitted job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobValidationError {
    EngineNotFound { engine_id: String },
    EngineUnavailable { engine_id: String },
    EntitlementDenied { tier: String, engine_id: String },
    OutputPathViolation { path: String, reason: String },
    InputFileViolation { path: String, reason: String },
}

impl std::fmt::Display for JobValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EngineNotFound { engine_id } => {
                write!(f, "engine '{}' not found in registry", engine_id)
            }
            Self::EngineUnavailable { engine_id } => {
                write!(f, "engine '{}' is not available", engine_id)
            }
            Self::EntitlementDenied { tier, engine_id } => {
                write!(f, "tier '{}' not entitled to engine '{}'", tier, engine_id)
            }
            Self::OutputPathViolation { path, reason } => {
                write!(f, "output path '{}': {}", path, reason)
            }
            Self::InputFileViolation { path, reason } => {
                write!(f, "input file '{}': {}", path, reason)
            }
        }
    }
}

/// Full pre-routing validation of a job.
///
/// Checks:
/// 1. Engine exists in registry and is available
/// 2. Requesting applet's tier is entitled to use the engine
/// 3. output_target is sandboxed to the applet's data dir
/// 4. input_files are in staging/models and pass SHA256 integrity
pub fn validate_job(
    job: &EngineJob,
    registry: &EngineRegistry,
    entitlements: &EntitlementManifest,
    user_tier: &str,
) -> Result<(), JobValidationError> {
    // 1. Engine exists
    let engine =
        registry
            .get(&job.engine_id)
            .ok_or_else(|| JobValidationError::EngineNotFound {
                engine_id: job.engine_id.clone(),
            })?;

    // Engine must be Ready or Loading (Loading = queued for when it's ready)
    if engine.availability != EngineAvailability::Ready
        && engine.availability != EngineAvailability::Loading
    {
        return Err(JobValidationError::EngineUnavailable {
            engine_id: job.engine_id.clone(),
        });
    }

    // 2. Entitlement gate
    if !entitlements.can_use_engine(user_tier, &job.engine_id) {
        return Err(JobValidationError::EntitlementDenied {
            tier: user_tier.to_string(),
            engine_id: job.engine_id.clone(),
        });
    }

    // 3. Output path sandboxing
    if let Err(e) = validate_output_target(&job.output_target, &job.requesting_applet) {
        return Err(JobValidationError::OutputPathViolation {
            path: job.output_target.display().to_string(),
            reason: e.to_string(),
        });
    }

    // 4. Input file validation
    if let Err(e) = validate_input_files(&job.input_files, &job.job_id) {
        return Err(JobValidationError::InputFileViolation {
            path: "batch".into(),
            reason: e.to_string(),
        });
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Job timeout resolution
// ---------------------------------------------------------------------------

/// Resolve the effective timeout for a job.
/// Uses the job's explicit timeout_ms if set, otherwise the priority default.
pub fn resolve_timeout(job: &EngineJob) -> Duration {
    job.timeout_ms
        .map(Duration::from_millis)
        .unwrap_or_else(|| job.priority.default_timeout())
}

// ---------------------------------------------------------------------------
// Plan submission
// ---------------------------------------------------------------------------

/// Validate an entire plan atomically. All jobs must pass validation
/// or the entire plan is rejected.
pub fn validate_plan(
    jobs: &[EngineJob],
    registry: &EngineRegistry,
    entitlements: &EntitlementManifest,
    user_tier: &str,
) -> Result<(), (usize, JobValidationError)> {
    for (i, job) in jobs.iter().enumerate() {
        if let Err(e) = validate_job(job, registry, entitlements, user_tier) {
            return Err((i, e));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/// Cancel all jobs matching a cancellation token.
/// Returns the number of jobs cancelled.
pub fn cancel_by_token(queue: &mut Vec<EngineJob>, cancellation_token: &str) -> usize {
    let before = queue.len();
    queue.retain(|j| j.cancellation_token != cancellation_token);
    let cancelled = before - queue.len();
    if cancelled > 0 {
        info!(
            token = cancellation_token,
            cancelled, "Cancelled jobs by token"
        );
    }
    cancelled
}

/// Cancel all jobs from a specific requesting applet.
/// Used when an applet disconnects.
pub fn cancel_by_applet(queue: &mut Vec<EngineJob>, applet_id: &str) -> usize {
    let before = queue.len();
    queue.retain(|j| j.requesting_applet != applet_id);
    let cancelled = before - queue.len();
    if cancelled > 0 {
        info!(
            applet = applet_id,
            cancelled, "Cancelled jobs for disconnected applet"
        );
    }
    cancelled
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine_registry::{EngineEntry, EngineLifecycle};

    fn make_registry_with_engine() -> EngineRegistry {
        let mut reg = EngineRegistry::new();
        reg.register(EngineEntry {
            engine_id: "gener8.audio".into(),
            applet_id: "gener8".into(),
            capabilities: vec!["audio_gen".into()],
            input_schemas: HashMap::new(),
            output_schemas: HashMap::new(),
            vram_requirement_mb: 4096,
            availability: EngineAvailability::Ready,
            lifecycle: EngineLifecycle::Idle,
            registered_at: 0,
        });
        reg
    }

    fn make_entitlements() -> EntitlementManifest {
        let mut tiers = HashMap::new();
        tiers.insert(
            "free".into(),
            TierEntitlements {
                applets: vec!["gener8".into()],
                engines: vec!["gener8.audio".into()],
                features: vec![],
            },
        );
        tiers.insert(
            "creator_studio".into(),
            TierEntitlements {
                applets: vec!["gener8".into(), "1magen".into(), "3nvizen".into()],
                engines: vec![
                    "gener8.audio".into(),
                    "1magen.image".into(),
                    "3nvizen.video".into(),
                ],
                features: vec!["ai_director".into()],
            },
        );
        EntitlementManifest { tiers }
    }

    fn make_job(engine_id: &str, applet_id: &str) -> EngineJob {
        EngineJob {
            job_id: "test-job-001".into(),
            requesting_applet: applet_id.into(),
            requesting_module: "create_view".into(),
            engine_id: engine_id.into(),
            capability: "audio_gen".into(),
            input_payload: serde_json::json!({}),
            input_files: vec![],
            output_target: everywear_paths::data_dir(applet_id).join("output.wav"),
            priority: JobPriority::Normal,
            vram_policy: VramPolicy::Exclusive,
            cancellation_token: "batch-001".into(),
            plan_ref: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn valid_job_passes() {
        let reg = make_registry_with_engine();
        let ent = make_entitlements();
        let job = make_job("gener8.audio", "gener8");
        assert!(validate_job(&job, &reg, &ent, "free").is_ok());
    }

    #[test]
    fn unknown_engine_fails() {
        let reg = make_registry_with_engine();
        let ent = make_entitlements();
        let job = make_job("nonexistent.engine", "gener8");
        let err = validate_job(&job, &reg, &ent, "free").unwrap_err();
        assert!(matches!(err, JobValidationError::EngineNotFound { .. }));
    }

    #[test]
    fn entitlement_denied() {
        let reg = make_registry_with_engine();
        let ent = make_entitlements();
        // Free tier cannot use 1magen.image
        let mut job = make_job("gener8.audio", "gener8");
        job.engine_id = "1magen.image".into();
        // But the engine doesn't exist in registry, so it fails on EngineNotFound first.
        // Test entitlement separately:
        assert!(!ent.can_use_engine("free", "1magen.image"));
        assert!(ent.can_use_engine("creator_studio", "1magen.image"));
    }

    #[test]
    fn priority_timeouts() {
        assert_eq!(
            JobPriority::High.default_timeout(),
            Duration::from_secs(300)
        );
        assert_eq!(
            JobPriority::Normal.default_timeout(),
            Duration::from_secs(120)
        );
        assert_eq!(JobPriority::Low.default_timeout(), Duration::from_secs(60));
        assert_eq!(
            JobPriority::Background.default_timeout(),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn cancel_by_token_removes_matching() {
        let mut queue = vec![make_job("gener8.audio", "gener8"), {
            let mut j = make_job("gener8.audio", "gener8");
            j.cancellation_token = "batch-002".into();
            j
        }];
        let cancelled = cancel_by_token(&mut queue, "batch-001");
        assert_eq!(cancelled, 1);
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].cancellation_token, "batch-002");
    }

    #[test]
    fn cancel_by_applet_removes_all() {
        let mut queue = vec![
            make_job("gener8.audio", "gener8"),
            make_job("gener8.audio", "gener8"),
            {
                let mut j = make_job("gener8.audio", "gener8");
                j.requesting_applet = "1magen".into();
                j
            },
        ];
        let cancelled = cancel_by_applet(&mut queue, "gener8");
        assert_eq!(cancelled, 2);
        assert_eq!(queue.len(), 1);
    }
}
