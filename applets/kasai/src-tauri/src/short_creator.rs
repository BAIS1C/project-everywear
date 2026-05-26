use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_DURATION_SECONDS: u32 = 30;
const MIN_SEGMENT_SECONDS: u32 = 4;
const MAX_SEGMENT_SECONDS: u32 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortCreationRequest {
    pub topic: String,
    pub keywords: Vec<String>,
    pub narrator_style: String,
    pub duration_seconds: u32,
    pub aspect: String,
    pub audience: String,
    pub source_mode: SourceMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    SearchFirst,
    LocalVault,
    UserSupplied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortCreationPlan {
    pub plan_type: String,
    pub topic: String,
    pub aspect: String,
    pub duration_seconds: u32,
    pub narrator: NarratorPlan,
    pub keyword_search: KeywordSearchPlan,
    pub shots: Vec<ShortShot>,
    pub render_handoff: RenderHandoff,
    pub acceptance_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NarratorPlan {
    pub style: String,
    pub audience: String,
    pub hook: String,
    pub script: String,
    pub subtitle_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordSearchPlan {
    pub source_mode: SourceMode,
    pub primary_keywords: Vec<String>,
    pub search_queries: Vec<String>,
    pub evidence_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortShot {
    pub shot_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub narration: String,
    pub search_query: String,
    pub visual_prompt: String,
    pub keyframe_prompt: String,
    pub continuity_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderHandoff {
    pub orchestrator: String,
    pub keyframe_engine: String,
    pub video_engine: String,
    pub sequence: Vec<RenderHandoffStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum RenderHandoffStep {
    Search {
        query: String,
        shot_id: String,
    },
    Narration {
        shot_id: String,
        text: String,
    },
    Keyframe {
        engine: String,
        shot_id: String,
        prompt: String,
    },
    VideoSegment {
        engine: String,
        shot_id: String,
        start_ms: u64,
        end_ms: u64,
        prompt: String,
        init_frame_ref: String,
    },
}

pub fn is_short_creation_job(job: &Value) -> bool {
    let Some(kind) = job_kind(job) else {
        return false;
    };
    matches!(
        kind,
        "keyword_short_creation"
            | "keyword_short_plan"
            | "short_creation"
            | "narrated_short"
            | "kasai.short.create"
    )
}

pub fn plan_from_job(job: &Value) -> Result<ShortCreationPlan, String> {
    let request = request_from_job(job)?;
    Ok(build_plan(request))
}

fn request_from_job(job: &Value) -> Result<ShortCreationRequest, String> {
    let input = job.get("input").unwrap_or(job);
    let topic = first_string(input, &["topic", "subject", "prompt"])
        .or_else(|| first_string(job, &["topic", "subject", "prompt"]))
        .ok_or_else(|| "keyword_short_creation requires a topic or prompt".to_string())?;

    let keywords = keywords_from_value(input)
        .or_else(|| keywords_from_value(job))
        .unwrap_or_else(|| keywords_from_topic(&topic));

    let narrator_style = first_string(input, &["narrator_style", "voice", "style"])
        .unwrap_or_else(|| "clear, energetic explainer".to_string());
    let audience =
        first_string(input, &["audience"]).unwrap_or_else(|| "short-form viewers".to_string());
    let aspect = first_string(input, &["aspect", "format"]).unwrap_or_else(|| "9:16".to_string());
    let duration_seconds = first_u64(input, &["duration_seconds", "duration"])
        .or_else(|| first_u64(job, &["duration_seconds", "duration"]))
        .unwrap_or(DEFAULT_DURATION_SECONDS as u64)
        .clamp(12, 90) as u32;
    let source_mode = match first_string(input, &["source_mode"])
        .unwrap_or_else(|| "search_first".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "local" | "local_vault" | "vault" => SourceMode::LocalVault,
        "user" | "user_supplied" | "provided" => SourceMode::UserSupplied,
        _ => SourceMode::SearchFirst,
    };

    Ok(ShortCreationRequest {
        topic,
        keywords,
        narrator_style,
        duration_seconds,
        aspect,
        audience,
        source_mode,
    })
}

fn build_plan(request: ShortCreationRequest) -> ShortCreationPlan {
    let segment_count = segment_count(request.duration_seconds);
    let search_queries = build_search_queries(&request.topic, &request.keywords, segment_count);
    let shots = build_shots(&request, &search_queries, segment_count);
    let script = shots
        .iter()
        .map(|shot| shot.narration.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let hook = shots
        .first()
        .map(|shot| shot.narration.clone())
        .unwrap_or_else(|| format!("Here is the fastest useful tour of {}.", request.topic));
    let render_handoff = build_render_handoff(&shots);

    ShortCreationPlan {
        plan_type: "kasai_keyword_narrated_short".to_string(),
        topic: request.topic.clone(),
        aspect: request.aspect,
        duration_seconds: request.duration_seconds,
        narrator: NarratorPlan {
            style: request.narrator_style,
            audience: request.audience,
            hook,
            script,
            subtitle_mode: "burned-in captions from narrator script".to_string(),
        },
        keyword_search: KeywordSearchPlan {
            source_mode: request.source_mode,
            primary_keywords: request.keywords,
            search_queries,
            evidence_notes: vec![
                "Search results should be summarized before visual generation.".to_string(),
                "Claims in narration should be backed by retrieved snippets or user-supplied notes."
                    .to_string(),
                "External media must be rights-safe before it enters 1magen or 3nvizen."
                    .to_string(),
            ],
        },
        shots,
        render_handoff,
        acceptance_checks: vec![
            "Narration covers the topic in one continuous short-form arc.".to_string(),
            "Every shot has a search query, keyframe prompt, and video prompt.".to_string(),
            "1magen receives only keyframe prompts; 3nvizen receives segment prompts and frame refs."
                .to_string(),
            "Final assembly keeps aspect ratio, subtitles, and narration timing aligned.".to_string(),
        ],
    }
}

fn build_search_queries(topic: &str, keywords: &[String], segment_count: usize) -> Vec<String> {
    let mut queries = Vec::new();
    for keyword in keywords.iter().take(segment_count.max(1)) {
        queries.push(format!("{topic} {keyword} visual reference short video"));
    }
    while queries.len() < segment_count {
        let angle = match queries.len() {
            0 => "overview",
            1 => "surprising fact",
            2 => "real world example",
            3 => "before and after",
            _ => "memorable ending",
        };
        queries.push(format!("{topic} {angle} visual reference"));
    }
    queries
}

fn build_shots(
    request: &ShortCreationRequest,
    search_queries: &[String],
    segment_count: usize,
) -> Vec<ShortShot> {
    let segment_ms = (request.duration_seconds as u64 * 1000) / segment_count.max(1) as u64;
    (0..segment_count)
        .map(|index| {
            let start_ms = index as u64 * segment_ms;
            let end_ms = if index + 1 == segment_count {
                request.duration_seconds as u64 * 1000
            } else {
                (index as u64 + 1) * segment_ms
            };
            let keyword = request
                .keywords
                .get(index % request.keywords.len().max(1))
                .cloned()
                .unwrap_or_else(|| request.topic.clone());
            let narration = narration_line(&request.topic, &keyword, index, segment_count);
            let visual_prompt = visual_prompt(&request.topic, &keyword, index, &request.aspect);
            let shot_id = format!("short-shot-{:02}", index + 1);

            ShortShot {
                shot_id,
                start_ms,
                end_ms,
                narration,
                search_query: search_queries
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| format!("{} {}", request.topic, keyword)),
                keyframe_prompt: format!("{visual_prompt}; clean anchor frame, no text, no logo"),
                visual_prompt,
                continuity_notes: continuity_notes(index),
            }
        })
        .collect()
}

fn narration_line(topic: &str, keyword: &str, index: usize, segment_count: usize) -> String {
    if index == 0 {
        return format!(
            "Here is why {topic} matters, starting with the signal hiding in {keyword}."
        );
    }
    if index + 1 == segment_count {
        return format!("So the takeaway is simple: {topic} becomes clearer when you track {keyword}.");
    }
    match index {
        1 => format!("The next piece is {keyword}, because it shows what changes first."),
        2 => format!("Then {keyword} gives us the proof, not just the promise."),
        _ => format!("And {keyword} connects the idea to something people can recognize fast."),
    }
}

fn visual_prompt(topic: &str, keyword: &str, index: usize, aspect: &str) -> String {
    let camera = match index % 4 {
        0 => "dynamic wide shot",
        1 => "medium tracking shot",
        2 => "close detailed shot",
        _ => "smooth reveal shot",
    };
    format!(
        "{camera} for a {aspect} short about {topic}, focused on {keyword}, cinematic but readable, high contrast, natural motion"
    )
}

fn continuity_notes(index: usize) -> Vec<String> {
    if index == 0 {
        vec!["establish the main subject clearly in the first second".to_string()]
    } else {
        vec![
            format!("continue from end frame of short-shot-{index:02}"),
            "preserve lighting direction and subject identity".to_string(),
        ]
    }
}

fn build_render_handoff(shots: &[ShortShot]) -> RenderHandoff {
    let mut sequence = Vec::with_capacity(shots.len() * 4);
    for (index, shot) in shots.iter().enumerate() {
        sequence.push(RenderHandoffStep::Search {
            query: shot.search_query.clone(),
            shot_id: shot.shot_id.clone(),
        });
        sequence.push(RenderHandoffStep::Narration {
            shot_id: shot.shot_id.clone(),
            text: shot.narration.clone(),
        });
        sequence.push(RenderHandoffStep::Keyframe {
            engine: "1magen".to_string(),
            shot_id: shot.shot_id.clone(),
            prompt: shot.keyframe_prompt.clone(),
        });
        sequence.push(RenderHandoffStep::VideoSegment {
            engine: "3nvizen".to_string(),
            shot_id: shot.shot_id.clone(),
            start_ms: shot.start_ms,
            end_ms: shot.end_ms,
            prompt: shot.visual_prompt.clone(),
            init_frame_ref: if index == 0 {
                format!("keyframe:{}", shot.shot_id)
            } else {
                format!("endframe:short-shot-{index:02}")
            },
        });
    }

    RenderHandoff {
        orchestrator: "kasai.planning".to_string(),
        keyframe_engine: "1magen".to_string(),
        video_engine: "3nvizen".to_string(),
        sequence,
    }
}

fn segment_count(duration_seconds: u32) -> usize {
    let desired = (duration_seconds as f32 / MAX_SEGMENT_SECONDS as f32).ceil() as usize;
    let max_count = (duration_seconds / MIN_SEGMENT_SECONDS).max(1) as usize;
    desired.clamp(2, max_count.max(2))
}

fn job_kind(job: &Value) -> Option<&str> {
    job.get("kind")
        .and_then(Value::as_str)
        .or_else(|| job.get("job_kind").and_then(Value::as_str))
        .or_else(|| job.get("capability").and_then(Value::as_str))
        .or_else(|| job.pointer("/input/kind").and_then(Value::as_str))
        .or_else(|| job.pointer("/input/capability").and_then(Value::as_str))
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(str::to_string)
}

fn first_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| value.get(*key).and_then(Value::as_u64))
}

fn keywords_from_value(value: &Value) -> Option<Vec<String>> {
    value
        .get("keywords")
        .or_else(|| value.get("terms"))
        .and_then(|keywords| {
            if let Some(items) = keywords.as_array() {
                Some(
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>(),
                )
            } else {
                keywords.as_str().map(split_keywords)
            }
        })
        .filter(|items| !items.is_empty())
}

fn split_keywords(value: &str) -> Vec<String> {
    value
        .split([',', ';', '|'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn keywords_from_topic(topic: &str) -> Vec<String> {
    let mut words = topic
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_ascii_lowercase()
        })
        .filter(|word| word.len() > 3)
        .take(5)
        .collect::<Vec<_>>();
    if words.is_empty() {
        words.push(topic.to_string());
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_supported_job_kinds() {
        assert!(is_short_creation_job(&json!({
            "kind": "keyword_short_creation",
            "topic": "local AI video"
        })));
    }

    #[test]
    fn creates_renderable_plan_from_keywords() {
        let plan = plan_from_job(&json!({
            "kind": "keyword_short_creation",
            "input": {
                "topic": "privacy first AI video tools",
                "keywords": ["offline", "creator workflow", "shorts"],
                "duration_seconds": 24,
                "aspect": "9:16"
            }
        }))
        .expect("plan");

        assert_eq!(plan.plan_type, "kasai_keyword_narrated_short");
        assert_eq!(plan.aspect, "9:16");
        assert!(plan.shots.len() >= 3);
        assert!(plan
            .render_handoff
            .sequence
            .iter()
            .any(|step| matches!(step, RenderHandoffStep::Keyframe { engine, .. } if engine == "1magen")));
        assert!(plan
            .render_handoff
            .sequence
            .iter()
            .any(|step| matches!(step, RenderHandoffStep::VideoSegment { engine, .. } if engine == "3nvizen")));
    }
}
