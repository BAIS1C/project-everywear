//! User-tunable paths and engine preferences.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Settings file at everywear_paths::data_dir("gener8")/settings.json
//!   - No crate::util dependencies; dirs resolved via platform functions

use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::RwLock;
use tokio::fs;

const STUDIO_SUBDIR: &str = "Strands Sound Studio";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub music_dir: String,
    pub videos_dir: String,
    pub audio_format: String,
    pub video_format: String,
    pub default_model: String,
    pub inference_steps: i32,
    pub guidance_scale: f32,
    pub first_run_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            music_dir: String::new(),
            videos_dir: String::new(),
            audio_format: "mp3".into(),
            video_format: "mp4".into(),
            default_model: "xl-turbo".into(),
            inference_steps: -1,
            guidance_scale: -1.0,
            first_run_complete: false,
        }
    }
}

impl Settings {
    pub fn resolved_music_root(&self) -> PathBuf {
        if self.music_dir.is_empty() {
            default_music_dir().join(STUDIO_SUBDIR)
        } else {
            PathBuf::from(&self.music_dir)
        }
    }

    pub fn resolved_videos_root(&self) -> PathBuf {
        if self.videos_dir.is_empty() {
            default_videos_dir().join(STUDIO_SUBDIR)
        } else {
            PathBuf::from(&self.videos_dir)
        }
    }

    pub fn gener8_dir(&self) -> PathBuf {
        self.resolved_music_root().join("gener8")
    }

    pub fn references_dir(&self) -> PathBuf {
        self.resolved_music_root().join("references")
    }

    pub fn covers_dir(&self) -> PathBuf {
        self.resolved_music_root().join("covers")
    }

    pub fn patches_dir(&self) -> PathBuf {
        self.resolved_music_root().join("patches")
    }

    pub fn training_dir(&self) -> PathBuf {
        self.resolved_music_root().join("training")
    }

    pub fn stems_dir(&self) -> PathBuf {
        self.resolved_music_root().join("stems")
    }

    pub fn vid_dir(&self) -> PathBuf {
        self.resolved_videos_root().join("vid")
    }
}

fn settings_path() -> PathBuf {
    everywear_paths::data_dir(crate::APPLET_ID).join(SETTINGS_FILE)
}

fn default_music_dir() -> PathBuf {
    dirs::audio_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Music")
    })
}

fn default_videos_dir() -> PathBuf {
    dirs::video_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Videos")
    })
}

pub async fn ensure_dirs(settings: &Settings) -> std::io::Result<()> {
    for dir in [
        settings.gener8_dir(),
        settings.references_dir(),
        settings.covers_dir(),
        settings.patches_dir(),
        settings.training_dir(),
        settings.stems_dir(),
        settings.vid_dir(),
    ] {
        fs::create_dir_all(&dir).await?;
    }
    Ok(())
}

static SETTINGS_CACHE: RwLock<Option<Settings>> = RwLock::new(None);

pub async fn load_settings() -> Settings {
    if let Ok(guard) = SETTINGS_CACHE.read() {
        if let Some(s) = guard.as_ref() {
            return s.clone();
        }
    }

    let path = settings_path();
    let settings = match fs::read_to_string(&path).await {
        Ok(raw) => serde_json::from_str::<Settings>(&raw).unwrap_or_else(|err| {
            tracing::warn!("settings.json parse failed ({}); defaults", err);
            Settings::default()
        }),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent).await;
            }
            Settings::default()
        }
        Err(err) => {
            tracing::warn!("settings.json read failed ({}); defaults", err);
            Settings::default()
        }
    };

    if let Err(e) = ensure_dirs(&settings).await {
        tracing::warn!("ensure_dirs failed: {}", e);
    }

    if let Ok(mut guard) = SETTINGS_CACHE.write() {
        *guard = Some(settings.clone());
    }
    settings
}

fn validate_path_override(p: &str) -> Result<(), String> {
    if p.is_empty() {
        return Ok(());
    }
    let path = std::path::Path::new(p);
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    for c in path.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("path must not contain '..' components".to_string());
        }
    }
    let home: std::path::PathBuf = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
    } else {
        std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
    };
    if home.as_os_str().is_empty() {
        return Err("could not resolve home directory".to_string());
    }
    if !path.starts_with(&home) {
        return Err(format!("path must be inside home ({})", home.display()));
    }
    Ok(())
}

pub async fn save_settings(settings: Settings) -> std::io::Result<Settings> {
    if let Err(reason) = validate_path_override(&settings.music_dir) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("music_dir rejected: {}", reason),
        ));
    }
    if let Err(reason) = validate_path_override(&settings.videos_dir) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("videos_dir rejected: {}", reason),
        ));
    }

    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let body = serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "{}".to_string());
    fs::write(&path, body).await?;

    if let Err(e) = ensure_dirs(&settings).await {
        tracing::warn!("ensure_dirs failed after save: {}", e);
    }

    if let Ok(mut guard) = SETTINGS_CACHE.write() {
        *guard = Some(settings.clone());
    }
    Ok(settings)
}
