//! SAPI-backed planner adapter for AI Director.
//!
//! This is provider-routed: LM Studio and external providers use an
//! OpenAI-compatible chat endpoint, while Ollama uses `/api/chat`.

use serde::Deserialize;
use serde_json::{json, Value};
use std::env;
use std::time::Duration;

use super::{BeatMap, InitSource, PlanShotsParams, Shot, ShotPlan};

#[derive(Debug, Clone)]
pub struct SapiPlanResult {
    pub plan: ShotPlan,
    pub provider: &'static str,
    pub model: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SapiPlannerStatus {
    pub mode: &'static str,
    pub providers: Vec<&'static str>,
    pub planned_providers: Vec<&'static str>,
    pub configured_provider: Option<String>,
}

#[derive(Debug, Clone)]
enum SapiProvider {
    LmStudio,
    Ollama,
    ExternalApi,
}

impl SapiProvider {
    fn id(&self) -> &'static str {
        match self {
            Self::LmStudio => "lm_studio",
            Self::Ollama => "ollama",
            Self::ExternalApi => "external_api",
        }
    }
}

pub fn planner_status() -> SapiPlannerStatus {
    SapiPlannerStatus {
        mode: "provider_routed",
        providers: vec!["lm_studio", "ollama", "external_api"],
        planned_providers: vec!["my_maits_internal"],
        configured_provider: configured_provider_name(),
    }
}

pub async fn plan_shots_with_sapi(
    http: &reqwest::Client,
    params: &PlanShotsParams,
    target_duration_ms: u64,
) -> Result<SapiPlanResult, String> {
    let sys = system_prompt();
    let usr = user_prompt(&params.beat_map, &params.brief, target_duration_ms);
    let mut errors = Vec::new();

    for provider in provider_order() {
        match call_provider(http, &provider, params.model.as_deref(), &sys, &usr).await {
            Ok((raw, model)) => {
                let shots = parse_sapi_shots(&raw, &params.beat_map)?;
                let plan = ShotPlan {
                    shots,
                    style_preset: params.style_preset.clone(),
                    brief: params.brief.clone(),
                    total_duration_ms: target_duration_ms,
                };
                return Ok(SapiPlanResult {
                    plan,
                    provider: provider.id(),
                    model,
                });
            }
            Err(error) => errors.push(format!("{}: {error}", provider.id())),
        }
    }

    Err(format!("SAPI planner unavailable ({})", errors.join("; ")))
}

async fn call_provider(
    http: &reqwest::Client,
    provider: &SapiProvider,
    requested_model: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<(String, String), String> {
    match provider {
        SapiProvider::LmStudio => {
            let endpoint = env_any(&["EVERYWEAR_LM_STUDIO_URL", "LM_STUDIO_BASE_URL"])
                .unwrap_or_else(|| "http://127.0.0.1:1234/v1/chat/completions".to_string());
            let model = requested_model.map(str::to_string).unwrap_or_else(|| {
                env_any(&["EVERYWEAR_LM_STUDIO_MODEL", "LM_STUDIO_MODEL"])
                    .unwrap_or_else(|| "local-model".to_string())
            });
            call_openai_compatible(http, endpoint, None, model, system_prompt, user_prompt).await
        }
        SapiProvider::ExternalApi => {
            let endpoint = env_any(&["EVERYWEAR_EXTERNAL_AI_BASE_URL", "OPENAI_BASE_URL"])
                .ok_or_else(|| "external API base URL not configured".to_string())?;
            let key = env_any(&["EVERYWEAR_EXTERNAL_AI_API_KEY", "OPENAI_API_KEY"]);
            let model = requested_model.map(str::to_string).unwrap_or_else(|| {
                env_any(&["EVERYWEAR_EXTERNAL_AI_MODEL", "OPENAI_MODEL"])
                    .unwrap_or_else(|| "gpt-4o-mini".to_string())
            });
            call_openai_compatible(http, endpoint, key, model, system_prompt, user_prompt).await
        }
        SapiProvider::Ollama => {
            let endpoint = env_any(&["EVERYWEAR_OLLAMA_URL", "OLLAMA_CHAT_URL"])
                .unwrap_or_else(|| "http://127.0.0.1:11434/api/chat".to_string());
            let model = requested_model.map(str::to_string).unwrap_or_else(|| {
                env_any(&["EVERYWEAR_OLLAMA_MODEL", "OLLAMA_MODEL"])
                    .unwrap_or_else(|| "llama3.1".to_string())
            });
            call_ollama(http, endpoint, model, system_prompt, user_prompt).await
        }
    }
}

async fn call_openai_compatible(
    http: &reqwest::Client,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<(String, String), String> {
    let endpoint = normalize_openai_endpoint(&endpoint);
    let mut request = http
        .post(endpoint)
        .timeout(Duration::from_secs(20))
        .json(&json!({
            "model": model,
            "temperature": 0.35,
            "response_format": { "type": "json_object" },
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }));
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
        request = request.bearer_auth(key);
    }
    let body: Value = request
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let content = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenAI-compatible response missing choices[0].message.content".to_string())?
        .to_string();
    Ok((content, model))
}

async fn call_ollama(
    http: &reqwest::Client,
    endpoint: String,
    model: String,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<(String, String), String> {
    let body: Value = http
        .post(endpoint)
        .timeout(Duration::from_secs(20))
        .json(&json!({
            "model": model,
            "stream": false,
            "format": "json",
            "options": { "temperature": 0.35 },
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let content = body
        .pointer("/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "Ollama response missing message.content".to_string())?
        .to_string();
    Ok((content, model))
}

fn provider_order() -> Vec<SapiProvider> {
    if let Some(name) = configured_provider_name() {
        return parse_provider(&name).into_iter().collect();
    }
    vec![
        SapiProvider::LmStudio,
        SapiProvider::Ollama,
        SapiProvider::ExternalApi,
    ]
}

fn parse_provider(name: &str) -> Option<SapiProvider> {
    match name.trim().to_ascii_lowercase().as_str() {
        "lm_studio" | "lm-studio" | "lmstudio" => Some(SapiProvider::LmStudio),
        "ollama" => Some(SapiProvider::Ollama),
        "external_api" | "external-api" | "openai" | "api" => Some(SapiProvider::ExternalApi),
        _ => None,
    }
}

fn configured_provider_name() -> Option<String> {
    env_any(&["EVERYWEAR_AI_DIRECTOR_SAPI_PROVIDER", "SAPI_PROVIDER"])
}

fn env_any(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_openai_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        return trimmed.to_string();
    }
    format!("{trimmed}/chat/completions")
}

fn system_prompt() -> String {
    "You are AI Director for a local music-video pipeline. Return strict JSON only. Do not include markdown. Output an object with a shots array. Each shot must include shot_id, start_ms, end_ms, visual_prompt, shot_type, and reference_tags.".to_string()
}

fn user_prompt(beat_map: &BeatMap, brief: &str, target_duration_ms: u64) -> String {
    let sections = beat_map
        .sections
        .iter()
        .map(|section| format!("{}:{}-{}", section.label, section.start_ms, section.end_ms))
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "Brief: {brief}\nBPM: {}\nDuration ms: {target_duration_ms}\nSections: {sections}\nCreate continuous music-video shots covering the full duration without gaps.",
        beat_map.bpm
    )
}

#[derive(Debug, Deserialize)]
struct SapiShot {
    shot_id: Option<String>,
    start_ms: u64,
    end_ms: u64,
    visual_prompt: String,
    #[serde(default = "default_shot_type")]
    shot_type: String,
    #[serde(default)]
    reference_tags: Vec<String>,
}

fn default_shot_type() -> String {
    "medium".to_string()
}

fn parse_sapi_shots(raw: &str, beat_map: &BeatMap) -> Result<Vec<Shot>, String> {
    let value = parse_json_payload(raw)?;
    let raw_shots: Vec<SapiShot> = if let Some(shots) = value.get("shots").and_then(Value::as_array) {
        serde_json::from_value(Value::Array(shots.clone())).map_err(|e| e.to_string())?
    } else if value.is_array() {
        serde_json::from_value(value).map_err(|e| e.to_string())?
    } else {
        return Err("SAPI planner JSON must be an array or object with shots[]".to_string());
    };
    if raw_shots.is_empty() {
        return Err("SAPI planner returned zero shots".to_string());
    }
    let section_starts: Vec<u64> = beat_map.sections.iter().map(|section| section.start_ms).collect();
    Ok(raw_shots
        .into_iter()
        .enumerate()
        .filter(|(_, shot)| shot.end_ms > shot.start_ms)
        .map(|(index, shot)| {
            let shot_id = shot.shot_id.unwrap_or_else(|| format!("shot-{}", index + 1));
            let init_source = init_source_for(index, shot.start_ms, &section_starts, &shot.visual_prompt);
            Shot {
                shot_id,
                start_ms: shot.start_ms,
                end_ms: shot.end_ms,
                visual_prompt: shot.visual_prompt,
                shot_type: shot.shot_type,
                reference_tags: shot.reference_tags,
                init_source,
            }
        })
        .collect())
}

fn init_source_for(
    index: usize,
    start_ms: u64,
    section_starts: &[u64],
    visual_prompt: &str,
) -> InitSource {
    if index == 0 || is_at_section_boundary(start_ms, section_starts) {
        return InitSource::KeyframeGenerated {
            keyframe_prompt: visual_prompt.to_string(),
        };
    }
    InitSource::PreviousShotEndFrame {
        previous_shot_id: format!("shot-{index}"),
    }
}

fn is_at_section_boundary(time_ms: u64, section_starts: &[u64]) -> bool {
    const TOLERANCE_MS: u64 = 500;
    section_starts
        .iter()
        .any(|&start| time_ms.abs_diff(start) <= TOLERANCE_MS)
}

fn parse_json_payload(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    let stripped = if trimmed.starts_with("```") {
        let start = trimmed.find('\n').map(|i| i + 1).unwrap_or(0);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        &trimmed[start..end]
    } else {
        trimmed
    };
    serde_json::from_str(stripped).or_else(|_| {
        let start = stripped
            .find('{')
            .or_else(|| stripped.find('['))
            .ok_or_else(|| "no JSON payload found".to_string())?;
        let end = stripped
            .rfind('}')
            .or_else(|| stripped.rfind(']'))
            .ok_or_else(|| "no JSON payload terminator found".to_string())?;
        serde_json::from_str(&stripped[start..=end]).map_err(|e| e.to_string())
    })
}
