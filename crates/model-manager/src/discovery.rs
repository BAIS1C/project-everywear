//! GGUF discovery: scan known locations for existing model files.
//!
//! Before downloading anything from HuggingFace, we check if the model
//! already exists in commonly used AI tool directories: LM Studio,
//! Ollama, HuggingFace Hub cache, GPT4All, and the Everywear cache.

use crate::manifest::ModelInfo;
use std::path::Path;
use std::path::PathBuf;
use tracing::{debug, info, warn};

const MIN_MODEL_BYTES: u64 = 50_000_000;

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

fn scan_for_filename(dir: &Path, filename: &str, depth: u8) -> Option<PathBuf> {
    if depth > 6 {
        return None;
    }

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = scan_for_filename(&path, filename, depth + 1) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(filename))
        {
            return Some(path);
        }
    }

    None
}

fn scan_gguf_files(dir: &Path, depth: u8, out: &mut Vec<(PathBuf, u64)>) {
    if depth > 6 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_gguf_files(&path, depth + 1, out);
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        {
            if let Ok(metadata) = std::fs::metadata(&path) {
                out.push((path, metadata.len()));
            }
        }
    }
}

fn normalize_gguf_stem(filename: &str) -> String {
    let stem = filename
        .strip_suffix(".gguf")
        .or_else(|| filename.strip_suffix(".GGUF"))
        .unwrap_or(filename);
    stem.to_lowercase().replace(['-', ' '], "_")
}

fn extract_model_family(normalized_stem: &str) -> &str {
    let quant_patterns = [
        "_q8_k_p", "_q8_0", "_q6_k_l", "_q6_k", "_q5_k_s", "_q5_k_m", "_q5_k_l", "_q4_k_s",
        "_q4_k_m", "_q4_k_l", "_q4_0", "_q3_k_s", "_q3_k_m", "_q3_k_l", "_q2_k", "_iq4_xs",
        "_iq4_m", "_iq3_xs", "_iq2_xxs",
    ];

    for pattern in quant_patterns {
        if let Some(prefix) = normalized_stem.strip_suffix(pattern) {
            return prefix;
        }
    }

    normalized_stem
}

fn same_model_family(a: &str, b: &str) -> bool {
    let a = normalize_gguf_stem(a);
    let b = normalize_gguf_stem(b);
    let a = extract_model_family(&a);
    let b = extract_model_family(&b);
    !a.is_empty() && a == b
}

fn is_usable_size(expected: u64, actual: u64) -> bool {
    if actual < MIN_MODEL_BYTES {
        return false;
    }

    if expected == 0 {
        return true;
    }

    let low = expected.saturating_mul(9) / 10;
    let high = expected.saturating_mul(11) / 10;
    actual >= low && actual <= high
}

fn find_best_local_match(model: &ModelInfo, search_dirs: &[PathBuf]) -> Option<PathBuf> {
    let mut alternatives = Vec::new();

    for dir in search_dirs {
        if let Some(candidate) = scan_for_filename(dir, &model.filename, 0) {
            let size = std::fs::metadata(&candidate).map(|m| m.len()).unwrap_or(0);
            if is_usable_size(model.size_bytes, size) {
                return Some(candidate);
            }

            warn!(
                model = %model.key,
                path = %candidate.display(),
                size,
                expected_size = model.size_bytes,
                "Ignoring unusable local model match"
            );
        }

        let mut found = Vec::new();
        scan_gguf_files(dir, 0, &mut found);
        alternatives.extend(found);
    }

    alternatives
        .into_iter()
        .filter(|(path, size)| {
            if *size < MIN_MODEL_BYTES {
                return false;
            }

            let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
                return false;
            };

            same_model_family(&model.filename, filename)
                && !filename.eq_ignore_ascii_case(&model.filename)
                && (model.size_bytes == 0 || *size <= model.size_bytes.saturating_mul(11) / 10)
        })
        .max_by_key(|(_, size)| *size)
        .map(|(path, size)| {
            info!(
                model = %model.key,
                requested = %model.filename,
                selected = %path.display(),
                size,
                expected_size = model.size_bytes,
                "Using best local same-family model instead of downloading"
            );
            path
        })
}

/// Scan all discovery paths and update manifest entries with found paths.
///
/// For each model in the manifest, walks the discovery directories and first
/// checks for an exact filename. If the exact planned file is not present, a
/// same-family GGUF with an equal-or-smaller footprint can be used as a local
/// fallback. This preserves LM Studio/HF cache reuse without silently upgrading
/// a low-VRAM plan to a larger quant.
pub fn scan_manifest(manifest: &mut [ModelInfo], models_dir: &PathBuf) {
    let search_dirs = discovery_paths(models_dir);

    for model in manifest.iter_mut() {
        // Skip if already resolved
        if model.downloaded && model.path.is_some() {
            continue;
        }

        if let Some(candidate) = find_best_local_match(model, &search_dirs) {
            info!(
                model = %model.key,
                path = %candidate.display(),
                "Found existing model"
            );
            model.path = Some(candidate);
            model.downloaded = true;
        } else {
            debug!(model = %model.key, filename = %model.filename, "Model not found locally");
        }
    }
}

/// Check if a specific model file exists in any discovery path.
pub fn find_model(filename: &str, models_dir: &PathBuf) -> Option<PathBuf> {
    let search_dirs = discovery_paths(models_dir);
    for dir in &search_dirs {
        if let Some(candidate) = scan_for_filename(dir, filename, 0) {
            let size = std::fs::metadata(&candidate).map(|m| m.len()).unwrap_or(0);
            if size >= MIN_MODEL_BYTES {
                return Some(candidate);
            }
        }
    }
    None
}
