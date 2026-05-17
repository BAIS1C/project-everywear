//! GGUF discovery: scan known locations for existing model files.
//!
//! Before downloading anything from HuggingFace, we check if the model
//! already exists in commonly used AI tool directories: LM Studio,
//! Ollama, HuggingFace Hub cache, GPT4All, and the Everywear cache.

use crate::manifest::ModelInfo;
use std::path::PathBuf;
use tracing::{debug, info};

/// Standard directories where GGUF files might already exist.
/// Includes paths for Windows, macOS, and Linux.
pub fn discovery_paths(models_dir: &PathBuf) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    push_unique(&mut paths, models_dir.clone());
    push_unique(&mut paths, everywear_paths::models_dir());
    push_model_subdirs(&mut paths, models_dir);
    push_model_subdirs(&mut paths, &everywear_paths::models_dir());

    let home = everywear_paths::models_dir()
        .parent()
        .and_then(|root| root.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    // LM Studio (Linux/macOS)
    push_unique(
        &mut paths,
        home.join(".cache").join("lm-studio").join("models"),
    );
    // LM Studio (Windows)
    push_unique(&mut paths, home.join(".lmstudio").join("models"));

    // Ollama: check env var first, then default path
    if let Ok(ollama) = std::env::var("OLLAMA_MODELS") {
        push_unique(&mut paths, PathBuf::from(ollama));
    }
    push_unique(
        &mut paths,
        home.join(".ollama").join("models").join("blobs"),
    );

    // HuggingFace Hub cache
    let hf_cache = std::env::var("HF_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".cache").join("huggingface").join("hub"));
    push_unique(&mut paths, hf_cache);

    // GPT4All (Linux)
    push_unique(
        &mut paths,
        home.join(".local")
            .join("share")
            .join("nomic.ai")
            .join("GPT4All"),
    );
    // GPT4All (macOS)
    push_unique(
        &mut paths,
        home.join("Library")
            .join("Application Support")
            .join("nomic.ai")
            .join("GPT4All"),
    );
    // GPT4All (Windows)
    push_unique(
        &mut paths,
        home.join("AppData")
            .join("Local")
            .join("nomic.ai")
            .join("GPT4All"),
    );

    paths
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|p| p == &path) {
        paths.push(path);
    }
}

fn push_model_subdirs(paths: &mut Vec<PathBuf>, root: &PathBuf) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            push_unique(paths, path);
        }
    }
}

/// Scan all discovery paths and update manifest entries with found paths.
///
/// For each model in the manifest, walks the discovery directories and
/// checks if the filename exists. On first match, sets `path` and
/// `downloaded = true` and stops searching for that model.
pub fn scan_manifest(manifest: &mut [ModelInfo], models_dir: &PathBuf) {
    let search_dirs = discovery_paths(models_dir);

    for model in manifest.iter_mut() {
        // Skip if already resolved
        if model.downloaded && model.path.is_some() {
            continue;
        }

        for dir in &search_dirs {
            let candidate = dir.join(&model.filename);
            if candidate.exists() {
                info!(
                    model = %model.key,
                    path = %candidate.display(),
                    "Found existing model"
                );
                model.path = Some(candidate);
                model.downloaded = true;
                break;
            }
        }

        if !model.downloaded {
            debug!(model = %model.key, filename = %model.filename, "Model not found locally");
        }
    }
}

/// Check if a specific model file exists in any discovery path.
pub fn find_model(filename: &str, models_dir: &PathBuf) -> Option<PathBuf> {
    let search_dirs = discovery_paths(models_dir);
    for dir in &search_dirs {
        let candidate = dir.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}
