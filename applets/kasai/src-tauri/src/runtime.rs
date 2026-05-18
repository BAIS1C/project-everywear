use crate::inference::{ChatMessage as InferenceChatMessage, LoadedModel};
use crate::slot_manager::{
    FileSystemTool, KasaiToolExecutor, ModelSpec, ShellToolRequest, SlotEvent, SlotManager,
    SwapMode, TurnOutcome,
};
use crate::types::{
    AuditOutcome as ToolAuditOutcome, ChatMessage, KasaiJobResult, ModelSlotStatus, RuntimeStatus,
    SlotId, ToolCallStatus,
};
use anyhow::{anyhow, Context, Result};
use applet_ipc::ModelPath;
use model_manager::{LlamaFlags, VramTier};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicU64, Arc};
use tokio::sync::mpsc;

const MIN_MODEL_BYTES: u64 = 50_000_000;

struct ModelSlot {
    slot: SlotId,
    role: String,
    path: PathBuf,
    size_bytes: u64,
    vram_mb: u32,
    loaded: bool,
    /// Whether this model uses Mixture of Experts architecture.
    is_moe: bool,
    /// Lazily initialized inference handle. None until first use.
    engine: Option<Arc<LoadedModel>>,
}

impl ModelSlot {
    fn status(&self) -> ModelSlotStatus {
        ModelSlotStatus {
            slot: self.slot,
            role: self.role.clone(),
            path: self.path.clone(),
            size_bytes: self.size_bytes,
            vram_mb: self.vram_mb,
            loaded: self.loaded,
        }
    }
}

/// Headless Kasai runtime owned by the Everywear shell.
///
/// This layer deliberately avoids standalone Tauri window assumptions. The
/// shell provisions models, launches this backend, then renders Kasai's EWDS
/// frontend inside Everywear OS.
pub struct KasaiRuntime {
    applet_id: String,
    engine_id: String,
    slots: HashMap<SlotId, ModelSlot>,
    /// Detected VRAM tier, used for Five Flags profile selection.
    vram_tier: VramTier,
    /// Big/Small swap orchestrator, built when both Orchestrator + Agent slots
    /// are registered. None when running single-model mode.
    swap_manager: Option<Arc<SlotManager>>,
    /// Sender for SlotEvents emitted by the swap manager. The IPC layer
    /// forwards this stream to the shell as applet events.
    slot_events_tx: Option<mpsc::UnboundedSender<SlotEvent>>,
    /// Sink used by shell-call tools to ask the Everywear shell to execute
    /// privileged commands over the applet IPC channel.
    shell_tool_tx: Option<mpsc::UnboundedSender<ShellToolRequest>>,
    next_tool_call_index: Arc<AtomicU64>,
}

impl KasaiRuntime {
    pub fn new(applet_id: &str, engine_id: &str) -> Self {
        // Detect VRAM tier from env (shell provides this) or default to Ultra
        // for the RTX 5090 dev machine.
        let vram_mb: u32 = std::env::var("EVERYWEAR_VRAM_MB")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(32_000);
        let vram_tier = VramTier::from_vram_mb(vram_mb);
        tracing::info!(vram_mb, tier = vram_tier.label(), "VRAM tier detected");

        let mut runtime = Self {
            applet_id: applet_id.to_string(),
            engine_id: engine_id.to_string(),
            slots: HashMap::new(),
            vram_tier,
            swap_manager: None,
            slot_events_tx: None,
            shell_tool_tx: None,
            next_tool_call_index: Arc::new(AtomicU64::new(0)),
        };
        runtime.refresh_from_env();
        runtime
    }

    pub fn set_shell_tool_sender(&mut self, tx: mpsc::UnboundedSender<ShellToolRequest>) {
        self.shell_tool_tx = Some(tx);
        self.try_build_swap_manager();
    }

    pub fn set_slot_event_sender(&mut self, tx: mpsc::UnboundedSender<SlotEvent>) {
        self.slot_events_tx = Some(tx);
        self.try_build_swap_manager();
    }

    pub fn refresh_from_env(&mut self) {
        self.load_env_slot(
            "EVERYWEAR_MODEL_PRIMARY",
            SlotId::Orchestrator,
            "primary",
            0,
        );
        self.load_env_slot("EVERYWEAR_MODEL_ENCODER", SlotId::Agent, "agent", 0);
        self.load_env_slot("EVERYWEAR_MODEL_EMBEDDER", SlotId::Embedder, "embedder", 0);
        self.load_env_slot("EVERYWEAR_MODEL_VAE", SlotId::Embedder, "embedder", 0);
    }

    pub fn start_inference(&mut self, model_paths: Vec<ModelPath>) -> Result<RuntimeStatus> {
        for model_path in model_paths {
            let slot = slot_for_role(&model_path.role);
            self.register_slot(slot, model_path.role, model_path.path, model_path.vram_mb)?;
        }
        self.try_build_swap_manager();
        Ok(self.status())
    }

    /// If both Orchestrator and Agent slots are registered, construct the
    /// Big/Small SlotManager for multi-model reasoning. Called after slot
    /// registration changes.
    fn try_build_swap_manager(&mut self) {
        let (Some(big_slot), Some(small_slot)) = (
            self.slots.get(&SlotId::Orchestrator),
            self.slots.get(&SlotId::Agent),
        ) else {
            return;
        };

        let big_spec = ModelSpec {
            alias: "big".into(),
            gguf_path: big_slot.path.clone(),
            is_moe: big_slot.is_moe,
            max_tokens: ModelSpec::default_max_tokens(),
            temperature: ModelSpec::default_temperature(),
        };
        let small_spec = ModelSpec {
            alias: "small".into(),
            gguf_path: small_slot.path.clone(),
            is_moe: small_slot.is_moe,
            max_tokens: ModelSpec::default_max_tokens(),
            temperature: ModelSpec::default_temperature(),
        };
        let mode = SwapMode::from_tier(&self.vram_tier);
        let tx = self.slot_events_tx.clone().unwrap_or_else(|| {
            let (tx, _rx) = mpsc::unbounded_channel();
            tx
        });

        tracing::info!(
            swap_mode = ?mode,
            big = %big_spec.gguf_path.display(),
            small = %small_spec.gguf_path.display(),
            "Building Big/Small SlotManager"
        );

        let manager = SlotManager::new(
            big_spec,
            small_spec,
            mode,
            self.vram_tier,
            tx,
            Arc::new(KasaiToolExecutor::new(
                self.shell_tool_tx.clone(),
                FileSystemTool::default_root(),
            )),
            self.next_tool_call_index.clone(),
        );
        self.swap_manager = Some(Arc::new(manager));
    }

    pub fn warmup(&self, capability: &str) -> Result<Value> {
        if !self.inference_ready() {
            return Err(anyhow!(
                "Kasai cannot warm up '{capability}' before an orchestrator model is available"
            ));
        }

        Ok(json!({
            "status": "warm",
            "capability": capability,
            "engine_id": self.engine_id,
            "slots": self.slot_statuses(),
        }))
    }

    pub async fn execute_job(&mut self, job: Value) -> Result<KasaiJobResult> {
        if !self.inference_ready() {
            return Err(anyhow!(
                "Kasai runtime has no orchestrator model path. Shell must provision and hand off models first."
            ));
        }

        let prompt = extract_prompt(&job);
        let output_target = extract_output_target(&job);

        // If the swap manager is wired (both Big + Small registered), try
        // Big/Small routing. Falls through to single-model path on None.
        if let Some(ref manager) = self.swap_manager {
            let messages = build_messages_from_job(&job, prompt.as_deref());
            let system = job.get("system").and_then(Value::as_str).map(String::from);
            let turn_id = extract_session_id(&job)
                .or_else(|| {
                    job.get("job_id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            let outcome = manager
                .route_prompt(turn_id, messages, system)
                .await
                .context("SlotManager route_prompt failed")?;

            let result = match outcome {
                TurnOutcome::BigDirect {
                    response,
                    tokens_generated,
                    tokens_per_second,
                } => KasaiJobResult {
                    status: "completed".to_string(),
                    engine_id: self.engine_id.clone(),
                    inference_ready: true,
                    prompt,
                    response,
                    tokens_generated: Some(tokens_generated),
                    tokens_per_second: Some(tokens_per_second),
                    generation_time_ms: None,
                    tool_calls: None,
                    slots: self.slot_statuses(),
                },
                TurnOutcome::BigSmallBig {
                    big_plan: _,
                    small_log: _,
                    big_audit,
                } => KasaiJobResult {
                    status: "completed".to_string(),
                    engine_id: self.engine_id.clone(),
                    inference_ready: true,
                    prompt,
                    response: big_audit.user_response,
                    tokens_generated: None,
                    tokens_per_second: None,
                    generation_time_ms: None,
                    tool_calls: None,
                    slots: self.slot_statuses(),
                },
            };

            if let Some(target) = output_target {
                write_job_output(&target, &result).await?;
            }
            return Ok(result);
        }

        // Single-model path: Orchestrator only, no swap.
        let max_tokens = job
            .get("max_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(2048) as u32;
        let temperature = job
            .get("temperature")
            .and_then(Value::as_f64)
            .unwrap_or(0.7) as f32;

        let engine = self.ensure_loaded(SlotId::Orchestrator)?;
        let messages = build_messages_from_job(&job, prompt.as_deref());

        let inference_result = engine
            .generate(messages, max_tokens, temperature, None)
            .await
            .context("Inference generation failed")?;

        let response = if inference_result.tool_calls.is_empty() {
            inference_result.content.clone()
        } else {
            format!(
                "{}\n[{} tool call(s) detected]",
                inference_result.content,
                inference_result.tool_calls.len()
            )
        };

        let result = KasaiJobResult {
            status: "completed".to_string(),
            engine_id: self.engine_id.clone(),
            inference_ready: true,
            prompt,
            response,
            tokens_generated: Some(inference_result.tokens_generated),
            tokens_per_second: Some(inference_result.tokens_per_second),
            generation_time_ms: Some(inference_result.generation_time_ms),
            tool_calls: if inference_result.tool_calls.is_empty() {
                None
            } else {
                Some(
                    inference_result
                        .tool_calls
                        .into_iter()
                        .enumerate()
                        .map(|(index, tc)| crate::types::ToolCallInfo {
                            index: index as u64,
                            session_id: extract_session_id(&job).unwrap_or_default(),
                            timestamp: 0,
                            tool_name: tc.function.name,
                            tool_args: serde_json::from_str(&tc.function.arguments)
                                .unwrap_or_default(),
                            status: ToolCallStatus::Pending,
                            result: None,
                            error: None,
                            duration_ms: 0,
                            source_slot: SlotId::Orchestrator,
                            audit_result: Some(ToolAuditOutcome::Pending),
                        })
                        .collect(),
                )
            },
            slots: self.slot_statuses(),
        };

        if let Some(target) = output_target {
            write_job_output(&target, &result).await?;
        }

        Ok(result)
    }

    /// Ensure the model for the given slot is loaded into memory.
    /// Lazy-initializes on first call using Five Flags for the detected VRAM tier.
    fn ensure_loaded(&mut self, slot_id: SlotId) -> Result<Arc<LoadedModel>> {
        let slot = self
            .slots
            .get(&slot_id)
            .ok_or_else(|| anyhow!("Slot {:?} not registered", slot_id))?;

        // Already loaded?
        if let Some(ref engine) = slot.engine {
            return Ok(engine.clone());
        }

        let path = slot.path.clone();
        let is_moe = slot.is_moe;

        // Select Five Flags profile
        let flags = if is_moe {
            LlamaFlags::for_moe_model(&self.vram_tier)
        } else {
            LlamaFlags::for_dense_model(&self.vram_tier)
        };

        tracing::info!(
            slot = slot_id.label(),
            path = %path.display(),
            moe = is_moe,
            tier = self.vram_tier.label(),
            "Loading model with Five Flags"
        );

        let loaded = LoadedModel::load(&path, flags)
            .with_context(|| format!("Failed to load model for slot {:?}", slot_id))?;
        let engine = Arc::new(loaded);

        // Update the slot with the loaded engine
        if let Some(slot) = self.slots.get_mut(&slot_id) {
            slot.engine = Some(engine.clone());
        }

        Ok(engine)
    }

    pub async fn unload(&mut self) -> RuntimeStatus {
        // Unload swap manager first (drops its Arc<LoadedModel> handles)
        if let Some(ref manager) = self.swap_manager {
            manager.unload_all().await;
        }
        self.swap_manager = None;

        for slot in self.slots.values_mut() {
            slot.loaded = false;
            slot.engine = None; // Drop the llama.cpp model handle
        }
        self.slots.clear();
        self.status()
    }

    pub fn status(&self) -> RuntimeStatus {
        let inference_ready = self.inference_ready();
        RuntimeStatus {
            applet_id: self.applet_id.clone(),
            engine_id: self.engine_id.clone(),
            status: if inference_ready {
                "models_handed_off".to_string()
            } else {
                "waiting_for_models".to_string()
            },
            inference_ready,
            slots: self.slot_statuses(),
        }
    }

    fn inference_ready(&self) -> bool {
        self.slots
            .get(&SlotId::Orchestrator)
            .is_some_and(|slot| slot.loaded)
    }

    fn slot_statuses(&self) -> Vec<ModelSlotStatus> {
        let mut slots = self
            .slots
            .values()
            .map(ModelSlot::status)
            .collect::<Vec<_>>();
        slots.sort_by_key(|slot| match slot.slot {
            SlotId::Orchestrator => 0,
            SlotId::Agent => 1,
            SlotId::Embedder => 2,
        });
        slots
    }

    fn load_env_slot(&mut self, env_key: &str, slot: SlotId, role: &str, vram_mb: u32) {
        let Ok(path) = std::env::var(env_key) else {
            return;
        };
        if path.trim().is_empty() {
            return;
        }

        if let Err(error) = self.register_slot(slot, role.to_string(), PathBuf::from(path), vram_mb)
        {
            tracing::warn!(%error, env_key, "Ignoring invalid shell-provided Kasai model path");
        }
    }

    fn register_slot(
        &mut self,
        slot: SlotId,
        role: String,
        path: PathBuf,
        vram_mb: u32,
    ) -> Result<()> {
        let size_bytes = validate_model_file(&path).with_context(|| {
            format!(
                "invalid model path for {}: {}",
                slot.label(),
                path.display()
            )
        })?;

        // Detect MoE by role or filename heuristic (MoE models have "A3B"
        // or similar active-param tags in their names)
        let is_moe = role == "orchestrator"
            && (path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains("A3B") || n.contains("MoE") || n.contains("moe"))
                .unwrap_or(false)
                || size_bytes > 15_000_000_000); // >15GB hints at a large MoE

        tracing::info!(
            slot = slot.label(),
            role,
            path = %path.display(),
            size_bytes,
            is_moe,
            "Kasai accepted shell-provided model path"
        );
        self.slots.insert(
            slot,
            ModelSlot {
                slot,
                role,
                path,
                size_bytes,
                vram_mb,
                loaded: true,
                is_moe,
                engine: None, // Lazy-loaded on first inference
            },
        );
        Ok(())
    }
}

fn validate_model_file(path: &Path) -> Result<u64> {
    let metadata = std::fs::metadata(path)
        .with_context(|| format!("model file does not exist: {}", path.display()))?;
    let size = metadata.len();
    if size < MIN_MODEL_BYTES {
        return Err(anyhow!(
            "model file is too small to be trusted: {} ({} bytes)",
            path.display(),
            size
        ));
    }
    Ok(size)
}

fn slot_for_role(role: &str) -> SlotId {
    match role.to_ascii_lowercase().as_str() {
        "primary" | "orchestrator" | "llm" => SlotId::Orchestrator,
        "encoder" | "agent" | "worker" | "assistant" => SlotId::Agent,
        "embedder" | "embedding" | "vae" => SlotId::Embedder,
        _ => SlotId::Agent,
    }
}

fn extract_prompt(job: &Value) -> Option<String> {
    job.get("prompt")
        .and_then(Value::as_str)
        .or_else(|| job.pointer("/input/prompt").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| {
            job.get("messages")
                .and_then(Value::as_array)
                .and_then(|messages| messages.last())
                .and_then(|last| serde_json::from_value::<ChatMessage>(last.clone()).ok())
                .map(|message| message.content)
        })
}

fn extract_session_id(job: &Value) -> Option<String> {
    job.get("session_id")
        .and_then(Value::as_str)
        .or_else(|| {
            job.pointer("/input_payload/session_id")
                .and_then(Value::as_str)
        })
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn extract_output_target(job: &Value) -> Option<PathBuf> {
    job.get("output_target")
        .and_then(Value::as_str)
        .or_else(|| job.pointer("/output/target").and_then(Value::as_str))
        .map(PathBuf::from)
}

/// Build inference messages from a job payload.
///
/// Supports three job formats:
///   1. `{"messages": [{"role": "...", "content": "..."}]}` - chat format
///   2. `{"prompt": "..."}` or `{"input": {"prompt": "..."}}` - simple prompt
///   3. Fallback: wraps whatever we can find as a user message
fn build_messages_from_job(job: &Value, prompt: Option<&str>) -> Vec<InferenceChatMessage> {
    // Try to parse messages array first
    if let Some(messages) = job.get("messages").and_then(Value::as_array) {
        let parsed: Vec<InferenceChatMessage> = messages
            .iter()
            .filter_map(|m| serde_json::from_value(m.clone()).ok())
            .collect();
        if !parsed.is_empty() {
            return parsed;
        }
    }

    // Fall back to prompt string
    let content = prompt
        .map(String::from)
        .unwrap_or_else(|| "Hello".to_string());

    // Check for system prompt in job
    let mut msgs = Vec::new();
    if let Some(system) = job.get("system").and_then(Value::as_str) {
        msgs.push(InferenceChatMessage {
            role: "system".into(),
            content: system.to_string(),
            tool_calls: None,
            tool_call_id: None,
        });
    }
    msgs.push(InferenceChatMessage {
        role: "user".into(),
        content,
        tool_calls: None,
        tool_call_id: None,
    });
    msgs
}

async fn write_job_output(path: &Path, result: &KasaiJobResult) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let payload = serde_json::to_vec_pretty(result)?;
    tokio::fs::write(path, payload)
        .await
        .with_context(|| format!("failed to write Kasai output to {}", path.display()))
}
