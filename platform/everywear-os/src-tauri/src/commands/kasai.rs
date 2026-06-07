use crate::{response_detail_to_json, state::AppState};
use applet_ipc::{CommandKind, ResponseStatus};
use serde::Serialize;
use std::path::{Path, PathBuf};
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

#[derive(Debug, Clone, Serialize)]
pub struct PortableEngineStatus {
    pub gpu: PortableGpuInfo,
    pub tier: String,
    pub loaded_slots: Vec<PortableLoadedSlot>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortableGpuInfo {
    pub name: String,
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortableLoadedSlot {
    pub slot: String,
    pub model_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct KasaiSkill {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub tag: String,
    pub token_cost: u32,
    pub safety_class: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatchedProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub wing: String,
    pub watch_enabled: bool,
    pub structure: WatchedProjectStructure,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatchedProjectStructure {
    pub project_type: String,
    pub docs: Vec<String>,
    pub source_roots: Vec<String>,
    pub package_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MymoryStatus {
    pub root: String,
    pub exists: bool,
    pub wings: Vec<String>,
    pub markdown_files: usize,
    pub memory_layers: Vec<String>,
    pub graph_projection_json: Option<String>,
    pub graph_projection_mermaid: Option<String>,
    pub schema_template: Option<String>,
}

// Portable Kasai UI compatibility command.
//
// The embedded Kasai frontend is shared with Kasai-Local and calls
// `get_engine_status`; Everywear's shell-owned command name is
// `kasai_get_status`. This wrapper keeps the UI portable while preserving the
// shell as owner of GPU state and the IPC bridge.
#[tauri::command]
pub async fn get_engine_status(
    state: tauri::State<'_, AppState>,
) -> Result<PortableEngineStatus, String> {
    let status = query_kasai_status(&state).await?;
    let gpu = state.gpu.lock().await;
    let loaded_slots = status
        .slots
        .into_iter()
        .filter(|slot| slot.status == "loaded")
        .map(|slot| PortableLoadedSlot {
            slot: portable_slot_label(&slot.slot_id).into(),
            model_name: slot
                .model_name
                .unwrap_or_else(|| portable_slot_label(&slot.slot_id).into()),
        })
        .collect();

    Ok(PortableEngineStatus {
        gpu: PortableGpuInfo {
            name: gpu
                .primary_gpu
                .clone()
                .unwrap_or_else(|| "Local compute".into()),
            vram_mb: gpu.total_vram_mb,
        },
        tier: format!("My Mait {}", status.swap_mode),
        loaded_slots,
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, AppState>,
    message: String,
    session_id: Option<String>,
    _skill_id: Option<String>,
) -> Result<String, String> {
    let response = kasai_forward_chat(state, message, session_id).await?;
    Ok(response.reply.unwrap_or_default())
}

#[tauri::command]
pub async fn list_installed_skills() -> Result<Vec<KasaiSkill>, String> {
    let vault = inspect_everywear_vault_status();
    let vault_live = if vault.exists { "live" } else { "error" };
    let mut skills = vec![
        KasaiSkill {
            id: "mymory-recall".into(),
            name: "MyMory Recall".into(),
            path: "mymory://skills/recall".into(),
            icon: "M".into(),
            summary: "Everywear Vault retrieval through the MyMory substrate".into(),
            description:
                "Reads Everywear Vault records through the MyMory-compatible substrate before answering. Reference canon remains separate from the installed user vault."
                    .into(),
            status: vault_live.into(),
            tag: "memory".into(),
            token_cost: 2400,
            safety_class: "ReadOnly".into(),
        },
        KasaiSkill {
            id: "mymory-remember".into(),
            name: "MyMory Remember".into(),
            path: "mymory://skills/remember".into(),
            icon: "M+".into(),
            summary: "Append decisions into Everywear Vault".into(),
            description:
                "Captures durable decisions and session facts into Everywear Vault records without importing a development vault."
                    .into(),
            status: vault_live.into(),
            tag: "memory".into(),
            token_cost: 800,
            safety_class: "Mutation".into(),
        },
        KasaiSkill {
            id: "mymory-graph".into(),
            name: "MyMory Graph".into(),
            path: "mymory://skills/graph".into(),
            icon: "MG".into(),
            summary: "Inspect the Everywear Vault graph projection".into(),
            description:
                "Inspects the MyMory-compatible graph projection inside Everywear Vault when present; graph output is not source of truth."
                    .into(),
            status: if vault.graph_projection_json.is_some() {
                "idle"
            } else {
                "error"
            }
            .into(),
            tag: "memory".into(),
            token_cost: 1200,
            safety_class: "ReadOnly".into(),
        },
        KasaiSkill {
            id: "code-review".into(),
            name: "Code Review".into(),
            path: "everywear://skills/code-review".into(),
            icon: "CR".into(),
            summary: "Review code against Everywear architecture".into(),
            description:
                "Checks implementation changes against the local wiki, vault notes, and module boundaries."
                    .into(),
            status: "idle".into(),
            tag: "dev".into(),
            token_cost: 3200,
            safety_class: "ReadOnly".into(),
        },
    ];
    skills.extend(content_capture_skill_pack());
    skills.extend(discovered_skill_pack());
    skills.sort_by(|a, b| {
        let a_key = skill_sort_key(a);
        let b_key = skill_sort_key(b);
        a_key.cmp(&b_key)
    });
    Ok(skills)
}

fn skill_sort_key(skill: &KasaiSkill) -> (u8, String) {
    let group = match skill.tag.as_str() {
        "memory" => 0,
        "dev" => 1,
        "capture" => 2,
        _ => 3,
    };
    (group, skill.name.to_ascii_lowercase())
}

fn builtin_skill(
    id: &str,
    name: &str,
    icon: &str,
    summary: &str,
    description: &str,
    output_contract: &str,
) -> KasaiSkill {
    KasaiSkill {
        id: id.into(),
        name: name.into(),
        path: format!("builtin://{id}"),
        icon: icon.into(),
        summary: summary.into(),
        description: description.into(),
        status: "idle".into(),
        tag: "capture".into(),
        token_cost: ((description.len() + output_contract.len()) / 4) as u32,
        safety_class: "ReadOnly".into(),
    }
}

fn content_capture_skill_pack() -> Vec<KasaiSkill> {
    vec![
        builtin_skill(
            "capture-yt-executive-summary",
            "YT -> Executive Summary",
            "play",
            "Turn a YouTube video or transcript into a concise executive brief.",
            "Analyze a YouTube video URL or pasted transcript. Extract the thesis, key points, evidence, caveats, notable quotes, and practical takeaways without adding unsupported facts.",
            "Return: thesis, executive summary, key points, evidence and examples, caveats or missing context, action notes, and source gaps.",
        ),
        builtin_skill(
            "capture-yt-to-x-thread",
            "YT -> X Thread",
            "thread",
            "Convert a YouTube video or transcript into a clear X thread draft.",
            "Transform a YouTube video URL or pasted transcript into a concise X thread that preserves the original argument, flags uncertainty, and avoids fake citations.",
            "Return: hook, 6-10 numbered posts, optional quote cards, suggested title, and claims that need source checking.",
        ),
        builtin_skill(
            "capture-yt-to-linkedin",
            "YT -> LinkedIn Post",
            "briefcase",
            "Repurpose a YouTube video or transcript into a professional LinkedIn post.",
            "Convert a YouTube video URL or pasted transcript into a LinkedIn post with a useful business or learning angle. Keep the tone grounded and avoid engagement bait.",
            "Return: post draft, alternate openings, key bullets, useful hashtags, and source gaps.",
        ),
        builtin_skill(
            "capture-article-executive-summary",
            "Article Executive Summary",
            "document",
            "Summarize an article, PDF excerpt, or web page into an executive brief.",
            "Extract and organize important information from pasted article text, a URL, or a PDF excerpt. Separate what the source says from interpretation.",
            "Return: headline, source type, executive summary, key claims, named entities, evidence quality, follow-up questions, and practical implications.",
        ),
        builtin_skill(
            "capture-thread-distiller",
            "Thread Distiller",
            "thread",
            "Distill an X, LinkedIn, Reddit, or comment thread into signal.",
            "Analyze a pasted social thread or comment section. Identify the main argument, strongest replies, disagreement clusters, sentiment, and useful links or entities.",
            "Return: main thesis, consensus points, disagreement map, notable replies, weak claims, entities to research, and a reusable learning note.",
        ),
        builtin_skill(
            "capture-study-pack",
            "Study Pack Generator",
            "book",
            "Turn a video, article, or thread into notes, flashcards, and quiz prompts.",
            "Convert source material into a learning pack for retention. Prefer precise definitions, examples, misconceptions, and review questions over generic summaries.",
            "Return: structured notes, glossary, flashcards, quiz questions with answers, misconceptions, and next resources to look for.",
        ),
    ]
}

fn discovered_skill_pack() -> Vec<KasaiSkill> {
    let mut skills = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (root, tag) in discovered_skill_roots() {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(id) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !seen.insert(id.to_string()) {
                continue;
            }
            if let Some(skill) = skill_from_dir(id, &path, tag) {
                skills.push(skill);
            }
        }
    }
    skills
}

fn discovered_skill_roots() -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Some(repo_root) = repo_root_from_process() {
        roots.push((repo_root.join("skills"), "everywear"));
    }
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        roots.push((
            PathBuf::from(local_appdata)
                .join("Kasai-Local")
                .join("skills"),
            "donor",
        ));
    }
    roots
}

fn repo_root_from_process() -> Option<PathBuf> {
    crate::registry::find_monorepo_root_from_exe().or_else(|| {
        let mut current = std::env::current_dir().ok()?;
        loop {
            if current.join("Cargo.toml").exists() && current.join("applets").is_dir() {
                return Some(current);
            }
            if !current.pop() {
                return None;
            }
        }
    })
}

fn skill_from_dir(id: &str, path: &Path, source_tag: &str) -> Option<KasaiSkill> {
    let manifest_path = path.join("manifest.json");
    let skill_md_path = path.join("SKILL.md");
    if manifest_path.exists() {
        return skill_from_manifest(id, path, &manifest_path, source_tag);
    }
    if skill_md_path.exists() {
        return skill_from_markdown(id, path, &skill_md_path, source_tag);
    }
    Some(KasaiSkill {
        id: id.into(),
        name: humanize_slug(id),
        path: path.display().to_string(),
        icon: "file".into(),
        summary: "Imported skill folder".into(),
        description: "Imported skill folder".into(),
        status: "idle".into(),
        tag: source_tag.into(),
        token_cost: 0,
        safety_class: "ReadOnly".into(),
    })
}

fn skill_from_manifest(
    id: &str,
    path: &Path,
    manifest_path: &Path,
    source_tag: &str,
) -> Option<KasaiSkill> {
    let content = std::fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    let description = value
        .get("description")
        .and_then(|value| value.as_str())
        .or_else(|| value.get("summary").and_then(|value| value.as_str()))
        .unwrap_or("Imported skill")
        .trim();
    let name = value
        .get("name")
        .and_then(|value| value.as_str())
        .map(humanize_slug)
        .unwrap_or_else(|| humanize_slug(id));
    let icon = value
        .get("icon")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| auto_icon(&name));
    let tag = value
        .get("tag")
        .and_then(|value| value.as_str())
        .unwrap_or(source_tag);
    Some(KasaiSkill {
        id: id.into(),
        name,
        path: path.display().to_string(),
        icon,
        summary: truncate_summary(description),
        description: description.into(),
        status: "idle".into(),
        tag: tag.into(),
        token_cost: skill_token_cost(path),
        safety_class: "ReadOnly".into(),
    })
}

fn skill_from_markdown(
    id: &str,
    path: &Path,
    skill_md_path: &Path,
    source_tag: &str,
) -> Option<KasaiSkill> {
    let content = std::fs::read_to_string(skill_md_path).ok()?;
    let frontmatter = markdown_frontmatter(&content);
    let name = frontmatter
        .as_ref()
        .and_then(|frontmatter| frontmatter_value(frontmatter, "name"))
        .or_else(|| markdown_heading(&content))
        .unwrap_or_else(|| humanize_slug(id));
    let description = frontmatter
        .as_ref()
        .and_then(|frontmatter| frontmatter_value(frontmatter, "description"))
        .or_else(|| first_markdown_sentence(&content))
        .unwrap_or_else(|| "Imported skill".into());
    let icon = frontmatter
        .as_ref()
        .and_then(|frontmatter| frontmatter_value(frontmatter, "icon"))
        .unwrap_or_else(|| auto_icon(&name));
    let tag = frontmatter
        .as_ref()
        .and_then(|frontmatter| frontmatter_value(frontmatter, "tag"))
        .unwrap_or_else(|| source_tag.into());
    Some(KasaiSkill {
        id: id.into(),
        name,
        path: path.display().to_string(),
        icon,
        summary: truncate_summary(&description),
        description,
        status: "idle".into(),
        tag,
        token_cost: (content.len() / 4) as u32,
        safety_class: "ReadOnly".into(),
    })
}

fn markdown_frontmatter(content: &str) -> Option<String> {
    let rest = content.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    Some(rest[..end].to_string())
}

fn frontmatter_value(frontmatter: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    frontmatter.lines().find_map(|line| {
        let trimmed = line.trim();
        let value = trimmed.strip_prefix(&prefix)?.trim();
        Some(value.trim_matches('"').trim_matches('\'').to_string())
    })
}

fn markdown_heading(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        line.trim()
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn first_markdown_sentence(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("---")
            || trimmed.starts_with('#')
            || trimmed.starts_with("name:")
            || trimmed.starts_with("description:")
        {
            return None;
        }
        Some(trimmed.to_string())
    })
}

fn truncate_summary(value: &str) -> String {
    const LIMIT: usize = 118;
    let trimmed = value.trim();
    if trimmed.len() <= LIMIT {
        return trimmed.into();
    }
    format!(
        "{}...",
        trimmed.chars().take(LIMIT).collect::<String>().trim()
    )
}

fn skill_token_cost(path: &Path) -> u32 {
    let skill_md_path = path.join("SKILL.md");
    std::fs::metadata(skill_md_path)
        .map(|metadata| (metadata.len() / 4) as u32)
        .unwrap_or(0)
}

fn humanize_slug(value: &str) -> String {
    value
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn auto_icon(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("memory") || lower.contains("mymory") || lower.contains("vault") {
        "memory".into()
    } else if lower.contains("graph") {
        "graph".into()
    } else if lower.contains("code") || lower.contains("review") {
        "code".into()
    } else if lower.contains("video") || lower.contains("youtube") {
        "play".into()
    } else if lower.contains("thread") {
        "thread".into()
    } else if lower.contains("study") || lower.contains("teacher") {
        "book".into()
    } else if lower.contains("file") {
        "file".into()
    } else {
        "skill".into()
    }
}

#[tauri::command]
pub async fn list_watched_projects() -> Result<Vec<WatchedProject>, String> {
    let mut projects = vec![WatchedProject {
        id: "proj-everywear".into(),
        name: "Project Everywear".into(),
        path: crate::registry::find_monorepo_root_from_exe()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
            .display()
            .to_string(),
        wing: "ace".into(),
        watch_enabled: true,
        structure: WatchedProjectStructure {
            project_type: "monorepo".into(),
            docs: vec!["CONTEXT.md".into(), "WIKI.md".into()],
            source_roots: vec![
                "platform".into(),
                "applets".into(),
                "crates".into(),
                "packages".into(),
            ],
            package_files: vec!["Cargo.toml".into(), "package.json".into()],
        },
    }];

    let vault_root = everywear_paths::vault_root();
    projects.push(WatchedProject {
        id: "proj-everywear-vault".into(),
        name: "Everywear Vault".into(),
        path: vault_root.display().to_string(),
        wing: "vault".into(),
        watch_enabled: vault_root.exists(),
        structure: WatchedProjectStructure {
            project_type: "everywear-vault".into(),
            docs: vec!["_templates".into()],
            source_roots: vec![
                "Audio".into(),
                "Images".into(),
                "Videos".into(),
                "Contexts".into(),
                "Conversations".into(),
                "Maits".into(),
                "Shards".into(),
            ],
            package_files: vec![],
        },
    });

    Ok(projects)
}

#[tauri::command]
pub async fn get_mymory_status() -> Result<MymoryStatus, String> {
    // Compatibility command name for the Kasai donor UI. In Everywear this
    // reports the installed Everywear Vault, powered by MyMory-compatible
    // records, not Sean's development Project Mymory vault.
    Ok(inspect_everywear_vault_status())
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

    // Inject the shell's detected runtime state as the system prompt so chat
    // answers cannot contradict the side rail. Without this, the model answers
    // from base weights and claims to be a cloud service with no local models
    // or vault. (Handoff 2026-06-07: My Mait local contract.)
    let system_prompt = {
        let (gpu_name, vram_mb) = {
            let gpu = state.gpu.lock().await;
            (
                gpu.primary_gpu
                    .clone()
                    .unwrap_or_else(|| "local GPU".into()),
                gpu.total_vram_mb,
            )
        };
        let loaded_models = query_kasai_status(&state)
            .await
            .map(|status| {
                status
                    .slots
                    .into_iter()
                    .filter(|slot| slot.status == "loaded")
                    .filter_map(|slot| {
                        slot.model_name.map(|name| {
                            format!("{name} ({})", portable_slot_label(&slot.slot_id))
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let vault = inspect_everywear_vault_status();
        build_my_mait_system_prompt(&gpu_name, vram_mb, &loaded_models, &vault)
    };

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
        "system": system_prompt,
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
pub async fn kasai_get_status(
    state: tauri::State<'_, AppState>,
) -> Result<KasaiStatusResponse, String> {
    query_kasai_status(&state).await
}

async fn query_kasai_status(
    state: &tauri::State<'_, AppState>,
) -> Result<KasaiStatusResponse, String> {
    let active = state.active_applet.lock().await.clone();
    if active.as_deref() != Some("kasai") {
        return Ok(empty_kasai_status(state).await);
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
            Ok(kasai_status_from_runtime(state, detail).await)
        }
        ResponseStatus::Error => Err(response.detail.unwrap_or_else(|| "KASAI_API_ERROR".into())),
    }
}

fn build_my_mait_system_prompt(
    gpu_name: &str,
    vram_mb: u64,
    loaded_models: &[String],
    vault: &MymoryStatus,
) -> String {
    let models_line = if loaded_models.is_empty() {
        "Local models are managed by the Everywear shell and load on demand.".to_string()
    } else {
        format!("Loaded local models: {}.", loaded_models.join(", "))
    };
    let vault_line = if vault.exists {
        let sections = if vault.wings.is_empty() {
            "no sections yet".to_string()
        } else {
            vault.wings.join(", ")
        };
        format!(
            "The Everywear Vault is installed at {} (sections: {sections}; {} notes).",
            vault.root, vault.markdown_files
        )
    } else {
        "The Everywear Vault is not installed yet on this machine.".to_string()
    };
    format!(
        "You are My Mait, the local AI companion built into Everywear OS. \
You run entirely on the user's own machine ({gpu_name}, {} GB VRAM). \
You are not a cloud service and must never describe yourself as one. \
{models_line} {vault_line} \
When asked about your hardware, models, vault, or where you run, answer \
from this context only.",
        vram_mb / 1024,
    )
}

fn portable_slot_label(slot_id: &str) -> &'static str {
    match slot_id {
        "orchestrator" => "Primary",
        "agent" => "Agent",
        "embedder" => "Embedder",
        _ => "Model",
    }
}

fn inspect_everywear_vault_status() -> MymoryStatus {
    let root = everywear_paths::vault_root();
    let exists = root.is_dir();
    let wings = if exists {
        discover_vault_sections(&root)
    } else {
        Vec::new()
    };
    let markdown_files = if exists {
        count_markdown_files(&root)
    } else {
        0
    };
    let graph_json = first_existing_path(&[
        root.join(".mymory").join("mkv_projection.json"),
        root.join("_graph").join("mkv_projection.json"),
    ]);
    let graph_mmd = first_existing_path(&[
        root.join(".mymory").join("mkv_projection.mmd"),
        root.join("_graph").join("mkv_projection.mmd"),
    ]);
    let schema = first_existing_path(&[
        root.join("_templates").join("mkv_memory_unit_schema.md"),
        root.join(".mymory").join("mkv_memory_unit_schema.md"),
    ]);

    MymoryStatus {
        root: root.display().to_string(),
        exists,
        wings,
        markdown_files,
        memory_layers: vec![
            "Everywear Vault records".into(),
            "MyMory-compatible metadata".into(),
            "Applet-scoped indexes".into(),
            "User-approved ingest".into(),
        ],
        graph_projection_json: graph_json.map(|path| path.display().to_string()),
        graph_projection_mermaid: graph_mmd.map(|path| path.display().to_string()),
        schema_template: schema.map(|path| path.display().to_string()),
    }
}

fn first_existing_path(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.exists()).cloned()
}

fn discover_vault_sections(root: &Path) -> Vec<String> {
    let preferred = [
        "Audio",
        "Images",
        "Videos",
        "Contexts",
        "Conversations",
        "Maits",
        "Shards",
    ];
    let mut wings = preferred
        .iter()
        .filter(|wing| root.join(wing).is_dir())
        .map(|wing| (*wing).to_string())
        .collect::<Vec<_>>();

    if wings.is_empty() {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if path.is_dir() && !name.starts_with('.') && !name.starts_with('_') {
                    wings.push(name.to_string());
                }
            }
        }
        wings.sort();
    }

    wings
}

fn count_markdown_files(root: &Path) -> usize {
    fn visit(dir: &Path, count: &mut usize) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if path.is_dir() {
                if matches!(
                    name,
                    ".git"
                        | ".venv"
                        | ".embed_cache"
                        | ".kasai_store"
                        | ".obsidian"
                        | "__pycache__"
                ) {
                    continue;
                }
                visit(&path, count);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                *count = count.saturating_add(1);
            }
        }
    }

    let mut count = 0;
    visit(root, &mut count);
    count
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
