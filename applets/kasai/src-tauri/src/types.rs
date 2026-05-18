use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotId {
    Orchestrator,
    Agent,
    Embedder,
}

impl SlotId {
    pub fn label(self) -> &'static str {
        match self {
            Self::Orchestrator => "orchestrator",
            Self::Agent => "agent",
            Self::Embedder => "embedder",
        }
    }
}

impl Default for SlotId {
    fn default() -> Self {
        Self::Agent
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSlotStatus {
    pub slot: SlotId,
    pub role: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub vram_mb: u32,
    pub loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub applet_id: String,
    pub engine_id: String,
    pub status: String,
    pub inference_ready: bool,
    pub slots: Vec<ModelSlotStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KasaiJobResult {
    pub status: String,
    pub engine_id: String,
    pub inference_ready: bool,
    pub prompt: Option<String>,
    pub response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_generated: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_second: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_time_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    pub slots: Vec<ModelSlotStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallInfo {
    /// Monotonically increasing log index assigned by the headless runtime.
    #[serde(default)]
    pub index: u64,
    /// Frontend session ID from `kasai_forward_chat`.
    #[serde(default)]
    pub session_id: String,
    /// Unix timestamp in milliseconds.
    #[serde(default)]
    pub timestamp: u64,
    /// "shell_call" | "file_system" | "web_fetch" | compatible aliases.
    #[serde(default)]
    pub tool_name: String,
    /// Exact JSON arguments passed to the tool executor.
    #[serde(default)]
    pub tool_args: serde_json::Value,
    #[serde(default)]
    pub status: ToolCallStatus,
    /// Tool return value when execution succeeded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// Error message when execution failed or timed out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Wall-clock execution duration.
    #[serde(default)]
    pub duration_ms: u64,
    /// Which model slot initiated the call. Usually Agent/Small.
    #[serde(default)]
    pub source_slot: SlotId,
    /// Big-model audit of the tool result, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit_result: Option<AuditOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ToolCallStatus {
    Pending,
    Executing,
    Success,
    Failed,
    Timeout,
}

impl Default for ToolCallStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuditOutcome {
    Approved,
    Rejected,
    Pending,
}
