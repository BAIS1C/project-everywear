//! DAW command helpers and response types.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - No #[tauri::command] annotations
//!   - No tauri::State; functions take &mut DawEngine directly
//!   - Response types are plain Serialize structs used by shim routes
//!   - Stem import utilities (colour/label helpers) used by shim

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::project;
use super::transport::PositionEvent;

// ---- Response types ----

#[derive(Serialize)]
pub struct TrackCreated {
    pub track_id: String,
}

#[derive(Serialize)]
pub struct RegionCreated {
    pub region_id: String,
}

#[derive(Serialize)]
pub struct SplitResult {
    pub left_id: String,
    pub right_id: String,
}

#[derive(Serialize)]
pub struct WaveformPeaks {
    pub peaks: Vec<(f32, f32)>,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub track_ids: Vec<String>,
}

#[derive(Deserialize)]
pub struct StemUrlEntry {
    pub track_name: String,
    pub audio_url: String,
    pub duration_ms: u64,
}

// ---- Track colours and labels ----

/// Default track colours matching the frontend track_1..track_12 palette.
const TRACK_COLOURS: &[&str] = &[
    "#F472B6", "#FB923C", "#A78BFA", "#34D399", "#60A5FA", "#FBBF24", "#F87171", "#2DD4BF",
    "#C084FC", "#FB7185", "#E879F9", "#94A3B8",
];

/// Canonical track names matching the frontend TRACK_NAMES array.
pub const TRACK_NAMES: &[&str] = &[
    "track_1", "track_2", "track_3", "track_4", "track_5", "track_6", "track_7", "track_8",
    "track_9", "track_10", "track_11", "track_12",
];

pub fn colour_for_track(index: usize) -> String {
    TRACK_COLOURS.get(index).unwrap_or(&"#60A5FA").to_string()
}

pub fn label_for_track(index: usize) -> String {
    format!("Track {}", index + 1)
}

pub fn colour_for_stem(name: &str) -> String {
    let lower = name.to_lowercase();
    for (i, tn) in TRACK_NAMES.iter().enumerate() {
        if lower.contains(tn) {
            return colour_for_track(i);
        }
    }
    "#60A5FA".to_string()
}

pub fn label_for_stem(filename: &str) -> String {
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let lower = stem.to_lowercase();
    for (i, tn) in TRACK_NAMES.iter().enumerate() {
        if lower.contains(tn) {
            return label_for_track(i);
        }
    }
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => stem.to_string(),
    }
}

// ---- DAW operations (called by shim routes) ----

use super::DawEngine;

/// Split a region at the given timeline position.
/// Returns (left_id, right_id) on success.
pub fn split_region(
    engine: &mut DawEngine,
    region_id: &str,
    position_ms: u64,
) -> Result<SplitResult, String> {
    engine.push_undo();
    let mut target_track_idx = None;
    let mut target_region_idx = None;
    for (ti, track) in engine.project().tracks.iter().enumerate() {
        for (ri, region) in track.regions.iter().enumerate() {
            if region.id == region_id {
                target_track_idx = Some(ti);
                target_region_idx = Some(ri);
                break;
            }
        }
        if target_track_idx.is_some() {
            break;
        }
    }
    let ti = target_track_idx.ok_or_else(|| format!("region {} not found", region_id))?;
    let ri = target_region_idx.unwrap();
    let original = engine.project().tracks[ti].regions[ri].clone();

    if position_ms <= original.position_ms || position_ms >= original.end_position_ms() {
        return Err("split point must be within the region".into());
    }
    let split_offset_in_audio = original.start_offset_ms + (position_ms - original.position_ms);
    let left_id = format!("{}-L", &original.id[..8.min(original.id.len())]);
    let right_id = format!("{}-R", &original.id[..8.min(original.id.len())]);

    let left = project::Region {
        id: left_id.clone(),
        audio_ref: original.audio_ref.clone(),
        resolved_path: original.resolved_path.clone(),
        position_ms: original.position_ms,
        start_offset_ms: original.start_offset_ms,
        end_offset_ms: split_offset_in_audio,
        fade_in_ms: original.fade_in_ms,
        fade_out_ms: 0,
        fade_curve: original.fade_curve.clone(),
        generation_dna: original.generation_dna.clone(),
    };
    let right = project::Region {
        id: right_id.clone(),
        audio_ref: original.audio_ref.clone(),
        resolved_path: original.resolved_path.clone(),
        position_ms,
        start_offset_ms: split_offset_in_audio,
        end_offset_ms: original.end_offset_ms,
        fade_in_ms: 0,
        fade_out_ms: original.fade_out_ms,
        fade_curve: original.fade_curve,
        generation_dna: original.generation_dna,
    };

    let track = &mut engine.project_mut().tracks[ti];
    track.regions.remove(ri);
    track.regions.push(left);
    track.regions.push(right);
    Ok(SplitResult { left_id, right_id })
}

/// Move a region to a different track and/or position.
pub fn move_region(
    engine: &mut DawEngine,
    region_id: &str,
    target_track_id: &str,
    position_ms: u64,
) -> Result<(), String> {
    engine.push_undo();
    let mut found_region = None;
    for track in &mut engine.project_mut().tracks {
        if let Some(idx) = track.regions.iter().position(|r| r.id == region_id) {
            found_region = Some(track.regions.remove(idx));
            break;
        }
    }
    let mut region = found_region.ok_or_else(|| format!("region {} not found", region_id))?;
    region.position_ms = position_ms;
    let target = engine
        .project_mut()
        .find_track_mut(target_track_id)
        .ok_or_else(|| format!("target track {} not found", target_track_id))?;
    target.regions.push(region);
    Ok(())
}

/// Import stems from a directory. Returns track IDs created.
pub fn import_stems_from_dir(
    engine: &mut DawEngine,
    source_path: &str,
) -> Result<ImportResult, String> {
    let dir = PathBuf::from(source_path);
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", source_path));
    }
    engine.push_undo();
    let mut track_ids = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            matches!(
                p.extension().and_then(|x| x.to_str()),
                Some("wav") | Some("mp3") | Some("flac") | Some("ogg")
            )
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();
        let label = label_for_stem(&filename);
        let color = colour_for_stem(&filename);
        let track_id = engine.project_mut().add_track(label, color);
        match engine.decode_audio(&path) {
            Ok(audio) => {
                let region_id = format!("stem-{}", &track_id[..8.min(track_id.len())]);
                let region = project::Region {
                    id: region_id,
                    audio_ref: path.to_string_lossy().to_string(),
                    resolved_path: Some(path),
                    position_ms: 0,
                    start_offset_ms: 0,
                    end_offset_ms: audio.duration_ms,
                    fade_in_ms: 0,
                    fade_out_ms: 0,
                    fade_curve: project::FadeCurve::Linear,
                    generation_dna: None,
                };
                if let Some(track) = engine.project_mut().find_track_mut(&track_id) {
                    track.regions.push(region);
                }
            }
            Err(err) => {
                tracing::warn!("failed to decode stem {}: {}", filename, err);
            }
        }
        track_ids.push(track_id);
    }
    tracing::info!("imported {} stems from {}", track_ids.len(), source_path);
    Ok(ImportResult { track_ids })
}

/// Import stems from URL metadata (cloud extract output).
pub fn import_stem_urls(
    engine: &mut DawEngine,
    stems: Vec<StemUrlEntry>,
    project_name: Option<String>,
    tempo_bpm: Option<f64>,
) -> Result<ImportResult, String> {
    engine.push_undo();
    if let Some(name) = project_name {
        engine.project_mut().name = name;
    }
    if let Some(bpm) = tempo_bpm {
        engine.project_mut().tempo_bpm = bpm;
        engine.transport_mut().tempo_bpm = bpm;
    }
    engine.project_mut().tracks.clear();

    let mut track_ids = Vec::new();
    for (i, entry) in stems.iter().enumerate() {
        let label = label_for_track(i);
        let color = colour_for_track(i);
        let track_id = engine.project_mut().add_track(label, color);
        let region_id = format!("stem-url-{}", &track_id[..8.min(track_id.len())]);
        let region = project::Region {
            id: region_id,
            audio_ref: entry.audio_url.clone(),
            resolved_path: None,
            position_ms: 0,
            start_offset_ms: 0,
            end_offset_ms: entry.duration_ms,
            fade_in_ms: 0,
            fade_out_ms: 0,
            fade_curve: project::FadeCurve::Linear,
            generation_dna: None,
        };
        if let Some(track) = engine.project_mut().find_track_mut(&track_id) {
            track.regions.push(region);
        }
        track_ids.push(track_id);
    }
    tracing::info!(
        "imported {} URL-based stems into DAW project",
        track_ids.len()
    );
    Ok(ImportResult { track_ids })
}
