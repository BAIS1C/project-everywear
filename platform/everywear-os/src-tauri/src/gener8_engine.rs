//! Shell-owned Gener8 engine bridge.
//!
//! The Gener8 React applet talks to these commands over Tauri IPC. The shell
//! keeps ACE as a private implementation detail, currently via ace-server on
//! localhost. No Gener8 UI code should call a public localhost shim.

use anyhow::{anyhow, Result};
use base64::Engine;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

const APPLET_ID: &str = "gener8";
const ACE_PORT: u16 = 8080;
const ACE_URL: &str = "http://127.0.0.1:8080";

#[derive(Default)]
pub struct Gener8EngineState {
    child: Option<Child>,
    bin_path: Option<PathBuf>,
    pending_titles: HashMap<String, String>,
}

impl Gener8EngineState {
    fn is_running(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    self.child = None;
                    false
                }
                Ok(None) => true,
                Err(_) => false,
            },
            None => false,
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Gener8EngineState {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type Gener8Engine = Arc<Mutex<Gener8EngineState>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAudioRequest {
    pub file_name: Option<String>,
    pub content_type: Option<String>,
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAudioResponse {
    pub key: String,
    pub path: String,
    pub audio_url: String,
    pub filename: String,
    pub size: usize,
}

#[tauri::command]
pub async fn gener8_upload_audio(
    state: tauri::State<'_, crate::AppState>,
    request: UploadAudioRequest,
) -> Result<UploadAudioResponse, String> {
    require_tier(&state, model_manager::LicenceTier::Gener8Pro).await?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.data_base64.as_bytes())
        .map_err(|e| format!("invalid audio payload: {e}"))?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("Audio uploads are limited to 15 MB.".into());
    }

    let refs_dir = gener8_data_dir().join("references");
    tokio::fs::create_dir_all(&refs_dir)
        .await
        .map_err(|e| e.to_string())?;

    let fallback = format!("ref_{}", chrono::Utc::now().timestamp_millis());
    let requested = request.file_name.as_deref();
    let ext = requested
        .and_then(|name| Path::new(name).extension().and_then(|e| e.to_str()))
        .map(|s| sanitize_stem(s).to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| extension_for_content_type(request.content_type.as_deref()).into());
    let stem = requested
        .and_then(|name| Path::new(name).file_stem().and_then(|s| s.to_str()))
        .map(sanitize_stem)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback);

    let mut filename = format!("{stem}.{ext}");
    let mut path = refs_dir.join(&filename);
    if path.exists() {
        filename = format!("{}_{}.{}", stem, chrono::Utc::now().timestamp_millis(), ext);
        path = refs_dir.join(&filename);
    }

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    let key = format!("references/{filename}");

    Ok(UploadAudioResponse {
        key: key.clone(),
        path: path.display().to_string(),
        audio_url: format!("gener8://{key}"),
        filename,
        size: bytes.len(),
    })
}

#[tauri::command]
pub async fn gener8_generate(
    state: tauri::State<'_, crate::AppState>,
    params: Value,
) -> Result<Value, String> {
    let task_type = string_field(&params, &["taskType", "task_type"]).unwrap_or_default();
    let source_audio = string_field(&params, &["sourceAudioUrl", "source_audio_url"]);
    let reference_audio = string_field(&params, &["referenceAudioUrl", "reference_audio_url"]);
    if task_type.eq_ignore_ascii_case("cover")
        || source_audio.as_deref().is_some_and(|s| !s.is_empty())
        || reference_audio.as_deref().is_some_and(|s| !s.is_empty())
    {
        require_tier(&state, model_manager::LicenceTier::Gener8Pro).await?;
    }

    ensure_ace_ready(state.gener8_engine.clone()).await?;

    let client = reqwest::Client::new();
    let ace_req = normalize_ace_request(&params);
    let content_type = string_field(&params, &["audioFormat", "audio_format"])
        .unwrap_or_else(|| "mp3".into())
        .to_ascii_lowercase();
    let synth_path = if matches!(content_type.as_str(), "wav" | "wave" | "flac" | "lossless") {
        "/synth?format=wav24"
    } else {
        "/synth"
    };

    let source_path = source_audio.as_deref().and_then(resolve_audio_ref);
    let reference_path = reference_audio.as_deref().and_then(resolve_audio_ref);

    let response = if source_path.is_some() || reference_path.is_some() {
        let mut form = Form::new().part(
            "request",
            Part::text(ace_req.to_string())
                .mime_str("application/json")
                .map_err(|e| e.to_string())?,
        );
        if let Some(path) = source_path {
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("failed to read source audio: {e}"))?;
            form = form.part(
                "audio",
                Part::bytes(bytes)
                    .file_name(file_name_or(&path, "source.mp3"))
                    .mime_str("audio/mpeg")
                    .map_err(|e| e.to_string())?,
            );
        }
        if let Some(path) = reference_path {
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("failed to read reference audio: {e}"))?;
            form = form.part(
                "ref_audio",
                Part::bytes(bytes)
                    .file_name(file_name_or(&path, "reference.mp3"))
                    .mime_str("audio/mpeg")
                    .map_err(|e| e.to_string())?,
            );
        }
        client
            .post(format!("{ACE_URL}{synth_path}"))
            .multipart(form)
            .send()
            .await
    } else {
        client
            .post(format!("{ACE_URL}{synth_path}"))
            .json(&ace_req)
            .send()
            .await
    }
    .map_err(|e| format!("ace-server request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ace-server returned {status}: {body}"));
    }

    let data: Value = response.json().await.unwrap_or_else(|_| json!({}));
    let id = data
        .get("id")
        .and_then(|v| v.as_str().map(str::to_string))
        .or_else(|| {
            data.get("id")
                .and_then(|v| v.as_u64())
                .map(|n| n.to_string())
        })
        .ok_or_else(|| "ace-server did not return a job id".to_string())?;
    if let Some(title) = string_field(&params, &["title"]) {
        state
            .gener8_engine
            .lock()
            .await
            .pending_titles
            .insert(id.clone(), title);
    }

    Ok(json!({
        "id": id,
        "jobId": format!("gen_{id}"),
        "status": "running",
        "queuePosition": data.get("queue_position").cloned(),
        "etaSeconds": data.get("eta_seconds").cloned()
    }))
}

#[tauri::command]
pub async fn gener8_generation_status(
    state: tauri::State<'_, crate::AppState>,
    job_id: String,
) -> Result<Value, String> {
    ensure_ace_ready(state.gener8_engine.clone()).await?;

    let id = job_id.trim_start_matches("gen_").to_string();
    if id.is_empty() {
        return Ok(json!({ "jobId": job_id, "status": "failed", "error": "invalid job id" }));
    }

    let client = reqwest::Client::new();
    let status_resp = client
        .get(format!("{ACE_URL}/job?id={id}"))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("ace-server status request failed: {e}"))?;
    if !status_resp.status().is_success() {
        return Ok(json!({
            "jobId": job_id,
            "status": "failed",
            "error": format!("engine returned {}", status_resp.status())
        }));
    }

    let status: Value = status_resp.json().await.unwrap_or_else(|_| json!({}));
    let state_str = status.get("status").and_then(|v| v.as_str()).unwrap_or("");
    match state_str {
        "done" | "complete" | "completed" | "succeeded" => {
            let result_resp = client
                .get(format!("{ACE_URL}/job?id={id}&result=1"))
                .send()
                .await
                .map_err(|e| format!("ace-server result request failed: {e}"))?;
            if !result_resp.status().is_success() {
                return Ok(json!({
                    "jobId": job_id,
                    "status": "failed",
                    "error": format!("engine result returned {}", result_resp.status())
                }));
            }
            let content_type = result_resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("audio/mpeg")
                .to_string();
            let bytes = result_resp.bytes().await.unwrap_or_default().to_vec();
            let ext = extension_for_content_type(Some(&content_type));
            let title = state.gener8_engine.lock().await.pending_titles.remove(&id);
            let filename = format!("{}.{}", build_track_filename(title.as_deref(), &id), ext);
            let out_dir = gener8_data_dir().join("outputs").join("gener8");
            tokio::fs::create_dir_all(&out_dir)
                .await
                .map_err(|e| e.to_string())?;
            let path = out_dir.join(filename);
            tokio::fs::write(&path, &bytes)
                .await
                .map_err(|e| e.to_string())?;
            let duration_seconds = status
                .get("duration")
                .and_then(|value| value.as_f64())
                .unwrap_or_default();
            let vault_item = {
                let dirs = crate::vault_commands::VaultDirs::default_paths()?;
                let context = crate::vault_commands::RegistrationContext::new("gener8")
                    .with_library("songs")
                    .with_shell_state(state.inner());
                let vault = state.vault.lock().await;
                crate::vault_commands::register_audio_with_dirs(
                    &vault,
                    &dirs,
                    &context,
                    title.clone().unwrap_or_else(|| "Gener8 output".to_string()),
                    path,
                    duration_seconds,
                    None,
                    None,
                    Some("Gener8".to_string()),
                    None,
                    false,
                    None,
                    None,
                    Some("gener8_song".to_string()),
                    vec!["gener8".to_string()],
                )?
            };
            let (vault_id, vault_path) = match &vault_item {
                ew_vault::VaultItem::Audio(doc) => (doc.id.clone(), doc.file_path.clone()),
                _ => (String::new(), String::new()),
            };

            Ok(json!({
                "jobId": job_id,
                "status": "succeeded",
                "file_path": vault_path.clone(),
                "vault_id": vault_id.clone(),
                "title": title,
                "result": {
                    "filePath": vault_path.clone(),
                    "audioUrls": [vault_path],
                    "vaultId": vault_id,
                    "audioContentType": content_type,
                    "duration": status.get("duration").cloned(),
                    "warnings": status.get("warnings").cloned().unwrap_or_else(|| json!([]))
                }
            }))
        }
        "error" | "failed" => Ok(json!({
            "jobId": job_id,
            "status": "failed",
            "error": status.get("error").and_then(|v| v.as_str()).unwrap_or("generation failed")
        })),
        "queued" | "pending" => Ok(json!({ "jobId": job_id, "status": "queued" })),
        _ => Ok(json!({
            "jobId": job_id,
            "status": "running",
            "progress": status.get("progress").cloned()
        })),
    }
}

#[tauri::command]
pub async fn gener8_engine_models(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Value, String> {
    ensure_ace_ready(state.gener8_engine.clone()).await?;
    let props = reqwest::Client::new()
        .get(format!("{ACE_URL}/props"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(normalize_model_inventory(&props))
}

fn normalize_model_inventory(props: &Value) -> Value {
    let dit_models = props
        .get("models")
        .and_then(|models| models.get("dit"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let lm_models = props
        .get("models")
        .and_then(|models| models.get("lm"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let dit_names: Vec<String> = dit_models
        .into_iter()
        .filter_map(|model| model.as_str().map(str::to_string))
        .collect();
    let lm_names: Vec<String> = lm_models
        .into_iter()
        .filter_map(|model| model.as_str().map(str::to_string))
        .collect();

    let default_model = preferred_dit_model(&dit_names);
    let loaded_lm_model = lm_names.first().cloned().unwrap_or_default();

    let models: Vec<Value> = dit_names
        .iter()
        .map(|name| {
            let is_default = *name == default_model;
            json!({
                "name": name,
                "is_default": is_default,
                "is_loaded": is_default,
                "supported_task_types": supported_task_types(name),
            })
        })
        .collect();
    let lm_models: Vec<Value> = lm_names
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "is_loaded": *name == loaded_lm_model,
            })
        })
        .collect();

    json!({
        "engine": "acestep.cpp",
        "runtime": "gguf",
        "models": models,
        "default_model": default_model,
        "lm_models": lm_models,
        "loaded_lm_model": loaded_lm_model,
        "llm_initialized": !loaded_lm_model.is_empty(),
    })
}

fn preferred_dit_model(models: &[String]) -> String {
    models
        .iter()
        .find(|name| name.to_ascii_lowercase().contains("sftturbo50"))
        .or_else(|| {
            models
                .iter()
                .find(|name| name.to_ascii_lowercase().contains("xl-turbo"))
        })
        .or_else(|| {
            models
                .iter()
                .find(|name| !name.to_ascii_lowercase().contains("xl-base"))
        })
        .or_else(|| models.first())
        .cloned()
        .unwrap_or_default()
}

fn supported_task_types(model: &str) -> Vec<&'static str> {
    let lower = model.to_ascii_lowercase();
    if lower.contains("xl-base") {
        vec![
            "text2music",
            "reference",
            "cover",
            "extract",
            "lego",
            "complete",
        ]
    } else {
        vec!["text2music"]
    }
}

async fn require_tier(
    state: &tauri::State<'_, crate::AppState>,
    required: model_manager::LicenceTier,
) -> Result<(), String> {
    let tier = *state.licence_tier.lock().await;
    let entitlements = state.entitlement_flags.lock().await;
    if tier.satisfies(required) || entitlement_satisfies_tier(&entitlements, required) {
        Ok(())
    } else {
        Err(format!(
            "Requires {}. Current tier is {}.",
            required.as_str(),
            tier.as_str()
        ))
    }
}

fn entitlement_satisfies_tier(
    entitlements: &HashMap<String, bool>,
    required: model_manager::LicenceTier,
) -> bool {
    let keys: &[&str] = match required {
        model_manager::LicenceTier::Demo => &[],
        model_manager::LicenceTier::Gener8 => &["gener8", "gener8.audio"],
        model_manager::LicenceTier::Gener8Pro => &["gener8_pro", "creator_studio"],
        model_manager::LicenceTier::CreatorStudio => &["creator_studio", "creator_pro"],
    };
    keys.iter()
        .any(|key| entitlements.get(*key).copied().unwrap_or(false))
}

async fn ensure_ace_ready(engine: Gener8Engine) -> Result<(), String> {
    {
        let mut guard = engine.lock().await;
        if guard.is_running() {
            return Ok(());
        }
    }

    let client = reqwest::Client::new();
    if client
        .get(format!("{ACE_URL}/props"))
        .timeout(std::time::Duration::from_millis(750))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success())
    {
        return Ok(());
    }

    let mut guard = engine.lock().await;
    if guard.is_running() {
        return Ok(());
    }

    let bin = guard
        .bin_path
        .clone()
        .map(Ok)
        .unwrap_or_else(locate_ace_binary)
        .map_err(|e| e.to_string())?;
    let models_dir = resolve_models_dir();
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    let child = start_ace_server(&bin, &models_dir).map_err(|e| e.to_string())?;
    guard.child = Some(child);
    guard.bin_path = Some(bin);
    drop(guard);

    wait_for_props().await.map_err(|e| e.to_string())
}

async fn wait_for_props() -> Result<()> {
    let client = reqwest::Client::new();
    for _ in 0..60 {
        if client
            .get(format!("{ACE_URL}/props"))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err(anyhow!("ace-server did not become ready within 60s"))
}

fn start_ace_server(bin: &Path, models_dir: &Path) -> Result<Child> {
    let mut cmd = Command::new(bin);
    cmd.args([
        "--models",
        &models_dir.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &ACE_PORT.to_string(),
        "--keep-loaded",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    spawn_drained(cmd)
}

fn spawn_drained(mut cmd: Command) -> Result<Child> {
    let mut child = cmd.spawn()?;
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(std::result::Result::ok) {
                tracing::info!(target: "gener8.ace.stdout", "{}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(std::result::Result::ok) {
                tracing::warn!(target: "gener8.ace.stderr", "{}", line);
            }
        });
    }
    Ok(child)
}

fn locate_ace_binary() -> Result<PathBuf> {
    let bin_name = if cfg!(target_os = "windows") {
        "ace-server.exe"
    } else {
        "ace-server"
    };

    let platform = everywear_paths::bin_dir().join("ace-server").join(bin_name);
    if platform.exists() {
        return Ok(platform);
    }
    if let Ok(path) = std::env::var("ACE_SERVER_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }
    let local = PathBuf::from(r"C:\Users\MAG MSI\Project Ace\S3 STUDIO\acestep.cpp\build\Release")
        .join(bin_name);
    if local.exists() {
        return Ok(local);
    }
    if let Ok(path) = which::which(bin_name.trim_end_matches(".exe")) {
        return Ok(path);
    }
    Err(anyhow!("ace-server binary not found"))
}

fn resolve_models_dir() -> PathBuf {
    if let Ok(primary) = std::env::var("EVERYWEAR_MODEL_PRIMARY") {
        let primary = PathBuf::from(primary);
        if let Some(parent) = primary.parent() {
            return parent.to_path_buf();
        }
    }
    let applet_models = everywear_paths::models_dir().join(APPLET_ID);
    if applet_models.exists() {
        return applet_models;
    }
    everywear_paths::models_dir()
}

fn normalize_ace_request(raw: &Value) -> Value {
    let task_type = string_field(raw, &["taskType", "task_type"]).unwrap_or_default();
    let effective_task_type = if task_type.eq_ignore_ascii_case("cover") {
        "cover-nofsq".to_string()
    } else if task_type.eq_ignore_ascii_case("text2music") {
        String::new()
    } else {
        task_type
    };

    json!({
        "synth_model": string_field(raw, &["synth_model", "model"]).unwrap_or_default(),
        "lm_model": string_field(raw, &["lm_model", "lmModel"]).unwrap_or_default(),
        "caption": string_field(raw, &["style", "prompt", "caption"]).unwrap_or_default(),
        "lyrics": string_field(raw, &["lyrics"]).unwrap_or_default(),
        "keyscale": string_field(raw, &["keyscale", "keyScale"]).unwrap_or_default(),
        "timesignature": string_field(raw, &["timesignature", "timeSignature"]).unwrap_or_default(),
        "vocal_language": string_field(raw, &["vocal_language", "vocalLanguage"]).unwrap_or_default(),
        "audio_codes": string_field(raw, &["audio_codes", "audioCodes"]).unwrap_or_default(),
        "task_type": effective_task_type,
        "track": string_field(raw, &["track", "trackName", "track_name"]).unwrap_or_default(),
        "infer_method": string_field(raw, &["inferMethod", "infer_method"]).unwrap_or_else(|| "ode".into()),
        "bpm": number_field(raw, &["bpm"]).unwrap_or(0.0) as i64,
        "duration": number_field(raw, &["duration"]).unwrap_or(0.0),
        "seed": number_field(raw, &["seed"]).unwrap_or(-1.0) as i64,
        "inference_steps": number_field(raw, &["inferenceSteps", "inference_steps"]).unwrap_or(50.0) as i64,
        "guidance_scale": number_field(raw, &["guidanceScale", "guidance_scale"]).unwrap_or(7.0),
        "shift": number_field(raw, &["shift"]).unwrap_or(3.0),
        "synth_batch_size": number_field(raw, &["synthBatchSize", "synth_batch_size"]).unwrap_or(1.0) as i64,
        "lm_batch_size": number_field(raw, &["lmBatchSize", "lm_batch_size"]).unwrap_or(1.0) as i64,
        "lm_top_k": number_field(raw, &["lmTopK", "lm_top_k"]).unwrap_or(0.0) as i64,
        "lm_temperature": number_field(raw, &["lmTemperature", "lm_temperature"]).unwrap_or(0.85),
        "lm_cfg_scale": number_field(raw, &["lmCfgScale", "lm_cfg_scale"]).unwrap_or(2.0),
        "lm_top_p": number_field(raw, &["lmTopP", "lm_top_p"]).unwrap_or(0.9),
        "audio_cover_strength": number_field(raw, &["audioCoverStrength", "audio_cover_strength"]).unwrap_or(1.0),
        "cover_noise_strength": number_field(raw, &["coverNoiseStrength", "cover_noise_strength"]).unwrap_or(0.0),
        "repainting_start": number_field(raw, &["repaintingStart", "repainting_start"]).unwrap_or(0.0),
        "repainting_end": number_field(raw, &["repaintingEnd", "repainting_end"]).unwrap_or(-1.0),
        "use_cot_caption": raw.get("useCot").or_else(|| raw.get("use_cot")).and_then(|v| v.as_bool()).unwrap_or(true),
    })
}

fn string_field(raw: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| raw.get(*key).and_then(|v| v.as_str()).map(str::to_string))
        .filter(|s| !s.trim().is_empty())
}

fn number_field(raw: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        raw.get(*key).and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_i64().map(|n| n as f64))
                .or_else(|| v.as_u64().map(|n| n as f64))
        })
    })
}

fn gener8_data_dir() -> PathBuf {
    everywear_paths::data_dir(APPLET_ID)
}

fn resolve_audio_ref(reference: &str) -> Option<PathBuf> {
    if reference.starts_with("gener8://") {
        return resolve_storage_key(reference.trim_start_matches("gener8://"));
    }
    if let Some(key) = reference.strip_prefix("/audio/") {
        return resolve_storage_key(key);
    }
    if let Some(key) = reference.strip_prefix("audio/") {
        return resolve_storage_key(key);
    }
    let path = PathBuf::from(reference);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn resolve_storage_key(key: &str) -> Option<PathBuf> {
    let rel = Path::new(key.trim_start_matches('/'));
    for component in rel.components() {
        if !matches!(component, Component::Normal(_)) {
            return None;
        }
    }
    Some(gener8_data_dir().join(rel))
}

fn sanitize_stem(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_sep = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
            out.push(ch);
            last_was_sep = false;
        } else if !last_was_sep {
            out.push('_');
            last_was_sep = true;
        }
        if out.len() >= 96 {
            break;
        }
    }
    out.trim_matches(|c: char| c == '_' || c == '-' || c == ' ')
        .trim()
        .to_string()
}

fn build_track_filename(title: Option<&str>, id: &str) -> String {
    let stem = title.map(sanitize_stem).filter(|s| !s.is_empty());
    format!("{}-{}", stem.unwrap_or_else(|| "gener8".into()), id)
}

fn extension_for_content_type(content_type: Option<&str>) -> &'static str {
    match content_type
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        ct if ct.contains("wav") => "wav",
        ct if ct.contains("flac") => "flac",
        ct if ct.contains("ogg") => "ogg",
        ct if ct.contains("mp4") || ct.contains("m4a") => "m4a",
        _ => "mp3",
    }
}

fn file_name_or(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| fallback.into())
}
