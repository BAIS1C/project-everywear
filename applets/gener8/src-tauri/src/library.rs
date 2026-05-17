//! Flat-JSON library index for local tracks and playlists.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - No crate::auth_token / UserClaim dependency (auth handled by shell)
//!   - Paths resolved via everywear_paths::data_dir("gener8")
//!   - Legacy migration functions retained for backward compatibility
//!     with existing library.json files

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::ErrorKind;
use std::path::Path;
use tokio::fs;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrack {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub lyrics: String,
    pub audio_key: String,
    #[serde(default)]
    pub duration: f64,
    pub bpm: Option<f64>,
    pub key_scale: Option<String>,
    pub time_signature: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub generation_params: Value,
    pub created_at: String,
    #[serde(default)]
    pub shared: bool,
    pub stems: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lrc_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryIndex {
    pub version: u32,
    #[serde(default)]
    pub tracks: Vec<LibraryTrack>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        Self {
            version: 1,
            tracks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tracks: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub cover_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistIndex {
    pub version: u32,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
}

impl Default for PlaylistIndex {
    fn default() -> Self {
        Self {
            version: 1,
            playlists: Vec::new(),
        }
    }
}

// File locks
static LIBRARY_LOCK: Mutex<()> = Mutex::const_new(());
static PLAYLISTS_LOCK: Mutex<()> = Mutex::const_new(());

async fn read_json_or_default<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    match fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str::<T>(&raw).unwrap_or_else(|err| {
            tracing::warn!(
                "{:?} parse failed ({}); starting fresh",
                path.file_name(),
                err
            );
            T::default()
        }),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent).await;
            }
            T::default()
        }
        Err(err) => {
            tracing::warn!(
                "{:?} read failed ({}); starting fresh",
                path.file_name(),
                err
            );
            T::default()
        }
    }
}

async fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let body = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string());
    fs::write(path, body).await
}

// --- Library CRUD ---

pub async fn read_library(library_path: &Path) -> LibraryIndex {
    let _g = LIBRARY_LOCK.lock().await;
    read_json_or_default::<LibraryIndex>(library_path).await
}

pub async fn write_library(library_path: &Path, idx: &LibraryIndex) -> std::io::Result<()> {
    let _g = LIBRARY_LOCK.lock().await;
    write_json(library_path, idx).await
}

pub async fn add_track(library_path: &Path, track: LibraryTrack) -> std::io::Result<LibraryTrack> {
    let _g = LIBRARY_LOCK.lock().await;
    let mut idx = read_json_or_default::<LibraryIndex>(library_path).await;
    if let Some(slot) = idx.tracks.iter_mut().find(|t| t.id == track.id) {
        *slot = track.clone();
    } else {
        idx.tracks.push(track.clone());
    }
    if idx.tracks.len() > 5000 {
        tracing::warn!(
            "library.json now holds {} tracks; consider SQLite",
            idx.tracks.len()
        );
    }
    write_json(library_path, &idx).await?;
    Ok(track)
}

pub async fn get_track(library_path: &Path, id: &str) -> Option<LibraryTrack> {
    let _g = LIBRARY_LOCK.lock().await;
    let idx = read_json_or_default::<LibraryIndex>(library_path).await;
    idx.tracks.into_iter().find(|t| t.id == id)
}

pub async fn update_track(
    library_path: &Path,
    id: &str,
    updates: Value,
) -> std::io::Result<Option<LibraryTrack>> {
    let _g = LIBRARY_LOCK.lock().await;
    let mut idx = read_json_or_default::<LibraryIndex>(library_path).await;
    let slot_idx = match idx.tracks.iter().position(|t| t.id == id) {
        Some(i) => i,
        None => return Ok(None),
    };

    let existing = &idx.tracks[slot_idx];
    let mut merged = serde_json::to_value(existing).unwrap_or(Value::Null);
    json_merge(&mut merged, &updates);

    let updated: LibraryTrack = match serde_json::from_value(merged) {
        Ok(t) => t,
        Err(err) => {
            tracing::warn!("update_track merge produced invalid shape: {}", err);
            return Ok(None);
        }
    };
    idx.tracks[slot_idx] = updated.clone();
    write_json(library_path, &idx).await?;
    Ok(Some(updated))
}

pub async fn delete_track(library_path: &Path, id: &str) -> std::io::Result<bool> {
    let _g = LIBRARY_LOCK.lock().await;
    let mut idx = read_json_or_default::<LibraryIndex>(library_path).await;
    let before = idx.tracks.len();
    idx.tracks.retain(|t| t.id != id);
    if idx.tracks.len() == before {
        return Ok(false);
    }
    write_json(library_path, &idx).await?;
    Ok(true)
}

pub struct ListOptions {
    pub limit: usize,
    pub offset: usize,
    pub sort_by: SortKey,
    pub sort_dir: SortDir,
}

#[derive(Clone, Copy)]
pub enum SortKey {
    CreatedAt,
    Title,
}

#[derive(Clone, Copy)]
pub enum SortDir {
    Asc,
    Desc,
}

impl Default for ListOptions {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
            sort_by: SortKey::CreatedAt,
            sort_dir: SortDir::Desc,
        }
    }
}

pub async fn list_tracks(library_path: &Path, opts: ListOptions) -> (Vec<LibraryTrack>, usize) {
    let _g = LIBRARY_LOCK.lock().await;
    let idx = read_json_or_default::<LibraryIndex>(library_path).await;
    let mut tracks = idx.tracks.clone();
    tracks.sort_by(|a, b| {
        let cmp = match opts.sort_by {
            SortKey::CreatedAt => a.created_at.cmp(&b.created_at),
            SortKey::Title => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
        };
        match opts.sort_dir {
            SortDir::Asc => cmp,
            SortDir::Desc => cmp.reverse(),
        }
    });
    let total = tracks.len();
    let start = opts.offset.min(total);
    let end = (start + opts.limit).min(total);
    (tracks[start..end].to_vec(), total)
}

// --- Playlist CRUD ---

pub async fn read_playlists(playlists_path: &Path) -> PlaylistIndex {
    let _g = PLAYLISTS_LOCK.lock().await;
    read_json_or_default::<PlaylistIndex>(playlists_path).await
}

pub async fn add_playlist(playlists_path: &Path, p: Playlist) -> std::io::Result<Playlist> {
    let _g = PLAYLISTS_LOCK.lock().await;
    let mut idx = read_json_or_default::<PlaylistIndex>(playlists_path).await;
    if let Some(slot) = idx.playlists.iter_mut().find(|x| x.id == p.id) {
        *slot = p.clone();
    } else {
        idx.playlists.push(p.clone());
    }
    write_json(playlists_path, &idx).await?;
    Ok(p)
}

pub async fn delete_playlist(playlists_path: &Path, id: &str) -> std::io::Result<bool> {
    let _g = PLAYLISTS_LOCK.lock().await;
    let mut idx = read_json_or_default::<PlaylistIndex>(playlists_path).await;
    let before = idx.playlists.len();
    idx.playlists.retain(|p| p.id != id);
    if idx.playlists.len() == before {
        return Ok(false);
    }
    write_json(playlists_path, &idx).await?;
    Ok(true)
}

// --- Helpers ---

fn json_merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(t), Value::Object(p)) => {
            for (k, v) in p {
                match t.get_mut(k) {
                    Some(existing) => json_merge(existing, v),
                    None => {
                        t.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (slot, patch) => {
            *slot = patch.clone();
        }
    }
}

pub fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
