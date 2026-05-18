use chrono::Utc;
use ew_vault::{
    item_file_size, item_favorite, AudioDocument, ImageDocument, MediaFilter, SortField, VaultIndex,
    VaultItem, VideoDocument,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type VaultState = Arc<Mutex<VaultIndex>>;

#[derive(Debug, Serialize)]
pub struct VaultSearchResponse {
    pub items: Vec<VaultItem>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct VaultStats {
    pub total_items: usize,
    pub images: usize,
    pub audio: usize,
    pub videos: usize,
    pub stems: usize,
    pub favorites: usize,
    pub total_size_bytes: u64,
}

// CLAUDE_INTERFACE: Vault auto-registration is active by default
// When an applet completes a generation job, the shell automatically
// registers the output file to the vault. This means the "Save to Vault"
// button in applet frontends should check if the file is already in the
// vault (file_path starts with vault root) and show "In Vault" instead.
// Users can disable auto-register via profile preference "vault_auto_register".
// The frontend can read this via: invoke("get_preference", { key: "vault_auto_register" })
pub async fn auto_register_job_result(
    vault: VaultState,
    applet_id: &str,
    result: &serde_json::Value,
) -> Result<Option<VaultItem>, String> {
    let Some(source) = find_output_path(result).map(PathBuf::from) else {
        return Ok(None);
    };
    if !source.exists() || is_in_vault(&source) {
        return Ok(None);
    }

    let dirs = VaultDirs::default_paths()?;
    let title = result
        .get("title")
        .or_else(|| result.get("name"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            source
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Untitled".into());
    let tags = result
        .get("tags")
        .and_then(|value| value.as_array())
        .map(|tags| {
            tags.iter()
                .filter_map(|tag| tag.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let vault = vault.lock().await;
    match applet_id {
        "1magen" => {
            let (width, height) = image_dimensions_from_result(result, &source)?;
            register_image_with_dirs(
                &vault,
                &dirs,
                title,
                source,
                width,
                height,
                result.get("model_id").and_then(as_string),
                result.get("prompt").and_then(as_string),
                result.get("generation_params").cloned(),
                tags,
            )
            .map(Some)
        }
        "gener8" => register_audio_with_dirs(
            &vault,
            &dirs,
            title,
            source,
            number_value(result, "duration_seconds").unwrap_or_default(),
            u64_value(result, "sample_rate"),
            u64_value(result, "channels"),
            result.get("genre").and_then(as_string),
            u64_value(result, "bpm"),
            result
                .get("is_stem")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            result.get("stem_type").and_then(as_string),
            result.get("lyrics_text").and_then(as_string),
            tags,
        )
        .map(Some),
        "3nvizen" | "vid" => register_video_with_dirs(
            &vault,
            &dirs,
            title,
            source,
            number_value(result, "duration_seconds").unwrap_or_default(),
            u64_value(result, "width").unwrap_or_default(),
            u64_value(result, "height").unwrap_or_default(),
            number_value(result, "frame_rate").unwrap_or_default(),
            result.get("model_id").and_then(as_string),
            result.get("generation_mode").and_then(as_string),
            result.get("prompt").and_then(as_string),
            result
                .get("has_audio")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            tags,
        )
        .map(Some),
        _ => Ok(None),
    }
}

#[derive(Debug, Clone)]
struct VaultDirs {
    images: PathBuf,
    audio: PathBuf,
    audio_stems: PathBuf,
    videos: PathBuf,
    thumbnails: PathBuf,
}

impl VaultDirs {
    fn default_paths() -> Result<Self, String> {
        everywear_paths::ensure_vault_dirs().map_err(|e| e.to_string())?;
        Ok(Self {
            images: everywear_paths::vault_images(),
            audio: everywear_paths::vault_audio(),
            audio_stems: everywear_paths::vault_audio_stems(),
            videos: everywear_paths::vault_video(),
            thumbnails: everywear_paths::vault_thumbnails(),
        })
    }
}

// CLAUDE_INTERFACE: Search vault
// Command: "vault_search"
// Args: { query?: string, media_filter?: "all"|"images"|"audio"|"videos"|"stems"|"favorites", sort_by?: "newest"|"oldest"|"title"|"size"|"duration", limit?: number, offset?: number }
// Returns: VaultSearchResponse { items: VaultItem[], total: number, limit: number, offset: number }
// Note: VaultItem is discriminated union by media_type: "image" | "audio" | "video"
#[tauri::command]
pub async fn vault_search(
    query: String,
    media_filter: Option<String>,
    sort_by: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    vault: State<'_, VaultState>,
) -> Result<VaultSearchResponse, String> {
    let filter = parse_media_filter(media_filter.as_deref())?;
    let sort = parse_sort_field(sort_by.as_deref())?;
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    let vault = vault.lock().await;
    let total = vault
        .search_total(&query, Some(filter.clone()))
        .map_err(|e| e.to_string())?;
    let items = vault
        .search(&query, Some(filter), sort, limit, offset)
        .map_err(|e| e.to_string())?;
    Ok(VaultSearchResponse {
        items,
        total,
        limit,
        offset,
    })
}

// CLAUDE_INTERFACE: Get single vault item
// Command: "vault_get_item"
// Args: { id: string }
// Returns: VaultItem | null
#[tauri::command]
pub async fn vault_get_item(
    id: String,
    vault: State<'_, VaultState>,
) -> Result<Option<VaultItem>, String> {
    vault.lock().await.get_by_id(&id).map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: Set favorite
// Command: "vault_set_favorite"
// Args: { id: string, favorite: boolean }
// Returns: {}
#[tauri::command]
pub async fn vault_set_favorite(
    id: String,
    favorite: bool,
    vault: State<'_, VaultState>,
) -> Result<(), String> {
    vault
        .lock()
        .await
        .update_favorite(&id, favorite)
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: Set tags
// Command: "vault_set_tags"
// Args: { id: string, tags: string[] }
// Returns: {}
#[tauri::command]
pub async fn vault_set_tags(
    id: String,
    tags: Vec<String>,
    vault: State<'_, VaultState>,
) -> Result<(), String> {
    vault
        .lock()
        .await
        .update_tags(&id, tags)
        .map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: Delete vault item
// Command: "vault_delete_item"
// Args: { id: string }
// Returns: {}
// Note: Deletes file from disk and removes from index
#[tauri::command]
pub async fn vault_delete_item(id: String, vault: State<'_, VaultState>) -> Result<(), String> {
    vault.lock().await.delete(&id).map_err(|e| e.to_string())
}

// CLAUDE_INTERFACE: Get vault stats
// Command: "vault_get_stats"
// Args: {}
// Returns: VaultStats { total_items, images, audio, videos, stems, favorites, total_size_bytes }
#[tauri::command]
pub async fn vault_get_stats(vault: State<'_, VaultState>) -> Result<VaultStats, String> {
    let items = vault
        .lock()
        .await
        .stats_items()
        .map_err(|e| e.to_string())?;
    Ok(stats_from_items(&items))
}

// CLAUDE_INTERFACE: Register generated image into vault
// Command: "vault_register_image"
// Args: { title: string, file_path: string, width: number, height: number, model_id?: string, prompt?: string, generation_params?: object, tags?: string[] }
// Returns: VaultItem (the created item with new vault file_path)
#[tauri::command]
pub async fn vault_register_image(
    title: String,
    file_path: String,
    width: u64,
    height: u64,
    model_id: Option<String>,
    prompt: Option<String>,
    generation_params: Option<serde_json::Value>,
    tags: Vec<String>,
    vault: State<'_, VaultState>,
) -> Result<VaultItem, String> {
    let dirs = VaultDirs::default_paths()?;
    let vault = vault.lock().await;
    register_image_with_dirs(
        &vault,
        &dirs,
        title,
        PathBuf::from(file_path),
        width,
        height,
        model_id,
        prompt,
        generation_params,
        tags,
    )
}

// CLAUDE_INTERFACE: Register generated audio into vault
// Command: "vault_register_audio"
// Args: { title: string, file_path: string, duration_seconds: number, sample_rate?: number, channels?: number, genre?: string, bpm?: number, is_stem?: boolean, stem_type?: string, lyrics_text?: string, tags?: string[] }
// Returns: VaultItem
#[tauri::command]
pub async fn vault_register_audio(
    title: String,
    file_path: String,
    duration_seconds: f64,
    sample_rate: Option<u64>,
    channels: Option<u64>,
    genre: Option<String>,
    bpm: Option<u64>,
    is_stem: bool,
    stem_type: Option<String>,
    lyrics_text: Option<String>,
    tags: Vec<String>,
    vault: State<'_, VaultState>,
) -> Result<VaultItem, String> {
    let dirs = VaultDirs::default_paths()?;
    let vault = vault.lock().await;
    register_audio_with_dirs(
        &vault,
        &dirs,
        title,
        PathBuf::from(file_path),
        duration_seconds,
        sample_rate,
        channels,
        genre,
        bpm,
        is_stem,
        stem_type,
        lyrics_text,
        tags,
    )
}

// CLAUDE_INTERFACE: Register generated video into vault
// Command: "vault_register_video"
// Args: { title: string, file_path: string, duration_seconds: number, width: number, height: number, frame_rate: number, model_id?: string, generation_mode?: string, prompt?: string, has_audio?: boolean, tags?: string[] }
// Returns: VaultItem
#[tauri::command]
pub async fn vault_register_video(
    title: String,
    file_path: String,
    duration_seconds: f64,
    width: u64,
    height: u64,
    frame_rate: f64,
    model_id: Option<String>,
    generation_mode: Option<String>,
    prompt: Option<String>,
    has_audio: bool,
    tags: Vec<String>,
    vault: State<'_, VaultState>,
) -> Result<VaultItem, String> {
    let dirs = VaultDirs::default_paths()?;
    let vault = vault.lock().await;
    register_video_with_dirs(
        &vault,
        &dirs,
        title,
        PathBuf::from(file_path),
        duration_seconds,
        width,
        height,
        frame_rate,
        model_id,
        generation_mode,
        prompt,
        has_audio,
        tags,
    )
}

fn parse_media_filter(value: Option<&str>) -> Result<MediaFilter, String> {
    match value.unwrap_or("all").to_ascii_lowercase().as_str() {
        "all" => Ok(MediaFilter::All),
        "images" | "image" => Ok(MediaFilter::Images),
        "audio" => Ok(MediaFilter::Audio),
        "videos" | "video" => Ok(MediaFilter::Videos),
        "stems" | "stem" => Ok(MediaFilter::Stems),
        "favorites" | "favorite" => Ok(MediaFilter::Favorites),
        value if value.starts_with("applet:") => Ok(MediaFilter::Applet(value[7..].to_string())),
        other => Err(format!("unknown vault media_filter '{other}'")),
    }
}

fn parse_sort_field(value: Option<&str>) -> Result<SortField, String> {
    match value.unwrap_or("newest").to_ascii_lowercase().as_str() {
        "newest" => Ok(SortField::Newest),
        "oldest" => Ok(SortField::Oldest),
        "title" => Ok(SortField::Title),
        "size" => Ok(SortField::Size),
        "duration" => Ok(SortField::Duration),
        other => Err(format!("unknown vault sort_by '{other}'")),
    }
}

fn stats_from_items(items: &[VaultItem]) -> VaultStats {
    let mut stats = VaultStats::default();
    stats.total_items = items.len();
    for item in items {
        stats.total_size_bytes += item_file_size(item);
        if item_favorite(item) {
            stats.favorites += 1;
        }
        match item {
            VaultItem::Image(_) => stats.images += 1,
            VaultItem::Audio(doc) => {
                stats.audio += 1;
                if doc.is_stem {
                    stats.stems += 1;
                }
            }
            VaultItem::Video(_) => stats.videos += 1,
        }
    }
    stats
}

#[allow(clippy::too_many_arguments)]
fn register_image_with_dirs(
    vault: &VaultIndex,
    dirs: &VaultDirs,
    title: String,
    source: PathBuf,
    width: u64,
    height: u64,
    model_id: Option<String>,
    prompt: Option<String>,
    generation_params: Option<serde_json::Value>,
    tags: Vec<String>,
) -> Result<VaultItem, String> {
    let id = Uuid::new_v4().to_string();
    fs::create_dir_all(&dirs.images).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dirs.thumbnails).map_err(|e| e.to_string())?;
    let destination = destination_path(&dirs.images, &id, &source);
    move_into_vault(&source, &destination)?;
    create_image_thumbnail(&destination, &dirs.thumbnails.join(format!("{id}.jpg")))?;

    let metadata = fs::metadata(&destination).map_err(|e| e.to_string())?;
    let now = now_timestamp();
    let doc = ImageDocument {
        id,
        applet_id: "1magen".into(),
        title,
        tags,
        created_at: now,
        updated_at: now,
        file_path: destination.to_string_lossy().to_string(),
        file_size_bytes: metadata.len(),
        mime_type: mime_from_path(&destination, "image/png"),
        favorite: false,
        width,
        height,
        model_id,
        generation_params,
        prompt,
    };
    vault.index_image(&doc).map_err(|e| e.to_string())?;
    Ok(VaultItem::Image(doc))
}

#[allow(clippy::too_many_arguments)]
fn register_audio_with_dirs(
    vault: &VaultIndex,
    dirs: &VaultDirs,
    title: String,
    source: PathBuf,
    duration_seconds: f64,
    sample_rate: Option<u64>,
    channels: Option<u64>,
    genre: Option<String>,
    bpm: Option<u64>,
    is_stem: bool,
    stem_type: Option<String>,
    lyrics_text: Option<String>,
    tags: Vec<String>,
) -> Result<VaultItem, String> {
    let id = Uuid::new_v4().to_string();
    let target_dir = if is_stem { &dirs.audio_stems } else { &dirs.audio };
    fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    let destination = destination_path(target_dir, &id, &source);
    move_into_vault(&source, &destination)?;

    let metadata = fs::metadata(&destination).map_err(|e| e.to_string())?;
    let now = now_timestamp();
    let doc = AudioDocument {
        id,
        applet_id: "gener8".into(),
        title,
        tags,
        created_at: now,
        updated_at: now,
        file_path: destination.to_string_lossy().to_string(),
        file_size_bytes: metadata.len(),
        mime_type: mime_from_path(&destination, "audio/wav"),
        favorite: false,
        duration_seconds,
        sample_rate: sample_rate.unwrap_or_default(),
        channels: channels.unwrap_or_default(),
        genre,
        bpm,
        key_signature: None,
        is_stem,
        stem_type,
        lyrics_aligned: false,
        lyrics_text,
    };
    vault.index_audio(&doc).map_err(|e| e.to_string())?;
    Ok(VaultItem::Audio(doc))
}

#[allow(clippy::too_many_arguments)]
fn register_video_with_dirs(
    vault: &VaultIndex,
    dirs: &VaultDirs,
    title: String,
    source: PathBuf,
    duration_seconds: f64,
    width: u64,
    height: u64,
    frame_rate: f64,
    model_id: Option<String>,
    generation_mode: Option<String>,
    prompt: Option<String>,
    has_audio: bool,
    tags: Vec<String>,
) -> Result<VaultItem, String> {
    let id = Uuid::new_v4().to_string();
    fs::create_dir_all(&dirs.videos).map_err(|e| e.to_string())?;
    let destination = destination_path(&dirs.videos, &id, &source);
    move_into_vault(&source, &destination)?;

    let metadata = fs::metadata(&destination).map_err(|e| e.to_string())?;
    let now = now_timestamp();
    let doc = VideoDocument {
        id,
        applet_id: "3nvizen".into(),
        title,
        tags,
        created_at: now,
        updated_at: now,
        file_path: destination.to_string_lossy().to_string(),
        file_size_bytes: metadata.len(),
        mime_type: mime_from_path(&destination, "video/mp4"),
        favorite: false,
        duration_seconds,
        width,
        height,
        frame_rate,
        model_id,
        generation_mode,
        prompt,
        has_audio,
    };
    vault.index_video(&doc).map_err(|e| e.to_string())?;
    Ok(VaultItem::Video(doc))
}

fn destination_path(target_dir: &Path, id: &str, source: &Path) -> PathBuf {
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.is_empty())
        .unwrap_or("bin");
    target_dir.join(format!("{id}.{extension}"))
}

fn move_into_vault(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, destination).map_err(|e| e.to_string())?;
            fs::remove_file(source).map_err(|e| e.to_string())
        }
    }
}

fn create_image_thumbnail(source: &Path, destination: &Path) -> Result<(), String> {
    let image = image::open(source).map_err(|e| e.to_string())?;
    let thumb = image.thumbnail(256, 256);
    thumb
        .save_with_format(destination, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())
}

fn mime_from_path(path: &Path, fallback: &str) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => fallback,
    }
    .to_string()
}

fn find_output_path(value: &serde_json::Value) -> Option<String> {
    for key in [
        "file_path",
        "output_path",
        "image_path",
        "audio_path",
        "video_path",
        "path",
    ] {
        if let Some(path) = value.get(key).and_then(|value| value.as_str()) {
            if looks_like_local_path(path) {
                return Some(path.to_string());
            }
        }
    }

    match value {
        serde_json::Value::Array(values) => values.iter().find_map(find_output_path),
        serde_json::Value::Object(map) => map.values().find_map(find_output_path),
        _ => None,
    }
}

fn looks_like_local_path(path: &str) -> bool {
    !path.starts_with("http://")
        && !path.starts_with("https://")
        && Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some()
}

fn is_in_vault(path: &Path) -> bool {
    let Ok(root) = everywear_paths::vault_root().canonicalize() else {
        return path.starts_with(everywear_paths::vault_root());
    };
    path.canonicalize()
        .map(|path| path.starts_with(root))
        .unwrap_or_else(|_| path.starts_with(everywear_paths::vault_root()))
}

fn image_dimensions_from_result(
    result: &serde_json::Value,
    source: &Path,
) -> Result<(u64, u64), String> {
    match (u64_value(result, "width"), u64_value(result, "height")) {
        (Some(width), Some(height)) if width > 0 && height > 0 => Ok((width, height)),
        _ => image::image_dimensions(source)
            .map(|(width, height)| (width as u64, height as u64))
            .map_err(|e| e.to_string()),
    }
}

fn as_string(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

fn number_value(value: &serde_json::Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|value| value.as_f64())
}

fn u64_value(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|value| value.as_u64())
}

fn now_timestamp() -> u64 {
    Utc::now().timestamp().max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn temp_dirs() -> (PathBuf, VaultDirs, VaultIndex) {
        let root = std::env::temp_dir().join(format!("os-vault-test-{}", Uuid::new_v4()));
        let dirs = VaultDirs {
            images: root.join("Images"),
            audio: root.join("Audio"),
            audio_stems: root.join("Audio").join("Stems"),
            videos: root.join("Videos"),
            thumbnails: root.join(".thumbnails"),
        };
        fs::create_dir_all(&dirs.images).unwrap();
        fs::create_dir_all(&dirs.thumbnails).unwrap();
        let index = VaultIndex::open_or_create(root.join(".index")).unwrap();
        (root, dirs, index)
    }

    #[test]
    fn vault_parse_filters_and_sorts() {
        assert_eq!(parse_media_filter(Some("images")).unwrap(), MediaFilter::Images);
        assert_eq!(parse_media_filter(Some("stems")).unwrap(), MediaFilter::Stems);
        assert_eq!(parse_sort_field(Some("duration")).unwrap(), SortField::Duration);
    }

    #[test]
    fn vault_register_image_moves_thumbnails_and_indexes() {
        let (root, dirs, index) = temp_dirs();
        let source = root.join("source.png");
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(16, 16, Rgba([255, 0, 0, 255]));
        img.save(&source).unwrap();

        let item = register_image_with_dirs(
            &index,
            &dirs,
            "Test image".into(),
            source.clone(),
            16,
            16,
            Some("ltx-test".into()),
            Some("test prompt".into()),
            None,
            vec!["test".into()],
        )
        .unwrap();

        assert!(!source.exists());
        let VaultItem::Image(doc) = &item else {
            panic!("expected image");
        };
        assert!(Path::new(&doc.file_path).exists());
        assert!(dirs.thumbnails.join(format!("{}.jpg", doc.id)).exists());
        let hits = index
            .search("test", Some(MediaFilter::Images), SortField::Newest, 10, 0)
            .unwrap();
        assert_eq!(hits.len(), 1);

        let _ = fs::remove_dir_all(root);
    }
}
