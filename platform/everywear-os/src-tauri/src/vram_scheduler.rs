//! VRAM Scheduler: wraps existing budget primitives for engine lifecycle.
//!
//! Contract 4 from MIGRATION_ARCHITECTURE.md.
//!
//! CRITICAL: VramScheduler wraps `budget::VramBudget` and `budget::PurgePolicy`
//! via composition. It does NOT introduce parallel enum hierarchies.
//!
//! Responsibilities:
//! - Load/unload decisions based on policy + budget state
//! - Heartbeat monitoring for connected applets
//! - Graceful unload escalation (UnloadModel -> CTRL_BREAK -> SIGTERM -> kill)
//! - NVML post-purge verification
//! - Job queue management with priority-based timeouts

use crate::budget::{PurgePolicy, VramBudget};
use crate::engine_registry::EngineLifecycle;
use crate::engine_router::EngineJob;
use crate::gpu::SystemGpuState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// The VRAM scheduler: owns the budget + policy, tracks active engines
/// and the job queue.
pub struct VramScheduler {
    /// Existing VramBudget (composition, not reimplementation).
    budget: VramBudget,
    /// Existing PurgePolicy (tier-derived).
    policy: PurgePolicy,
    /// Currently loaded engine (if any).
    active_engine: Option<ActiveEngine>,
    /// Queued jobs waiting for engine availability.
    job_queue: Vec<QueuedJob>,
    /// Connected applet heartbeat tracking.
    heartbeats: HashMap<String, AppletConnection>,
}

/// An engine currently loaded in GPU memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveEngine {
    pub engine_id: String,
    pub applet_id: String,
    pub vram_allocated_mb: u32,
    #[serde(skip)]
    pub loaded_at: Option<Instant>,
    #[serde(skip)]
    pub last_job_at: Option<Instant>,
    pub lifecycle: EngineLifecycle,
}

/// A job waiting in the queue.
pub struct QueuedJob {
    pub job: EngineJob,
    pub submitted_at: Instant,
    pub timeout: Duration,
}

/// Decision returned by `request_load`: what the caller should do.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LoadDecision {
    /// VRAM available, proceed to load.
    Proceed,
    /// Requested engine is already loaded and warm.
    AlreadyLoaded,
    /// Must unload the active engine first.
    MustUnloadFirst { applet_id: String },
    /// Not enough VRAM even after unloading.
    InsufficientVram,
}

// ---------------------------------------------------------------------------
// Heartbeat protocol
// ---------------------------------------------------------------------------

/// Tracks an IPC-connected applet for heartbeat monitoring.
pub struct AppletConnection {
    pub applet_id: String,
    pub last_heartbeat: Instant,
    pub heartbeat_interval: Duration,
    pub max_missed: u32,
    pub probe_sent: bool,
}

impl AppletConnection {
    pub fn new(applet_id: &str) -> Self {
        Self {
            applet_id: applet_id.to_string(),
            last_heartbeat: Instant::now(),
            heartbeat_interval: Duration::from_secs(5),
            max_missed: 3,
            probe_sent: false,
        }
    }

    /// Threshold before declaring an applet dead: interval * max_missed.
    pub fn death_threshold(&self) -> Duration {
        self.heartbeat_interval * self.max_missed
    }
}

// ---------------------------------------------------------------------------
// Unload timeout escalation
// ---------------------------------------------------------------------------

/// Compute unload timeout scaled by VRAM allocation.
/// 6GB = 30s, 12GB = 45s, 16GB+ = 60s (capped).
pub fn unload_timeout_for(vram_mb: u32) -> Duration {
    let base: u32 = 30;
    let extra = (vram_mb.saturating_sub(6144) / 2048) * 5;
    Duration::from_secs((base + extra).min(60) as u64)
}

/// Steps in the graceful unload escalation sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnloadStep {
    /// Step 1: send UnloadModel command via IPC.
    SendUnloadCommand,
    /// Step 2: wait for ack within scaled timeout.
    WaitForAck,
    /// Step 3: graceful signal (CTRL_BREAK on Windows, SIGINT on Unix).
    GracefulSignal,
    /// Step 4: SIGTERM equivalent.
    Terminate,
    /// Step 5: force kill (SIGKILL / TerminateProcess).
    ForceKill,
    /// Step 6: post-kill NVML health check.
    VerifyGpuHealth,
}

// ---------------------------------------------------------------------------
// VramScheduler implementation
// ---------------------------------------------------------------------------

impl VramScheduler {
    /// Construct from live GPU state. Uses existing PurgePolicy::from_tier.
    pub fn from_gpu_state(gpu: &SystemGpuState) -> Self {
        let policy = PurgePolicy::from_tier(gpu.vram_tier);
        Self {
            budget: VramBudget::new(gpu.total_vram_mb),
            policy,
            active_engine: None,
            job_queue: Vec::new(),
            heartbeats: HashMap::new(),
        }
    }

    /// Construct with an existing budget (e.g., when migrating from AppState).
    pub fn with_budget(budget: VramBudget, policy: PurgePolicy) -> Self {
        Self {
            budget,
            policy,
            active_engine: None,
            job_queue: Vec::new(),
            heartbeats: HashMap::new(),
        }
    }

    // ── Budget access (delegated, not reimplemented) ──

    /// Read-only access to the underlying budget.
    pub fn budget(&self) -> &VramBudget {
        &self.budget
    }

    /// Mutable access to the underlying budget.
    pub fn budget_mut(&mut self) -> &mut VramBudget {
        &mut self.budget
    }

    /// Current purge policy.
    pub fn policy(&self) -> PurgePolicy {
        self.policy
    }

    /// Update policy (e.g., if GPU state changes at runtime).
    pub fn set_policy(&mut self, policy: PurgePolicy) {
        self.policy = policy;
    }

    // ── Load decisions ──

    /// Check if a given VRAM amount can fit in current free budget.
    pub fn can_load(&self, vram_mb: u32) -> bool {
        self.budget.free_mb() >= vram_mb as u64
    }

    /// Decide what to do when an engine needs to be loaded.
    pub fn request_load(&self, engine_id: &str, vram_mb: u32) -> LoadDecision {
        match self.policy {
            PurgePolicy::Exclusive => {
                if let Some(ref active) = self.active_engine {
                    if active.engine_id == engine_id {
                        LoadDecision::AlreadyLoaded
                    } else {
                        LoadDecision::MustUnloadFirst {
                            applet_id: active.applet_id.clone(),
                        }
                    }
                } else {
                    LoadDecision::Proceed
                }
            }
            PurgePolicy::PurgePrimary => {
                if let Some(ref active) = self.active_engine {
                    if active.engine_id == engine_id {
                        LoadDecision::AlreadyLoaded
                    } else {
                        // PurgePrimary: unload the active primary, keep aux
                        LoadDecision::MustUnloadFirst {
                            applet_id: active.applet_id.clone(),
                        }
                    }
                } else if self.budget.free_mb() >= vram_mb as u64 {
                    LoadDecision::Proceed
                } else {
                    LoadDecision::InsufficientVram
                }
            }
            PurgePolicy::WarmSwitch => {
                if let Some(ref active) = self.active_engine {
                    if active.engine_id == engine_id {
                        return LoadDecision::AlreadyLoaded;
                    }
                }
                if self.budget.free_mb() >= vram_mb as u64 {
                    LoadDecision::Proceed
                } else if let Some(ref active) = self.active_engine {
                    LoadDecision::MustUnloadFirst {
                        applet_id: active.applet_id.clone(),
                    }
                } else {
                    LoadDecision::InsufficientVram
                }
            }
            PurgePolicy::Lru => {
                if let Some(ref active) = self.active_engine {
                    if active.engine_id == engine_id {
                        return LoadDecision::AlreadyLoaded;
                    }
                }
                if self.budget.free_mb() >= vram_mb as u64 {
                    LoadDecision::Proceed
                } else if let Some(ref active) = self.active_engine {
                    // LRU: evict least recently used
                    LoadDecision::MustUnloadFirst {
                        applet_id: active.applet_id.clone(),
                    }
                } else {
                    LoadDecision::InsufficientVram
                }
            }
        }
    }

    // ── Active engine tracking ──

    /// Record that an engine has been loaded.
    pub fn set_active_engine(&mut self, engine_id: &str, applet_id: &str, vram_mb: u32) {
        let now = Instant::now();
        self.active_engine = Some(ActiveEngine {
            engine_id: engine_id.to_string(),
            applet_id: applet_id.to_string(),
            vram_allocated_mb: vram_mb,
            loaded_at: Some(now),
            last_job_at: Some(now),
            lifecycle: EngineLifecycle::Warm,
        });
        info!(
            engine = engine_id,
            applet = applet_id,
            vram_mb,
            "Active engine set"
        );
    }

    /// Clear the active engine (after unload).
    pub fn clear_active_engine(&mut self) {
        if let Some(ref engine) = self.active_engine {
            info!(
                engine = %engine.engine_id,
                applet = %engine.applet_id,
                "Active engine cleared"
            );
        }
        self.active_engine = None;
    }

    /// Get the active engine (read-only).
    pub fn active_engine(&self) -> Option<&ActiveEngine> {
        self.active_engine.as_ref()
    }

    /// Update lifecycle of the active engine.
    pub fn set_active_lifecycle(&mut self, lifecycle: EngineLifecycle) {
        if let Some(ref mut engine) = self.active_engine {
            engine.lifecycle = lifecycle;
            if lifecycle == EngineLifecycle::Generating {
                engine.last_job_at = Some(Instant::now());
            }
        }
    }

    // ── Job queue ──

    /// Enqueue a job with its resolved timeout.
    pub fn enqueue(&mut self, job: EngineJob, timeout: Duration) {
        info!(
            job_id = %job.job_id,
            engine = %job.engine_id,
            priority = ?job.priority,
            "Job enqueued"
        );
        self.job_queue.push(QueuedJob {
            job,
            submitted_at: Instant::now(),
            timeout,
        });
    }

    /// Dequeue the next job (FIFO within priority tiers).
    /// Returns None if queue is empty.
    pub fn dequeue(&mut self) -> Option<QueuedJob> {
        if self.job_queue.is_empty() {
            return None;
        }
        // Priority ordering: High > Normal > Low > Background
        // Within same priority: FIFO (first submitted wins)
        self.job_queue.sort_by(|a, b| {
            priority_rank(&a.job.priority)
                .cmp(&priority_rank(&b.job.priority))
                .then_with(|| a.submitted_at.cmp(&b.submitted_at))
        });
        Some(self.job_queue.remove(0))
    }

    /// Remove timed-out jobs from the queue. Returns their job_ids.
    pub fn expire_timed_out(&mut self) -> Vec<String> {
        let now = Instant::now();
        let mut expired = Vec::new();
        self.job_queue.retain(|qj| {
            if now.duration_since(qj.submitted_at) > qj.timeout {
                warn!(
                    job_id = %qj.job.job_id,
                    elapsed_ms = now.duration_since(qj.submitted_at).as_millis(),
                    timeout_ms = qj.timeout.as_millis(),
                    "Job expired in queue"
                );
                expired.push(qj.job.job_id.clone());
                false
            } else {
                true
            }
        });
        expired
    }

    /// Queue length.
    pub fn queue_len(&self) -> usize {
        self.job_queue.len()
    }

    /// Cancel all jobs for a disconnected applet.
    pub fn cancel_applet_jobs(&mut self, applet_id: &str) -> usize {
        let before = self.job_queue.len();
        self.job_queue
            .retain(|qj| qj.job.requesting_applet != applet_id);
        let cancelled = before - self.job_queue.len();
        if cancelled > 0 {
            info!(applet = applet_id, cancelled, "Cancelled queued jobs");
        }
        cancelled
    }

    // ── Heartbeat protocol ──

    /// Register a connected applet for heartbeat monitoring.
    pub fn register_connection(&mut self, applet_id: &str) {
        info!(applet = applet_id, "Registering heartbeat connection");
        self.heartbeats
            .insert(applet_id.to_string(), AppletConnection::new(applet_id));
    }

    /// Record a heartbeat from an applet.
    pub fn record_heartbeat(&mut self, applet_id: &str) {
        if let Some(conn) = self.heartbeats.get_mut(applet_id) {
            conn.last_heartbeat = Instant::now();
            conn.probe_sent = false;
        }
    }

    /// Remove an applet from heartbeat tracking.
    pub fn unregister_connection(&mut self, applet_id: &str) {
        self.heartbeats.remove(applet_id);
    }

    /// Check all heartbeats. Returns lists of applets that need probing
    /// and applets that should be killed.
    pub fn check_heartbeats(&mut self) -> HeartbeatCheckResult {
        let now = Instant::now();
        let mut needs_probe = Vec::new();
        let mut needs_kill = Vec::new();

        for conn in self.heartbeats.values_mut() {
            let elapsed = now.duration_since(conn.last_heartbeat);
            let threshold = conn.death_threshold();

            if elapsed > threshold + Duration::from_secs(5) && conn.probe_sent {
                // No response to probe: dead
                needs_kill.push(conn.applet_id.clone());
            } else if elapsed > threshold && !conn.probe_sent {
                // Missed heartbeats, send probe
                conn.probe_sent = true;
                needs_probe.push(conn.applet_id.clone());
            }
        }

        HeartbeatCheckResult {
            needs_probe,
            needs_kill,
        }
    }

    // ── Scheduling table (from architecture doc) ──

    /// Determine the scheduling action for a job given current state.
    pub fn schedule_action(&self, engine_id: &str, vram_mb: u32) -> ScheduleAction {
        let load_decision = self.request_load(engine_id, vram_mb);

        match load_decision {
            LoadDecision::AlreadyLoaded => ScheduleAction::ExecuteImmediate,
            LoadDecision::Proceed => ScheduleAction::ProvisionAndLoad,
            LoadDecision::MustUnloadFirst { applet_id } => {
                ScheduleAction::UnloadThenLoad { applet_id }
            }
            LoadDecision::InsufficientVram => ScheduleAction::Reject {
                reason: "insufficient VRAM even after unloading".into(),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/// Result of a heartbeat check pass.
pub struct HeartbeatCheckResult {
    /// Applets that missed heartbeats; shell should send a Ping probe.
    pub needs_probe: Vec<String>,
    /// Applets that didn't respond to probe; shell should kill and reclaim.
    pub needs_kill: Vec<String>,
}

/// High-level scheduling action the shell should take.
#[derive(Debug, Clone, PartialEq)]
pub enum ScheduleAction {
    /// Engine already warm, execute the job immediately (skip warmup).
    ExecuteImmediate,
    /// No engine loaded, provision models and load.
    ProvisionAndLoad,
    /// Must unload the active engine first, then provision and load.
    UnloadThenLoad { applet_id: String },
    /// Cannot schedule: insufficient VRAM.
    Reject { reason: String },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Priority rank for sorting (lower number = higher priority).
fn priority_rank(p: &crate::engine_router::JobPriority) -> u8 {
    use crate::engine_router::JobPriority;
    match p {
        JobPriority::High => 0,
        JobPriority::Normal => 1,
        JobPriority::Low => 2,
        JobPriority::Background => 3,
    }
}

// ---------------------------------------------------------------------------
// NVML post-purge verification
// ---------------------------------------------------------------------------

/// Poll NVML up to `max_polls` times at `interval`, checking that free VRAM
/// meets the budget's expectation. Returns true if verified, false if timed out.
///
/// Uses `crate::gpu::poll_vram` for live readings and `budget.verify_against_nvml`
/// for drift check (512MB tolerance, matching existing budget.rs logic).
pub async fn verify_gpu_health_after_purge(
    budget: &VramBudget,
    gpu_index: u32,
    max_polls: u32,
    interval: Duration,
) -> bool {
    for i in 0..max_polls {
        tokio::time::sleep(interval).await;
        if let Some((_used, free)) = crate::gpu::poll_vram(gpu_index) {
            if budget.verify_against_nvml(free) {
                info!(
                    poll = i + 1,
                    free_mb = free,
                    budget_free = budget.free_mb(),
                    "NVML post-purge verification passed"
                );
                return true;
            }
        }
    }
    warn!(
        max_polls,
        "NVML post-purge verification timed out; proceeding optimistically"
    );
    false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::PurgePolicy;
    use crate::engine_router::JobPriority;
    use crate::gpu::VramTier;

    fn make_gpu_state(total_vram_mb: u64, tier: VramTier) -> SystemGpuState {
        SystemGpuState {
            gpus: vec![],
            nvml_available: false,
            total_vram_mb,
            total_free_mb: total_vram_mb,
            primary_gpu: Some("Test GPU".into()),
            backend: crate::gpu::ComputeBackend::Cpu {
                has_blas: false,
                ram_mb: 32768,
            },
            vram_tier: tier,
        }
    }

    #[test]
    fn scheduler_wraps_budget() {
        let gpu = make_gpu_state(32768, VramTier::Ultra);
        let sched = VramScheduler::from_gpu_state(&gpu);

        // Budget is the existing VramBudget, not a parallel type
        assert_eq!(sched.budget().total_mb, 32768);
        assert_eq!(sched.budget().free_mb(), 32768);
        assert_eq!(sched.policy(), PurgePolicy::Lru);
    }

    #[test]
    fn exclusive_policy_forces_unload() {
        let gpu = make_gpu_state(8192, VramTier::Minimal);
        let mut sched = VramScheduler::from_gpu_state(&gpu);
        assert_eq!(sched.policy(), PurgePolicy::Exclusive);

        // Load an engine
        sched.set_active_engine("ace-step", "gener8", 4096);

        // Request a different engine: must unload
        let decision = sched.request_load("z-image", 7400);
        assert_eq!(
            decision,
            LoadDecision::MustUnloadFirst {
                applet_id: "gener8".into()
            }
        );
    }

    #[test]
    fn same_engine_returns_already_loaded() {
        let gpu = make_gpu_state(8192, VramTier::Minimal);
        let mut sched = VramScheduler::from_gpu_state(&gpu);
        sched.set_active_engine("ace-step", "gener8", 4096);

        let decision = sched.request_load("ace-step", 4096);
        assert_eq!(decision, LoadDecision::AlreadyLoaded);
    }

    #[test]
    fn warm_switch_can_cohabitate() {
        let gpu = make_gpu_state(16384, VramTier::Standard);
        let mut sched = VramScheduler::from_gpu_state(&gpu);
        assert_eq!(sched.policy(), PurgePolicy::WarmSwitch);

        sched.set_active_engine("ace-step", "gener8", 4096);
        // Budget says 16384 free (allocations tracked separately in budget ledger)
        // WarmSwitch: if budget shows enough free, proceed
        let decision = sched.request_load("z-image", 7400);
        // budget.free_mb() == 16384 (no allocations recorded in budget yet here)
        assert_eq!(decision, LoadDecision::Proceed);
    }

    #[test]
    fn unload_timeout_scales() {
        assert_eq!(unload_timeout_for(6144), Duration::from_secs(30));
        assert_eq!(unload_timeout_for(8192), Duration::from_secs(35));
        assert_eq!(unload_timeout_for(12288), Duration::from_secs(45));
        assert_eq!(unload_timeout_for(16384), Duration::from_secs(55));
        assert_eq!(unload_timeout_for(24576), Duration::from_secs(60)); // capped
        assert_eq!(unload_timeout_for(32768), Duration::from_secs(60)); // capped
    }

    #[test]
    fn schedule_action_maps_correctly() {
        let gpu = make_gpu_state(8192, VramTier::Minimal);
        let sched = VramScheduler::from_gpu_state(&gpu);

        // No active engine, should proceed
        assert_eq!(
            sched.schedule_action("ace-step", 4096),
            ScheduleAction::ProvisionAndLoad
        );
    }

    #[test]
    fn heartbeat_connection_lifecycle() {
        let gpu = make_gpu_state(32768, VramTier::Ultra);
        let mut sched = VramScheduler::from_gpu_state(&gpu);

        sched.register_connection("gener8");
        sched.record_heartbeat("gener8");

        // Immediately after heartbeat, check should find nothing
        let result = sched.check_heartbeats();
        assert!(result.needs_probe.is_empty());
        assert!(result.needs_kill.is_empty());

        sched.unregister_connection("gener8");
    }
}
