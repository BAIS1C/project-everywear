use crate::{response_detail_to_json, state::AppState};
use applet_ipc::{CommandKind, ResponseStatus};
use serde::Serialize;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct KasaiChatResponse {
    pub session_id: String,
    pub reply: Option<String>,
    pub status: ChatStatus,
    pub tool_calls_initiated: u64,
    pub first_tool_call_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub enum ChatStatus {
    Streaming,
    Complete,
    ToolExecuting,
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiSlotInfo {
    pub slot_id: String,
    pub model_name: Option<String>,
    pub model_size_gb: Option<f64>,
    pub vram_used_gb: Option<f64>,
    pub status: String,
    pub current_activity: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiStatusResponse {
    pub runtime_status: String,
    pub slots: Vec<KasaiSlotInfo>,
    pub swap_mode: String,
    pub total_vram_gb: f64,
    pub available_vram_gb: f64,
    pub active_session_id: Option<String>,
    pub tool_call_log_size: usize,
}


// CLAUDE_INTERFACE: Updated kasai_forward_chat response
// Command: "kasai_forward_chat"
// Args: { message: string, session_id?: string }
// Returns: KasaiChatResponse { session_id, reply?, status, tool_calls_initiated, first_tool_call_index? }
// Note: status "ToolExecuting" means reply is not final - subscribe to tool-call events for progress
// Error: "KASAI_NOT_ACTIVE" | "KASAI_IPC_UNAVAILABLE" | "KASAI_API_ERROR"
#[tauri::command]
pub async fn kasai_forward_chat(
    state: tauri::State<'_, AppState>,
    message: String,
    session_id: Option<String>,
) -> Result<KasaiChatResponse, String> {
    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some("kasai") {
        return Err("KASAI_NOT_ACTIVE".into());
    }
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let first_candidate = next_kasai_tool_call_index(&state.kasai_tool_calls).await;

    let job = serde_json::json!({
        "job_id": uuid::Uuid::new_v4().to_string(),
        "requesting_applet": "shell",
        "requesting_module": "kasai_shell_proxy",
        "engine_id": "kasai.chat",
        "capability": "chat",
        "input_payload": {
            "message": message.clone(),
            "session_id": session_id.clone(),
        },
        "messages": [
            { "role": "user", "content": message }
        ],
        "session_id": session_id.clone(),
    });

    let response = {
        let mut proc_lock = state.applet_processes.lock().await;
        let applet_proc = proc_lock
            .get_mut("kasai")
            .ok_or_else(|| "KASAI_IPC_UNAVAILABLE".to_string())?;

        applet_proc
            .ipc
            .send_envelope_command(
                CommandKind::ExecuteJob { job },
                std::time::Duration::from_secs(600),
            )
            .await
            .map_err(|error| format!("KASAI_API_ERROR: {error}"))?
    };

    match response.status {
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            let reply = detail
                .get("response")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let (tool_calls_initiated, first_tool_call_index) =
                kasai_tool_call_turn_summary(&state.kasai_tool_calls, &session_id, first_candidate)
                    .await;
            Ok(KasaiChatResponse {
                session_id,
                reply,
                status: ChatStatus::Complete,
                tool_calls_initiated,
                first_tool_call_index,
            })
        }
        ResponseStatus::Error => Err(response.detail.unwrap_or_else(|| "KASAI_API_ERROR".into())),
    }
}

// CLAUDE_INTERFACE: Get Kasai runtime status with slot detail
// Command: "kasai_get_status"
// Args: {}
// Returns: KasaiStatusResponse { runtime_status, slots: KasaiSlotInfo[], swap_mode, total_vram_gb, available_vram_gb, active_session_id, tool_call_log_size }
// KasaiSlotInfo: { slot_id, model_name, model_size_gb, vram_used_gb, status, current_activity, error }
// slot_id values: "orchestrator" | "agent" | "embedder"
// status values: "empty" | "loading" | "loaded" | "unloading" | "error"
// current_activity values: "planning" | "executing_tools" | "auditing" | "idle" | null
// Poll every 3 seconds in SlotStatusPanel
#[tauri::command]
pub async fn kasai_get_status(state: tauri::State<'_, AppState>) -> Result<KasaiStatusResponse, String> {
    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some("kasai") {
        return Ok(empty_kasai_status(&state).await);
    }

    let response = {
        let mut proc_lock = state.applet_processes.lock().await;
        let applet_proc = proc_lock
            .get_mut("kasai")
            .ok_or_else(|| "KASAI_IPC_UNAVAILABLE".to_string())?;

        applet_proc
            .ipc
            .send_envelope_command(CommandKind::QueryStatus, std::time::Duration::from_secs(10))
            .await
            .map_err(|error| format!("KASAI_API_ERROR: {error}"))?
    };

    match response.status {
        ResponseStatus::Ok => {
            let detail = response_detail_to_json(response.detail);
            Ok(kasai_status_from_runtime(&state, detail).await)
        }
        ResponseStatus::Error => Err(response.detail.unwrap_or_else(|| "KASAI_API_ERROR".into())),
    }
}

async fn empty_kasai_status(state: &tauri::State<'_, AppState>) -> KasaiStatusResponse {
    let gpu = state.gpu.lock().await;
    let calls = state.kasai_tool_calls.lock().await;
    KasaiStatusResponse {
        runtime_status: "stopped".into(),
        slots: default_kasai_slots(),
        swap_mode: kasai_swap_mode(gpu.total_vram_mb),
        total_vram_gb: mb_to_gb(gpu.total_vram_mb),
        available_vram_gb: mb_to_gb(gpu.total_free_mb),
        active_session_id: None,
        tool_call_log_size: calls.len(),
    }
}

async fn kasai_status_from_runtime(
    state: &tauri::State<'_, AppState>,
    detail: serde_json::Value,
) -> KasaiStatusResponse {
    let gpu = state.gpu.lock().await;
    let calls = state.kasai_tool_calls.lock().await;
    let runtime_status = detail
        .get("status")
        .and_then(|value| value.as_str())
        .map(runtime_status_label)
        .unwrap_or_else(|| "running".into());
    let slot_values = detail
        .get("slots")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut slots = default_kasai_slots();
    for slot in slot_values {
        if let Some(info) = kasai_slot_from_value(&slot) {
            if let Some(existing) = slots
                .iter_mut()
                .find(|candidate| candidate.slot_id == info.slot_id)
            {
                *existing = info;
            } else {
                slots.push(info);
            }
        }
    }

    KasaiStatusResponse {
        runtime_status,
        slots,
        swap_mode: kasai_swap_mode(gpu.total_vram_mb),
        total_vram_gb: mb_to_gb(gpu.total_vram_mb),
        available_vram_gb: mb_to_gb(gpu.total_free_mb),
        active_session_id: calls
            .last()
            .and_then(|call| call.get("session_id"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        tool_call_log_size: calls.len(),
    }
}

fn default_kasai_slots() -> Vec<KasaiSlotInfo> {
    ["orchestrator", "agent", "embedder"]
        .into_iter()
        .map(|slot_id| KasaiSlotInfo {
            slot_id: slot_id.into(),
            model_name: None,
            model_size_gb: None,
            vram_used_gb: None,
            status: "empty".into(),
            current_activity: None,
            error: None,
        })
        .collect()
}

fn kasai_slot_from_value(value: &serde_json::Value) -> Option<KasaiSlotInfo> {
    let slot_id = value
        .get("slot")
        .and_then(|slot| slot.as_str())
        .map(str::to_string)?;
    let path = value.get("path").and_then(|path| path.as_str());
    let loaded = value
        .get("loaded")
        .and_then(|loaded| loaded.as_bool())
        .unwrap_or(false);
    let size_bytes = value
        .get("size_bytes")
        .and_then(|size| size.as_u64())
        .unwrap_or_default();
    let vram_mb = value
        .get("vram_mb")
        .and_then(|vram| vram.as_u64())
        .unwrap_or_default();

    Some(KasaiSlotInfo {
        slot_id,
        model_name: path.and_then(|path| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        }),
        model_size_gb: (size_bytes > 0).then_some(bytes_to_gb(size_bytes)),
        vram_used_gb: (loaded && vram_mb > 0).then_some(mb_to_gb(vram_mb)),
        status: if loaded { "loaded" } else { "empty" }.into(),
        current_activity: loaded.then_some("idle".into()),
        error: None,
    })
}

fn runtime_status_label(status: &str) -> String {
    match status {
        "models_handed_off" | "warm" | "completed" => "running".into(),
        "waiting_for_models" => "stopped".into(),
        "error" => "error".into(),
        other => other.to_string(),
    }
}

fn kasai_swap_mode(total_vram_mb: u64) -> String {
    if total_vram_mb >= 24_000 {
        "dual_resident".into()
    } else {
        "single_slot".into()
    }
}

fn mb_to_gb(value: u64) -> f64 {
    ((value as f64 / 1024.0) * 100.0).round() / 100.0
}

fn bytes_to_gb(value: u64) -> f64 {
    ((value as f64 / 1_073_741_824.0) * 100.0).round() / 100.0
}

// CLAUDE_INTERFACE: Updated kasai_get_tool_calls response
// Command: "kasai_get_tool_calls"
// Args: { since_index?: number }
// Returns: { calls: ToolCallInfo[], total_count: number }
// Note: ToolCallInfo now includes tool_args (JSON), result (JSON), duration_ms, audit_result
// Error: never, unless state lock is poisoned
#[tauri::command]
pub async fn kasai_get_tool_calls(
    state: tauri::State<'_, AppState>,
    since_index: Option<u64>,
) -> Result<serde_json::Value, String> {
    let calls = state.kasai_tool_calls.lock().await;
    let since = since_index.unwrap_or(0);
    let slice = calls
        .iter()
        .filter(|call| {
            call.get("index")
                .and_then(|value| value.as_u64())
                .map_or(true, |index| index >= since)
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "calls": slice,
        "total_count": calls.len(),
    }))
}

async fn next_kasai_tool_call_index(log: &Arc<Mutex<Vec<serde_json::Value>>>) -> u64 {
    let calls = log.lock().await;
    calls
        .iter()
        .filter_map(|call| call.get("index").and_then(|value| value.as_u64()))
        .max()
        .map(|index| index.saturating_add(1))
        .unwrap_or(0)
}

async fn kasai_tool_call_turn_summary(
    log: &Arc<Mutex<Vec<serde_json::Value>>>,
    session_id: &str,
    first_candidate: u64,
) -> (u64, Option<u64>) {
    let calls = log.lock().await;
    let mut count = 0_u64;
    let mut first: Option<u64> = None;
    for call in calls.iter() {
        let matches_session = call
            .get("session_id")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value == session_id);
        let index = call.get("index").and_then(|value| value.as_u64());
        if matches_session && index.is_some_and(|index| index >= first_candidate) {
            count = count.saturating_add(1);
            first = match (first, index) {
                (Some(current), Some(index)) => Some(current.min(index)),
                (None, Some(index)) => Some(index),
                (existing, None) => existing,
            };
        }
    }
    (count, first)
}


// CLAUDE_INTERFACE: Kasai tool call event (Tauri event, NOT invoke)
// Event: "kasai://tool-call/update"
// Payload: ToolCallInfo { index, session_id, timestamp, tool_name, tool_args, status, result, error, duration_ms, source_slot, audit_result }
// Fired: On every tool execution state transition
// Subscribe: listen("kasai://tool-call/update", handler)
//
// CLAUDE_INTERFACE: Kasai tool call complete event (Tauri event)
// Event: "kasai://tool-call/complete"
// Payload: ToolCallInfo (same shape, status is always terminal)
// Fired: When tool reaches Success/Failed/Timeout
pub(crate) async fn record_kasai_tool_call_update(
    app: &tauri::AppHandle,
    log: &Arc<Mutex<Vec<serde_json::Value>>>,
    tool_call: serde_json::Value,
    complete: bool,
) {
    {
        let mut calls = log.lock().await;
        let index = tool_call.get("index").and_then(|value| value.as_u64());
        if let Some(index) = index {
            if let Some(existing) = calls.iter_mut().find(|call| {
                call.get("index")
                    .and_then(|value| value.as_u64())
                    .is_some_and(|candidate| candidate == index)
            }) {
                *existing = tool_call.clone();
            } else {
                calls.push(tool_call.clone());
            }
        } else {
            calls.push(tool_call.clone());
        }

        calls.sort_by_key(|call| {
            call.get("index")
                .and_then(|value| value.as_u64())
                .unwrap_or(0)
        });
        let overflow = calls.len().saturating_sub(200);
        if overflow > 0 {
            calls.drain(0..overflow);
        }
    }

    let _ = app.emit("kasai://tool-call/update", &tool_call);
    if complete {
        let _ = app.emit("kasai://tool-call/complete", &tool_call);
    }
}

