//! `SlotManager`: Big/Small swap orchestration for Kasai's reasoning pattern.
//!
//! Ported from Kasai-Local's `kasai-inference/slot_manager.rs`.
//!
//! State machine:
//!
//!   [Empty] -- ensure_big --> [BigLoaded]
//!   [BigLoaded] -- ensure_small --> [Swapping] -- unload+load --> [SmallLoaded]
//!   [SmallLoaded] -- ensure_big --> [Swapping] -- unload+load --> [BigLoaded]
//!
//! The load-bearing method is `route_prompt`: Big plans the turn, if tools
//! are needed we swap to Small for execution, then swap back to Big for audit.
//!
//! Everywear adaptation notes:
//! - Replaces `LlamaHandle` with `LoadedModel` from inference.rs
//! - Replaces `LocalProvider` with direct `LoadedModel::generate()` calls
//! - Replaces `kasai_api` types with inference.rs types
//! - SlotEvents emitted via `mpsc::UnboundedSender` (IPC relay, not Tauri events)

use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{mpsc, Mutex};
use tracing::{instrument, warn};

use model_manager::{LlamaFlags, VramTier};

use crate::audit::{audit_result, AuditOutcome as BigAuditOutcome, AuditVerdict};
use crate::inference::{ChatMessage, InferenceResult, LoadedModel};
use crate::types::{AuditOutcome as ToolAuditOutcome, SlotId, ToolCallInfo, ToolCallStatus};

// =============================================================================
// Configuration
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpec {
    /// Logical name, e.g. "big" or "small".
    pub alias: String,
    /// GGUF weight file on disk.
    pub gguf_path: PathBuf,
    /// Whether this model uses MoE architecture.
    pub is_moe: bool,
    /// Max tokens for generation.
    pub max_tokens: u32,
    /// Temperature for sampling.
    pub temperature: f32,
}

impl ModelSpec {
    pub fn default_max_tokens() -> u32 {
        4096
    }

    pub fn default_temperature() -> f32 {
        0.7
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SwapMode {
    /// Single-slot: unload one before loading the other. 16GB tier.
    SingleSlot,
    /// Dual-resident: both stay loaded, no swap. 24GB+ tier.
    DualResident,
}

impl SwapMode {
    pub fn from_tier(tier: &VramTier) -> Self {
        match tier {
            VramTier::Ultra => Self::DualResident,
            _ => Self::SingleSlot,
        }
    }
}

// =============================================================================
// Events emitted to the frontend via IPC
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SlotEvent {
    BigLoading {
        spec_alias: String,
    },
    BigReady,
    BigGenerating {
        turn_id: String,
    },
    BigDecidedTools {
        turn_id: String,
        tool_count: usize,
    },
    SwapStarted {
        from: String,
        to: String,
        reason: String,
    },
    SwapCompleted {
        now_active: String,
        ms: u64,
    },
    SmallGenerating {
        turn_id: String,
    },
    SmallToolLoopComplete {
        turn_id: String,
        calls: usize,
    },
    ToolCallUpdate {
        tool_call: ToolCallInfo,
    },
    ToolCallComplete {
        tool_call: ToolCallInfo,
    },
    BigAuditing {
        turn_id: String,
    },
    Done {
        turn_id: String,
        audit: Option<BigAuditOutcome>,
    },
    Error {
        turn_id: String,
        message: String,
    },
}

// =============================================================================
// ToolExecutor trait
// =============================================================================

/// Per-turn handler dispatching tool calls to the local tool registry.
/// Implement this to wire Kasai's tool system.
#[async_trait::async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String>;
}

/// No-op tool executor for when no tools are registered.
pub struct NoOpToolExecutor;

#[async_trait::async_trait]
impl ToolExecutor for NoOpToolExecutor {
    async fn execute(
        &self,
        tool_name: &str,
        _arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String> {
        Err(format!(
            "No tool executor registered; cannot run '{tool_name}'"
        ))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ShellToolRequest {
    pub request_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

/// Dispatches shell-sensitive commands back over the applet IPC event stream.
#[derive(Clone)]
pub struct ShellCallTool {
    tx: mpsc::UnboundedSender<ShellToolRequest>,
}

impl ShellCallTool {
    pub fn new(tx: mpsc::UnboundedSender<ShellToolRequest>) -> Self {
        Self { tx }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ShellCallTool {
    async fn execute(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String> {
        let command = arguments
            .get("command")
            .or_else(|| arguments.get("cmd"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .ok_or_else(|| "shell_call requires a string 'command' or 'cmd' field".to_string())?;
        if command.trim().is_empty() {
            return Err("shell_call command cannot be empty".into());
        }

        let request_id = uuid::Uuid::new_v4().to_string();
        self.tx
            .send(ShellToolRequest {
                request_id: request_id.clone(),
                tool_name: tool_name.to_string(),
                arguments,
            })
            .map_err(|_| "shell IPC tool request channel is closed".to_string())?;

        Ok(json!({
            "status": "submitted_to_shell",
            "request_id": request_id,
            "command": command,
        }))
    }
}

/// Sandboxed local file operations for Small-model tool use.
#[derive(Clone)]
pub struct FileSystemTool {
    sandbox_root: PathBuf,
}

impl FileSystemTool {
    pub fn new(sandbox_root: impl Into<PathBuf>) -> Self {
        Self {
            sandbox_root: sandbox_root.into(),
        }
    }

    pub fn default_root() -> PathBuf {
        std::env::var("EVERYWEAR_KASAI_TOOL_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("everywear-kasai-tools"))
    }

    fn resolve_relative(&self, raw_path: &str) -> std::result::Result<PathBuf, String> {
        let requested = Path::new(raw_path);
        if requested.is_absolute() {
            return Err("filesystem tool paths must be relative to the sandbox root".into());
        }
        if requested.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("filesystem tool path cannot escape the sandbox root".into());
        }
        Ok(self.sandbox_root.join(requested))
    }

    async fn read_file(&self, raw_path: &str) -> std::result::Result<serde_json::Value, String> {
        let path = self.resolve_relative(raw_path)?;
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|error| format!("failed to read '{}': {error}", path.display()))?;
        Ok(json!({
            "path": raw_path,
            "content": content,
        }))
    }

    async fn write_file(
        &self,
        raw_path: &str,
        content: &str,
    ) -> std::result::Result<serde_json::Value, String> {
        let path = self.resolve_relative(raw_path)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("failed to create '{}': {error}", parent.display()))?;
        }
        tokio::fs::write(&path, content)
            .await
            .map_err(|error| format!("failed to write '{}': {error}", path.display()))?;
        Ok(json!({
            "path": raw_path,
            "bytes_written": content.len(),
        }))
    }

    async fn list_dir(&self, raw_path: &str) -> std::result::Result<serde_json::Value, String> {
        let path = self.resolve_relative(raw_path)?;
        let mut entries = tokio::fs::read_dir(&path)
            .await
            .map_err(|error| format!("failed to list '{}': {error}", path.display()))?;
        let mut names = Vec::new();
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("failed to read directory entry: {error}"))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| format!("failed to read metadata: {error}"))?;
            names.push(json!({
                "name": entry.file_name().to_string_lossy(),
                "is_dir": metadata.is_dir(),
                "len": metadata.len(),
            }));
        }
        Ok(json!({
            "path": raw_path,
            "entries": names,
        }))
    }

    async fn stat(&self, raw_path: &str) -> std::result::Result<serde_json::Value, String> {
        let path = self.resolve_relative(raw_path)?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| format!("failed to stat '{}': {error}", path.display()))?;
        Ok(json!({
            "path": raw_path,
            "is_dir": metadata.is_dir(),
            "is_file": metadata.is_file(),
            "len": metadata.len(),
        }))
    }
}

#[async_trait::async_trait]
impl ToolExecutor for FileSystemTool {
    async fn execute(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String> {
        let op = arguments
            .get("op")
            .and_then(|value| value.as_str())
            .unwrap_or(tool_name);
        let path = arguments
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or(".");

        match op {
            "read" | "read_file" | "fs_read" => self.read_file(path).await,
            "write" | "write_file" | "fs_write" => {
                let content = arguments
                    .get("content")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| {
                        "filesystem write requires a string 'content' field".to_string()
                    })?;
                self.write_file(path, content).await
            }
            "list" | "list_dir" | "fs_list" => self.list_dir(path).await,
            "stat" | "fs_stat" => self.stat(path).await,
            _ => Err(format!("unsupported filesystem operation '{op}'")),
        }
    }
}

#[derive(Clone, Default)]
pub struct WebFetchTool;

#[async_trait::async_trait]
impl ToolExecutor for WebFetchTool {
    async fn execute(
        &self,
        _tool_name: &str,
        arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String> {
        let url = arguments
            .get("url")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "web_fetch requires a string 'url' field".to_string())?;
        tracing::info!(%url, "Kasai web_fetch stub invoked");
        Ok(json!({
            "status": "stubbed",
            "url": url,
            "message": "web_fetch is logged but not executed yet",
        }))
    }
}

#[derive(Clone)]
pub struct KasaiToolExecutor {
    shell: Option<ShellCallTool>,
    filesystem: FileSystemTool,
    web_fetch: WebFetchTool,
}

impl KasaiToolExecutor {
    pub fn new(
        shell_tx: Option<mpsc::UnboundedSender<ShellToolRequest>>,
        sandbox_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            shell: shell_tx.map(ShellCallTool::new),
            filesystem: FileSystemTool::new(sandbox_root),
            web_fetch: WebFetchTool,
        }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for KasaiToolExecutor {
    async fn execute(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, String> {
        match tool_name {
            "shell" | "shell_call" | "run_shell" => {
                let Some(shell) = &self.shell else {
                    return Err(
                        "shell_call is unavailable because shell IPC is not connected".into(),
                    );
                };
                shell.execute(tool_name, arguments).await
            }
            "filesystem" | "file_system" | "fs" | "read_file" | "write_file" | "list_dir"
            | "stat" | "fs_read" | "fs_write" | "fs_list" | "fs_stat" => {
                self.filesystem.execute(tool_name, arguments).await
            }
            "web_fetch" | "fetch_url" | "http_get" => {
                self.web_fetch.execute(tool_name, arguments).await
            }
            _ => Err(format!("unknown Kasai tool '{tool_name}'")),
        }
    }
}

// =============================================================================
// SlotManager
// =============================================================================

#[derive(Clone)]
enum Slot {
    Empty,
    BigLoaded(Arc<LoadedModel>),
    SmallLoaded(Arc<LoadedModel>),
    BothLoaded {
        big: Arc<LoadedModel>,
        small: Arc<LoadedModel>,
    },
}

pub struct SlotManager {
    big_spec: Mutex<ModelSpec>,
    small_spec: Mutex<ModelSpec>,
    mode: SwapMode,
    vram_tier: VramTier,
    state: Arc<Mutex<Slot>>,
    events: mpsc::UnboundedSender<SlotEvent>,
    tool_executor: Arc<dyn ToolExecutor>,
    next_tool_call_index: Arc<AtomicU64>,
}

impl SlotManager {
    pub fn new(
        big: ModelSpec,
        small: ModelSpec,
        mode: SwapMode,
        vram_tier: VramTier,
        events: mpsc::UnboundedSender<SlotEvent>,
        tool_executor: Arc<dyn ToolExecutor>,
        next_tool_call_index: Arc<AtomicU64>,
    ) -> Self {
        Self {
            big_spec: Mutex::new(big),
            small_spec: Mutex::new(small),
            mode,
            vram_tier,
            state: Arc::new(Mutex::new(Slot::Empty)),
            events,
            tool_executor,
            next_tool_call_index,
        }
    }

    // ------------------------------------------------------------------------
    // Slot transitions
    // ------------------------------------------------------------------------

    async fn ensure_big(&self) -> Result<Arc<LoadedModel>> {
        let mut s = self.state.lock().await;
        match s.clone() {
            Slot::BigLoaded(h) | Slot::BothLoaded { big: h, .. } => Ok(h),
            Slot::SmallLoaded(_) => {
                let t0 = Instant::now();
                let _ = self.events.send(SlotEvent::SwapStarted {
                    from: "small".into(),
                    to: "big".into(),
                    reason: "reasoning required".into(),
                });
                if matches!(self.mode, SwapMode::SingleSlot) {
                    *s = Slot::Empty;
                }
                let big = self.load_big_locked(&mut s).await?;
                let _ = self.events.send(SlotEvent::SwapCompleted {
                    now_active: "big".into(),
                    ms: t0.elapsed().as_millis() as u64,
                });
                Ok(big)
            }
            Slot::Empty => {
                let alias = self.big_spec.lock().await.alias.clone();
                let _ = self
                    .events
                    .send(SlotEvent::BigLoading { spec_alias: alias });
                let big = self.load_big_locked(&mut s).await?;
                let _ = self.events.send(SlotEvent::BigReady);
                Ok(big)
            }
        }
    }

    async fn ensure_small(&self) -> Result<Arc<LoadedModel>> {
        let mut s = self.state.lock().await;
        match s.clone() {
            Slot::SmallLoaded(h) | Slot::BothLoaded { small: h, .. } => Ok(h),
            Slot::BigLoaded(_) => {
                let t0 = Instant::now();
                let _ = self.events.send(SlotEvent::SwapStarted {
                    from: "big".into(),
                    to: "small".into(),
                    reason: "tool execution".into(),
                });
                if matches!(self.mode, SwapMode::SingleSlot) {
                    *s = Slot::Empty;
                }
                let small = self.load_small_locked(&mut s).await?;
                let _ = self.events.send(SlotEvent::SwapCompleted {
                    now_active: "small".into(),
                    ms: t0.elapsed().as_millis() as u64,
                });
                Ok(small)
            }
            Slot::Empty => self.load_small_locked(&mut s).await,
        }
    }

    async fn load_big_locked(&self, s: &mut Slot) -> Result<Arc<LoadedModel>> {
        let spec = self.big_spec.lock().await.clone();
        let flags = if spec.is_moe {
            LlamaFlags::for_moe_model(&self.vram_tier)
        } else {
            LlamaFlags::for_dense_model(&self.vram_tier)
        };
        let h = Arc::new(
            LoadedModel::load(&spec.gguf_path, flags).context("Failed to load Big model")?,
        );
        *s = match s.clone() {
            Slot::SmallLoaded(small) if matches!(self.mode, SwapMode::DualResident) => {
                Slot::BothLoaded {
                    big: h.clone(),
                    small,
                }
            }
            _ => Slot::BigLoaded(h.clone()),
        };
        Ok(h)
    }

    async fn load_small_locked(&self, s: &mut Slot) -> Result<Arc<LoadedModel>> {
        let spec = self.small_spec.lock().await.clone();
        let flags = if spec.is_moe {
            LlamaFlags::for_moe_model(&self.vram_tier)
        } else {
            LlamaFlags::for_dense_model(&self.vram_tier)
        };
        let h = Arc::new(
            LoadedModel::load(&spec.gguf_path, flags).context("Failed to load Small model")?,
        );
        *s = match s.clone() {
            Slot::BigLoaded(big) if matches!(self.mode, SwapMode::DualResident) => {
                Slot::BothLoaded {
                    big,
                    small: h.clone(),
                }
            }
            _ => Slot::SmallLoaded(h.clone()),
        };
        Ok(h)
    }

    pub async fn unload_all(&self) {
        let mut s = self.state.lock().await;
        *s = Slot::Empty;
    }

    // ------------------------------------------------------------------------
    // Routing: the load-bearing method
    // ------------------------------------------------------------------------

    /// Drive a turn end-to-end. Big plans, swaps to Small if tools are needed,
    /// audits the Small's work, returns the final outcome.
    #[instrument(skip(self, messages), fields(turn_id = %turn_id))]
    pub async fn route_prompt(
        &self,
        turn_id: String,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
    ) -> Result<TurnOutcome> {
        let big_spec = self.big_spec.lock().await.clone();

        // 1. Big plans / responds.
        let big_handle = self.ensure_big().await?;
        let _ = self.events.send(SlotEvent::BigGenerating {
            turn_id: turn_id.clone(),
        });

        let mut big_messages = Vec::new();
        if let Some(ref sys) = system_prompt {
            big_messages.push(ChatMessage {
                role: "system".into(),
                content: sys.clone(),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        big_messages.extend(messages.clone());

        let big_result = big_handle
            .generate(
                big_messages.clone(),
                big_spec.max_tokens,
                big_spec.temperature,
                None,
            )
            .await
            .context("Big model generation failed")?;

        if big_result.tool_calls.is_empty() {
            // Conversational direct: no swap, no audit.
            let _ = self.events.send(SlotEvent::Done {
                turn_id: turn_id.clone(),
                audit: None,
            });
            return Ok(TurnOutcome::BigDirect {
                response: big_result.content,
                tokens_generated: big_result.tokens_generated,
                tokens_per_second: big_result.tokens_per_second,
            });
        }

        let _ = self.events.send(SlotEvent::BigDecidedTools {
            turn_id: turn_id.clone(),
            tool_count: big_result.tool_calls.len(),
        });

        // 2. Swap to Small for tool execution.
        let small_handle = self.ensure_small().await?;
        let small_spec = self.small_spec.lock().await.clone();
        let _ = self.events.send(SlotEvent::SmallGenerating {
            turn_id: turn_id.clone(),
        });

        // 3. Tool loop on Small.
        let small_log = self
            .run_small_tool_loop(
                &small_handle,
                &small_spec,
                &messages,
                &big_result,
                &turn_id,
                system_prompt.as_deref(),
            )
            .await?;

        let _ = self.events.send(SlotEvent::SmallToolLoopComplete {
            turn_id: turn_id.clone(),
            calls: small_log.invocations.len(),
        });

        // 4. Swap back to Big for audit.
        let big_handle = self.ensure_big().await?;
        let _ = self.events.send(SlotEvent::BigAuditing {
            turn_id: turn_id.clone(),
        });

        let audit = audit_result(
            &big_handle,
            &big_spec,
            &messages,
            &big_result.content,
            &small_log,
        )
        .await?;

        let tool_audit = tool_audit_from_big(&audit);
        for mut tool_call in small_log.completed_tool_calls.clone() {
            tool_call.audit_result = Some(tool_audit.clone());
            let _ = self.events.send(SlotEvent::ToolCallUpdate { tool_call });
        }

        let _ = self.events.send(SlotEvent::Done {
            turn_id: turn_id.clone(),
            audit: Some(audit.clone()),
        });

        Ok(TurnOutcome::BigSmallBig {
            big_plan: big_result.content,
            small_log,
            big_audit: audit,
        })
    }

    /// Iteratively feed Small the tool-call -> result loop until Small either
    /// emits no further tool calls or hits a safety cap on iterations.
    async fn run_small_tool_loop(
        &self,
        small: &Arc<LoadedModel>,
        small_spec: &ModelSpec,
        original_messages: &[ChatMessage],
        big_result: &InferenceResult,
        session_id: &str,
        system_prompt: Option<&str>,
    ) -> Result<SmallToolLog> {
        const MAX_ITERATIONS: u32 = 8;
        const TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

        let mut log = SmallToolLog::default();
        let mut working_messages = Vec::new();

        // System prompt if present
        if let Some(sys) = system_prompt {
            working_messages.push(ChatMessage {
                role: "system".into(),
                content: sys.to_string(),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        // Original conversation
        working_messages.extend_from_slice(original_messages);

        // Append Big's plan as an assistant turn so Small sees context
        working_messages.push(ChatMessage {
            role: "assistant".into(),
            content: big_result.content.clone(),
            tool_calls: if big_result.tool_calls.is_empty() {
                None
            } else {
                Some(big_result.tool_calls.clone())
            },
            tool_call_id: None,
        });

        let mut pending_calls = big_result.tool_calls.clone();

        for iteration in 0..MAX_ITERATIONS {
            // Execute every tool call in this batch.
            for tc in &pending_calls {
                let input: serde_json::Value =
                    serde_json::from_str(&tc.function.arguments).unwrap_or_default();
                let index = self.next_tool_call_index.fetch_add(1, Ordering::SeqCst);
                let mut tool_call = ToolCallInfo {
                    index,
                    session_id: session_id.to_string(),
                    timestamp: unix_ms(),
                    tool_name: tc.function.name.clone(),
                    tool_args: input.clone(),
                    status: ToolCallStatus::Pending,
                    result: None,
                    error: None,
                    duration_ms: 0,
                    source_slot: SlotId::Agent,
                    audit_result: Some(ToolAuditOutcome::Pending),
                };
                let _ = self.events.send(SlotEvent::ToolCallUpdate {
                    tool_call: tool_call.clone(),
                });

                tool_call.status = ToolCallStatus::Executing;
                tool_call.timestamp = unix_ms();
                let started = Instant::now();
                let _ = self.events.send(SlotEvent::ToolCallUpdate {
                    tool_call: tool_call.clone(),
                });

                let res = tokio::time::timeout(
                    TOOL_TIMEOUT,
                    self.tool_executor.execute(&tc.function.name, input.clone()),
                )
                .await;
                let (body, is_error) = match res {
                    Ok(Ok(v)) => {
                        tool_call.status = ToolCallStatus::Success;
                        tool_call.result = Some(v.clone());
                        tool_call.error = None;
                        (
                            serde_json::to_string(&v).unwrap_or_else(|_| "null".into()),
                            false,
                        )
                    }
                    Ok(Err(e)) => {
                        tool_call.status = ToolCallStatus::Failed;
                        tool_call.result = None;
                        tool_call.error = Some(e.clone());
                        (e, true)
                    }
                    Err(_) => {
                        let error = format!(
                            "tool '{}' exceeded {}ms timeout",
                            tc.function.name,
                            TOOL_TIMEOUT.as_millis()
                        );
                        tool_call.status = ToolCallStatus::Timeout;
                        tool_call.result = None;
                        tool_call.error = Some(error.clone());
                        (error, true)
                    }
                };
                tool_call.duration_ms = started.elapsed().as_millis() as u64;
                tool_call.timestamp = unix_ms();
                let _ = self.events.send(SlotEvent::ToolCallUpdate {
                    tool_call: tool_call.clone(),
                });
                let _ = self.events.send(SlotEvent::ToolCallComplete {
                    tool_call: tool_call.clone(),
                });
                log.completed_tool_calls.push(tool_call);
                log.invocations.push(ToolInvocation {
                    iteration,
                    tool_call_index: index,
                    id: tc.id.clone(),
                    name: tc.function.name.clone(),
                    input,
                    output: body.clone(),
                    is_error,
                });

                // Append tool result as a tool message
                working_messages.push(ChatMessage {
                    role: "tool".into(),
                    content: body,
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                });
            }

            // Re-prompt Small with the updated history.
            let next_result = small
                .generate(
                    working_messages.clone(),
                    small_spec.max_tokens,
                    small_spec.temperature,
                    None,
                )
                .await
                .context("Small model generation failed")?;

            // Append Small's response to the transcript
            working_messages.push(ChatMessage {
                role: "assistant".into(),
                content: next_result.content.clone(),
                tool_calls: if next_result.tool_calls.is_empty() {
                    None
                } else {
                    Some(next_result.tool_calls.clone())
                },
                tool_call_id: None,
            });
            log.transcript_texts.push(next_result.content.clone());

            // Look for new tool calls
            if next_result.tool_calls.is_empty() {
                log.terminated_by_small_completion = true;
                break;
            }
            pending_calls = next_result.tool_calls;

            if iteration + 1 == MAX_ITERATIONS {
                warn!("Small tool loop hit MAX_ITERATIONS cap; terminating");
                log.terminated_by_iteration_cap = true;
            }
        }

        Ok(log)
    }
}

// =============================================================================
// Outcome types
// =============================================================================

#[derive(Debug, Clone)]
pub enum TurnOutcome {
    /// No tools needed; Big handled directly.
    BigDirect {
        response: String,
        tokens_generated: u32,
        tokens_per_second: f32,
    },
    /// Tools needed; Big planned, Small executed, Big audited.
    BigSmallBig {
        big_plan: String,
        small_log: SmallToolLog,
        big_audit: BigAuditOutcome,
    },
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SmallToolLog {
    pub invocations: Vec<ToolInvocation>,
    pub completed_tool_calls: Vec<ToolCallInfo>,
    pub transcript_texts: Vec<String>,
    pub terminated_by_small_completion: bool,
    pub terminated_by_iteration_cap: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolInvocation {
    pub iteration: u32,
    pub tool_call_index: u64,
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    pub output: String,
    pub is_error: bool,
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn tool_audit_from_big(audit: &BigAuditOutcome) -> ToolAuditOutcome {
    match audit.verdict {
        AuditVerdict::Pass | AuditVerdict::PassWithCaveat => ToolAuditOutcome::Approved,
        AuditVerdict::Fail => ToolAuditOutcome::Rejected,
        AuditVerdict::Inconclusive => ToolAuditOutcome::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("everywear-kasai-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test root");
        root
    }

    #[tokio::test]
    async fn shell_call_tool_sends_ipc_request() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tool = ShellCallTool::new(tx);

        let result = tool
            .execute("shell_call", json!({"command": "echo", "args": ["hello"]}))
            .await
            .expect("shell call should be accepted");

        assert_eq!(result["status"], "submitted_to_shell");
        assert_eq!(result["command"], "echo");
        let request = rx.recv().await.expect("shell request");
        assert_eq!(request.tool_name, "shell_call");
        assert_eq!(request.arguments["command"], "echo");
    }

    #[tokio::test]
    async fn filesystem_tool_reads_writes_lists_and_blocks_escape() {
        let root = test_root("filesystem");
        let tool = FileSystemTool::new(&root);

        let write = tool
            .execute(
                "filesystem",
                json!({"op": "write", "path": "notes/todo.txt", "content": "ship it"}),
            )
            .await
            .expect("write");
        assert_eq!(write["bytes_written"], 7);

        let read = tool
            .execute(
                "filesystem",
                json!({"op": "read", "path": "notes/todo.txt"}),
            )
            .await
            .expect("read");
        assert_eq!(read["content"], "ship it");

        let listing = tool
            .execute("filesystem", json!({"op": "list", "path": "notes"}))
            .await
            .expect("list");
        assert_eq!(listing["entries"][0]["name"], "todo.txt");

        let escape = tool
            .execute(
                "filesystem",
                json!({"op": "read", "path": "../outside.txt"}),
            )
            .await;
        assert!(escape.is_err());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn web_fetch_tool_returns_logged_stub() {
        let tool = WebFetchTool;
        let result = tool
            .execute("web_fetch", json!({"url": "https://example.com"}))
            .await
            .expect("web fetch stub");

        assert_eq!(result["status"], "stubbed");
        assert_eq!(result["url"], "https://example.com");
    }
}
