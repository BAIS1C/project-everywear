use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

use super::ShimState;
use crate::daw_engine::DawEngine;
// ─── DAW Engine routes ────────────────────────────────────────────────

pub(super) fn routes() -> Router<Arc<ShimState>> {
    Router::new()
        .route("/api/daw/init", post(daw_init))
        .route("/api/daw/destroy", post(daw_destroy))
        .route("/api/daw/status", get(daw_status))
        .route("/api/daw/play", post(daw_play))
        .route("/api/daw/pause", post(daw_pause))
        .route("/api/daw/stop", post(daw_stop))
        .route("/api/daw/seek", post(daw_seek))
        .route("/api/daw/loop", post(daw_set_loop))
        .route("/api/daw/set-loop", post(daw_set_loop))
        .route("/api/daw/set-tempo", post(daw_set_tempo))
        .route("/api/daw/set-metronome", post(daw_set_metronome))
        .route("/api/daw/position", get(daw_get_position))
        .route("/api/daw/project", get(daw_get_project))
        .route("/api/daw/add-track", post(daw_add_track))
        .route("/api/daw/remove-track", post(daw_remove_track))
        .route("/api/daw/set-track-volume", post(daw_set_track_volume))
        .route("/api/daw/set-track-pan", post(daw_set_track_pan))
        .route("/api/daw/set-track-mute", post(daw_set_track_mute))
        .route("/api/daw/set-track-solo", post(daw_set_track_solo))
        .route("/api/daw/add-region", post(daw_add_region))
        .route("/api/daw/move-region", post(daw_move_region))
        .route("/api/daw/resize-region", post(daw_resize_region))
        .route("/api/daw/split-region", post(daw_split_region))
        .route("/api/daw/delete-region", post(daw_delete_region))
        .route("/api/daw/set-fade", post(daw_set_fade))
        .route("/api/daw/waveform-peaks", get(daw_waveform_peaks))
        .route("/api/daw/save-project", post(daw_save_project))
        .route("/api/daw/load-project", post(daw_load_project))
        .route("/api/daw/undo", post(daw_undo))
        .route("/api/daw/redo", post(daw_redo))
        .route("/api/daw/import-stems", post(daw_import_stems))
        .route("/api/daw/import-stem-urls", post(daw_import_stem_urls))
}

async fn daw_init(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    if guard.is_some() {
        return Ok(Json(json!({ "status": "already_initialised" })));
    }
    *guard = Some(DawEngine::new(st.daw_beats.clone()));
    tracing::info!("DAW engine initialised");
    Ok(Json(json!({ "status": "ok" })))
}

async fn daw_destroy(State(st): State<Arc<ShimState>>) -> Json<Value> {
    let mut guard = st.daw_engine.lock().await;
    if let Some(mut engine) = guard.take() {
        engine.stop_playback();
        engine.flush_caches();
    }
    tracing::info!("DAW engine destroyed");
    Json(json!({ "status": "ok" }))
}

#[derive(Deserialize, Default)]
struct PlayRequest {
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    start_position_seconds: Option<f64>,
}

async fn daw_play(
    State(st): State<Arc<ShimState>>,
    body: Option<Json<PlayRequest>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let request = body.map(|Json(body)| body).unwrap_or_default();
    if let Some(start_position_seconds) = request.start_position_seconds {
        engine
            .transport_mut()
            .seek(seconds_to_ms(start_position_seconds));
    }
    engine
        .start_playback()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let pos = crate::daw_engine::transport::PositionEvent::from(engine.transport());
    let mut value = serde_json::to_value(pos).unwrap_or(json!({}));
    if let Some(project_id) = request.project_id {
        if let Some(object) = value.as_object_mut() {
            object.insert("project_id".into(), json!(project_id));
        }
    }
    Ok(Json(value))
}

async fn daw_pause(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.pause_playback();
    let pos = crate::daw_engine::transport::PositionEvent::from(engine.transport());
    Ok(Json(serde_json::to_value(pos).unwrap_or(json!({}))))
}

async fn daw_stop(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.stop_playback();
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct SeekRequest {
    #[serde(default)]
    position_ms: Option<u64>,
    #[serde(default)]
    position_seconds: Option<f64>,
}

async fn daw_seek(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<SeekRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let position_ms = body
        .position_ms
        .or_else(|| body.position_seconds.map(seconds_to_ms))
        .ok_or((
            StatusCode::BAD_REQUEST,
            "position_seconds is required".into(),
        ))?;
    let was_playing = matches!(
        engine.transport().mode(),
        crate::daw_engine::transport::PlaybackMode::Playing
    );
    engine.transport_mut().seek(position_ms);
    if was_playing {
        engine
            .start_playback()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(json!({
        "position_seconds": position_ms as f64 / 1000.0,
        "position_frames": seconds_to_frames(position_ms as f64 / 1000.0, engine.project().sample_rate),
    })))
}

#[derive(Deserialize)]
struct LoopRequest {
    #[serde(default)]
    start_ms: Option<u64>,
    #[serde(default)]
    end_ms: Option<u64>,
    enabled: bool,
}

async fn daw_set_loop(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<LoopRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let total_ms = project_total_ms(engine);
    let start_ms = body
        .start_ms
        .unwrap_or(engine.transport().loop_range.start_ms);
    let end_ms = body
        .end_ms
        .unwrap_or_else(|| engine.transport().loop_range.end_ms.max(total_ms));
    let was_playing = matches!(
        engine.transport().mode(),
        crate::daw_engine::transport::PlaybackMode::Playing
    );
    engine
        .transport_mut()
        .set_loop(start_ms, end_ms, body.enabled);
    if was_playing {
        engine
            .start_playback()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(json!({ "loop_enabled": body.enabled })))
}

#[derive(Deserialize)]
struct TempoRequest {
    bpm: f64,
}

async fn daw_set_tempo(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TempoRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.transport_mut().tempo_bpm = body.bpm;
    engine.project_mut().tempo_bpm = body.bpm;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct MetronomeRequest {
    enabled: bool,
}

async fn daw_set_metronome(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<MetronomeRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.transport_mut().metronome = body.enabled;
    Ok(Json(json!({ "status": "ok" })))
}

async fn daw_get_position(
    State(st): State<Arc<ShimState>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let guard = st.daw_engine.lock().await;
    let engine = guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let pos = crate::daw_engine::transport::PositionEvent::from(engine.transport());
    Ok(Json(serde_json::to_value(pos).unwrap_or(json!({}))))
}

async fn daw_status(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let guard = st.daw_engine.lock().await;
    let engine = guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    Ok(Json(daw_status_value(engine)))
}

fn daw_status_value(engine: &DawEngine) -> Value {
    let position_seconds = engine.transport().position_ms() as f64 / 1000.0;
    let total_seconds = project_total_ms(engine) as f64 / 1000.0;
    let sample_rate = engine.project().sample_rate;
    let state = match engine.transport().mode() {
        crate::daw_engine::transport::PlaybackMode::Playing => "playing",
        crate::daw_engine::transport::PlaybackMode::Paused => "paused",
        crate::daw_engine::transport::PlaybackMode::Stopped => "stopped",
    };
    json!({
        "state": state,
        "position_seconds": position_seconds,
        "position_frames": seconds_to_frames(position_seconds, sample_rate),
        "total_seconds": total_seconds,
        "total_frames": seconds_to_frames(total_seconds, sample_rate),
        "loop_enabled": engine.transport().loop_range.enabled,
        "sample_rate": sample_rate,
        "project_id": "current",
    })
}

fn project_total_ms(engine: &DawEngine) -> u64 {
    engine
        .project()
        .tracks
        .iter()
        .flat_map(|track| track.regions.iter())
        .map(|region| region.end_position_ms())
        .max()
        .unwrap_or_default()
}

fn seconds_to_ms(seconds: f64) -> u64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds * 1000.0).round() as u64
    } else {
        0
    }
}

fn seconds_to_frames(seconds: f64, sample_rate: u32) -> u64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds * sample_rate as f64).round() as u64
    } else {
        0
    }
}

async fn daw_get_project(
    State(st): State<Arc<ShimState>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let guard = st.daw_engine.lock().await;
    let engine = guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    Ok(Json(
        serde_json::to_value(engine.project()).unwrap_or(json!({})),
    ))
}

#[derive(Deserialize)]
struct AddTrackRequest {
    name: String,
    color: String,
}

async fn daw_add_track(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<AddTrackRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.push_undo();
    let track_id = engine.project_mut().add_track(body.name, body.color);
    Ok(Json(json!({ "track_id": track_id })))
}

#[derive(Deserialize)]
struct TrackIdRequest {
    track_id: String,
}

async fn daw_remove_track(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TrackIdRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.push_undo();
    if !engine.project_mut().remove_track(&body.track_id) {
        return Err((
            StatusCode::NOT_FOUND,
            format!("track {} not found", body.track_id),
        ));
    }
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct TrackVolumeRequest {
    track_id: String,
    db: f64,
}

async fn daw_set_track_volume(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TrackVolumeRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let track = engine.project_mut().find_track_mut(&body.track_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("track {} not found", body.track_id),
    ))?;
    track.volume_db = body.db;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct TrackPanRequest {
    track_id: String,
    pan: f64,
}

async fn daw_set_track_pan(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TrackPanRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let track = engine.project_mut().find_track_mut(&body.track_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("track {} not found", body.track_id),
    ))?;
    track.pan = body.pan.clamp(-1.0, 1.0);
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct TrackMuteRequest {
    track_id: String,
    muted: bool,
}

async fn daw_set_track_mute(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TrackMuteRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let track = engine.project_mut().find_track_mut(&body.track_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("track {} not found", body.track_id),
    ))?;
    track.mute = body.muted;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct TrackSoloRequest {
    track_id: String,
    solo: bool,
}

async fn daw_set_track_solo(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<TrackSoloRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let track = engine.project_mut().find_track_mut(&body.track_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("track {} not found", body.track_id),
    ))?;
    track.solo = body.solo;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct AddRegionRequest {
    track_id: String,
    audio_path: String,
    position_ms: u64,
}

async fn daw_add_region(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<AddRegionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let abs_path = PathBuf::from(&body.audio_path);
    let audio = engine
        .decode_audio(&abs_path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let duration_ms = audio.duration_ms;
    engine.push_undo();
    let region_id = format!("r-{}", chrono::Utc::now().timestamp_millis());
    let region = crate::daw_engine::project::Region {
        id: region_id.clone(),
        audio_ref: body.audio_path,
        resolved_path: Some(abs_path),
        position_ms: body.position_ms,
        start_offset_ms: 0,
        end_offset_ms: duration_ms,
        fade_in_ms: 0,
        fade_out_ms: 0,
        fade_curve: crate::daw_engine::project::FadeCurve::Linear,
        generation_dna: None,
    };
    let track = engine.project_mut().find_track_mut(&body.track_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("track {} not found", body.track_id),
    ))?;
    track.regions.push(region);
    Ok(Json(json!({ "region_id": region_id })))
}

#[derive(Deserialize)]
struct MoveRegionRequest {
    region_id: String,
    track_id: String,
    position_ms: u64,
}

async fn daw_move_region(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<MoveRegionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    crate::daw_engine::commands::move_region(
        engine,
        &body.region_id,
        &body.track_id,
        body.position_ms,
    )
    .map_err(|e| (StatusCode::NOT_FOUND, e))?;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct ResizeRegionRequest {
    region_id: String,
    start_ms: u64,
    end_ms: u64,
}

async fn daw_resize_region(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<ResizeRegionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.push_undo();
    let region = engine
        .project_mut()
        .find_region_mut(&body.region_id)
        .ok_or((
            StatusCode::NOT_FOUND,
            format!("region {} not found", body.region_id),
        ))?;
    region.start_offset_ms = body.start_ms;
    region.end_offset_ms = body.end_ms;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct SplitRegionRequest {
    region_id: String,
    position_ms: u64,
}

async fn daw_split_region(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<SplitRegionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let result =
        crate::daw_engine::commands::split_region(engine, &body.region_id, body.position_ms)
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::to_value(result).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
struct DeleteRegionRequest {
    region_id: String,
}

async fn daw_delete_region(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<DeleteRegionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.push_undo();
    for track in &mut engine.project_mut().tracks {
        let len = track.regions.len();
        track.regions.retain(|r| r.id != body.region_id);
        if track.regions.len() < len {
            return Ok(Json(json!({ "status": "ok" })));
        }
    }
    Err((
        StatusCode::NOT_FOUND,
        format!("region {} not found", body.region_id),
    ))
}

#[derive(Deserialize)]
struct SetFadeRequest {
    region_id: String,
    fade_in_ms: u64,
    fade_out_ms: u64,
    curve: String,
}

async fn daw_set_fade(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<SetFadeRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let fade_curve = match body.curve.as_str() {
        "exponential" => crate::daw_engine::project::FadeCurve::Exponential,
        "s_curve" => crate::daw_engine::project::FadeCurve::SCurve,
        _ => crate::daw_engine::project::FadeCurve::Linear,
    };
    let region = engine
        .project_mut()
        .find_region_mut(&body.region_id)
        .ok_or((
            StatusCode::NOT_FOUND,
            format!("region {} not found", body.region_id),
        ))?;
    region.fade_in_ms = body.fade_in_ms;
    region.fade_out_ms = body.fade_out_ms;
    region.fade_curve = fade_curve;
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct WaveformQuery {
    audio_path: String,
    width_px: u32,
    start_ms: u64,
    end_ms: u64,
}

async fn daw_waveform_peaks(
    State(st): State<Arc<ShimState>>,
    Query(q): Query<WaveformQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let path = PathBuf::from(&q.audio_path);
    let peaks = engine
        .get_waveform_peaks(&path, q.width_px, q.start_ms, q.end_ms)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "peaks": peaks })))
}

#[derive(Deserialize)]
struct SaveProjectRequest {
    path: String,
}

async fn daw_save_project(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<SaveProjectRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let guard = st.daw_engine.lock().await;
    let engine = guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let json = serde_json::to_string_pretty(engine.project())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    std::fs::write(&body.path, json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("DAW project saved to {}", body.path);
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct LoadProjectRequest {
    path: String,
}

async fn daw_load_project(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<LoadProjectRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let raw =
        std::fs::read_to_string(&body.path).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let project: crate::daw_engine::DawProject =
        serde_json::from_str(&raw).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    engine.stop_playback();
    engine.flush_caches();
    let value = serde_json::to_value(&project).unwrap_or(json!({}));
    *engine.project_mut() = project;
    tracing::info!("DAW project loaded from {}", body.path);
    Ok(Json(value))
}

async fn daw_undo(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    if !engine.undo() {
        return Err((StatusCode::BAD_REQUEST, "nothing to undo".into()));
    }
    Ok(Json(json!({ "status": "ok" })))
}

async fn daw_redo(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    if !engine.redo() {
        return Err((StatusCode::BAD_REQUEST, "nothing to redo".into()));
    }
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Deserialize)]
struct ImportStemsRequest {
    source_path: String,
}

async fn daw_import_stems(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<ImportStemsRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let result = crate::daw_engine::commands::import_stems_from_dir(engine, &body.source_path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::to_value(result).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
struct ImportStemUrlsRequest {
    stems: Vec<crate::daw_engine::commands::StemUrlEntry>,
    #[serde(default)]
    project_name: Option<String>,
    #[serde(default)]
    tempo_bpm: Option<f64>,
}

async fn daw_import_stem_urls(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<ImportStemUrlsRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut guard = st.daw_engine.lock().await;
    let engine = guard
        .as_mut()
        .ok_or((StatusCode::BAD_REQUEST, "DAW not initialised".into()))?;
    let result = crate::daw_engine::commands::import_stem_urls(
        engine,
        body.stems,
        body.project_name,
        body.tempo_bpm,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::to_value(result).unwrap_or(json!({}))))
}
