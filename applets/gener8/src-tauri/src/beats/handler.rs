//! axum handler for `GET /api/beats`.
//!
//! Wire contract:
//!   GET /api/beats?path=<abs_path>&sr=<int>&cache=<bool>
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Takes ShimState from crate::shim (not S3's ShimState)

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

use super::BeatsCache;
use crate::shim::ShimState;

const DEFAULT_ANALYSIS_SR: u32 = 22_050;

#[derive(Debug, Deserialize)]
pub struct BeatsQuery {
    pub path: String,
    #[serde(default)]
    pub sr: Option<u32>,
    #[serde(default)]
    pub cache: Option<bool>,
}

pub async fn beats_handler(
    State(st): State<Arc<ShimState>>,
    Query(q): Query<BeatsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = PathBuf::from(&q.path);

    if q.path.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "path query param required"));
    }
    if !path.is_absolute() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "path must be absolute (e.g. C:\\Users\\...\\track.mp3)",
        ));
    }
    if !path.exists() {
        return Err(err(StatusCode::NOT_FOUND, "audio file not found"));
    }

    let sr = q.sr.unwrap_or(DEFAULT_ANALYSIS_SR);
    let use_cache = q.cache.unwrap_or(true);

    let cache: Arc<BeatsCache> = st.beats.clone();

    if use_cache {
        if let Some(hit) = cache.get(&path, sr) {
            return Ok(Json(json!({
                "bpm":         hit.bpm,
                "duration_ms": hit.duration_ms,
                "sample_rate": hit.sample_rate,
                "beats":       hit.beats,
                "downbeats":   hit.downbeats,
                "sections":    hit.sections,
                "method":      hit.method,
                "cached":      true,
            })));
        }
    }

    let path_for_blocking = path.clone();
    let analysis =
        tokio::task::spawn_blocking(move || super::engine::analyse(&path_for_blocking, Some(sr)))
            .await;

    let map = match analysis {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => {
            let msg = format!("{e:#}");
            tracing::error!("beats analyse failed for {}: {msg}", path.display());
            let code = classify_err(&msg);
            return Err(err(code, msg));
        }
        Err(join_err) => {
            tracing::error!("beats blocking task join error: {join_err}");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "analysis worker panicked",
            ));
        }
    };

    if let Err(e) = cache.put(&path, sr, &map) {
        tracing::warn!("beats cache write failed: {e:#}");
    }

    Ok(Json(json!({
        "bpm":         map.bpm,
        "duration_ms": map.duration_ms,
        "sample_rate": map.sample_rate,
        "beats":       map.beats,
        "downbeats":   map.downbeats,
        "sections":    map.sections,
        "method":      map.method,
        "cached":      false,
    })))
}

fn err(code: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (code, Json(json!({ "error": msg.into() })))
}

fn classify_err(msg: &str) -> StatusCode {
    let lower = msg.to_lowercase();
    if lower.contains("no decodable track")
        || lower.contains("unsupported")
        || lower.contains("unknown format")
        || lower.contains("codec")
    {
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    } else if lower.contains("decode ") || lower.contains("open ") {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}
