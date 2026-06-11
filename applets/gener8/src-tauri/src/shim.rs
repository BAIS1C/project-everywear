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
use std::io::Cursor;
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

mod daw;

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
        .route("/api/engine/pack-status", get(pack_status))
        .route("/api/engine/install-pack", post(install_pack))
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
        .merge(daw::routes())
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
    Ok(Json(normalize_model_inventory(&props)))
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
    Json(normalize_model_inventory(&props))
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

// ─── Model pack status / install ───────────────────────────────────────────

const PRO_CAPABILITY_PACK_ID: &str = "pro_base";
const PRO_MANIFEST_PACK_ID: &str = "better_models";

#[derive(Deserialize)]
struct PackStatusQuery {
    #[serde(default)]
    pack_id: Option<String>,
}

#[derive(Deserialize)]
struct InstallPackRequest {
    pack_id: String,
}

fn manifest_pack_id(pack_id: &str) -> &str {
    match pack_id {
        PRO_CAPABILITY_PACK_ID => PRO_MANIFEST_PACK_ID,
        other => other,
    }
}

fn canonical_pack_id(manifest_pack_id: &str) -> &str {
    match manifest_pack_id {
        PRO_MANIFEST_PACK_ID => PRO_CAPABILITY_PACK_ID,
        other => other,
    }
}

fn current_tier_for_model_manager(tier: crate::LicenceTier) -> model_manager::LicenceTier {
    match tier {
        crate::LicenceTier::Demo => model_manager::LicenceTier::Demo,
        crate::LicenceTier::Gener8 => model_manager::LicenceTier::Gener8,
        crate::LicenceTier::Gener8Pro => model_manager::LicenceTier::Gener8Pro,
        crate::LicenceTier::CreatorStudio => model_manager::LicenceTier::CreatorStudio,
    }
}

fn load_applet_manifest() -> Result<model_manager::AppletManifest, String> {
    model_manager::AppletManifest::from_toml(include_str!("../../applet.toml"))
        .map_err(|error| format!("failed to parse Gener8 applet manifest: {error}"))
}

fn model_type_for_role(
    role: &model_manager::ModelRole,
    engine_type: &str,
) -> model_manager::ModelType {
    match role {
        model_manager::ModelRole::Encoder
        | model_manager::ModelRole::TextEncoder
        | model_manager::ModelRole::Projection => model_manager::ModelType::Encoder,
        model_manager::ModelRole::Vae
        | model_manager::ModelRole::VideoVae
        | model_manager::ModelRole::AudioVae => model_manager::ModelType::Vae,
        _ => match engine_type {
            "llm" => model_manager::ModelType::Llm,
            "audio" => model_manager::ModelType::Audio,
            _ => model_manager::ModelType::TextToImage,
        },
    }
}

fn pack_model_info(
    manifest: &model_manager::AppletManifest,
    pack_id: &str,
    vram_mb: u64,
) -> Result<(model_manager::ModelInfo, Value, model_manager::LicenceTier), String> {
    let pack = manifest
        .upgrade_packs
        .get(pack_id)
        .ok_or_else(|| format!("unknown model pack: {pack_id}"))?;

    if pack.status != "active" {
        return Err(format!("model pack is not downloadable yet: {pack_id}"));
    }

    if let Some(file) = &pack.file {
        let info = model_manager::ModelInfo {
            key: file.key.clone(),
            name: format!("{} ({})", pack.label, file.key),
            filename: file.filename.clone(),
            size_bytes: file.size_bytes,
            sha256: file.sha256.clone(),
            hf_repo: file.hf_repo.clone(),
            hf_file: file.hf_file.clone(),
            model_type: model_type_for_role(&file.role, &manifest.engine.engine_type),
            path: None,
            downloaded: false,
        };
        let plan = json!({
            "filename": file.filename.clone(),
            "role": format!("{:?}", file.role),
            "quant": null,
            "size_bytes": file.size_bytes,
            "key": file.key.clone(),
        });
        return Ok((info, plan, pack.min_tier));
    }

    let selected = model_manager::AppletManifest::select_pack_quant(pack, vram_mb)
        .ok_or_else(|| format!("no quant in pack {pack_id} fits {vram_mb} MB VRAM"))?;
    let info = model_manager::ModelInfo {
        key: selected.key.clone(),
        name: format!("{} {} ({})", pack.label, selected.quant, selected.key),
        filename: selected.filename.clone(),
        size_bytes: selected.size_bytes,
        sha256: selected.sha256.clone(),
        hf_repo: selected.hf_repo.clone(),
        hf_file: selected.hf_file.clone(),
        model_type: model_type_for_role(&selected.role, &manifest.engine.engine_type),
        path: None,
        downloaded: false,
    };
    let plan = json!({
        "filename": selected.filename.clone(),
        "role": format!("{:?}", selected.role),
        "quant": selected.quant.clone(),
        "size_bytes": selected.size_bytes,
        "key": selected.key.clone(),
    });
    Ok((info, plan, pack.min_tier))
}

fn pack_error(status: StatusCode, error: impl Into<String>) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "error": error.into(),
        })),
    )
}

async fn pack_status(
    State(st): State<Arc<ShimState>>,
    Query(query): Query<PackStatusQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let requested_id = query
        .pack_id
        .unwrap_or_else(|| PRO_CAPABILITY_PACK_ID.to_string());
    let manifest_id = manifest_pack_id(&requested_id).to_string();
    let manifest = load_applet_manifest()
        .map_err(|error| pack_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    let (model, plan, required_tier) =
        pack_model_info(&manifest, &manifest_id, u64::from(st.vram_mb))
            .map_err(|error| pack_error(StatusCode::BAD_REQUEST, error))?;

    let actual_tier = current_tier(&st).await;
    let actual_model_tier = current_tier_for_model_manager(actual_tier);
    if !actual_model_tier.satisfies(required_tier) {
        return Err(upgrade_required_with_actual(
            required_tier.as_str(),
            actual_tier,
        ));
    }

    let mut model_mgr = model_manager::ModelManager::global();
    model_mgr.add_models(vec![model.clone()]);
    model_mgr.scan();
    let present = model_mgr.is_downloaded(&model.key);

    Ok(Json(json!({
        "pack_id": canonical_pack_id(&manifest_id),
        "requested_pack_id": requested_id,
        "manifest_pack_id": manifest_id,
        "present": present,
        "bytes_total": model.size_bytes,
        "vram_mb": st.vram_mb,
        "plan": [plan],
    })))
}

fn sse_body(frames: Vec<(&str, Value)>) -> String {
    frames
        .into_iter()
        .map(|(event, data)| format!("event: {event}\ndata: {data}\n\n"))
        .collect::<Vec<_>>()
        .join("")
}

fn sse_response(status: StatusCode, body: String) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn install_pack(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<InstallPackRequest>,
) -> Response {
    let requested_id = if body.pack_id.trim().is_empty() {
        PRO_CAPABILITY_PACK_ID.to_string()
    } else {
        body.pack_id
    };
    let manifest_id = manifest_pack_id(&requested_id).to_string();

    let manifest = match load_applet_manifest() {
        Ok(manifest) => manifest,
        Err(error) => {
            return sse_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                sse_body(vec![("error", json!({ "error": error }))]),
            );
        }
    };
    let (model, plan, required_tier) =
        match pack_model_info(&manifest, &manifest_id, u64::from(st.vram_mb)) {
            Ok(resolved) => resolved,
            Err(error) => {
                return sse_response(
                    StatusCode::BAD_REQUEST,
                    sse_body(vec![("error", json!({ "error": error }))]),
                );
            }
        };

    let actual_tier = current_tier(&st).await;
    let actual_model_tier = current_tier_for_model_manager(actual_tier);
    if !actual_model_tier.satisfies(required_tier) {
        return sse_response(
            StatusCode::FORBIDDEN,
            sse_body(vec![(
                "error",
                json!({
                    "error": "upgrade_required",
                    "required_tier": required_tier.as_str(),
                    "actual_tier": actual_tier.as_str(),
                }),
            )]),
        );
    }

    let mut model_mgr = model_manager::ModelManager::global();
    model_mgr.add_models(vec![model.clone()]);
    model_mgr.scan();

    let mut frames = vec![(
        "plan",
        json!({
            "pack_id": canonical_pack_id(&manifest_id),
            "requested_pack_id": requested_id,
            "manifest_pack_id": manifest_id,
            "bytes_total": model.size_bytes,
            "plan": [plan],
        }),
    )];

    if model_mgr.is_downloaded(&model.key) {
        frames.push((
            "done",
            json!({
                "pack_id": canonical_pack_id(&manifest_id),
                "already_present": true,
            }),
        ));
        return sse_response(StatusCode::OK, sse_body(frames));
    }

    match model_mgr.download(&model.key, |_| {}).await {
        Ok(path) => {
            frames.push((
                "progress",
                json!({
                    "overall_pct": 100.0,
                    "bytes_done_global": model.size_bytes,
                    "bytes_total_global": model.size_bytes,
                    "file": model.filename,
                    "role": "Primary",
                }),
            ));
            frames.push((
                "done",
                json!({
                    "pack_id": canonical_pack_id(&manifest_id),
                    "path": path.display().to_string(),
                }),
            ));
            sse_response(StatusCode::OK, sse_body(frames))
        }
        Err(error) => sse_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            sse_body(vec![(
                "error",
                json!({
                    "error": error.to_string(),
                    "pack_id": canonical_pack_id(&manifest_id),
                }),
            )]),
        ),
    }
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
    let (gpu, used_mb, diagnostic_total_mb) = match vram.as_ref() {
        Some(v) => (Some(v.gpu.as_str()), Some(v.used_mb), Some(v.total_mb)),
        None => (None, None, None),
    };
    Json(json!({
        "data": {
            "engine":        "acestep.cpp",
            "runtime":       "gguf",
            "gpu":           gpu,
            "vram_used_mb":  used_mb,
            "vram_total_mb": st.vram_mb,
            "diagnostic_vram_total_mb": diagnostic_total_mb,
            "source": "everywear-shell",
            "diagnostic_source": "nvidia-smi-fallback",
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

#[derive(Deserialize)]
struct GenerateRequest {
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    lyrics: Option<String>,
    #[serde(default = "d_180_i")]
    duration: i64,
    #[serde(default = "d_neg1")]
    seed: i64,
    #[serde(alias = "inferenceSteps", alias = "inference_steps", default = "d_8")]
    steps: u32,
    #[serde(alias = "guidanceScale", alias = "cfg_scale", default = "d_1_0")]
    guidance_scale: f32,
    #[serde(default = "d_3_0")]
    shift: f32,
    #[serde(alias = "inferMethod", alias = "infer_method", default)]
    method: Option<String>,
    #[serde(alias = "use_cot_caption", alias = "useCotCaption", default = "d_true")]
    use_cot: bool,
    #[serde(alias = "audioUrl", default)]
    audio_url: Option<String>,
    #[serde(alias = "batch", alias = "batchSize", default = "d_1")]
    batch_size: u32,
}

fn d_180_i() -> i64 {
    180
}
fn d_neg1() -> i64 {
    -1
}
fn d_8() -> u32 {
    8
}
fn d_1_0() -> f32 {
    1.0
}
fn d_3_0() -> f32 {
    3.0
}
fn d_1() -> u32 {
    1
}
fn d_true() -> bool {
    true
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str().map(str::to_string))
}

fn u(v: &Value, k: &str) -> Option<u32> {
    let x = v.get(k)?;
    let n: Option<u64> = x
        .as_u64()
        .or_else(|| x.as_i64().and_then(|n| (n >= 0).then_some(n as u64)))
        .or_else(|| x.as_f64().and_then(|n| (n >= 0.0).then_some(n as u64)))
        .or_else(|| x.as_str().and_then(|s| s.trim().parse::<u64>().ok()));
    n.map(|n| n as u32)
}

fn i(v: &Value, k: &str) -> Option<i64> {
    let x = v.get(k)?;
    x.as_i64()
        .or_else(|| x.as_f64().map(|n| n as i64))
        .or_else(|| x.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

fn f(v: &Value, k: &str) -> Option<f32> {
    let x = v.get(k)?;
    x.as_f64()
        .or_else(|| x.as_i64().map(|n| n as f64))
        .or_else(|| x.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
        .map(|n| n as f32)
}

fn b(v: &Value, k: &str) -> Option<bool> {
    let x = v.get(k)?;
    x.as_bool()
        .or_else(|| {
            x.as_str()
                .and_then(|s| match s.trim().to_ascii_lowercase().as_str() {
                    "true" | "1" | "yes" | "on" => Some(true),
                    "false" | "0" | "no" | "off" => Some(false),
                    _ => None,
                })
        })
        .or_else(|| x.as_u64().map(|n| n != 0))
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(encoded: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .unwrap_or_default()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn strip_audio_url_to_key(url: &str) -> Option<String> {
    let u = url.trim();
    if let Some(idx) = u.find("/audio/") {
        return Some(
            u[idx + "/audio/".len()..]
                .split(['?', '#'])
                .next()?
                .to_string(),
        );
    }
    u.strip_prefix("audio/")
        .map(|s| s.split(['?', '#']).next().unwrap_or(s).to_string())
}

async fn resolve_audio_request_b64(label: &str, audio_path_raw: &str) -> String {
    if audio_path_raw.is_empty() {
        return String::new();
    }
    let key = strip_audio_url_to_key(audio_path_raw)
        .unwrap_or_else(|| audio_path_raw.trim_start_matches('/').to_string());
    let settings = settings::load_settings().await;
    if let Some(path) = storage::resolve_key(&settings, &key) {
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                tracing::info!(
                    "generate: resolved {} audio {} ({} bytes)",
                    label,
                    path.display(),
                    bytes.len()
                );
                base64_encode(&bytes)
            }
            Err(e) => {
                tracing::warn!(
                    "generate: {} audio read failed at {}: {}",
                    label,
                    path.display(),
                    e
                );
                String::new()
            }
        }
    } else {
        tracing::warn!(
            "generate: {} audio key '{}' could not be resolved",
            label,
            key
        );
        String::new()
    }
}

async fn current_tier(state: &Arc<ShimState>) -> crate::LicenceTier {
    if let Some(rec) = &state.reconciler {
        return rec.current_tier().await;
    }
    crate::LicenceTier::Demo
}

fn tier_is_pro(tier: crate::LicenceTier) -> bool {
    matches!(
        tier,
        crate::LicenceTier::Gener8Pro | crate::LicenceTier::CreatorStudio
    )
}

fn tier_is_creator(tier: crate::LicenceTier) -> bool {
    matches!(tier, crate::LicenceTier::CreatorStudio)
}

fn upgrade_required_with_actual(
    required_tier: &str,
    actual_tier: crate::LicenceTier,
) -> (StatusCode, Json<Value>) {
    (
        StatusCode::PAYMENT_REQUIRED,
        Json(json!({
            "error": "upgrade_required",
            "required_tier": required_tier,
            "actual_tier": actual_tier.as_str(),
            "message": format!(
                "This feature requires {} or higher. Current shell tier is {}.",
                required_tier,
                actual_tier.as_str()
            )
        })),
    )
}

fn probe_audio_duration_seconds(bytes: &[u8], mime: &str) -> Option<f64> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    if bytes.is_empty() {
        return None;
    }
    let mss = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    let ext = match mime {
        "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        _ => "mp3",
    };
    hint.with_extension(ext);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)?;
    let sample_rate = track.codec_params.sample_rate? as f64;
    track.codec_params.n_frames.and_then(|n_frames| {
        let duration = n_frames as f64 / sample_rate;
        (duration > 0.0 && duration.is_finite()).then_some(duration)
    })
}

fn build_track_filename(title: Option<&str>, id: &str) -> String {
    let short_id: String = id.chars().take(8).collect();
    let cleaned = title
        .map(sanitise_title)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Untitled".to_string());
    if short_id.is_empty() {
        cleaned
    } else {
        format!("{}_{}", cleaned, short_id)
    }
}

fn sanitise_title(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_underscore = false;
    for ch in input.chars() {
        let keep = ch.is_ascii_alphanumeric()
            || ch == ' '
            || ch == '-'
            || ch == '_'
            || ch == '('
            || ch == ')'
            || ch == '.';
        if keep {
            out.push(ch);
            last_underscore = ch == '_';
        } else if !last_underscore {
            out.push('_');
            last_underscore = true;
        }
    }
    out.trim_matches(|c: char| c == '.' || c.is_whitespace())
        .chars()
        .take(64)
        .collect()
}

// ─── Generate ─────────────────────────────────────────────────────────

async fn generate(
    State(st): State<Arc<ShimState>>,
    Json(raw): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let body: GenerateRequest = serde_json::from_value(raw.clone()).unwrap_or_else(|e| {
        tracing::warn!(
            "generate: strict decode failed ({}); coercing from raw JSON: {}",
            e,
            raw
        );
        GenerateRequest {
            task: s(&raw, "task").or_else(|| s(&raw, "taskType")),
            style: s(&raw, "style"),
            prompt: s(&raw, "prompt"),
            lyrics: s(&raw, "lyrics"),
            duration: i(&raw, "duration").unwrap_or(180),
            seed: i(&raw, "seed").unwrap_or(-1),
            steps: u(&raw, "steps")
                .or_else(|| u(&raw, "inferenceSteps"))
                .unwrap_or(8),
            guidance_scale: f(&raw, "guidance_scale")
                .or_else(|| f(&raw, "guidanceScale"))
                .or_else(|| f(&raw, "cfg_scale"))
                .unwrap_or(1.0),
            shift: f(&raw, "shift").unwrap_or(3.0),
            method: s(&raw, "method").or_else(|| s(&raw, "inferMethod")),
            use_cot: b(&raw, "use_cot")
                .or_else(|| b(&raw, "use_cot_caption"))
                .or_else(|| b(&raw, "useCotCaption"))
                .unwrap_or(false),
            audio_url: s(&raw, "audio_url").or_else(|| s(&raw, "audioUrl")),
            batch_size: u(&raw, "batch_size")
                .or_else(|| u(&raw, "batch"))
                .or_else(|| u(&raw, "batchSize"))
                .unwrap_or(1),
        }
    });

    let duration: u32 = if body.duration <= 0 {
        180
    } else {
        body.duration as u32
    };
    let task_type = body
        .task
        .clone()
        .or_else(|| s(&raw, "task_type"))
        .or_else(|| s(&raw, "taskType"))
        .unwrap_or_else(|| "text2music".into());
    let effective_task_type = if task_type == "cover" {
        "cover-nofsq".to_string()
    } else {
        task_type.clone()
    };

    let source_audio_path_raw = s(&raw, "sourceAudioUrl")
        .or_else(|| s(&raw, "source_audio_url"))
        .or_else(|| body.audio_url.clone())
        .unwrap_or_default();
    let reference_audio_path_raw = s(&raw, "referenceAudioUrl")
        .or_else(|| s(&raw, "reference_audio_url"))
        .unwrap_or_default();

    let wants_reference_audio = !reference_audio_path_raw.trim().is_empty();
    let wants_cover = matches!(effective_task_type.as_str(), "cover" | "cover-nofsq");
    if wants_reference_audio || wants_cover {
        let tier = current_tier(&st).await;
        tracing::info!(
            "generate: gated path requested (reference_audio={} cover={}) tier={}",
            wants_reference_audio,
            wants_cover,
            tier.as_str()
        );
        if !tier_is_pro(tier) {
            return Err(upgrade_required_with_actual("gener8_pro", tier));
        }
    }

    let source_audio_b64 = resolve_audio_request_b64("source", &source_audio_path_raw).await;
    let mut ref_audio_b64 = resolve_audio_request_b64("reference", &reference_audio_path_raw).await;
    if ref_audio_b64.is_empty()
        && effective_task_type == "cover-nofsq"
        && !source_audio_b64.is_empty()
    {
        ref_audio_b64 = source_audio_b64.clone();
    }

    let audio_path_raw = if source_audio_path_raw.is_empty() {
        reference_audio_path_raw.clone()
    } else {
        source_audio_path_raw.clone()
    };
    let audio_codes = s(&raw, "audio_codes")
        .or_else(|| s(&raw, "audioCodes"))
        .unwrap_or_default();
    let needs_source_audio = matches!(
        effective_task_type.as_str(),
        "cover" | "cover-nofsq" | "repaint" | "extract" | "lego" | "complete"
    );
    if needs_source_audio && source_audio_b64.is_empty() && audio_codes.is_empty() {
        tracing::warn!(
            "generate: task_type={} requested source audio but none resolved from '{}'",
            effective_task_type,
            audio_path_raw
        );
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "missing_source_audio",
                "message": "This generation mode requires source audio, but the source could not be resolved."
            })),
        ));
    }

    let synth_model_raw = s(&raw, "synth_model")
        .or_else(|| s(&raw, "synthModel"))
        .or_else(|| s(&raw, "model"))
        .unwrap_or_default();
    let synth_model = if synth_model_raw.is_empty() {
        let preferred = st
            .preferred_dit
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        // 2026-06-12 SGT: extract/lego/complete/cover are xl-base-only tasks
        // (see supported_task_types), but preferred_dit deliberately prefers
        // turbo and never selects xl-base. Unqualified requests for these
        // tasks were therefore dispatched to a model that cannot run them —
        // this is what broke DAW stem extraction (12/12 instant failures,
        // Sean smoke test 06-11; the xl-base pack was installed and working
        // the whole time). Resolve the installed xl-base dit from the engine
        // itself. NOTE: this also routes unqualified cover requests to
        // xl-base, per the engine's own capability table.
        let needs_base = matches!(
            effective_task_type.as_str(),
            "cover" | "cover-nofsq" | "repaint" | "extract" | "lego" | "complete" | "reference"
        );
        if needs_base && !preferred.to_ascii_lowercase().contains("xl-base") {
            let base_name = match st
                .client
                .get(format!("{}/props", st.ace_url))
                .timeout(Duration::from_millis(1500))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    resp.json::<Value>().await.ok().and_then(|props| {
                        props
                            .get("models")
                            .and_then(|m| m.get("dit"))
                            .and_then(Value::as_array)
                            .and_then(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str())
                                    .find(|n| n.to_ascii_lowercase().contains("xl-base"))
                                    .map(str::to_string)
                            })
                    })
                }
                _ => None,
            };
            base_name.unwrap_or(preferred)
        } else {
            preferred
        }
    } else {
        synth_model_raw
    };
    let lm_model = s(&raw, "lm_model")
        .or_else(|| s(&raw, "lmModel"))
        .unwrap_or_default();
    let caption = body
        .style
        .clone()
        .or(body.prompt.clone())
        .unwrap_or_default();
    let lyrics = body.lyrics.clone().unwrap_or_default();
    let keyscale = s(&raw, "keyscale")
        .or_else(|| s(&raw, "keyScale"))
        .unwrap_or_default();
    let timesignature = s(&raw, "timesignature")
        .or_else(|| s(&raw, "timeSignature"))
        .unwrap_or_default();
    let vocal_language = s(&raw, "vocal_language")
        .or_else(|| s(&raw, "vocalLanguage"))
        .unwrap_or_default();
    let lm_neg_prompt = s(&raw, "lm_negative_prompt")
        .or_else(|| s(&raw, "lmNegativePrompt"))
        .unwrap_or_default();
    let track = s(&raw, "track")
        .or_else(|| s(&raw, "trackName"))
        .or_else(|| s(&raw, "track_name"))
        .unwrap_or_default();
    let bpm = u(&raw, "bpm").unwrap_or(0) as i64;
    let lm_batch_size = u(&raw, "lm_batch_size")
        .or_else(|| u(&raw, "lmBatchSize"))
        .unwrap_or(1);
    let lm_top_k = u(&raw, "lm_top_k")
        .or_else(|| u(&raw, "lmTopK"))
        .unwrap_or(0);
    let lm_temperature = f(&raw, "lm_temperature")
        .or_else(|| f(&raw, "lmTemperature"))
        .unwrap_or(0.85);
    let lm_cfg_scale = f(&raw, "lm_cfg_scale")
        .or_else(|| f(&raw, "lmCfgScale"))
        .unwrap_or(2.0);
    let lm_top_p = f(&raw, "lm_top_p")
        .or_else(|| f(&raw, "lmTopP"))
        .unwrap_or(0.9);
    let audio_cover_strength = f(&raw, "audio_cover_strength")
        .or_else(|| f(&raw, "audioCoverStrength"))
        .unwrap_or(1.0);
    let cover_noise_strength = f(&raw, "cover_noise_strength")
        .or_else(|| f(&raw, "coverNoiseStrength"))
        .unwrap_or(0.0);
    let repainting_start = f(&raw, "repainting_start")
        .or_else(|| f(&raw, "repaintingStart"))
        .unwrap_or(0.0);
    let repainting_end = f(&raw, "repainting_end")
        .or_else(|| f(&raw, "repaintingEnd"))
        .unwrap_or(-1.0);
    let repaint_strength = f(&raw, "repaint_strength")
        .or_else(|| f(&raw, "repaintStrength"))
        .unwrap_or(1.0);
    let peak_clip = f(&raw, "peak_clip")
        .or_else(|| f(&raw, "peakClip"))
        .unwrap_or(1.0);

    let ace_req = json!({
        "synth_model": synth_model,
        "lm_model": lm_model,
        "caption": caption,
        "lyrics": lyrics,
        "keyscale": keyscale,
        "timesignature": timesignature,
        "vocal_language": vocal_language,
        "audio_codes": audio_codes,
        "audio": source_audio_b64,
        "lm_negative_prompt": lm_neg_prompt,
        "task_type": effective_task_type,
        "track": track,
        "infer_method": body.method.clone().unwrap_or_else(|| "ode".into()),
        "bpm": bpm,
        "duration": duration,
        "seed": body.seed,
        "inference_steps": body.steps,
        "guidance_scale": body.guidance_scale,
        "shift": body.shift,
        "synth_batch_size": body.batch_size,
        "lm_batch_size": lm_batch_size,
        "lm_top_k": lm_top_k,
        "lm_temperature": lm_temperature,
        "lm_cfg_scale": lm_cfg_scale,
        "lm_top_p": lm_top_p,
        "audio_cover_strength": audio_cover_strength,
        "cover_noise_strength": cover_noise_strength,
        "repainting_start": repainting_start,
        "repainting_end": repainting_end,
        "repaint_strength": repaint_strength,
        "peak_clip": peak_clip,
        "use_cot_caption": body.use_cot,
    });

    let audio_format = s(&raw, "audioFormat")
        .or_else(|| s(&raw, "audio_format"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let synth_path = if matches!(audio_format.as_str(), "flac" | "wav" | "wave" | "lossless") {
        "/synth?format=wav24"
    } else {
        "/synth"
    };

    let submit = if !source_audio_b64.is_empty() || !ref_audio_b64.is_empty() {
        let mut req_json = ace_req.clone();
        if let Some(obj) = req_json.as_object_mut() {
            obj.remove("audio");
        }
        let mut form = Form::new().part(
            "request",
            Part::text(req_json.to_string())
                .mime_str("application/json")
                .unwrap(),
        );
        let audio_bytes = base64_decode(&source_audio_b64);
        let ref_audio_bytes = base64_decode(&ref_audio_b64);
        if !audio_bytes.is_empty() {
            form = form.part(
                "audio",
                Part::bytes(audio_bytes)
                    .file_name("source.mp3")
                    .mime_str("audio/mpeg")
                    .unwrap(),
            );
        }
        if !ref_audio_bytes.is_empty() {
            form = form.part(
                "ref_audio",
                Part::bytes(ref_audio_bytes)
                    .file_name("reference.mp3")
                    .mime_str("audio/mpeg")
                    .unwrap(),
            );
        }
        st.client
            .post(format!("{}{}", st.ace_url, synth_path))
            .multipart(form)
            .send()
            .await
    } else {
        st.client
            .post(format!("{}{}", st.ace_url, synth_path))
            .json(&ace_req)
            .send()
            .await
    };

    match submit {
        Ok(r) if r.status().is_success() => {
            let resp: Value = r.json().await.unwrap_or(json!({}));
            let id_str: Option<String> = resp
                .get("id")
                .and_then(|v| v.as_str().map(str::to_string))
                .or_else(|| {
                    resp.get("id")
                        .and_then(|v| v.as_u64())
                        .map(|n| n.to_string())
                });
            if let Some(id) = id_str {
                if let Some(title) = s(&raw, "title") {
                    let trimmed = title.trim();
                    if !trimmed.is_empty() {
                        st.pending_titles
                            .lock()
                            .await
                            .insert(id.clone(), trimmed.to_string());
                    }
                }
                if task_type == "extract" {
                    let source_song_title = s(&raw, "sourceSongTitle")
                        .or_else(|| s(&raw, "source_song_title"))
                        .unwrap_or_else(|| "Unknown".into());
                    let track_name = s(&raw, "trackName")
                        .or_else(|| s(&raw, "track_name"))
                        .or_else(|| s(&raw, "track"))
                        .unwrap_or_else(|| "stem".into());
                    st.pending_stem_meta.lock().await.insert(
                        id.clone(),
                        StemJobMeta {
                            source_song_title,
                            track_name,
                        },
                    );
                }
                return Ok(Json(json!({
                    "id": id,
                    "jobId": format!("gen_{}", id),
                    "status": "running",
                    "queuePosition": resp.get("queue_position").cloned(),
                    "etaSeconds": resp.get("eta_seconds").cloned(),
                })));
            }

            if let Some(b64) = resp.get("audio_base64").and_then(|v| v.as_str()) {
                return Ok(Json(json!({
                    "jobId": format!("gen_{}", now_ms()),
                    "status": "succeeded",
                    "result": {
                        "audioBase64": b64,
                        "audioContentType": resp.get("content_type").and_then(|v| v.as_str()).unwrap_or("audio/mpeg"),
                        "duration": duration,
                        "seed": body.seed,
                    }
                })));
            }

            Err((
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "bad_engine_response",
                    "message": "The engine returned an unexpected generation response."
                })),
            ))
        }
        Ok(r) => {
            let status = StatusCode::from_u16(r.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let body_txt = r.text().await.unwrap_or_default();
            Err((
                status,
                Json(json!({ "error": "engine_rejected", "message": body_txt })),
            ))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "engine_unreachable", "message": e.to_string() })),
        )),
    }
}

async fn generate_status(
    State(st): State<Arc<ShimState>>,
    AxPath(job_id): AxPath<String>,
) -> Json<Value> {
    let id = job_id.trim_start_matches("gen_").to_string();
    if id.is_empty() {
        return Json(json!({
            "jobId": job_id,
            "status": "failed",
            "error": "invalid job id"
        }));
    }

    let mut poll_result = None;
    for attempt in 0..3u32 {
        let poll = st
            .client
            .get(format!("{}/job?id={}", st.ace_url, id))
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        match poll {
            Ok(r) if r.status().is_success() => {
                poll_result = Some(r.json::<Value>().await.unwrap_or(json!({})));
                break;
            }
            Ok(r) => {
                tracing::warn!(
                    "ace-server /job?id={} returned {} (attempt {})",
                    id,
                    r.status(),
                    attempt
                );
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                return Json(json!({
                    "jobId": job_id,
                    "status": "failed",
                    "error": format!("engine returned {}", r.status())
                }));
            }
            Err(e) => {
                tracing::warn!(
                    "ace-server /job?id={} unreachable (attempt {}): {}",
                    id,
                    attempt,
                    e
                );
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                return Json(json!({
                    "jobId": job_id,
                    "status": "loading",
                    "message": "Engine loading model into GPU, please wait..."
                }));
            }
        }
    }

    let status = poll_result.unwrap_or_else(|| json!({ "status": "running" }));
    let state_str = status.get("status").and_then(|s| s.as_str()).unwrap_or("");
    match state_str {
        "done" | "complete" | "completed" | "succeeded" => {
            let result_resp = st
                .client
                .get(format!("{}/job?id={}&result=1", st.ace_url, id))
                .send()
                .await;
            let (bytes, content_type) = match result_resp {
                Ok(r) if r.status().is_success() => {
                    let ct = r
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("audio/mpeg")
                        .to_string();
                    let b = r.bytes().await.unwrap_or_default().to_vec();
                    (b, ct)
                }
                _ => (Vec::new(), "audio/mpeg".to_string()),
            };

            let ext = match content_type.as_str() {
                "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
                "audio/flac" | "audio/x-flac" => "flac",
                "audio/ogg" | "application/ogg" => "ogg",
                "audio/mp4" | "audio/x-m4a" => "m4a",
                _ => "mp3",
            };
            let title = st.pending_titles.lock().await.remove(&id);
            let stem_meta = st.pending_stem_meta.lock().await.remove(&id);
            let audio_key = if let Some(ref sm) = stem_meta {
                format!(
                    "stems/{}/{}.{}",
                    sanitise_title(&sm.source_song_title),
                    sanitise_title(&sm.track_name),
                    ext
                )
            } else {
                format!(
                    "gener8/{}.{}",
                    build_track_filename(title.as_deref(), &id),
                    ext
                )
            };

            let mut audio_urls: Vec<String> = Vec::new();
            let mut persisted_key: Option<String> = None;
            let mut file_path: Option<String> = None;
            if !bytes.is_empty() {
                match storage::write_audio(&audio_key, &bytes).await {
                    Ok(path) => {
                        tracing::info!("wrote audio to {}", path.display());
                        persisted_key = Some(audio_key.clone());
                        file_path = Some(path.display().to_string());
                        audio_urls.push(format!("/audio/{}", audio_key));
                    }
                    Err(e) => tracing::error!("failed to persist audio {}: {}", audio_key, e),
                }
            }

            let ace_result = status.get("result");
            let field = |key: &str| -> Option<Value> {
                ace_result
                    .and_then(|r| r.get(key))
                    .cloned()
                    .or_else(|| status.get(key).cloned())
            };
            let probed_duration =
                probe_audio_duration_seconds(&bytes, &content_type).map(Value::from);
            let duration_value = probed_duration.or_else(|| field("duration"));
            let audio_b64 = if bytes.is_empty() {
                String::new()
            } else {
                base64_encode(&bytes)
            };

            Json(json!({
                "jobId": job_id,
                "status": "succeeded",
                "audio_url": audio_urls.first().cloned(),
                "file_path": file_path,
                "title": title,
                "duration": duration_value,
                "result": {
                    "audioUrls": audio_urls,
                    "audioKey": persisted_key,
                    "filePath": file_path,
                    "audioBase64": audio_b64,
                    "audioContentType": content_type,
                    "duration": duration_value,
                    "bpm": field("bpm"),
                    "keyScale": field("key_scale").or_else(|| field("keyScale")),
                    "timeSignature": field("time_signature").or_else(|| field("timeSignature")),
                    "lrcData": field("lrc_data").or_else(|| field("lrcData")),
                    "warnings": field("warnings").unwrap_or(json!([]))
                }
            }))
        }
        "error" | "failed" => Json(json!({
            "jobId": job_id,
            "status": "failed",
            "error": status.get("error").and_then(|e| e.as_str()).unwrap_or("generation failed")
        })),
        "queued" | "pending" => Json(json!({
            "jobId": job_id,
            "status": "queued",
            "queuePosition": status.get("queue_position").cloned(),
            "etaSeconds": status.get("eta_seconds").cloned()
        })),
        _ => Json(json!({
            "jobId": job_id,
            "status": "running",
            "progress": status.get("progress").cloned()
        })),
    }
}

async fn generate_history() -> Json<Value> {
    Json(json!({ "jobs": [] }))
}

async fn upload_audio(
    State(st): State<Arc<ShimState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tier = current_tier(&st).await;
    if !tier_is_pro(tier) {
        return Err(upgrade_required_with_actual("gener8_pro", tier));
    }
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
        .and_then(|name| {
            std::path::Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
        })
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "mp3".into());
    let stem = requested_name
        .as_deref()
        .and_then(|name| {
            std::path::Path::new(name)
                .file_stem()
                .and_then(|s| s.to_str())
        })
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

async fn tier_gated_studio(State(st): State<Arc<ShimState>>) -> (StatusCode, Json<Value>) {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return upgrade_required_with_actual("creator_studio", tier);
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "not_implemented",
            "required_tier": "creator_studio",
            "message": "Creator Studio endpoint is gated and reserved for the local engine implementation.",
            "code": 501
        })),
    )
}

// ─── AI Director ──────────────────────────────────────────────────────

async fn director_analyze(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return Err(upgrade_required_with_actual("creator_studio", tier));
    }
    let audio_path = body
        .get("audio_path")
        .or_else(|| body.get("audioPath"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "audio_path_required" })),
            )
        })?;
    crate::ai_director::analyze_audio(&st.beats, audio_path, tier)
        .await
        .map(|beat_map| Json(json!({ "beatMap": beat_map })))
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))
}

async fn director_plan(
    State(st): State<Arc<ShimState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return Err(upgrade_required_with_actual("creator_studio", tier));
    }
    let params: crate::ai_director::PlanShotsParams =
        serde_json::from_value(body).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "bad_director_plan_request", "message": e.to_string() })),
            )
        })?;
    let target_duration_ms = params
        .target_duration_ms
        .unwrap_or(params.beat_map.duration_ms);
    let (plan, planner) = match crate::ai_director::sapi_planner::plan_shots_with_sapi(
        &st.client,
        &params,
        target_duration_ms,
    )
    .await
    {
        Ok(result) => (
            result.plan,
            json!({
                "mode": "sapi",
                "provider": result.provider,
                "model": result.model,
            }),
        ),
        Err(error) => {
            let shots = build_fallback_shots(&params.beat_map, &params.brief, target_duration_ms);
            (
                crate::ai_director::ShotPlan {
                    shots,
                    style_preset: params.style_preset,
                    brief: params.brief,
                    total_duration_ms: target_duration_ms,
                },
                json!({
                    "mode": "fallback",
                    "error": error,
                }),
            )
        }
    };
    let render_sequence = crate::ai_director::render_sequence(&plan);
    Ok(Json(
        json!({ "plan": plan, "renderSequence": render_sequence, "planner": planner }),
    ))
}

async fn director_lm_load(State(st): State<Arc<ShimState>>) -> (StatusCode, Json<Value>) {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return upgrade_required_with_actual("creator_studio", tier);
    }
    let status = crate::ai_director::sapi_planner::planner_status();
    (
        StatusCode::OK,
        Json(json!({ "status": "provider_routed", "planner": status })),
    )
}

async fn director_lm_unload(State(st): State<Arc<ShimState>>) -> (StatusCode, Json<Value>) {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return upgrade_required_with_actual("creator_studio", tier);
    }
    let status = crate::ai_director::sapi_planner::planner_status();
    (
        StatusCode::OK,
        Json(json!({ "status": "provider_routed", "planner": status })),
    )
}

async fn director_lm_status(State(st): State<Arc<ShimState>>) -> (StatusCode, Json<Value>) {
    let tier = current_tier(&st).await;
    if !tier_is_creator(tier) {
        return upgrade_required_with_actual("creator_studio", tier);
    }
    (
        StatusCode::OK,
        Json(json!({
            "loaded": false,
            "model": null,
            "planner": crate::ai_director::sapi_planner::planner_status(),
        })),
    )
}

fn build_fallback_shots(
    beat_map: &crate::ai_director::BeatMap,
    brief: &str,
    target_duration_ms: u64,
) -> Vec<crate::ai_director::Shot> {
    let mut shots = Vec::new();
    let mut start = 0u64;
    let mut idx = 0usize;
    while start < target_duration_ms {
        let section = beat_map
            .sections
            .iter()
            .find(|s| start >= s.start_ms && start < s.end_ms)
            .map(|s| s.label.as_str())
            .unwrap_or("performance");
        let end = (start + 4_000).min(target_duration_ms);
        let shot_id = format!("shot-{}", idx + 1);
        let visual_prompt = format!(
            "{}; {} section; beat-synced music video shot",
            brief, section
        );
        let init_source = if idx == 0 || beat_map.sections.iter().any(|s| s.start_ms == start) {
            crate::ai_director::InitSource::KeyframeGenerated {
                keyframe_prompt: visual_prompt.clone(),
            }
        } else {
            crate::ai_director::InitSource::PreviousShotEndFrame {
                previous_shot_id: format!("shot-{}", idx),
            }
        };
        shots.push(crate::ai_director::Shot {
            shot_id,
            start_ms: start,
            end_ms: end,
            visual_prompt,
            shot_type: if idx % 3 == 0 { "wide" } else { "medium" }.to_string(),
            reference_tags: vec![section.to_string()],
            init_source,
        });
        start = end;
        idx += 1;
    }
    shots
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
