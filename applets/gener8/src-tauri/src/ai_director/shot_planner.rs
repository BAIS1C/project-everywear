//! Shot Planner: orchestrates Director LM inference for shot planning.
//!
//! Ported from S3 Studio. Migration changes:
//!   - No Tauri State; takes AppState reference directly
//!   - InitSource assignment: first shot gets KeyframeGenerated,
//!     subsequent shots get PreviousShotEndFrame unless a section
//!     boundary triggers a new keyframe
//!   - render_sequence is built by the caller (ai_director::render_sequence)

use std::sync::Arc;

use super::{BeatMap, InitSource, PlanShotsParams, Shot, ShotPlan};

/// Plan shots from a beat map + user brief.
///
/// In the Everywear platform, the Director LM is loaded on-demand when the
/// AI Director interface opens. If the LM is not available (feature not
/// compiled), this returns an error.
pub async fn plan_shots(
    _state: &Arc<crate::AppState>,
    params: PlanShotsParams,
) -> Result<ShotPlan, String> {
    let target_duration_ms = params
        .target_duration_ms
        .unwrap_or(params.beat_map.duration_ms);

    #[cfg(feature = "creator-studio")]
    {
        // Build prompts
        let sys = system_prompt().to_string();
        let usr = user_prompt(&params.beat_map, &params.brief, target_duration_ms);

        // Future: call Director LM via engine_client::submit_job
        // For now, return a placeholder that the LM integration will fill
        let raw_output = format!(
            "{{\"shots\": [{{\"shot_id\": \"shot-1\", \"start_ms\": 0, \"end_ms\": {}, \
             \"visual_prompt\": \"{}\", \"shot_type\": \"wide\"}}]}}",
            target_duration_ms, params.brief
        );

        let raw_shots = parse_shot_plan_json(&raw_output);

        if raw_shots.is_empty() {
            return Err(
                "Director could not generate a valid shot plan. Try adjusting your brief."
                    .to_string(),
            );
        }

        // Assign InitSource to each shot
        let shots = assign_init_sources(raw_shots, &params.beat_map);

        Ok(ShotPlan {
            shots,
            style_preset: params.style_preset,
            brief: params.brief,
            total_duration_ms: target_duration_ms,
        })
    }

    #[cfg(not(feature = "creator-studio"))]
    {
        let _ = target_duration_ms;
        Err("Creator Studio feature not enabled in this build".to_string())
    }
}

/// Assign InitSource to each shot based on position and section boundaries.
///
/// Rules:
///   1. First shot always gets KeyframeGenerated
///   2. Subsequent shots that start at a section boundary get KeyframeGenerated
///   3. All others get PreviousShotEndFrame (continuous video from prior shot)
fn assign_init_sources(raw_shots: Vec<RawShot>, beat_map: &BeatMap) -> Vec<Shot> {
    let section_starts: Vec<u64> = beat_map.sections.iter().map(|s| s.start_ms).collect();

    raw_shots
        .into_iter()
        .enumerate()
        .map(|(i, raw)| {
            let init_source = if i == 0 {
                // First shot: always generate a keyframe
                InitSource::KeyframeGenerated {
                    keyframe_prompt: raw.visual_prompt.clone(),
                }
            } else if is_at_section_boundary(raw.start_ms, &section_starts) {
                // New section: generate a fresh keyframe
                InitSource::KeyframeGenerated {
                    keyframe_prompt: raw.visual_prompt.clone(),
                }
            } else {
                // Continue from previous shot's end frame
                let prev_id = format!("shot-{}", i); // previous shot's ID
                InitSource::PreviousShotEndFrame {
                    previous_shot_id: prev_id,
                }
            };

            Shot {
                shot_id: raw.shot_id,
                start_ms: raw.start_ms,
                end_ms: raw.end_ms,
                visual_prompt: raw.visual_prompt,
                shot_type: raw.shot_type,
                reference_tags: raw.reference_tags,
                init_source,
            }
        })
        .collect()
}

/// Check if a timestamp is near a section boundary (within 500ms tolerance).
fn is_at_section_boundary(time_ms: u64, section_starts: &[u64]) -> bool {
    const TOLERANCE_MS: u64 = 500;
    section_starts
        .iter()
        .any(|&start| time_ms.abs_diff(start) <= TOLERANCE_MS)
}

// ---------------------------------------------------------------------------
// LLM prompt construction
// ---------------------------------------------------------------------------

pub fn system_prompt() -> &'static str {
    r#"You are a music video AI Director. Given a beat map (BPM, sections, beats with energy) and a user brief, produce a JSON array of shots that follow the music's energy contour.

Each shot must have:
- shot_id: unique string
- start_ms, end_ms: integer milliseconds
- visual_prompt: vivid description for image/video generation
- shot_type: "wide", "medium", "close", "extreme_close", "aerial", "tracking"
- reference_tags: array of style/mood tags

Rules:
- Shots must cover the full duration without gaps or overlaps
- High-energy sections get faster cuts (shorter shots, 2-4s)
- Low-energy sections get slower, contemplative shots (4-8s)
- Transition between sections with a new visual concept
- Output valid JSON only, no commentary"#
}

pub fn user_prompt(beat_map: &BeatMap, brief: &str, target_duration_ms: u64) -> String {
    let sections_desc: Vec<String> = beat_map
        .sections
        .iter()
        .map(|s| format!("  {} ({}-{}ms)", s.label, s.start_ms, s.end_ms))
        .collect();

    format!(
        "Brief: {}\nBPM: {}\nDuration: {}ms\nSections:\n{}\n\nGenerate the shot plan as a JSON array.",
        brief,
        beat_map.bpm,
        target_duration_ms,
        sections_desc.join("\n")
    )
}

// ---------------------------------------------------------------------------
// LLM output parsing
// ---------------------------------------------------------------------------

/// Intermediate shot representation before InitSource assignment.
#[derive(Debug, Clone)]
struct RawShot {
    shot_id: String,
    start_ms: u64,
    end_ms: u64,
    visual_prompt: String,
    shot_type: String,
    reference_tags: Vec<String>,
}

/// Parse the LLM's JSON output into raw shots.
fn parse_shot_plan_json(raw: &str) -> Vec<RawShot> {
    // Try to extract JSON array from the output (LLM may wrap it in markdown)
    let json_str = extract_json_array(raw);

    let arr: Vec<serde_json::Value> = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(_) => {
            // Try parsing as an object with a "shots" key
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(shots) = obj.get("shots").and_then(|v| v.as_array()) {
                    shots.clone()
                } else {
                    return Vec::new();
                }
            } else {
                return Vec::new();
            }
        }
    };

    arr.into_iter()
        .filter_map(|v| {
            Some(RawShot {
                shot_id: v.get("shot_id")?.as_str()?.to_string(),
                start_ms: v.get("start_ms")?.as_u64()?,
                end_ms: v.get("end_ms")?.as_u64()?,
                visual_prompt: v.get("visual_prompt")?.as_str()?.to_string(),
                shot_type: v
                    .get("shot_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("medium")
                    .to_string(),
                reference_tags: v
                    .get("reference_tags")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|t| t.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// Extract a JSON array from potentially messy LLM output.
/// Handles markdown code fences and leading/trailing text.
fn extract_json_array(raw: &str) -> String {
    let trimmed = raw.trim();

    // Strip markdown code fences
    let stripped = if trimmed.starts_with("```") {
        let start = trimmed.find('\n').map(|i| i + 1).unwrap_or(0);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        &trimmed[start..end]
    } else {
        trimmed
    };

    // Find the first [ or { and matching closer
    let stripped = stripped.trim();
    if stripped.starts_with('[') || stripped.starts_with('{') {
        stripped.to_string()
    } else if let Some(idx) = stripped.find('[') {
        stripped[idx..].to_string()
    } else if let Some(idx) = stripped.find('{') {
        stripped[idx..].to_string()
    } else {
        stripped.to_string()
    }
}
