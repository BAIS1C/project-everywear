//! In-process axum shim on :3001.
//!
//! Translates the SPA's REST contract into ace-server's HTTP API.
//! Runs as a tokio task inside the applet runtime.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - No auth_token / UserClaim dependency (auth handled by shell)
//!   - No per-user folder segmentation (single-user desktop applet)
//!   - Library/playlist paths from settings via everywear_paths
//!   - No crate::util; paths via everywear_paths + crate::settings
//!   - DAW routes delegate to DawEngine methods directly

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path as AxPath, Query, State},
    http::{header, HeaderMap, HeaderName, Method, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::beats::BeatsCache;
use crate::daw_engine::DawEngine;
use crate::library::{self, LibraryTrack, ListOptions, Playlist, SortDir, SortKey};
use crate::settings::{self, Settings};
use crate::storage;

#[derive(Clone, Debug)]
struct StemJobMeta {
    source_song_title: String,
    track_name: String,
}

#[derive(Clone)]
pub struct ShimState {
    pub client: Client,
    pub ace_url: String,
    pub beats: Arc<BeatsCache>,
    pub reconciler: Option<crate::tier_reconciler::Reconciler>,
    pub vram_mb: u32,
    pub pending_titles: Arc<AsyncMutex<HashMap<String, String>>>,
    pub pending_stem_meta: Arc<AsyncMutex<HashMap<String, StemJobMeta>>>,
    pub ace_server: Arc<AsyncMutex<crate::ace_server::AceServerManager>>,
    pub preferred_dit: Arc<StdMutex<String>>,
    pub daw_engine: Arc<AsyncMutex<Option<DawEngine>>>,
    pub daw_beats: Arc<BeatsCache>,
}

/// Resolve library.json and playlists.json paths from settings.
fn library_path() -> PathBuf {
    everywear_paths::data_dir(crate::APPLET_ID).join("library.json")
}

fn playlists_path() -> PathBuf {
    everywear_paths::data_dir(crate::APPLET_ID).join("playlists.json")
}

pub async fn boot(
    client: Client,
    shim_port: u16,
    ace_port: u16,
    beats: Arc<BeatsCache>,
    reconciler: Option<crate::tier_reconciler::Reconciler>,
    vram_mb: u32,
    ace_server: Arc<AsyncMutex<crate::ace_server::AceServerManager>>,
    daw_engine: Arc<AsyncMutex<Option<DawEngine>>>,
) -> anyhow::Result<()> {
    let daw_beats = beats.clone();
    let state = Arc::new(ShimState {
        client,
        ace_url: format!("http://127.0.0.1:{}", ace_port),
        beats,
        reconciler,
        vram_mb,
        pending_titles: Arc::new(AsyncMutex::new(HashMap::new())),
        pending_stem_meta: Arc::new(AsyncMutex::new(HashMap::new())),
        ace_server,
        preferred_dit: Arc::new(StdMutex::new(String::new())),
        daw_engine,
        daw_beats,
    });

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _req_parts| {
            let Ok(s) = origin.to_str() else {
                return false;
            };
            if s == "https://s3studio.xyz" {
                return true;
            }
            if s == "https://www.s3studio.xyz" {
                return true;
            }
            if s.starts_with("https://") && s.ends_with(".s3studio.xyz") {
                return true;
            }
            if s.starts_with("tauri://") {
                return true;
            }
            // Everywear shell origins
            if s == "https://everywear.id" {
                return true;
            }
            if s.starts_with("https://") && s.ends_with(".everywear.id") {
                return true;
            }
            #[cfg(debug_assertions)]
            {
                if s == "http://localhost:3000" {
                    return true;
                }
                if s == "http://127.0.0.1:3000" {
                    return true;
                }
                if s == "http://localhost:5173" {
                    return true;
                }
                if s == "http://127.0.0.1:5173" {
                    return true;
                }
            }
            false
        }))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("content-type"),
            HeaderName::from_static("accept"),
            HeaderName::from_static("x-requested-with"),
            HeaderName::from_static("x-client-info"),
            HeaderName::from_static("apikey"),
            HeaderName::from_static("prefer"),
            HeaderName::from_static("range"),
        ])
        .allow_private_network(true);

    // No auth middleware: shell handles authentication via IPC HMAC.
    // All routes are on a single public router.
    let app = Router::new()
        // Health / engine
        .route("/api/health", get(health))
        .route("/api/engine/health", get(health))
        .route("/api/engine/props", get(engine_props))
        .route("/api/engine/models", get(engine_models))
        .route("/api/engine/model-defaults", get(model_defaults))
        .route("/api/engine/stats", get(engine_stats))
        .route("/api/engine/init", post(init_model))
        .route("/api/engine/unload-models", post(unload_models))
        .route("/api/engine/reload-models", post(reload_models))
        .route("/api/engine/reinitialize", post(reload_models))
        .route("/v1/vram-status", get(vram_status))
        .route("/api/engine/vram-status", get(vram_status))
        // Generate
        .route("/api/v1/generate", post(generate))
        .route("/api/generate", post(generate))
        .route("/api/generate/status/{job_id}", get(generate_status))
        .route(
            "/api/generate/upload-audio",
            post(upload_audio).layer(DefaultBodyLimit::max(15 * 1024 * 1024)),
        )
        .route("/api/generate/format", post(format_lyrics))
        .route("/api/generate/analyze", post(analyze_audio))
        .route("/api/generate/history", get(generate_history))
        // Library
        .route("/api/songs", get(list_songs).post(create_song))
        .route("/api/songs/liked/list", get(list_songs))
        .route("/api/songs/featured", get(list_songs))
        .route(
            "/api/songs/{id}",
            get(get_song).put(update_song).delete(delete_song),
        )
        .route("/api/playlists", get(list_playlists).post(create_playlist))
        .route(
            "/api/playlists/{id}",
            get(get_playlist)
                .put(update_playlist)
                .delete(delete_playlist),
        )
        // Audio serving
        .route("/audio/{*key}", get(serve_audio))
        // Settings
        .route("/api/settings", get(read_settings).put(write_settings))
        .route("/api/shell/open", post(shell_open))
        .route("/api/shell/reveal", post(shell_reveal))
        .route(
            "/api/launcher/reveal-in-folder",
            post(launcher_reveal_in_folder),
        )
        // Beats
        .route("/api/beats", get(crate::beats::beats_handler))
        // Tier-gated stubs
        .route("/api/lora/status", get(tier_gated_studio))
        .route("/api/lora/load", post(tier_gated_studio))
        .route("/api/lora/unload", post(tier_gated_studio))
        .route("/api/lora/toggle", post(tier_gated_studio))
        .route("/api/lora/scale", post(tier_gated_studio))
        .route("/api/training/upload", post(tier_gated_studio))
        .route("/api/training/buckets", get(tier_gated_studio))
        .route("/api/training/dataset/scan", post(tier_gated_studio))
        .route("/api/training/dataset/preprocess", post(tier_gated_studio))
        .route("/api/training/dataset/auto-label", post(tier_gated_studio))
        .route("/api/training/dataset/status", get(tier_gated_studio))
        .route("/api/training/start", post(tier_gated_studio))
        .route("/api/training/status", get(tier_gated_studio))
        .route("/api/training/stop", post(tier_gated_studio))
        .route("/api/training/export", post(tier_gated_studio))
        .route("/api/training/status/stream", get(tier_gated_studio))
        .route("/api/training/analyze", post(tier_gated_studio))
        .route("/api/patches", get(tier_gated_studio))
        .route("/api/patches/create", post(tier_gated_studio))
        // AI Director
        .route("/api/director/analyze", post(director_analyze))
        .route("/api/director/plan", post(director_plan))
        .route("/api/director/lm/load", post(director_lm_load))
        .route("/api/director/lm/unload", post(director_lm_unload))
        .route("/api/director/lm/status", get(director_lm_status))
        // Video
        .route(
            "/api/video/save",
            post(save_video).layer(DefaultBodyLimit::max(150 * 1024 * 1024)),
        )
        .route("/api/videos", get(list_videos))
        .route("/video/{filename}", get(serve_video))
        // SRT export
        .route("/api/export/srt", post(export_srt))
        // DAW Engine
        .route("/api/daw/init", post(daw_init))
        .route("/api/daw/destroy", post(daw_destroy))
        // CLAUDE_INTERFACE: Get DAW transport status (shim endpoint, NOT Tauri invoke)
        // Endpoint: GET http://localhost:3001/api/daw/status
        // Returns: { state: "playing"|"paused"|"stopped", position_seconds, total_seconds, loop_enabled, sample_rate }
        // Poll every 250ms during playback for smooth position display
        .route("/api/daw/status", get(daw_status))
        // CLAUDE_INTERFACE: Gener8 is headless; frontend playback wiring uses shim :3001, not Tauri invoke.
        // Command: POST "http://127.0.0.1:3001/api/daw/play"
        // Args: { project_id?: string, start_position_seconds?: number }
        // Returns: { position_ms, bar, beat, tick, mode }
        // Error: HTTP 400 "DAW not initialised" | HTTP 500 audio device error
        .route("/api/daw/play", post(daw_play))
        // CLAUDE_INTERFACE: Gener8 is headless; frontend playback wiring uses shim :3001, not Tauri invoke.
        // Command: POST "http://127.0.0.1:3001/api/daw/pause"
        // Args: {}
        // Returns: { position_ms, bar, beat, tick, mode }
        // Error: HTTP 400 "DAW not initialised"
        .route("/api/daw/pause", post(daw_pause))
        // CLAUDE_INTERFACE: Gener8 is headless; frontend playback wiring uses shim :3001, not Tauri invoke.
        // Command: POST "http://127.0.0.1:3001/api/daw/stop"
        // Args: {}
        // Returns: { status: "ok" }
        // Error: HTTP 400 "DAW not initialised"
        .route("/api/daw/stop", post(daw_stop))
        // CLAUDE_INTERFACE: Seek to position (shim endpoint)
        // Endpoint: POST http://localhost:3001/api/daw/seek
        // Args: { position_seconds: number }
        .route("/api/daw/seek", post(daw_seek))
        // CLAUDE_INTERFACE: Toggle DAW loop (shim endpoint)
        // Endpoint: POST http://localhost:3001/api/daw/loop
        // Args: { enabled: boolean }
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
        // Stems
        .route("/api/stems/list", get(list_stems))
        // Diagnostics
        .route("/api/diag/log", post(diag_log))
        .route("/api/diag/event", post(diag_event))
        .with_state(state)
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], shim_port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("shim listening on {}", addr);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("shim serve error: {:#}", e);
        }
    });

    Ok(())
}

// ─── Health / Engine ──────────────────────────────────────────────────

async fn health(State(st): State<Arc<ShimState>>) -> Json<Value> {
    let engine_up = matches!(
        st.client
            .get(format!("{}/props", st.ace_url))
            .timeout(Duration::from_millis(400))
            .send()
            .await,
        Ok(r) if r.status().is_success()
    );
    let loaded_model = st
        .preferred_dit
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    Json(json!({
        "app":     "gener8",
        "version": env!("CARGO_PKG_VERSION"),
        "tier":    "demo",
        "engine":  "acestep.cpp",
        "runtime": "gguf",
        "loaded_model": loaded_model,
        "services": {
            "server":     engine_up,
            "engine":     engine_up,
            "connection": true
        },
        "ports": {
            "shim":    crate::SHIM_PORT,
            "server":  crate::ACE_PORT,
            "encoder": crate::VIDEO_ENCODER_PORT,
        },
        "status": if engine_up { "ok" } else { "degraded" }
    }))
}

async fn engine_props(State(st): State<Arc<ShimState>>) -> Result<Json<Value>, StatusCode> {
    let props: Value = match st.client.get(format!("{}/props", st.ace_url)).send().await {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or(json!({})),
        _ => json!({}),
    };
    Ok(Json(json!({
        "engine":  "acestep.cpp",
        "runtime": "gguf",
        "models":  props.get("models").cloned().unwrap_or_else(|| json!([])),
    })))
}

async fn engine_models(State(st): State<Arc<ShimState>>) -> Json<Value> {
    let props: Value = match st
        .client
        .get(format!("{}/props", st.ace_url))
        .timeout(Duration::from_millis(800))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or(json!({})),
        _ => json!({}),
    };
    Json(json!({
        "engine":  "acestep.cpp",
        "runtime": "gguf",
        "models":  props.get("models").cloned().unwrap_or_else(|| json!([])),
    }))
}

async fn model_defaults() -> Json<Value> {
    Json(json!({
        "model_type":             "base",
        "config_path":            "xl-base.gguf",
        "inference_steps":        50,
        "inference_steps_min":    8,
        "inference_steps_max":    50,
        "guidance_scale":         1.0,
        "guidance_scale_visible": true,
        "shift":                  1.0,
        "shift_visible":          true,
        "cot_recommended":        true,
        "thinking":               true,
        "use_adg_visible":        false,
        "cfg_interval_visible":   false,
        "infer_method":           "ode",
        "batch_size":             1
    }))
}

async fn engine_stats(State(st): State<Arc<ShimState>>) -> Json<Value> {
    Json(json!({
        "inference_count": 0,
        "uptime_s":        0,
        "models_loaded":   true,
    }))
}

// ─── VRAM ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct VramSample {
    gpu: String,
    total_mb: u64,
    used_mb: u64,
}

struct VramCache {
    sampled_at: Instant,
    data: Option<VramSample>,
}

static VRAM_CACHE: StdMutex<Option<VramCache>> = StdMutex::new(None);
const VRAM_CACHE_TTL: Duration = Duration::from_secs(5);

async fn read_nvidia_vram() -> Option<VramSample> {
    {
        let cache = VRAM_CACHE.lock().ok()?;
        if let Some(entry) = cache.as_ref() {
            if entry.sampled_at.elapsed() < VRAM_CACHE_TTL {
                return entry.data.clone();
            }
        }
    }
    let mut cmd = tokio::process::Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,memory.total,memory.used",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let result = cmd.output().await;
    let output = match result {
        Ok(o) if o.status.success() => o,
        _ => {
            if let Ok(mut cache) = VRAM_CACHE.lock() {
                *cache = Some(VramCache {
                    sampled_at: Instant::now(),
                    data: None,
                });
            }
            return None;
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.len() < 3 {
        return None;
    }
    let total_mb: u64 = parts[1].parse().ok()?;
    let used_mb: u64 = parts[2].parse().ok()?;
    let sample = VramSample {
        gpu: parts[0].to_string(),
        total_mb,
        used_mb,
    };
    if let Ok(mut cache) = VRAM_CACHE.lock() {
        *cache = Some(VramCache {
            sampled_at: Instant::now(),
            data: Some(sample.clone()),
        });
    }
    Some(sample)
}

async fn vram_status(State(st): State<Arc<ShimState>>) -> Json<Value> {
    let vram = read_nvidia_vram().await;
    let (gpu, used_mb, total_mb) = match vram.as_ref() {
        Some(v) => (Some(v.gpu.as_str()), Some(v.used_mb), Some(v.total_mb)),
        None => (None, None, None),
    };
    Json(json!({
        "data": {
            "engine":        "acestep.cpp",
            "runtime":       "gguf",
            "gpu":           gpu,
            "vram_used_mb":  used_mb,
            "vram_total_mb": total_mb,
            "loaded_models": [],
            "models_loaded": false,
        },
        "code": 200,
    }))
}

// ─── Model init / unload / reload ─────────────────────────────────────

#[derive(Deserialize)]
struct InitModelRequest {
    #[serde(default)]
    model: Option<String>,
}

async fn init_model(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<InitModelRequest>,
) -> Json<Value> {
    if let Some(ref m) = body.model {
        if let Ok(mut pref) = st.preferred_dit.lock() {
            *pref = m.clone();
        }
    }
    let loaded = st
        .preferred_dit
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    Json(json!({
        "message":      "ok",
        "loaded_model": loaded,
    }))
}

async fn unload_models(State(st): State<Arc<ShimState>>) -> Json<Value> {
    let mut mgr = st.ace_server.lock().await;
    mgr.stop();
    Json(json!({ "message": "models unloaded, VRAM released" }))
}

async fn reload_models(
    State(st): State<Arc<ShimState>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Err(e) = crate::ace_server::restart(st.ace_server.clone()).await {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ));
    }
    Ok(Json(json!({ "message": "models reloaded" })))
}

// ─── Generate ─────────────────────────────────────────────────────────

async fn generate(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Proxy to ace-server /generate
    let resp = st
        .client
        .post(format!("{}/generate", st.ace_url))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let status = resp.status();
    let data: Value = resp.json().await.unwrap_or(json!({}));
    if !status.is_success() {
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(json!({ "error": data })),
        ));
    }
    // Track pending title
    if let (Some(job_id), Some(title)) = (
        data.get("id").and_then(|v| v.as_str()),
        body.get("title").and_then(|v| v.as_str()),
    ) {
        st.pending_titles
            .lock()
            .await
            .insert(job_id.to_string(), title.to_string());
    }
    Ok(Json(data))
}

async fn generate_status(
    State(st): State<Arc<ShimState>>,
    AxPath(job_id): AxPath<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let resp = st
        .client
        .get(format!("{}/job/{}", st.ace_url, job_id))
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let data: Value = resp.json().await.unwrap_or(json!({}));
    Ok(Json(data))
}

async fn generate_history() -> Json<Value> {
    Json(json!({ "history": [] }))
}

async fn upload_audio(
    State(st): State<Arc<ShimState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let settings = settings::load_settings().await;
    let refs_dir = settings.references_dir();
    tokio::fs::create_dir_all(&refs_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    let fallback_stem = format!("ref_{}", chrono::Utc::now().timestamp_millis());
    let requested_name = headers
        .get("x-file-name")
        .or_else(|| headers.get("x-filename"))
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let ext = requested_name
        .as_deref()
        .and_then(|name| std::path::Path::new(name).extension().and_then(|e| e.to_str()))
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "mp3".into());
    let stem = requested_name
        .as_deref()
        .and_then(|name| std::path::Path::new(name).file_stem().and_then(|s| s.to_str()))
        .map(sanitize_upload_stem)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_stem);
    let mut filename = format!("{}.{}", stem, ext);
    let mut path = refs_dir.join(&filename);
    if path.exists() {
        let suffix = chrono::Utc::now().timestamp_millis();
        filename = format!("{}_{}.{}", stem, suffix, ext);
        path = refs_dir.join(&filename);
    }
    tokio::fs::write(&path, &body).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    let key = format!("references/{}", filename);
    Ok(Json(json!({
        "key":  key,
        "path": path.display().to_string(),
        "filename": filename,
        "original_filename": requested_name,
        "size": body.len(),
    })))
}

fn sanitize_upload_stem(input: &str) -> String {
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

async fn format_lyrics(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let resp = st
        .client
        .post(format!("{}/understand", st.ace_url))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let data: Value = resp.json().await.unwrap_or(json!({}));
    Ok(Json(data))
}

async fn analyze_audio(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Proxy audio analysis to ace-server
    let resp = st
        .client
        .post(format!("{}/analyze", st.ace_url))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let data: Value = resp.json().await.unwrap_or(json!({}));
    Ok(Json(data))
}

// ─── Library ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    sort_by: Option<String>,
    #[serde(default)]
    sort_dir: Option<String>,
}

async fn list_songs(Query(q): Query<ListQuery>) -> Json<Value> {
    let opts = ListOptions {
        limit: q.limit.unwrap_or(50),
        offset: q.offset.unwrap_or(0),
        sort_by: match q.sort_by.as_deref() {
            Some("title") => SortKey::Title,
            _ => SortKey::CreatedAt,
        },
        sort_dir: match q.sort_dir.as_deref() {
            Some("asc") => SortDir::Asc,
            _ => SortDir::Desc,
        },
    };
    let (tracks, total) = library::list_tracks(&library_path(), opts).await;
    Json(json!({ "tracks": tracks, "total": total }))
}

async fn create_song(
    Json(track): Json<LibraryTrack>,
) -> Result<Json<LibraryTrack>, (StatusCode, String)> {
    library::add_track(&library_path(), track)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_song(AxPath(id): AxPath<String>) -> Result<Json<LibraryTrack>, StatusCode> {
    library::get_track(&library_path(), &id)
        .await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn update_song(
    AxPath(id): AxPath<String>,
    Json(updates): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    match library::update_track(&library_path(), &id, updates).await {
        Ok(Some(t)) => Ok(Json(serde_json::to_value(t).unwrap_or(json!({})))),
        Ok(None) => Err((StatusCode::NOT_FOUND, "track not found".into())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn delete_song(AxPath(id): AxPath<String>) -> Result<Json<Value>, StatusCode> {
    match library::delete_track(&library_path(), &id).await {
        Ok(true) => Ok(Json(json!({ "deleted": true }))),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn list_playlists() -> Json<Value> {
    let idx = library::read_playlists(&playlists_path()).await;
    Json(json!({ "playlists": idx.playlists }))
}

async fn create_playlist(Json(p): Json<Playlist>) -> Result<Json<Playlist>, (StatusCode, String)> {
    library::add_playlist(&playlists_path(), p)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_playlist(AxPath(id): AxPath<String>) -> Result<Json<Playlist>, StatusCode> {
    let idx = library::read_playlists(&playlists_path()).await;
    idx.playlists
        .into_iter()
        .find(|p| p.id == id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn update_playlist(
    AxPath(id): AxPath<String>,
    Json(mut p): Json<Playlist>,
) -> Result<Json<Playlist>, (StatusCode, String)> {
    p.id = id;
    library::add_playlist(&playlists_path(), p)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn delete_playlist(AxPath(id): AxPath<String>) -> Result<Json<Value>, StatusCode> {
    match library::delete_playlist(&playlists_path(), &id).await {
        Ok(true) => Ok(Json(json!({ "deleted": true }))),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

// ─── Audio / Settings / Shell ─────────────────────────────────────────

async fn serve_audio(AxPath(key): AxPath<String>) -> Response {
    storage::serve_key(&key).await
}

async fn read_settings() -> Json<Value> {
    let s = settings::load_settings().await;
    Json(serde_json::to_value(s).unwrap_or(json!({})))
}

async fn write_settings(Json(s): Json<Settings>) -> Result<Json<Value>, (StatusCode, String)> {
    match settings::save_settings(s).await {
        Ok(saved) => Ok(Json(serde_json::to_value(saved).unwrap_or(json!({})))),
        Err(e) => Err((StatusCode::BAD_REQUEST, e.to_string())),
    }
}

#[derive(Deserialize)]
struct ShellOpenRequest {
    #[serde(default)]
    target: Option<String>,
}

async fn shell_open(Json(body): Json<ShellOpenRequest>) -> Json<Value> {
    let settings = settings::load_settings().await;
    let target = match body.target.as_deref() {
        Some("music") => settings.resolved_music_root(),
        Some("videos") => settings.resolved_videos_root(),
        Some("data") => everywear_paths::data_dir(crate::APPLET_ID),
        _ => settings.resolved_music_root(),
    };
    let _ = open::that(&target);
    Json(json!({ "opened": target.display().to_string() }))
}

async fn shell_reveal(Json(body): Json<Value>) -> Json<Value> {
    if let Some(path) = body.get("path").and_then(|v| v.as_str()) {
        let _ = open::that(path);
    }
    Json(json!({ "ok": true }))
}

async fn launcher_reveal_in_folder(Json(body): Json<Value>) -> Json<Value> {
    if let Some(path) = body.get("path").and_then(|v| v.as_str()) {
        let _ = open::that(path);
    }
    Json(json!({ "ok": true }))
}

// ─── Tier-gated stubs ─────────────────────────────────────────────────

async fn tier_gated_studio() -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error":   "Creator Studio tier required",
            "code":    501,
            "upgrade": true
        })),
    )
}

// ─── AI Director ──────────────────────────────────────────────────────

async fn director_analyze(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // TODO: wire to crate::ai_director::analyze_audio
    Ok(Json(json!({ "status": "not_implemented" })))
}

async fn director_plan(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // TODO: wire to crate::ai_director::shot_planner::plan_shots
    Ok(Json(json!({ "status": "not_implemented" })))
}

async fn director_lm_load(State(_st): State<Arc<ShimState>>) -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

async fn director_lm_unload(State(_st): State<Arc<ShimState>>) -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

async fn director_lm_status(State(_st): State<Arc<ShimState>>) -> Json<Value> {
    Json(json!({ "loaded": false, "model": null }))
}

// ─── Video ────────────────────────────────────────────────────────────

async fn save_video(
    State(_st): State<Arc<ShimState>>,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let settings = settings::load_settings().await;
    let vid_dir = settings.vid_dir();
    tokio::fs::create_dir_all(&vid_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    let filename = format!("vid_{}.mp4", chrono::Utc::now().timestamp_millis());
    let path = vid_dir.join(&filename);
    tokio::fs::write(&path, &body).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(json!({
        "path":     path.display().to_string(),
        "filename": filename,
        "size":     body.len(),
    })))
}

async fn list_videos() -> Json<Value> {
    let settings = settings::load_settings().await;
    let vid_dir = settings.vid_dir();
    let mut videos = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&vid_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                let meta = entry.metadata().ok();
                videos.push(json!({
                    "filename": entry.file_name().to_string_lossy(),
                    "path":     path.display().to_string(),
                    "size":     meta.as_ref().map(|m| m.len()),
                }));
            }
        }
    }
    Json(json!({ "videos": videos }))
}

async fn serve_video(AxPath(filename): AxPath<String>) -> Response {
    let settings = settings::load_settings().await;
    let path = settings.vid_dir().join(&filename);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, "video/mp4".parse().unwrap());
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
            (headers, Body::from(bytes)).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "video not found").into_response(),
    }
}

// ─── SRT Export ───────────────────────────────────────────────────────

async fn export_srt(Json(body): Json<Value>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let lrc = body.get("lrc").and_then(|v| v.as_str()).unwrap_or("");
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if lrc.is_empty() || path.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "lrc and path required" })),
        ));
    }
    // Simple LRC -> SRT conversion
    let srt_path = PathBuf::from(path).with_extension("srt");
    // TODO: implement proper LRC->SRT conversion
    tokio::fs::write(&srt_path, lrc).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(json!({ "path": srt_path.display().to_string() })))
}

// ─── Stems ────────────────────────────────────────────────────────────

async fn list_stems() -> Json<Value> {
    let settings = settings::load_settings().await;
    let stems_dir = settings.stems_dir();
    let mut groups = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&stems_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let mut tracks = Vec::new();
                if let Ok(subs) = std::fs::read_dir(entry.path()) {
                    for sub in subs.flatten() {
                        let ext = sub
                            .path()
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_string();
                        if matches!(ext.as_str(), "wav" | "mp3" | "flac" | "ogg") {
                            tracks.push(json!({
                                "filename": sub.file_name().to_string_lossy(),
                                "path":     sub.path().display().to_string(),
                            }));
                        }
                    }
                }
                groups.push(json!({ "name": name, "tracks": tracks }));
            }
        }
    }
    Json(json!({ "stems": groups }))
}

// ─── DAW Engine routes ────────────────────────────────────────────────

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
        .ok_or((StatusCode::BAD_REQUEST, "position_seconds is required".into()))?;
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
    let start_ms = body.start_ms.unwrap_or(engine.transport().loop_range.start_ms);
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

// ─── Diagnostics ──────────────────────────────────────────────────────

async fn diag_log(Json(body): Json<Value>) -> Json<Value> {
    if let Some(msg) = body.get("message").and_then(|v| v.as_str()) {
        tracing::info!(target: "spa.diag", "{}", msg);
    }
    Json(json!({ "ok": true }))
}

async fn diag_event(Json(body): Json<Value>) -> Json<Value> {
    tracing::debug!(target: "spa.event", "{}", body);
    Json(json!({ "ok": true }))
}
