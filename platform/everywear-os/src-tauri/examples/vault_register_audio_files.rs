use anyhow::{Context, Result};
use ew_vault::{AudioDocument, VaultIndex};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn main() -> Result<()> {
    let index = VaultIndex::open_or_create(everywear_paths::vault_index_dir())?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        anyhow::bail!("usage: vault_register_audio_files <path> [path...]");
    }

    let mut docs = Vec::new();
    let mut paths = Vec::new();
    for arg in args {
        let path = PathBuf::from(arg);
        docs.push(build_audio_doc(&path)?);
        paths.push(path);
    }

    let stale_count = index.replace_audio_documents_clearing_stale_by_file_path(&docs)?;
    for path in paths {
        println!("registered={}", path.display());
    }
    println!(
        "batch indexed {} audio document(s); removed {} stale duplicate row(s)",
        docs.len(),
        stale_count
    );

    Ok(())
}

fn build_audio_doc(path: &Path) -> Result<AudioDocument> {
    let metadata = std::fs::metadata(path)
        .with_context(|| format!("metadata {}", path.display()))?;
    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Gener8 output")
        .replace('_', " ");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let path_string = canonical.to_string_lossy().to_string();
    let id = format!("audio:{}", stable_path_key(&path_string));

    let mut tags = vec![
        "gener8".to_string(),
        "codex-overnight".to_string(),
        "asset:gener8_song".to_string(),
    ];
    tags.sort();
    tags.dedup();

    Ok(AudioDocument {
        id,
        applet_id: "gener8".to_string(),
        title,
        tags,
        created_at: now,
        updated_at: now,
        file_path: path_string,
        file_size_bytes: metadata.len(),
        mime_type: "audio/mpeg".to_string(),
        favorite: false,
        duration_seconds: 0.0,
        sample_rate: 0,
        channels: 0,
        genre: Some("progressive house".to_string()),
        bpm: Some(124),
        key_signature: Some("C minor".to_string()),
        is_stem: false,
        stem_type: None,
        lyrics_aligned: false,
        lyrics_text: None,
        asset_kind: Some("gener8_song".to_string()),
    })
}

fn stable_path_key(path: &str) -> String {
    path.chars()
        .map(|ch| match ch {
            'A'..='Z' => ch.to_ascii_lowercase(),
            'a'..='z' | '0'..='9' => ch,
            _ => '_',
        })
        .collect()
}
