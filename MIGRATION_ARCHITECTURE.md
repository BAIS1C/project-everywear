# S3 Gener8 → Everywear Platform Migration Architecture

**Version:** 4.0  
**Date:** 2026-05-17 SGT  
**Author:** Systems Migration Architecture (Cowork)  
**Classification:** Engineering Implementation Reference  
**Status:** APPROVED — All decisions resolved, all corrections applied  
**Revision note:** v4 incorporates 25 engineering corrections addressing IPC security, VRAM lifecycle, job queue safety, sidecar sandboxing, cross-platform paths, and runtime discovery refinements.

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Model storage path | Cross-platform: `~/.everywear/models/` on all OSes. Mac version planned. Single `everywear_paths` module as source of truth. |
| 2 | Tier reconciler authority | Per-applet (existing pattern preserved). Shell acts as sync broker + launch gate. Defense-in-depth: shell prevents launching unentitled applets; applets enforce module-level gates internally. |
| 3 | ACE-Step sidecar protocol | Bundled inside Gener8 applet. Free-tier features web-gated at Hub level. OS provides engine infra per VRAM and tier capability. |
| 4 | ffmpeg/dependency bootstrap | Per-applet (current pattern continues). Zendit dependency framework coming; no shell-level abstraction now. |
| 5 | Engine registration | Runtime discovery. Applets advertise capabilities on IPC connect via `AdvertiseCapabilities`. Shell builds registry dynamically. Zero shell recompilation for future engines. |
| 6 | CreatorStudio LLM + training | Stays inside Gener8. Style Forge has singular UI. Gener8 handles music LoRA training. Visual LoRA training added later via Osiris AI toolkit (Z-Image, LTX, Wan). |
| 7 | Auth integration | Minimal lift: S3 Studio already has Everywear IDs baked in. Tier-sync endpoint already exists. |
| 8 | Model loading boundary | Shell provisions (download, verify, provide paths, allocate VRAM budget). Applets load models into their own process/GPU context. Shell's authority = availability + VRAM allocation, not the `load_model()` call. |

---

## Document Conventions

- **Source** = `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s-gener8\` (standalone S3 Gener8 Tauri app)
- **Target** = `C:\Users\MAG MSI\Project Everywear\` (Everywear OS monorepo)
- All file paths relative to their respective repository root unless full path given
- Cross-platform canonical paths via `everywear_paths` module (see Phase 0.6)
- Risk levels: LOW (no production impact), MEDIUM (degraded feature possible), HIGH (data loss or broken builds), CRITICAL (user-facing regression)

---

## Module Boundary Table

**Distribution model:** Everywear is the single user-facing platform entry point,
similar to a launcher/package manager, while applets remain separately managed
runtime packages. The shell downloads, installs, updates, discovers, gates, and
launches applet packages; applets expose signed runtime capabilities back to the
shell so cross-applet workflows can compose those engines.

| Named Thing | Classification | Binary? | IPC Boundary? | Own Manifest? | Notes |
|---|---|---|---|---|---|
| **Everywear Shell** | Platform Shell | YES (sole platform binary) | Owns all IPC | N/A | GPU detection, VRAM scheduling, engine registry, auth, launcher, entitlement gate. Cross-platform (Windows + Mac). |
| **Gener8** | Creative Media Applet | YES (applet binary) | YES (applet-ipc to shell) | `applets/gener8/applet.toml` | Primary product workspace. Contains all creative modules. Bundles ACE-Step sidecar. Handles music + visual LoRA training. |
| **1magen** | Image Engine Applet | YES (applet binary) | YES (applet-ipc to shell) | `applets/1magen/applet.toml` | Distinct model stack (diffusion-rs, Z-Image GGUF). Separate VRAM profile. |
| **3nvizen** | Video Engine Applet | YES (applet binary) | YES (applet-ipc to shell) | `applets/3nvizen/applet.toml` | Distinct model stack (LTX/Wan via sandboxed Python sidecar). Separate VRAM profile. |
| **Kasai Local** | Agentic Engine Applet | YES (applet binary) | YES (applet-ipc to shell) | `applets/kasai/applet.toml` | Full orchestrator + agentic model + harness. Kasai Lite = same binary, tier-gated feature subset. |
| **AI Director** | Gener8 Product Module | NO | Internal to Gener8 | N/A | Orchestration layer. Shot planning. Submits jobs to shell engine router. |
| **Style Forge** | Gener8 Product Module | NO | Internal to Gener8 | N/A | Singular UI. LoRA/style patch management. Training stays in Gener8. |
| **DAW** | Gener8 Runtime Module | NO | Internal to Gener8 | N/A | Multi-track transport, mixer, project state. |
| **Osiris AI Toolkit** | Future Engine Applet | YES (when built) | YES | TBD | Visual LoRA training (Z-Image, LTX, Wan). Separate binary for GPU training isolation. |

**Decision rule for separate binary:** Only create a separate applet binary when the module has a distinct model stack requiring independent VRAM residency, independent release cadence, or crash isolation from the parent process.

---

## Architectural Spine: Contract Definitions

### Contract 0: IPC Envelope + Authentication

All IPC messages use a common envelope. No raw Command/Response on the wire.

```rust
// crates/applet-ipc/src/envelope.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcEnvelope {
    pub id: String,             // UUID v4 for correlation
    pub seq: u64,              // Monotonic sequence number per direction
    pub source: IpcSource,     // Who sent this
    pub kind: IpcKind,         // What type of message
    pub payload: serde_json::Value,
    pub hmac: Option<String>,  // HMAC-SHA256 for authenticated messages (TierSync, first connect)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcSource {
    Shell,
    Applet { applet_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcKind {
    Command,
    Response,
    Event,    // Heartbeats, job results, status updates
}
```

**Authentication at spawn time:**
```rust
// Shell generates before spawning applet:
let ipc_secret = uuid::Uuid::new_v4().to_string();
child.env("EVERYWEAR_IPC_SECRET", &ipc_secret);

// Applet's first message MUST include HMAC:
// hmac_sha256(secret, serialized_payload_bytes)
// Shell verifies before accepting any subsequent messages.
// After handshake, HMAC is optional on regular messages (performance),
// but REQUIRED on TierSync and any privilege-changing commands.
```

**Signed TierSync (integrity protection against local IPC injection):**
```rust
CommandKind::TierSync {
    tier: String,
    exp: Option<i64>,
    signature: String,  // HMAC-SHA256("tier:exp", ipc_secret)
}
// Applet verifies signature before accepting tier state change.
// Prevents local privilege escalation via IPC injection.
```

---

### Contract 1: Engine Registry (Runtime Discovery)

The shell maintains a registry of callable generation engines. Engines are NOT hardcoded. Each applet advertises capabilities upon IPC connection. Shell builds registry dynamically.

**Discovery protocol:**
1. Shell launches applet binary (path resolved via manifest or env override)
2. Applet connects IPC, authenticates with HMAC
3. Applet sends `AdvertiseCapabilities` event
4. Shell validates schema, adds to registry, sets availability = Ready
5. On disconnect/crash: shell removes from registry, marks Unavailable
6. On reconnect: applet re-advertises (full state reconciliation)

**Why runtime discovery:** Future engines (Osiris AI toolkit, LTX LoRA trainer, community plugins) require zero shell recompilation. New applet connects, advertises, shell routes to it.

```rust
// platform/everywear-os/src-tauri/src/engine_registry.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineEntry {
    pub engine_id: String,
    pub applet_id: String,
    pub capabilities: Vec<String>,
    pub input_schemas: HashMap<String, serde_json::Value>,
    pub output_schemas: HashMap<String, serde_json::Value>,
    pub vram_requirement_mb: u32,
    pub availability: EngineAvailability,
    pub lifecycle: EngineLifecycle,
    pub registered_at: u64,  // Unix epoch millis (no chrono in registry)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EngineAvailability {
    Ready,
    Loading,
    Unavailable,
    NotInstalled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EngineLifecycle {
    Idle,
    Warm,
    Generating,
    Unloading,
}

impl EngineRegistry {
    pub fn register(&mut self, entry: EngineEntry) { ... }
    pub fn unregister(&mut self, engine_id: &str) { ... }
    pub fn find_by_capability(&self, capability: &str) -> Vec<&EngineEntry> { ... }

    /// Called when applet IPC disconnects. Removes all engines owned by that applet.
    pub fn purge_applet(&mut self, applet_id: &str) {
        self.engines.retain(|_, e| e.applet_id != applet_id);
    }
}
```

---

### Contract 2: ShotPlan (AI Director Output)

AI Director (a module inside Gener8) produces this schema. The key design: shots are categorized as **cuts** (need fresh keyframes from 1magen) or **continuations** (use end-frame of previous video segment as init).

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotPlan {
    pub plan_id: String,
    pub project_id: String,
    pub source_audio: AudioSource,
    pub style_pack: String,
    pub shots: Vec<Shot>,
    pub render_sequence: Vec<RenderStep>,  // Engine-grouped, not shot-sequential
    pub plan_status: PlanStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shot {
    pub shot_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub image_prompt: String,
    pub video_prompt: String,
    pub shot_type: String,
    pub reference_tags: Vec<String>,
    pub required_engines: Vec<String>,
    pub init_source: InitSource,  // How this shot gets its init frame
    pub generated_asset_refs: AssetRefs,
    pub render_status: RenderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitSource {
    /// Fresh keyframe from 1magen (scene change / cut shot)
    KeyframeGenerated,
    /// End frame of the previous shot's video segment (continuation)
    PreviousShotEndFrame { previous_shot_id: String },
    /// User-provided reference image
    UserProvided { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderStep {
    pub shot_id: String,
    pub asset_type: String,       // "keyframe" or "video"
    pub engine_id: String,        // which engine handles this
    pub depends_on: Option<String>, // job_id this step waits for
}
```

**Render sequence construction (AI Director responsibility):**

1. Identify all **cut shots** (shots where `init_source = KeyframeGenerated`)
2. Group all cut-shot keyframes first (single 1magen load)
3. Then all video segments in timeline order (single 3nvizen load)
4. Continuation shots skip 1magen entirely; their init is the end-frame of the previous 3nvizen output

**Example:** 5-shot plan with cuts at shots 1 and 4:
```
render_sequence:
  - shot-001:keyframe (1magen)   ← cut
  - shot-004:keyframe (1magen)   ← cut
  - shot-001:video (3nvizen, init=shot-001:keyframe)
  - shot-002:video (3nvizen, init=shot-001:video end-frame)  ← continuation
  - shot-003:video (3nvizen, init=shot-002:video end-frame)  ← continuation
  - shot-004:video (3nvizen, init=shot-004:keyframe)         ← cut
  - shot-005:video (3nvizen, init=shot-004:video end-frame)  ← continuation
```

Result: 2 model loads total (1magen once, 3nvizen once), regardless of shot count. Only cut shots generate keyframes.

---

### Contract 3: Engine Job

How applets submit work to engines through the shell's router. **Event-driven results, not blocking request-response.**

```rust
// platform/everywear-os/src-tauri/src/engine_router.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineJob {
    pub job_id: String,
    pub requesting_applet: String,
    pub requesting_module: String,
    pub engine_id: String,
    pub capability: String,
    pub input_payload: serde_json::Value,   // Small params only
    pub input_files: Vec<FileRef>,          // Large binary data via filesystem
    pub output_target: PathBuf,
    pub priority: JobPriority,
    pub vram_policy: VramPolicy,
    pub cancellation_token: String,         // Correlation ID for batch cancel
    pub plan_ref: Option<PlanRef>,
    pub timeout_ms: Option<u64>,            // Per-job timeout; None = use priority default
}

/// Large file references passed via filesystem, not JSON channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRef {
    pub role: String,        // "source_image", "init_frame", "audio_stem"
    pub path: PathBuf,       // Must be in ~/.everywear/staging/<job_id>/
    pub mime: String,        // "image/png", "audio/wav"
    pub sha256: String,      // Integrity check
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPriority {
    High,       // Timeout: 300s
    Normal,     // Timeout: 120s
    Low,        // Timeout: 60s
    Background, // Timeout: 30s
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VramPolicy {
    Exclusive,       // DEFAULT: Purge active engine before loading
    WarmIfLoaded,    // Use if already warm, skip if not
    Preemptive,      // Can interrupt lower-priority jobs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanRef {
    pub plan_id: String,
    pub shot_id: String,
    pub asset_type: String,
}
```

**Atomic plan submission (not fire-and-forget loop):**
```rust
// Applet submits entire plan atomically:
CommandKind::SubmitPlan { plan: serde_json::Value }
// Shell enqueues all jobs or rejects entirely.
// This gives shell the full dependency graph for scheduling optimization.

// Individual job submission still available for ad-hoc work:
CommandKind::SubmitJob { job: serde_json::Value }
```

**Event-driven results (no blocking waits):**
```rust
// Submit returns immediately. Caller tracks status via events.
pub async fn submit_job(ipc: &IpcChannel, job: EngineJob) -> Result<String> {
    let envelope = IpcEnvelope::event(IpcSource::Applet { applet_id: "gener8".into() }, 
        CommandKind::SubmitJob { job: serde_json::to_value(&job)? });
    ipc.send(envelope).await?;
    Ok(job.job_id)  // Results arrive asynchronously as events
}

// Results arrive as IPC events, not blocking responses:
IpcKind::Event => match payload {
    EventKind::JobComplete { job_id, result } => { ... }
    EventKind::JobFailed { job_id, error } => { ... }
    EventKind::JobProgress { job_id, percent } => { ... }
}
```

**Path sandboxing (shell validates before routing):**
```rust
fn validate_output_target(target: &Path, applet_id: &str) -> Result<PathBuf> {
    let canonical = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());
    let allowed_base = everywear_paths::data_dir(applet_id);
    
    if canonical.starts_with(&allowed_base) {
        Ok(canonical)
    } else {
        Err(anyhow!("output_target {} outside allowed directory {}", 
            canonical.display(), allowed_base.display()))
    }
}

fn validate_input_files(files: &[FileRef], job_id: &str) -> Result<()> {
    let staging = everywear_paths::staging_dir().join(job_id);
    for f in files {
        let canonical = f.path.canonicalize()?;
        if !canonical.starts_with(&staging) && !canonical.starts_with(everywear_paths::models_dir()) {
            return Err(anyhow!("input file {} outside allowed paths", canonical.display()));
        }
        // Verify integrity
        let actual_hash = sha256_file(&canonical)?;
        if actual_hash != f.sha256 {
            return Err(anyhow!("input file {} hash mismatch", f.path.display()));
        }
    }
    Ok(())
}
```

**Job routing flow (revised):**
1. Applet submits `SubmitJob` or `SubmitPlan` (event, non-blocking)
2. Shell validates: engine exists in registry, tier entitlement OK, output_target sandboxed, input_files verified
3. Shell enqueues with timeout derived from priority
4. Shell checks VRAM scheduler for engine availability
5. If engine not loaded: shell provisions models (download/verify if needed), sends `StartInference` with paths, waits for applet to load into its own GPU context
6. Shell sends `Warmup { capability }` -> applet runs dummy inference for CUDA kernel compilation
7. Shell forwards `ExecuteJob` to engine applet
8. Engine applet loads model (in its own process), executes, writes to `output_target`
9. Shell receives result, relays `JobComplete` event to requesting applet
10. Requesting applet updates internal state asynchronously

**Deadlock prevention:**
- Applet disconnect -> shell cancels ALL queued jobs with that `requesting_applet`
- `SubmitPlan` is atomic: all-or-nothing enqueue
- Job timeout: jobs waiting longer than priority threshold auto-fail with `JobFailed { error: "queue_timeout" }`
- Shell never waits on an applet for a response during routing (event-driven, non-blocking)

---

### Contract 4: VRAM Scheduling

**The VramScheduler wraps existing primitives. It does NOT introduce parallel enums.**

```rust
// platform/everywear-os/src-tauri/src/vram_scheduler.rs

use crate::budget::{VramBudget, PurgePolicy};
use crate::gpu::SystemGpuState;

pub struct VramScheduler {
    budget: VramBudget,              // Existing, already works
    policy: PurgePolicy,             // Existing, already tier-derived
    active_engine: Option<ActiveEngine>,
    job_queue: Vec<QueuedJob>,
    heartbeats: HashMap<String, AppletConnection>,
}

impl VramScheduler {
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

    pub fn can_load(&self, vram_mb: u32) -> bool {
        self.budget.available() >= vram_mb
    }

    pub fn request_load(&self, engine_id: &str, vram_mb: u32) -> LoadDecision {
        match self.policy {
            PurgePolicy::Exclusive => {
                if let Some(ref active) = self.active_engine {
                    if active.engine_id == engine_id {
                        LoadDecision::AlreadyLoaded
                    } else {
                        LoadDecision::MustUnloadFirst { applet_id: active.applet_id.clone() }
                    }
                } else {
                    LoadDecision::Proceed
                }
            }
            PurgePolicy::WarmSwitch => {
                if self.budget.available() >= vram_mb {
                    LoadDecision::Proceed
                } else if let Some(ref active) = self.active_engine {
                    LoadDecision::MustUnloadFirst { applet_id: active.applet_id.clone() }
                } else {
                    LoadDecision::InsufficientVram
                }
            }
        }
    }
}

pub enum LoadDecision {
    Proceed,
    AlreadyLoaded,
    MustUnloadFirst { applet_id: String },
    InsufficientVram,
}

#[derive(Debug, Clone)]
pub struct ActiveEngine {
    pub engine_id: String,
    pub applet_id: String,
    pub vram_allocated_mb: u32,
    pub loaded_at: std::time::Instant,
    pub last_job_at: std::time::Instant,
    pub lifecycle: EngineLifecycle,
}

pub struct QueuedJob {
    pub job: EngineJob,
    pub submitted_at: std::time::Instant,
    pub timeout: Duration,  // Derived from job.priority
}
```

**Heartbeat protocol:**
```rust
pub struct AppletConnection {
    pub applet_id: String,
    pub last_heartbeat: std::time::Instant,
    pub heartbeat_interval: Duration,  // 5s
    pub max_missed: u32,               // 3
    pub probe_sent: bool,
}

// Applet sends every 5 seconds:
IpcEnvelope { kind: IpcKind::Event, payload: json!("heartbeat") }

// Shell detection logic (runs on tick):
fn check_heartbeats(&mut self) {
    let now = Instant::now();
    for conn in self.heartbeats.values_mut() {
        let elapsed = now - conn.last_heartbeat;
        let threshold = conn.heartbeat_interval * conn.max_missed; // 15s

        if elapsed > threshold && !conn.probe_sent {
            // Send Ping probe, wait 5s
            self.send_ping(&conn.applet_id);
            conn.probe_sent = true;
        } else if elapsed > threshold + Duration::from_secs(5) && conn.probe_sent {
            // No response to probe: kill, reclaim VRAM, purge from registry
            self.kill_applet(&conn.applet_id);
        }
    }
}
```

**Unload timeout (scaled, graceful escalation):**
```rust
fn unload_timeout_for(vram_mb: u32) -> Duration {
    // Scale: 6GB = 30s, 12GB = 45s, 16GB+ = 60s
    let base = 30;
    let extra = (vram_mb.saturating_sub(6144) / 2048) * 5;
    Duration::from_secs((base + extra).min(60) as u64)
}

async fn unload_engine(&self, applet_id: &str, vram_mb: u32) -> Result<()> {
    let timeout = unload_timeout_for(vram_mb);
    
    // Step 1: Send UnloadModel command
    self.send_command(applet_id, CommandKind::UnloadModel).await?;
    
    // Step 2: Wait for ack within timeout
    match tokio::time::timeout(timeout, self.wait_for_unload_ack(applet_id)).await {
        Ok(_) => return Ok(()),
        Err(_) => {}
    }
    
    // Step 3: Graceful signal (CTRL_BREAK on Windows, SIGINT on Unix)
    self.signal_graceful(applet_id);
    tokio::time::sleep(Duration::from_secs(10)).await;
    
    // Step 4: SIGTERM equivalent
    self.signal_terminate(applet_id);
    tokio::time::sleep(Duration::from_secs(10)).await;
    
    // Step 5: Force kill
    self.force_kill(applet_id);
    
    // Step 6: Post-kill GPU health check via NVML
    self.verify_gpu_health().await?;
    
    Ok(())
}
```

**NVML post-purge verification (capped polling):**
```rust
async fn verify_gpu_health(&self) -> Result<()> {
    // Poll 3 times at 500ms intervals, then proceed regardless
    for i in 0..3 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let vram_free = nvml::get_free_vram_mb()?;
        if vram_free >= self.budget.expected_free() {
            return Ok(());
        }
    }
    // VRAM not fully reclaimed after 1.5s — log warning, proceed anyway.
    // Final verification: if next engine OOMs on load, THEN we know purge failed.
    tracing::warn!("VRAM not fully reclaimed after purge; proceeding optimistically");
    Ok(())
}
```

**Model warmup after load:**
```rust
// After applet confirms model loaded, shell sends warmup before real jobs:
CommandKind::Warmup {
    capability: String,  // e.g., "txt2img"
    // Applet runs dummy inference at minimal resolution to trigger
    // CUDA kernel compilation and memory pattern setup.
    // Adds ~5-10s to load but first real job runs at full speed.
}
```

**Scheduling behaviour:**

| Condition | Action |
|-----------|--------|
| Active engine = requested engine | Execute immediately (warm hit, skip warmup) |
| Active engine != requested, policy = Exclusive | Unload (graceful escalation) -> provision -> applet loads -> warmup -> execute |
| Active engine != requested, policy = Cohabit, VRAM sufficient | Provision -> applet loads alongside -> warmup -> execute |
| Active engine != requested, policy = Cohabit, VRAM insufficient | Fall back to Exclusive |
| Job cancelled via cancellation_token | Cancel in-queue + forward CancelJob to active engine |
| Applet disconnect (heartbeat timeout) | Kill process, reclaim VRAM, purge from registry, cancel all owned jobs |
| Job timeout exceeded | Fail with `JobFailed { error: "queue_timeout" }`, advance queue |
| Engine applet crashes | Mark unavailable, cancel owned jobs, advance queue |
| Sequential plan (render_sequence) | Respect engine grouping: all 1magen keyframes first, then all 3nvizen video |
| Shell crash | Applets detect IPC loss -> 10s timer -> unload models -> exit (self-shutdown safety net) |

---

## Corrected Execution Model: AI Director Pipeline

```
+----------------------------------------------------------+
|  GENER8 APPLET (single binary, bundled ACE-Step sidecar) |
|                                                          |
|  +------------------+    +---------------------------+   |
|  |  Library/DAW     |    |   AI Director Module      |   |
|  |  (track state)   |--->|   - beat analysis         |   |
|  |                  |    |   - lyric alignment        |   |
|  +------------------+    |   - shot planning (LLM)   |   |
|                          |   - prompt expansion      |   |
|                          +-------------+-------------+   |
|                                        |                 |
|                                        | ShotPlan with   |
|                                        | InitSource per  |
|                                        | shot (cut vs    |
|                                        | continuation)   |
|                                        v                 |
|  +------------------------------------------------+     |
|  |  Engine Client Module                          |     |
|  |  Submits SubmitPlan to shell (atomic, async)   |     |
|  |  Receives JobComplete/JobFailed as events      |     |
|  +-------------------------+----------------------+     |
+-----------------------------|----------------------------+
                              | IPC Event: SubmitPlan
                              v
+----------------------------------------------------------+
|  EVERYWEAR SHELL                                         |
|                                                          |
|  +--------------+  +--------------+  +--------------+   |
|  | Engine       |  | VRAM         |  | Job          |   |
|  | Registry     |  | Scheduler    |  | Queue        |   |
|  | (runtime     |  | (wraps       |  | (atomic      |   |
|  |  discovered) |  |  VramBudget  |  |  plans,      |   |
|  |             |  |  + PurgePolicy)|  |  timeouts)  |   |
|  +------+------+  +------+-------+  +------+-------+   |
|         |                 |                  |           |
|  +------+-----------------+------------------+------+   |
|  |               Entitlement Gate                   |   |
|  |  (bundle manifest -> product tier -> launch OK?) |   |
|  +------+-------------------------------------------+   |
|         |                                               |
|  +------+------------------------------------------+    |
|  | Path Sandbox | File Ref Validation | HMAC Auth  |    |
|  +------+------+------+---------------+------+-----+    |
|         |              |                     |          |
+---------+--------------+---------------------+----------+
          |              |                     |
   +------v------+ +----v--------+ +----------v----+
   | 1MAGEN      | | 3NVIZEN     | | GENER8        |
   | (advertise, | | (advertise, | | (receives     |
   |  load model | |  load model | |  JobComplete/ |
   |  IN OWN GPU | |  IN OWN GPU | |  JobFailed    |
   |  context,   | |  context,   | |  events)      |
   |  warmup,    | |  warmup,    | |               |
   |  execute)   | |  execute)   | |               |
   +------+------+ +------+------+ +---------------+
          |               |
          | output_target | output_target
          v               v
   +-------------------------------------+
   | ~/.everywear/data/<applet_id>/      |
   | (path-sandboxed per applet)         |
   +-------------------------------------+
```

Step-by-step:
1. User creates/imports track in Gener8 (library/DAW module)
2. User opens AI Director (product module inside Gener8 UI)
3. AI Director analyses track: beats (aubio-rs, local), waveform, optional lyric alignment
4. If Director LLM needed: Gener8 submits job requiring `kasai.planning` engine
5. Shell checks entitlement (Creator Studio tier?), VRAM, provisions model path
6. Kasai applet loads LLM in its own GPU context, warms up, executes plan generation
7. AI Director receives plan result via JobComplete event
8. AI Director identifies cuts vs continuations, groups keyframes by engine
9. Gener8's engine_client submits `SubmitPlan` (atomic) to shell
10. Shell processes: provisions 1magen models -> 1magen loads + warms up -> all keyframes execute -> unload
11. Shell provisions 3nvizen -> loads + warms up -> all video segments in timeline order -> unload
12. Each job completion arrives as async event -> Gener8 updates ShotPlan + timeline
13. Continuation shots use end-frame of previous video; no redundant 1magen calls

---

## Tier Enforcement: Defense in Depth

```
+-------------------+     +-------------------+     +-------------------+
|  HUB (Supabase)   |     |  SHELL            |     |  APPLET           |
|                   |     |                   |     |                   |
|  Source of truth  |---->|  Sync broker      |---->|  Module gates     |
|  for product tier |     |  + Launch gate    |     |  + Reconciler     |
|                   |     |                   |     |                   |
|  Writes tier to   |     |  Holds bundle     |     |  Receives signed  |
|  user record      |     |  manifest with    |     |  TierSync         |
|                   |     |  product-to-      |     |  (HMAC verified)  |
|                   |     |  entitlement map  |     |                   |
|                   |     |                   |     |  Enforces:        |
|                   |     |  Enforces:        |     |  - Feature gates  |
|                   |     |  - Launch gates   |     |  - Model access   |
|                   |     |  - "You cannot    |     |  - Grace window   |
|                   |     |    launch Kasai   |     |  - .disabled/     |
|                   |     |    on Free tier"  |     |    sweep          |
+-------------------+     +-------------------+     +-------------------+
```

Shell holds **bundle manifests** (built at release time) mapping product tiers to applet entitlements:
```toml
# platform/everywear-os/bundles/entitlements.toml
[free]
applets = ["gener8"]
engines = ["gener8.audio"]
features = []

[gener8_pro]
applets = ["gener8", "1magen"]
engines = ["gener8.audio", "1magen.image"]
features = ["style_forge", "stem_studio"]

[creator_studio]
applets = ["gener8", "1magen", "3nvizen", "kasai"]
engines = ["gener8.audio", "1magen.image", "3nvizen.video", "kasai.planning"]
features = ["ai_director", "music_video_studio", "lora_training"]
```

---

## Python Sidecar Security

3nvizen (LTX/Wan) and future Osiris toolkit use Python sidecars via `uv`. These are sandboxed:

**Spawn protocol:**
```rust
fn spawn_python_sidecar(applet_id: &str, script: &Path) -> Result<Child> {
    let sidecar_secret = uuid::Uuid::new_v4().to_string();
    let port = allocate_dynamic_port()?;
    
    let child = Command::new("uv")
        .arg("run").arg(script)
        .env("SIDECAR_PORT", port.to_string())
        .env("SIDECAR_SECRET", &sidecar_secret)  // Auth token for HTTP
        .env("EVERYWEAR_MODELS_DIR", everywear_paths::models_dir())
        .env("EVERYWEAR_OUTPUT_DIR", everywear_paths::data_dir(applet_id))
        // Platform-specific sandboxing:
        // Windows: Job object with restricted DACL
        // Linux: seccomp profile limiting syscalls
        // macOS: sandbox-exec profile
        .spawn()?;
    
    // Log full command line for auditability
    tracing::info!(
        applet_id = applet_id,
        pid = child.id(),
        port = port,
        script = %script.display(),
        "spawned python sidecar"
    );
    
    Ok(child)
}
```

**Filesystem fencing (enforced at OS level):**
- READ: `~/.everywear/models/` only
- WRITE: `~/.everywear/data/<applet_id>/` only
- No network access except localhost (the sidecar HTTP port)
- No access to user home directory, documents, or other applet data

---

## Current State Inventory

### S3 Gener8 (Source)

| Module | File(s) | Classification | Destination |
|--------|---------|----------------|-------------|
| `shim.rs` | axum :3001 | Runtime Module | `applets/gener8/src-tauri/src/shim.rs` |
| `ace_server.rs` | Process mgr | Runtime Module | `applets/gener8/src-tauri/src/ace_server.rs` (bundled, unchanged) |
| `model_downloader.rs` | GGUF fetch | Runtime Module | **REMOVED** (shell provisions via model-manager; resumable downloads) |
| `dependency_bootstrap.rs` | First-run deps | Runtime Module | `applets/gener8/src-tauri/src/dependency_bootstrap.rs` (stays per-applet) |
| `licence.rs` | Tier enum | Runtime Module | **SIMPLIFIED** (shell pushes signed TierSync; applet verifies + enforces gates) |
| `tier_reconciler/` | 5 files | Runtime Module | Stays per-applet. Shell syncs tier; applet reconciles its own models. |
| `ai_director/` | Wire types + commands | Product Module | `applets/gener8/src-tauri/src/ai_director/` |
| `director_lm/` | LLM engine | Runtime Module | `applets/gener8/src-tauri/src/director_lm/` (feature-gated) |
| `beats/` | Beat detection | Shared Runtime | `crates/beats-engine/` (workspace crate) |
| `daw_engine/` | DAW | Runtime Module | `applets/gener8/src-tauri/src/daw_engine/` |
| `settings.rs` | Prefs | Runtime Module | `applets/gener8/src-tauri/src/settings.rs` |
| `storage.rs` | Persistence | Runtime Module | `applets/gener8/src-tauri/src/storage.rs` |
| `library.rs` | CRUD | Runtime Module | `applets/gener8/src-tauri/src/library.rs` |
| `video_encoder.rs` | NVENC | Shared Runtime | `crates/video-encoder/` (workspace crate) |
| `whisper_align.rs` | Lyrics | Runtime Module | `applets/gener8/src-tauri/src/whisper_align.rs` |
| `auth_token.rs` | JWT relay | Runtime Module | **MINIMAL CHANGE** (S3 already has Everywear IDs; point at shell auth context) |
| `uninstall.rs` | Cleanup | Runtime Module | **REMOVED** (shell lifecycle) |
| `style_forge.rs` | LoRA mgmt | Product Module | `applets/gener8/src-tauri/src/style_forge.rs` (singular UI, training stays here) |

---

## PHASE 0 — PREPARATION

### 0.1 Repository Structure

**Objective:** Create target directories. No code changes.

**Action:**
```bash
mkdir -p applets/gener8/src-tauri/src/{ai_director,director_lm,daw_engine,tier_reconciler,lora_training}
mkdir -p applets/gener8/web
mkdir -p applets/kasai/src-tauri/src
mkdir -p crates/beats-engine/src
mkdir -p crates/video-encoder/src
mkdir -p crates/everywear-paths/src
mkdir -p packages/ewds/src
mkdir -p packages/ewds/icons
mkdir -p platform/everywear-os/bundles
```

**Validation:** `cargo check --workspace` unchanged.

**Risk:** LOW. **Rollback:** `git clean -fd`.

---

### 0.2 EWDS Package Extraction

**Objective:** Extract Everywear Design System from S3 Studio inline copy into `packages/ewds/`.

**Source files:**
- `s3studio-web/src/styles/everywear/` (tokens.css, components.css, icons.css, fonts.css)
- `s3studio-web/index.html` (SVG sprite)
- `s3studio-web/src/shell/ThemeContext.tsx`
- `s3studio-web/tailwind.config.js` (color/font scales)

**Action:**
1. Copy CSS + ThemeContext into `packages/ewds/src/`
2. Extract SVG sprite into `packages/ewds/icons/sprite.svg`
3. Extract Tailwind preset into `packages/ewds/tailwind-preset.js`
4. Create `packages/ewds/package.json` with workspace exports
5. Update S3 Studio imports to consume `@everywear/ewds`
6. Delete `sync.ps1`

**Validation:** `npm run dev` in S3 Studio renders all 3 skins correctly.

**Risk:** MEDIUM. **Rollback:** Restore from git.

---

### 0.3 Dependency Alignment

**Objective:** Resolve version conflicts between S3's Cargo.toml and Everywear workspace.

**New workspace deps to add:** axum 0.8, tower-http 0.6, aubio-rs 0.2, symphonia 0.5, lru 0.12, llama-cpp-2 0.1 (optional), zip 2, indicatif 0.17, hostname 0.4, whoami 1, which 6, tracing-appender 0.2, encoding_rs 0.8, tauri-plugin-updater 2, hmac 0.12, sha2 0.10.

**Cross-platform note:** All path logic via `everywear-paths` crate. No direct `dirs::` calls anywhere else.

**Validation:** `cargo check --workspace` passes.

**Risk:** LOW. **Rollback:** Revert Cargo.toml.

---

### 0.4 IPC Protocol Extension

**Objective:** Implement envelope-based IPC with authentication, event-driven messaging, and runtime discovery commands.

**Create `crates/applet-ipc/src/envelope.rs`** (Contract 0 types above).

**Extend `crates/applet-ipc/src/protocol.rs`:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum CommandKind {
    // Existing
    UnloadModel,
    Shutdown,
    Ping,

    // Engine discovery (applet -> shell, via Event)
    AdvertiseCapabilities { capabilities: serde_json::Value },
    WithdrawCapabilities { engine_id: String },

    // Job execution (shell -> engine applet)
    ExecuteJob { job: serde_json::Value },
    CancelJob { job_id: String },
    Warmup { capability: String },

    // Job submission (applet -> shell, via Event)
    SubmitJob { job: serde_json::Value },
    SubmitPlan { plan: serde_json::Value },  // Atomic batch

    // Job results (shell -> requesting applet, via Event)
    JobComplete { job_id: String, result: serde_json::Value },
    JobFailed { job_id: String, error: String },
    JobProgress { job_id: String, percent: u8 },

    // Lifecycle
    StartInference { model_paths: Vec<ModelPath> },
    QueryStatus,

    // Auth/tier (shell -> applet, HMAC signed)
    TierSync { tier: String, exp: Option<i64>, signature: String },
    AuthContext { token: String, user_id: String },
}
```

**Validation:** `cargo test -p applet-ipc`. Backward compat: existing 1magen unaffected (old messages still parse via envelope adapter).

**Risk:** MEDIUM (protocol change). **Rollback:** Revert; old protocol still works.

---

### 0.5 Manifest Parser (CRITICAL PATH)

**Objective:** Build `manifest_parser.rs` — currently `[PLANNED]` in WIKI.md, now a Phase 0 blocker.

**The shell needs to parse `applet.toml` before launching any applet** (VRAM check, model provisioning, tier entitlement validation).

**Action:** Create `platform/everywear-os/src-tauri/src/manifest_parser.rs`:
```rust
use std::path::Path;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppletManifest {
    pub applet: AppletMeta,
    pub engines: Option<EngineSection>,
    pub model_groups: Vec<ModelGroup>,
    pub requirements: Option<Requirements>,
}

#[derive(Debug, Deserialize)]
pub struct AppletMeta {
    pub id: String,
    pub name: String,
    pub engine_type: String,
    pub transport: String,
    pub min_vram_mb: u32,
    pub tier_gate: String,
    pub platform: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ModelGroup {
    pub label: String,
    pub min_vram_mb: u32,
    pub tier_gate: Option<String>,
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ModelEntry {
    pub role: String,
    pub filename: String,
    pub url: Option<String>,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub optional: Option<bool>,
}

pub fn parse_manifest(path: &Path) -> Result<AppletManifest> {
    let content = std::fs::read_to_string(path)?;
    Ok(toml::from_str(&content)?)
}
```

**Also update WIKI.md:** Remove `[PLANNED]` tag from `manifest_parser.rs`.

**Validation:** Parse all existing applet.toml files (1magen, gener8). Round-trip test.

**Risk:** LOW (straightforward TOML). **Rollback:** Revert file.

---

### 0.6 Canonical Paths Crate

**Objective:** Single source of truth for all filesystem paths. Prevents `dirs::home_dir()` vs `dirs::data_dir()` split-brain on Windows.

**Create `crates/everywear-paths/src/lib.rs`:**
```rust
use std::path::PathBuf;

/// Root of all Everywear data. ~/.everywear/ on all platforms.
pub fn root() -> PathBuf {
    dirs::home_dir().expect("no home directory").join(".everywear")
}

pub fn models_dir() -> PathBuf { root().join("models") }
pub fn data_dir(applet_id: &str) -> PathBuf { root().join("data").join(applet_id) }
pub fn staging_dir() -> PathBuf { root().join("staging") }
pub fn bin_dir() -> PathBuf { root().join("bin") }
pub fn config_dir() -> PathBuf { root().join("config") }
pub fn logs_dir() -> PathBuf { root().join("logs") }
pub fn migration_dir() -> PathBuf { root().join(".migration") }

/// Ensure all required directories exist.
pub fn ensure_dirs() -> std::io::Result<()> {
    for dir in [root(), models_dir(), staging_dir(), bin_dir(), config_dir(), logs_dir()] {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(())
}
```

**Rule:** No crate in the workspace may call `dirs::home_dir()` or `dirs::data_dir()` directly. All path derivation goes through `everywear-paths`.

**Validation:** `cargo check -p everywear-paths`. Grep workspace for direct `dirs::` usage (should only appear in this crate).

**Risk:** LOW. **Rollback:** Remove crate.

---

### 0.7 Applet Binary Resolution

**Objective:** Shell knows how to find applet binaries across dev and production.

**Add to shell:**
```rust
// platform/everywear-os/src-tauri/src/applet_resolver.rs

fn resolve_applet_binary(applet_id: &str) -> Result<PathBuf> {
    // Tier 1: Production — installer manifest
    if let Ok(manifest_path) = std::env::var("EVERYWEAR_APPLET_MANIFEST") {
        if let Ok(manifest) = parse_installer_manifest(&manifest_path) {
            if let Some(path) = manifest.get_applet_path(applet_id) {
                return Ok(path);
            }
        }
    }
    
    // Tier 2: Development — explicit env override per applet
    let env_key = format!("EVERYWEAR_{}_PATH", applet_id.to_uppercase());
    if let Ok(override_path) = std::env::var(&env_key) {
        return Ok(PathBuf::from(override_path));
    }
    
    // Tier 3: Fallback — relative to shell binary (dev only)
    let shell_dir = std::env::current_exe()?.parent().unwrap().to_path_buf();
    let candidate = shell_dir.join("applets").join(applet_id);
    if candidate.exists() {
        return Ok(candidate);
    }
    
    Err(anyhow!("cannot resolve binary for applet: {}", applet_id))
}
```

**Validation:** Unit test with env var override. Integration: shell resolves and launches 1magen.

**Risk:** LOW.

---

### 0.8 Snapshot Source

**Action:** `git tag migration-source-v1.0.1` in S3 STUDIO repo.

---

## PHASE 1 — SHARED CRATE EXTRACTION

### 1.1 beats-engine Crate

**Objective:** Extract aubio-rs beat detection into workspace crate.

**Source:** `s-gener8/src-tauri/src/beats/{engine.rs, cache.rs, mod.rs}`
**Target:** `crates/beats-engine/src/{engine.rs, cache.rs, lib.rs}`

**Action:** Copy, convert mod.rs to lib.rs, remove Tauri-specific handler. Public API: `analyse(audio_path) -> BeatMap`, `BeatsCache`.

**Validation:** `cargo test -p beats-engine`.

**Risk:** LOW. **Rollback:** Remove crate.

---

### 1.2 video-encoder Crate

**Objective:** Extract NVENC/ffmpeg management into workspace crate.

**Note:** Each applet bundles its own ffmpeg binary (per-applet bootstrap, Zendit later). This crate provides the Rust API only.

**Validation:** `cargo check -p video-encoder`.

**Risk:** LOW.

---

### 1.3 model-manager Enhancement

**Objective:** Add `plan_for_vram()`, resumable downloads, cross-platform paths.

**Key additions:**
```rust
// Resumable downloads via HTTP Range headers
pub async fn download_with_resume(url: &str, target: &Path, expected_sha256: &str) -> Result<()> {
    let part_file = target.with_extension("part");
    let mut start_byte = 0u64;
    
    if part_file.exists() {
        let existing_size = part_file.metadata()?.len();
        // Validate partial file is from same content (check Content-Length header)
        start_byte = existing_size;
    }
    
    let client = reqwest::Client::new();
    let mut req = client.get(url);
    if start_byte > 0 {
        req = req.header("Range", format!("bytes={}-", start_byte));
    }
    
    // Stream to .part file, then verify SHA256, then rename
    // ...
}

// VRAM-appropriate model selection
pub fn plan_for_vram(manifest: &AppletManifest, vram_mb: u32) -> Option<&ModelGroup> {
    manifest.model_groups.iter()
        .filter(|g| g.min_vram_mb <= vram_mb)
        .max_by_key(|g| g.min_vram_mb)
}
```

**All paths via `everywear_paths::models_dir()`** — no direct `dirs::` calls.

**Validation:** `cargo test -p model-manager`. Resumable download test (interrupt + resume). VRAM tier selection test.

**Risk:** LOW.

---

## PHASE 2 — SHELL ENHANCEMENTS

### 2.1 Engine Registry + Router + VRAM Scheduler

**Objective:** Add the three shell modules for runtime-discovered engine routing.

**Implementation status (2026-05-17):** Partially implemented and compiling.
The shell now verifies signed `AdvertiseCapabilities`, registers advertised
engines in `EngineRegistry`, records heartbeat events in `VramScheduler`, and
exposes `submit_engine_job` to dispatch an `EngineJob` as an authenticated
`ExecuteJob` envelope to the currently active applet process. This is the first
real registry-backed dispatch path. Remaining work: multi-applet process table,
non-blocking result relay to requesting applets, queued plan dispatch, entitlement
manifest wiring, and StartInference/Warmup orchestration for cold engines.

**New files in `platform/everywear-os/src-tauri/src/`:**
- `engine_registry.rs` (Contract 1 — dynamic, no hardcoded engines)
- `engine_router.rs` (Contract 3 — atomic plans, event results, path sandbox, file refs)
- `vram_scheduler.rs` (Contract 4 — wraps existing VramBudget + PurgePolicy, heartbeat, scaled timeouts)
- `applet_resolver.rs` (Phase 0.7 — binary lookup)

**Key architectural points:**
- VramScheduler wraps `VramBudget` and `PurgePolicy` (no parallel enums)
- Engine registry starts empty, populated by runtime discovery
- Job results are event-driven (no blocking waits)
- Atomic plan submission (SubmitPlan)
- Job timeouts by priority
- Applet disconnect cancels all owned jobs
- Path sandboxing on all output targets and input files
- Warmup pass after model load, before first real job

**Wire into `AppState`:**
```rust
pub struct AppState {
    // Existing
    pub gpu: Arc<SystemGpuState>,
    pub profile: Arc<Mutex<UserProfile>>,
    pub wallet: Arc<Mutex<WalletState>>,
    // Enhanced
    pub engine_registry: Arc<Mutex<EngineRegistry>>,
    pub engine_router: Arc<Mutex<EngineRouter>>,
    pub vram_scheduler: Arc<Mutex<VramScheduler>>,
    pub entitlements: Arc<EntitlementMap>,  // From bundle manifest
}
```

**Validation:** Unit tests for each module. Integration: mock applet advertises -> registry populated -> submit plan -> router dispatches -> mock returns -> event relayed.

**Risk:** MEDIUM. **Rollback:** Disable router; applets operate standalone.

---

### 2.2 Auth + Entitlement in Shell

**Objective:** Shell provides signed auth context. Defense-in-depth tier enforcement.

**Shell responsibilities:**
- Maintain Supabase session (minimal change; S3 already has Everywear IDs)
- On applet launch: send `AuthContext { token, user_id }` (HMAC signed)
- On tier change: broadcast signed `TierSync` to all connected applets
- **Launch gate:** shell checks entitlement map before spawning applet binary. Free tier cannot launch Kasai. This is NOT permission the applet checks; the shell refuses to spawn it.

**Applet responsibilities:**
- Verify HMAC signature on TierSync before accepting
- Run its own tier_reconciler (grace window, .disabled/ sweep)
- Enforce module-level gates internally (e.g., "Creator Studio features disabled")

**Validation:** Login -> tier propagates (signed). Attempt launch unentitled applet -> shell refuses. Tier downgrade -> signed TierSync -> applet reconciles.

**Risk:** LOW (existing auth, minimal change).

---

## PHASE 3 — GENER8 APPLET BINARY

### 3.1 Create Gener8 Applet (Monolithic Port)

**Objective:** Single Gener8 binary with all creative modules. ACE-Step bundled. Per-applet tier reconciler. Per-applet dependency bootstrap. Event-driven job communication.

**Internal module structure:**
```
applets/gener8/src-tauri/src/
+-- main.rs                    # Entry: IPC connect, authenticate, advertise, start
+-- state.rs                   # AppletState (tier, token, project context)
+-- ipc_handler.rs             # Envelope processing, HMAC verification
+-- shim.rs                    # Axum HTTP server (routes unchanged)
+-- ace_server.rs              # ACE-Step sidecar (bundled, process management)
+-- dependency_bootstrap.rs    # Per-applet ffmpeg/deps (Zendit later)
+-- library.rs                 # Song/playlist CRUD
+-- storage.rs                 # File persistence (via everywear-paths)
+-- settings.rs                # Applet-local preferences
+-- whisper_align.rs           # Lyric alignment
+-- engine_client.rs           # Async job submission + event listener
+-- tier_reconciler/           # Per-applet enforcement (shell syncs, applet enforces)
+-- ai_director/
|   +-- mod.rs                 # ShotPlan types with InitSource (cut vs continuation)
|   +-- shot_planner.rs        # Engine-grouped render sequence construction
+-- director_lm/
|   +-- mod.rs                 # LLM lifecycle (loads in own GPU context)
|   +-- engine.rs              # llama-cpp-2 (feature-gated)
|   +-- prompt.rs              # Templates + JSON repair
+-- daw_engine/
+-- style_forge.rs             # Singular UI. Training stays here.
+-- licensing_gates.rs         # Module-level tier checks (verifies signed tier)
+-- lora_training/             # Music LoRA training (visual via Osiris later)
```

**Key design points (incorporating all corrections):**
- IPC uses envelope with seq numbers and HMAC auth
- TierSync verified via HMAC before acceptance
- Job submission is async (SubmitPlan event, results arrive as events)
- Model loading happens in applet's own GPU context (shell provisions paths only)
- Applet implements self-shutdown on IPC loss (10s timer -> unload -> exit)
- Heartbeat sent every 5s to shell
- Large file payloads via FileRef (staging dir), not base64 in JSON

**Self-shutdown safety net (applet side):**
```rust
async fn ipc_monitor(ipc: &IpcChannel, state: &AppletState) {
    loop {
        if ipc.is_disconnected() {
            tracing::warn!("shell IPC lost, starting 10s shutdown timer");
            tokio::time::sleep(Duration::from_secs(10)).await;
            if ipc.is_disconnected() {
                // Shell hasn't reconnected. Unload and exit.
                ace_server::stop().await;
                director_lm::unload().await;
                std::process::exit(0);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
```

**Risk:** HIGH (largest port). **Rollback:** S3 standalone unchanged.

**Validation:** Full test matrix from v3 plus: HMAC auth handshake, event-driven job flow, self-shutdown on IPC loss, heartbeat visible in shell logs.

---

### 3.2 Gener8 applet.toml Manifest

```toml
[applet]
id = "gener8"
name = "S3 Gener8"
engine_type = "ace-step-sidecar"
transport = "json-rpc-stdin"
min_vram_mb = 6144
tier_gate = "free"
platform = ["windows", "macos"]

[engines]
[[engines.entries]]
engine_id = "gener8.audio"
capabilities = ["text2music", "cover", "extract", "lego", "complete", "reference"]

[[model_groups]]
label = "HiFi"
min_vram_mb = 16384
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q8_0.gguf"
url = "https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main/acestep-v15-xl-sftturbo50-Q8_0.gguf"
size_bytes = 5310000000
sha256 = "ec6bef50f2aec3176aafa4836401394913f567ceb7a4d53a459948a8b5294e51"

[[model_groups]]
label = "Great"
min_vram_mb = 12288
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q6_K.gguf"
size_bytes = 4100000000

[[model_groups]]
label = "Recommended"
min_vram_mb = 8192
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q5_K_M.gguf"
size_bytes = 3700000000

[[model_groups]]
label = "Minimum"
min_vram_mb = 6144
[[model_groups.models]]
role = "dit"
filename = "acestep-v15-xl-base-Q4_K_M.gguf"
size_bytes = 3200000000

[[model_groups]]
label = "Director LLM"
min_vram_mb = 8192
tier_gate = "creator_studio"
[[model_groups.models]]
role = "director_llm"
filename = "qwen3-9b-director-Q8_0.gguf"
size_bytes = 10200000000
optional = true
```

---

### 3.3 Gener8 Frontend Port

Same as v3. Auth change is minimal (S3 already has Everywear IDs).

---

## PHASE 4 — ENGINE APPLET STABILISATION

### 4.1 1magen Engine Discovery + Warmup

**Action:** Add AdvertiseCapabilities + ExecuteJob + Warmup handler. Warmup runs a 64x64 dummy inference to compile CUDA kernels.

**Validation:** Shell discovers engine. Warmup completes. First real job runs at full speed.

---

### 4.2 3nvizen Engine Discovery + Sidecar Sandboxing

**Action:** AdvertiseCapabilities + ExecuteJob + sandboxed Python sidecar (job objects on Windows, seccomp on Linux). Dynamic port + auth token for sidecar HTTP.

**Validation:** Engine discovered. Sidecar cannot write outside allowed paths. Job produces video.

---

### 4.3 Kasai Local Integration

**Objective:** Port from `Project Claude\Kasai-Local` into `applets/kasai/`. Full orchestrator; Kasai Lite = same binary, tier-gated.

**Action:** Copy working codebase. Add IPC handler with AdvertiseCapabilities. Engine ID: `kasai.planning`. Capabilities: `plan`, `expand_prompt`, `classify`, `orchestrate`.

**Note:** Kasai Lite handles retry/recovery for partial plan execution (correction 17). This is deferred until Kasai is integrated.

**Validation:** Shell discovers. Planning capability works. Tier gate: free users cannot launch.

---

## PHASE 5 — DATA MIGRATION + PATHS

### 5.1 Model Storage Migration

**Objective:** Move `%LOCALAPPDATA%\S3-Gener8\models\` to `~/.everywear/models/gener8/`.

All paths via `everywear_paths` module. Mac: no legacy path (fresh install).

**Action:** Detect -> move (same partition) -> SHA256 verify -> symlink old->new -> write receipt to `everywear_paths::migration_dir()`.

**Risk:** HIGH. **Rollback:** Receipt enables restore.

---

### 5.2 Library + Settings Migration

Same as v3. Old files never deleted.

---

## PHASE 6 — PLATFORM POLISH

### 6.1 Updater

Cross-platform (Windows + Mac). Shell manages all applet updates.

### 6.2 Concierge Lazy Loading

Voice assets loaded on-demand at `concierge_start`, not shell init. Dropped from memory after setup completes. No impact on returning-user cold start.

---

## PHASE 7 — CLEANUP + STABILISATION

### 7.1 S3 Standalone Deprecation

Maintenance mode. Final update shows migration prompt. Seamless library continuity.

### 7.2 Symlink + Adapter Cleanup

After user migration confirmed. No fixed calendar.

---

## Implementation Cadence

### Critical Path (48-72 hours focused execution)

| Block | Task | Blocking? | Est. Hours |
|-------|------|-----------|------------|
| A | 0.1 Repo structure | Yes | 0.5 |
| A | 0.3 Dep alignment | Yes | 1 |
| A | 0.4 IPC protocol (envelope + auth) | Yes | 3 |
| A | 0.5 Manifest parser | Yes (gates provisioning) | 2 |
| A | 0.6 Canonical paths crate | Yes | 1 |
| A | 0.7 Applet resolver | Yes | 1 |
| B | 1.1 beats-engine | No | 2 |
| B | 1.2 video-encoder | No | 1 |
| B | 1.3 model-manager (resume + paths) | Yes | 3 |
| C | 2.1 Registry + router + scheduler | Yes | 8 |
| C | 2.2 Auth + entitlement | Yes | 2 |
| D | 3.1 Gener8 applet binary | Yes | 12 |
| D | 3.2 Manifest | Blocks launch | 0.5 |
| D | 3.3 Frontend port | Blocks UI | 4 |
| E | 4.1 1magen discovery + warmup | No | 2 |
| E | 4.2 3nvizen discovery + sandbox | No | 3 |
| E | 4.3 Kasai integration | No | 4 |
| F | 5.1 Model migration | Blocks clean install | 3 |
| F | 5.2 Library migration | Blocks user data | 2 |

**Parallel execution:**
- Block A (foundations): ~8.5 hours
- Blocks B + C in parallel: ~8 hours (C is longer, blocking)
- Block D when C completes: ~16.5 hours
- Blocks E + F in parallel after D: ~5 hours

**Total critical path:** ~38 hours of engineering (increased from 31.5 due to IPC security, manifest parser, paths crate, sidecar sandboxing). Still achievable in 48-72 wall-clock hours with AI-assisted workflow.

### Post-convergence (non-blocking)

| Task | Priority | Notes |
|------|----------|-------|
| 0.2 EWDS extraction | High | Prevents duplication |
| Mac build (Metal) | High | Cross-platform promise |
| Kasai Lite retry/recovery | Medium | Correction 17; orchestrator handles |
| Zendit integration | Medium | Replaces per-applet bootstrap |
| Osiris AI toolkit | Medium | Visual LoRA training |
| Concierge lazy-load | Low | Cold start optimisation |
| Mid-generation cancellation | Low | Requires tokio CancellationToken migration |
| Legacy S3 deprecation | Low | After validation period |

---

## Validation Checkpoints

| CP | Gate | Abort Trigger |
|----|------|---------------|
| 0 | Workspace compiles with all new deps + crates | Compile failure |
| 1 | IPC envelope + HMAC auth handshake works | Auth failure |
| 2 | Manifest parser handles all applet.toml files | Parse error |
| 3 | Shell engine registry accepts runtime advertisements | Registration fails |
| 4 | Entitlement gate blocks unentitled launch | Gate bypass |
| 5 | Gener8 launches, authenticates, advertises, Ping OK | Process crash |
| 6 | Music generation works (ACE-Step sidecar bundled) | Audio failure |
| 7 | AI Director generates ShotPlan with InitSource | Invalid plan |
| 8 | Engine routing: atomic SubmitPlan -> 1magen -> result event | Job stuck |
| 9 | Full pipeline with continuation logic (2 model loads for N shots) | Extra loads |
| 10 | Model migration SHA256 verified + resumable download works | Hash mismatch |
| 11 | Per-applet tier reconciler works with signed TierSync | Signature fail |
| 12 | Heartbeat detection: kill orphan within 20s | Orphan persists |
| 13 | Path sandbox: applet cannot write outside allowed dir | Escape |
| 14 | Python sidecar: cannot access outside fenced dirs | Escape |
| 15 | Applet self-shutdown on shell IPC loss within 15s | Orphan persists |

---

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CUDA build breaks on workspace merge | Medium | High | Feature-gate; CI tests with/without |
| Model corruption during migration | Low | Critical | SHA256 verify; resumable downloads; receipt |
| IPC authentication failure (HMAC) | Low | High | Fallback: reject + log; applet retries handshake |
| Director LLM + ACE-Step VRAM collision | N/A | N/A | **Eliminated**: exclusive scheduling |
| Job queue deadlock | Low | High | Atomic plans; applet-disconnect cleanup; timeouts |
| Force-killed CUDA process poisons GPU | Medium | High | Graceful escalation ladder; NVML health check before next load |
| Python sidecar escape sandbox | Low | Critical | OS-level enforcement (job objects/seccomp); audit logging |
| Large file payload bloats IPC | N/A | N/A | **Eliminated**: FileRef pattern, staging dir |
| Engine advertises wrong capabilities | Low | Medium | Schema validation on AdvertiseCapabilities |
| Shell crash orphans applets | Medium | Medium | Applet self-shutdown on IPC loss (10s timer) |
| Cross-platform path divergence | Low | Medium | **Eliminated**: everywear-paths crate, single source |
| Tier escalation via IPC injection | Low | Critical | HMAC-signed TierSync; verified before acceptance |

---

## Future Engine Roadmap (enabled by runtime discovery)

Adding a new engine requires:
1. Build applet binary
2. Implement IPC: authenticate, AdvertiseCapabilities, ExecuteJob, Warmup, heartbeat
3. Add applet.toml manifest
4. Add to entitlements.toml (tier gating)
5. Ship binary

**No shell recompilation. No protocol changes. No router updates.**

Planned:
- **Osiris AI toolkit** — visual LoRA training (Z-Image, LTX, Wan). Sandboxed Python sidecar.
- **Zendit** — dependency/runtime management. Replaces per-applet bootstrap.
- **Community engines** — plugin system for third-party generation backends.

---

## Appendix A: Partial Plan Recovery (Deferred to Kasai Lite)

When a plan partially executes and fails (e.g., shot 7 of 20 OOMs):
- Shell cancels remaining jobs for that plan
- Gener8 receives JobFailed events for cancelled jobs
- ShotPlan status = `partially_completed`
- **Recovery is orchestrated by Kasai Lite** (not the shell or Gener8):
  - Kasai analyses failure, adjusts prompts/params if needed
  - Kasai re-submits remaining shots as new plan
  - Exponential backoff on repeated failures
  - User notification after N retries

This is deferred until Kasai Local integration is complete (Phase 4.3).

---

## Appendix B: Repo Consolidation Map

| Current Location | Contents | Monorepo Target |
|---|---|---|
| `Project Everywear\` | Platform shell + workspace | **IS the monorepo** |
| `Project Ace\S3 STUDIO\` | Gener8 + S3 web | `applets/gener8/` + EWDS. Archive after migration. |
| `Project Claude\Kasai-Local\` | Orchestrator + harness | `applets/kasai/`. Kasai Lite = tier-gated subset. |
| `Project Mymory\` | Vault + Library handler | `crates/vault/` + `crates/library-store/` (unified asset library) |
| `Project Strands\everywear\` | Browser OS (everywear.id) | `packages/everywear-web/` or stays as thin deploy |
| `Project SON\` | Lysweru proto | **Stays separate** until ready. Consumes Kasai Lite. |

---

*End of document.*
