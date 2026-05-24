//! Phase 5 data migration from S3 Gener8 paths into Everywear paths.
//!
//! Phase 5.1 moves legacy model weights from the old S3 app-data root into
//! Everywear model storage, verifies SHA256 before and after the move, then
//! attempts to replace the legacy models directory with a symlink to the new
//! location.
//!
//! Phase 5.2 copies library and settings JSON into Everywear data storage.
//! Old library/settings files are never deleted.

use anyhow::{Context, Result};
use chrono::Utc;
use ew_vault::{AudioDocument, VaultIndex};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APPLET_ID: &str = "gener8";
const RECEIPT_PREFIX: &str = "phase5-gener8";
const VAULT_AUDIO_RECEIPT_PREFIX: &str = "phase5-gener8-vault-audio";
const LEGACY_STUDIO_SUBDIR: &str = "Strands Sound Studio";
const LEGACY_AUDIO_IMPORT_DIR: &str = "Gener8 Legacy";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    pub legacy_app_data_dir: PathBuf,
    pub legacy_models_dir: PathBuf,
    pub target_models_dir: PathBuf,
    pub target_data_dir: PathBuf,
    pub target_vault_audio_dir: PathBuf,
    pub receipt_dir: PathBuf,
    pub legacy_app_data_exists: bool,
    pub model_files: Vec<PlannedFile>,
    pub library_settings_files: Vec<PlannedFile>,
    pub vault_audio_files: Vec<PlannedFile>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedFile {
    pub source: PathBuf,
    pub target: PathBuf,
    pub bytes: u64,
    pub exists_at_target: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationSummary {
    pub dry_run: bool,
    pub receipt_path: Option<PathBuf>,
    pub receipt: MigrationReceipt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReceipt {
    pub id: String,
    pub created_at: String,
    pub legacy_app_data_dir: PathBuf,
    pub target_models_dir: PathBuf,
    pub target_data_dir: PathBuf,
    pub target_vault_audio_dir: PathBuf,
    pub operations: Vec<MigrationOperation>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationOperation {
    pub phase: String,
    pub action: String,
    pub source: PathBuf,
    pub target: PathBuf,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLibraryIndex {
    #[serde(default)]
    tracks: Vec<LegacyLibraryTrack>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLibraryTrack {
    title: String,
    #[serde(default)]
    style: String,
    #[serde(default)]
    lyrics: String,
    #[serde(default)]
    audio_key: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    bpm: Option<f64>,
    #[serde(default)]
    key_scale: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    lrc_data: Option<String>,
}

pub fn plan() -> Result<MigrationPlan> {
    let legacy_app_data_dir = legacy_s3_app_data_dir();
    let legacy_models_dir = legacy_app_data_dir.join("models");
    let target_models_dir = everywear_paths::models_dir().join(APPLET_ID);
    let target_data_dir = everywear_paths::data_dir(APPLET_ID);
    let target_vault_audio_dir = everywear_paths::vault_audio();
    let receipt_dir = everywear_paths::migration_dir();

    let mut warnings = Vec::new();
    let model_files = collect_planned_files(&legacy_models_dir, &target_models_dir)?;
    let library_settings_files =
        collect_library_settings_files(&legacy_app_data_dir, &target_data_dir)?;
    let vault_audio_files = collect_vault_audio_import_files()?;

    if !legacy_app_data_dir.exists() {
        warnings.push(format!(
            "Legacy S3 app-data directory does not exist: {}",
            legacy_app_data_dir.display()
        ));
    }

    Ok(MigrationPlan {
        legacy_app_data_dir: legacy_app_data_dir.clone(),
        legacy_models_dir,
        target_models_dir,
        target_data_dir,
        target_vault_audio_dir,
        receipt_dir,
        legacy_app_data_exists: legacy_app_data_dir.exists(),
        model_files,
        library_settings_files,
        vault_audio_files,
        warnings,
    })
}

pub fn run(dry_run: bool, vault_index: Option<&VaultIndex>) -> Result<MigrationSummary> {
    let plan = plan()?;
    let mut receipt = MigrationReceipt {
        id: format!("{}-{}", RECEIPT_PREFIX, Utc::now().format("%Y%m%dT%H%M%SZ")),
        created_at: Utc::now().to_rfc3339(),
        legacy_app_data_dir: plan.legacy_app_data_dir.clone(),
        target_models_dir: plan.target_models_dir.clone(),
        target_data_dir: plan.target_data_dir.clone(),
        target_vault_audio_dir: plan.target_vault_audio_dir.clone(),
        operations: Vec::new(),
        warnings: plan.warnings.clone(),
    };

    migrate_models(&plan, dry_run, &mut receipt)?;
    migrate_library_settings(&plan, dry_run, &mut receipt)?;
    migrate_vault_audio(&plan, dry_run, vault_index, &mut receipt)?;

    let receipt_path = if dry_run {
        None
    } else {
        fs::create_dir_all(&plan.receipt_dir)
            .with_context(|| format!("create {}", plan.receipt_dir.display()))?;
        let path = plan.receipt_dir.join(format!("{}.json", receipt.id));
        fs::write(&path, serde_json::to_vec_pretty(&receipt)?)
            .with_context(|| format!("write migration receipt {}", path.display()))?;
        Some(path)
    };

    Ok(MigrationSummary {
        dry_run,
        receipt_path,
        receipt,
    })
}

pub fn run_vault_audio_import(
    dry_run: bool,
    vault_index: Option<&VaultIndex>,
) -> Result<MigrationSummary> {
    let plan = plan()?;
    let mut receipt = MigrationReceipt {
        id: format!(
            "{}-{}",
            VAULT_AUDIO_RECEIPT_PREFIX,
            Utc::now().format("%Y%m%dT%H%M%SZ")
        ),
        created_at: Utc::now().to_rfc3339(),
        legacy_app_data_dir: plan.legacy_app_data_dir.clone(),
        target_models_dir: plan.target_models_dir.clone(),
        target_data_dir: plan.target_data_dir.clone(),
        target_vault_audio_dir: plan.target_vault_audio_dir.clone(),
        operations: Vec::new(),
        warnings: plan.warnings.clone(),
    };

    migrate_vault_audio(&plan, dry_run, vault_index, &mut receipt)?;

    let receipt_path = if dry_run {
        None
    } else {
        fs::create_dir_all(&plan.receipt_dir)
            .with_context(|| format!("create {}", plan.receipt_dir.display()))?;
        let path = plan.receipt_dir.join(format!("{}.json", receipt.id));
        fs::write(&path, serde_json::to_vec_pretty(&receipt)?)
            .with_context(|| format!("write migration receipt {}", path.display()))?;
        Some(path)
    };

    Ok(MigrationSummary {
        dry_run,
        receipt_path,
        receipt,
    })
}

fn migrate_models(
    plan: &MigrationPlan,
    dry_run: bool,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if plan.model_files.is_empty() {
        return Ok(());
    }

    if !dry_run {
        fs::create_dir_all(&plan.target_models_dir)
            .with_context(|| format!("create {}", plan.target_models_dir.display()))?;
    }

    for planned in &plan.model_files {
        let hash_before = if dry_run {
            None
        } else {
            Some(sha256_file(&planned.source)?)
        };

        let mut status = "planned".to_string();
        if !dry_run {
            if planned.target.exists() {
                let target_hash = sha256_file(&planned.target)?;
                if Some(target_hash.as_str()) == hash_before.as_deref() {
                    fs::remove_file(&planned.source).with_context(|| {
                        format!("remove duplicate source {}", planned.source.display())
                    })?;
                    status = "target already existed; duplicate source removed".to_string();
                } else {
                    status = "skipped; target exists with different SHA256".to_string();
                    receipt.warnings.push(format!(
                        "Skipped model with conflicting target: {} -> {}",
                        planned.source.display(),
                        planned.target.display()
                    ));
                }
            } else {
                if let Some(parent) = planned.target.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }

                match fs::rename(&planned.source, &planned.target) {
                    Ok(_) => {
                        status = "moved by rename".to_string();
                    }
                    Err(rename_error) => {
                        fs::copy(&planned.source, &planned.target).with_context(|| {
                            format!(
                                "copy fallback after rename failed ({rename_error}): {} -> {}",
                                planned.source.display(),
                                planned.target.display()
                            )
                        })?;
                        let target_hash = sha256_file(&planned.target)?;
                        if Some(target_hash.as_str()) != hash_before.as_deref() {
                            let _ = fs::remove_file(&planned.target);
                            anyhow::bail!(
                                "SHA256 mismatch after copy: {} -> {}",
                                planned.source.display(),
                                planned.target.display()
                            );
                        }
                        fs::remove_file(&planned.source).with_context(|| {
                            format!("remove copied source {}", planned.source.display())
                        })?;
                        status = "copied, verified, source removed".to_string();
                    }
                }

                let hash_after = sha256_file(&planned.target)?;
                if Some(hash_after.as_str()) != hash_before.as_deref() {
                    anyhow::bail!(
                        "SHA256 mismatch after move: {} -> {}",
                        planned.source.display(),
                        planned.target.display()
                    );
                }
            }
        }

        receipt.operations.push(MigrationOperation {
            phase: "5.1".to_string(),
            action: "migrate_model".to_string(),
            source: planned.source.clone(),
            target: planned.target.clone(),
            bytes: planned.bytes,
            sha256: hash_before,
            status,
        });
    }

    if !dry_run {
        remove_empty_dirs(&plan.legacy_models_dir)?;
        ensure_legacy_models_link(&plan.legacy_models_dir, &plan.target_models_dir, receipt)?;
    } else {
        receipt.operations.push(MigrationOperation {
            phase: "5.1".to_string(),
            action: "link_legacy_models_dir".to_string(),
            source: plan.legacy_models_dir.clone(),
            target: plan.target_models_dir.clone(),
            bytes: 0,
            sha256: None,
            status: "planned".to_string(),
        });
    }

    Ok(())
}

fn migrate_library_settings(
    plan: &MigrationPlan,
    dry_run: bool,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if plan.library_settings_files.is_empty() {
        return Ok(());
    }

    if !dry_run {
        fs::create_dir_all(&plan.target_data_dir)
            .with_context(|| format!("create {}", plan.target_data_dir.display()))?;
    }

    for planned in &plan.library_settings_files {
        let mut target = planned.target.clone();
        let hash = if dry_run {
            None
        } else {
            Some(sha256_file(&planned.source)?)
        };
        let mut status = "planned copy; source preserved".to_string();

        if !dry_run {
            if target.exists() {
                let target_hash = sha256_file(&target)?;
                if Some(target_hash.as_str()) == hash.as_deref() {
                    status = "target already exists with same SHA256; source preserved".to_string();
                } else {
                    target = conflict_target(&target, &receipt.id);
                    status = "target existed; copied to conflict-safe legacy filename".to_string();
                }
            }

            if !target.exists() {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }
                fs::copy(&planned.source, &target).with_context(|| {
                    format!("copy {} -> {}", planned.source.display(), target.display())
                })?;
                let copied_hash = sha256_file(&target)?;
                if Some(copied_hash.as_str()) != hash.as_deref() {
                    let _ = fs::remove_file(&target);
                    anyhow::bail!(
                        "SHA256 mismatch after copy: {} -> {}",
                        planned.source.display(),
                        target.display()
                    );
                }
            }
        }

        receipt.operations.push(MigrationOperation {
            phase: "5.2".to_string(),
            action: "copy_library_or_settings".to_string(),
            source: planned.source.clone(),
            target,
            bytes: planned.bytes,
            sha256: hash,
            status,
        });
    }

    Ok(())
}

fn migrate_vault_audio(
    plan: &MigrationPlan,
    dry_run: bool,
    vault_index: Option<&VaultIndex>,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if plan.vault_audio_files.is_empty() {
        return Ok(());
    }

    if !dry_run {
        everywear_paths::ensure_vault_dirs().context("ensure Everywear Vault directories")?;
    }

    let legacy_tracks = load_legacy_library_tracks(&plan.legacy_app_data_dir)?;

    for planned in &plan.vault_audio_files {
        let mut target = planned.target.clone();
        let hash = if dry_run {
            None
        } else {
            Some(sha256_file(&planned.source)?)
        };
        let mut status = "planned copy; source preserved".to_string();

        if !dry_run {
            if target.exists() {
                let target_hash = sha256_file(&target)?;
                if Some(target_hash.as_str()) == hash.as_deref() {
                    status = "target already exists with same SHA256; indexed".to_string();
                } else {
                    target = conflict_target(&target, &receipt.id);
                    status = "target existed; copied to conflict-safe legacy filename".to_string();
                }
            }

            if !target.exists() {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }
                fs::copy(&planned.source, &target).with_context(|| {
                    format!("copy {} -> {}", planned.source.display(), target.display())
                })?;
                let copied_hash = sha256_file(&target)?;
                if Some(copied_hash.as_str()) != hash.as_deref() {
                    let _ = fs::remove_file(&target);
                    anyhow::bail!(
                        "SHA256 mismatch after audio copy: {} -> {}",
                        planned.source.display(),
                        target.display()
                    );
                }
                status = "copied, verified, source preserved".to_string();
            }

            if let (Some(index), Some(hash)) = (vault_index, hash.as_deref()) {
                let legacy_track = match_legacy_track(&legacy_tracks, &planned.source, &target);
                let doc = audio_document_for_import(&target, hash, legacy_track)?;
                index.index_audio(&doc).with_context(|| {
                    format!("index imported audio in vault {}", target.display())
                })?;
                if status == "copied, verified, source preserved" {
                    status = "copied, verified, indexed; source preserved".to_string();
                }
            } else if vault_index.is_none() {
                receipt.warnings.push(format!(
                    "Audio copied but not indexed because no Vault index was provided: {}",
                    target.display()
                ));
            }
        }

        receipt.operations.push(MigrationOperation {
            phase: "5.3".to_string(),
            action: "copy_legacy_audio_to_vault".to_string(),
            source: planned.source.clone(),
            target,
            bytes: planned.bytes,
            sha256: hash,
            status,
        });
    }

    Ok(())
}

fn collect_planned_files(source_root: &Path, target_root: &Path) -> Result<Vec<PlannedFile>> {
    let mut out = Vec::new();
    if !source_root.exists() {
        return Ok(out);
    }

    for source in walk_files(source_root)? {
        let rel = source
            .strip_prefix(source_root)
            .with_context(|| format!("strip prefix {}", source.display()))?;
        let metadata = fs::metadata(&source)?;
        let target = target_root.join(rel);
        let exists_at_target = target.exists();
        out.push(PlannedFile {
            source,
            target,
            bytes: metadata.len(),
            exists_at_target,
        });
    }
    Ok(out)
}

fn collect_library_settings_files(
    source_root: &Path,
    target_root: &Path,
) -> Result<Vec<PlannedFile>> {
    let mut files = Vec::new();
    for file in [
        "settings.json",
        "library.json",
        "playlists.json",
        "videos.json",
    ] {
        collect_one_if_exists(source_root.join(file), target_root.join(file), &mut files)?;
    }

    let users = source_root.join("users");
    if users.exists() {
        for source in walk_files(&users)? {
            let rel = source
                .strip_prefix(source_root)
                .with_context(|| format!("strip prefix {}", source.display()))?;
            collect_one_if_exists(source.clone(), target_root.join(rel), &mut files)?;
        }
    }

    Ok(files)
}

fn collect_vault_audio_import_files() -> Result<Vec<PlannedFile>> {
    let mut files = Vec::new();
    let mut candidates = legacy_music_audio_roots()?;

    let legacy_app_data_dir = legacy_s3_app_data_dir();
    candidates.push((
        legacy_app_data_dir.join("audio"),
        "legacy-app-audio".to_string(),
    ));
    candidates.push((
        everywear_paths::data_dir(APPLET_ID).join("audio"),
        "everywear-data-audio".to_string(),
    ));

    let vault_root = everywear_paths::vault_root();
    let mut seen = Vec::<PathBuf>::new();
    for (source_root, label) in candidates {
        if !source_root.exists() || path_is_under(&source_root, &vault_root) {
            continue;
        }

        let canonical_root = source_root
            .canonicalize()
            .unwrap_or_else(|_| source_root.clone());
        if seen.iter().any(|seen_root| seen_root == &canonical_root) {
            continue;
        }
        seen.push(canonical_root);

        for source in walk_files(&source_root)? {
            if !is_audio_file(&source) || path_is_under(&source, &vault_root) {
                continue;
            }
            let rel = source
                .strip_prefix(&source_root)
                .with_context(|| format!("strip prefix {}", source.display()))?;
            let metadata = fs::metadata(&source)?;
            let target_root = if is_stem_path(&source) {
                everywear_paths::vault_audio_stems()
                    .join(LEGACY_AUDIO_IMPORT_DIR)
                    .join(&label)
            } else {
                everywear_paths::vault_audio()
                    .join(LEGACY_AUDIO_IMPORT_DIR)
                    .join(&label)
            };
            let target = target_root.join(rel);
            files.push(PlannedFile {
                source,
                target: target.clone(),
                bytes: metadata.len(),
                exists_at_target: target.exists(),
            });
        }
    }

    Ok(files)
}

fn legacy_music_audio_roots() -> Result<Vec<(PathBuf, String)>> {
    let Some(audio_dir) = dirs::audio_dir() else {
        return Ok(Vec::new());
    };
    let studio_root = audio_dir.join(LEGACY_STUDIO_SUBDIR);
    if !studio_root.exists() {
        return Ok(Vec::new());
    }

    let mut profile_roots = Vec::new();
    for entry in
        fs::read_dir(&studio_root).with_context(|| format!("read {}", studio_root.display()))?
    {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path();
        if !looks_like_legacy_music_profile_root(&path) {
            continue;
        }
        let label = entry
            .file_name()
            .to_str()
            .map(safe_import_label)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "profile".to_string());
        profile_roots.push((path, format!("music-user-{label}")));
    }

    if profile_roots.is_empty() {
        Ok(vec![(studio_root, "music-library".to_string())])
    } else {
        Ok(profile_roots)
    }
}

fn looks_like_legacy_music_profile_root(path: &Path) -> bool {
    ["gener8", "stems", "references", "covers"]
        .iter()
        .any(|dir| path.join(dir).is_dir())
}

fn safe_import_label(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(48)
        .collect()
}

fn collect_one_if_exists(
    source: PathBuf,
    target: PathBuf,
    files: &mut Vec<PlannedFile>,
) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    let metadata = fs::metadata(&source)?;
    if !metadata.is_file() {
        return Ok(());
    }
    files.push(PlannedFile {
        source,
        target: target.clone(),
        bytes: metadata.len(),
        exists_at_target: target.exists(),
    });
    Ok(())
}

fn walk_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut queue = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = queue.pop_front() {
        for entry in fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
            let entry = entry?;
            let path = entry.path();
            let ty = entry.file_type()?;
            if ty.is_dir() {
                queue.push_back(path);
            } else if ty.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .with_context(|| format!("read {}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn audio_document_for_import(
    path: &Path,
    source_sha256: &str,
    legacy_track: Option<&LegacyLibraryTrack>,
) -> Result<AudioDocument> {
    let metadata = fs::metadata(path).with_context(|| format!("metadata {}", path.display()))?;
    let file_timestamp = metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .and_then(system_time_to_unix_seconds)
        .unwrap_or_else(now_timestamp);
    let is_stem = is_stem_path(path);
    let asset_kind = if is_stem { "stem" } else { "gener8_song" };
    let timestamp = legacy_track
        .and_then(|track| chrono::DateTime::parse_from_rfc3339(&track.created_at).ok())
        .map(|created| created.timestamp().max(0) as u64)
        .unwrap_or(file_timestamp);
    let mut tags = legacy_track
        .map(|track| track.tags.clone())
        .unwrap_or_default();
    tags.push("gener8".to_string());
    tags.push("legacy-import".to_string());
    tags.push(format!("asset:{asset_kind}"));
    if is_stem {
        tags.push("stem".to_string());
    }
    tags.sort();
    tags.dedup();

    Ok(AudioDocument {
        id: stable_audio_import_id(path, source_sha256),
        applet_id: APPLET_ID.to_string(),
        title: legacy_track
            .map(|track| track.title.trim())
            .filter(|title| !title.is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Legacy Gener8 Audio".to_string()),
        tags,
        created_at: timestamp,
        updated_at: now_timestamp(),
        file_path: path.to_string_lossy().to_string(),
        file_size_bytes: metadata.len(),
        mime_type: mime_from_path(path),
        favorite: false,
        duration_seconds: legacy_track
            .map(|track| track.duration)
            .filter(|duration| *duration > 0.0)
            .unwrap_or_default(),
        sample_rate: 0,
        channels: 0,
        genre: legacy_track
            .map(|track| track.style.trim())
            .filter(|style| !style.is_empty())
            .map(str::to_string),
        bpm: legacy_track.and_then(|track| track.bpm.map(|value| value.round().max(0.0) as u64)),
        key_signature: legacy_track.and_then(|track| track.key_scale.clone()),
        is_stem,
        stem_type: infer_stem_type(path),
        lyrics_aligned: false,
        lyrics_text: legacy_track
            .map(|track| {
                if track.lyrics.trim().is_empty() {
                    track.lrc_data.as_deref().unwrap_or_default().trim()
                } else {
                    track.lyrics.trim()
                }
            })
            .filter(|lyrics| !lyrics.is_empty())
            .map(str::to_string),
        asset_kind: Some(asset_kind.to_string()),
    })
}

fn load_legacy_library_tracks(legacy_app_data_dir: &Path) -> Result<Vec<LegacyLibraryTrack>> {
    let mut tracks = Vec::new();
    read_legacy_library_file(&legacy_app_data_dir.join("library.json"), &mut tracks)?;

    let users_dir = legacy_app_data_dir.join("users");
    if users_dir.exists() {
        for path in walk_files(&users_dir)? {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("library.json"))
            {
                read_legacy_library_file(&path, &mut tracks)?;
            }
        }
    }

    Ok(tracks)
}

fn read_legacy_library_file(path: &Path, tracks: &mut Vec<LegacyLibraryTrack>) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let library = serde_json::from_str::<LegacyLibraryIndex>(&raw)
        .with_context(|| format!("parse legacy library {}", path.display()))?;
    tracks.extend(
        library
            .tracks
            .into_iter()
            .filter(|track| !track.audio_key.is_empty()),
    );
    Ok(())
}

fn match_legacy_track<'a>(
    tracks: &'a [LegacyLibraryTrack],
    source: &Path,
    target: &Path,
) -> Option<&'a LegacyLibraryTrack> {
    let source = normalized_path(source);
    let target = normalized_path(target);
    tracks.iter().find(|track| {
        let audio_key = normalized_key(&track.audio_key);
        !audio_key.is_empty() && (source.ends_with(&audio_key) || target.ends_with(&audio_key))
    })
}

fn normalized_path(path: &Path) -> String {
    normalized_key(&path.to_string_lossy())
}

fn normalized_key(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn stable_audio_import_id(path: &Path, source_sha256: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(source_sha256.as_bytes());
    let hash = hex::encode(hasher.finalize());
    format!("legacy-gener8-{}", &hash[..32])
}

fn mime_from_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        _ => "audio/wav",
    }
    .to_string()
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac"
    )
}

fn is_stem_path(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| part.eq_ignore_ascii_case("stems") || part.eq_ignore_ascii_case("stem"))
            .unwrap_or(false)
    })
}

fn infer_stem_type(path: &Path) -> Option<String> {
    let stem_names = [
        "vocals",
        "vocal",
        "drums",
        "bass",
        "guitar",
        "piano",
        "melody",
        "accompaniment",
        "instrumental",
        "other",
    ];
    path.components().find_map(|component| {
        let part = component.as_os_str().to_str()?.to_ascii_lowercase();
        stem_names
            .iter()
            .find(|stem| part == **stem || part.contains(*stem))
            .map(|stem| (*stem).to_string())
    })
}

fn path_is_under(path: &Path, root: &Path) -> bool {
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    canonical_path.starts_with(canonical_root)
}

fn system_time_to_unix_seconds(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn now_timestamp() -> u64 {
    Utc::now().timestamp().max(0) as u64
}

fn remove_empty_dirs(root: &Path) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }

    let mut dirs = Vec::new();
    let mut queue = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = queue.pop_front() {
        for entry in fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let path = entry.path();
                queue.push_back(path.clone());
                dirs.push(path);
            }
        }
    }

    dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for dir in dirs {
        let _ = fs::remove_dir(&dir);
    }
    let _ = fs::remove_dir(root);
    Ok(())
}

fn ensure_legacy_models_link(
    legacy_models_dir: &Path,
    target_models_dir: &Path,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if legacy_models_dir.exists() {
        receipt.warnings.push(format!(
            "Legacy models directory still exists, so symlink was not created: {}",
            legacy_models_dir.display()
        ));
        return Ok(());
    }

    if let Some(parent) = legacy_models_dir.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }

    match symlink_dir(target_models_dir, legacy_models_dir) {
        Ok(_) => receipt.operations.push(MigrationOperation {
            phase: "5.1".to_string(),
            action: "link_legacy_models_dir".to_string(),
            source: legacy_models_dir.to_path_buf(),
            target: target_models_dir.to_path_buf(),
            bytes: 0,
            sha256: None,
            status: "created".to_string(),
        }),
        Err(error) => receipt.warnings.push(format!(
            "Could not create legacy models symlink {} -> {}: {error}",
            legacy_models_dir.display(),
            target_models_dir.display()
        )),
    }

    Ok(())
}

#[cfg(windows)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

fn conflict_target(target: &Path, receipt_id: &str) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("legacy");
    let ext = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("json");
    target.with_file_name(format!("{stem}.legacy-{receipt_id}.{ext}"))
}

fn legacy_s3_app_data_dir() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Public"))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|home| {
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
            })
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
                    .unwrap_or_else(|_| PathBuf::from("/tmp"))
            })
    };
    base.join("S3-Gener8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_target_preserves_extension() {
        let target = PathBuf::from("settings.json");
        assert_eq!(
            conflict_target(&target, "r1"),
            PathBuf::from("settings.legacy-r1.json")
        );
    }

    #[test]
    fn receipt_prefix_is_stable() {
        let summary = MigrationReceipt {
            id: format!("{RECEIPT_PREFIX}-test"),
            created_at: "now".into(),
            legacy_app_data_dir: PathBuf::from("old"),
            target_models_dir: PathBuf::from("models"),
            target_data_dir: PathBuf::from("data"),
            target_vault_audio_dir: PathBuf::from("vault-audio"),
            operations: Vec::new(),
            warnings: Vec::new(),
        };
        assert!(summary.id.starts_with("phase5-gener8-"));
    }
}
