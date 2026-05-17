//! Local audio storage layer.
//!
//! Ported from S3 Studio. Maps storage keys to filesystem paths under
//! the user's Music folder. Key change: uses everywear_paths for data dir.

use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::path::{Component, Path, PathBuf};
use tokio::fs;

use crate::settings::{load_settings, Settings};

/// Resolve a storage key to absolute path. Returns None on traversal attempts.
pub fn resolve_key(settings: &Settings, key: &str) -> Option<PathBuf> {
    let trimmed = key.trim_start_matches('/');
    let rel = Path::new(trimmed);
    for c in rel.components() {
        match c {
            Component::Normal(_) => {}
            _ => return None,
        }
    }
    Some(settings.resolved_music_root().join(rel))
}

pub async fn write_audio(key: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let settings = load_settings().await;
    let path = resolve_key(&settings, key).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid storage key")
    })?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(&path, bytes).await?;
    Ok(path)
}

#[allow(dead_code)]
pub async fn exists(key: &str) -> bool {
    let settings = load_settings().await;
    match resolve_key(&settings, key) {
        Some(p) => fs::metadata(&p).await.is_ok(),
        None => false,
    }
}

#[allow(dead_code)]
pub async fn delete(key: &str) -> std::io::Result<()> {
    let settings = load_settings().await;
    let Some(path) = resolve_key(&settings, key) else {
        return Ok(());
    };
    match fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}

pub async fn serve_key(key: &str) -> Response {
    let settings = load_settings().await;
    let Some(path) = resolve_key(&settings, key) else {
        return (StatusCode::BAD_REQUEST, "bad key").into_response();
    };

    let bytes = match fs::read(&path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return (StatusCode::NOT_FOUND, "not found").into_response();
        }
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(&path)),
    );
    if let Ok(v) = HeaderValue::from_str(&bytes.len().to_string()) {
        headers.insert(header::CONTENT_LENGTH, v);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );

    (headers, Body::from(bytes)).into_response()
}
