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
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const APPLET_ID: &str = "gener8";
const RECEIPT_PREFIX: &str = "phase5-gener8";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    pub legacy_app_data_dir: PathBuf,
    pub legacy_models_dir: PathBuf,
    pub target_models_dir: PathBuf,
    pub target_data_dir: PathBuf,
    pub receipt_dir: PathBuf,
    pub legacy_app_data_exists: bool,
    pub model_files: Vec<PlannedFile>,
    pub library_settings_files: Vec<PlannedFile>,
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

pub fn plan() -> Result<MigrationPlan> {
    let legacy_app_data_dir = legacy_s3_app_data_dir();
    let legacy_models_dir = legacy_app_data_dir.join("models");
    let target_models_dir = everywear_paths::models_dir().join(APPLET_ID);
    let target_data_dir = everywear_paths::data_dir(APPLET_ID);
    let receipt_dir = everywear_paths::migration_dir();

    let mut warnings = Vec::new();
    let model_files = collect_planned_files(&legacy_models_dir, &target_models_dir)?;
    let library_settings_files =
        collect_library_settings_files(&legacy_app_data_dir, &target_data_dir)?;

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
        receipt_dir,
        legacy_app_data_exists: legacy_app_data_dir.exists(),
        model_files,
        library_settings_files,
        warnings,
    })
}

pub fn run(dry_run: bool) -> Result<MigrationSummary> {
    let plan = plan()?;
    let mut receipt = MigrationReceipt {
        id: format!("{}-{}", RECEIPT_PREFIX, Utc::now().format("%Y%m%dT%H%M%SZ")),
        created_at: Utc::now().to_rfc3339(),
        legacy_app_data_dir: plan.legacy_app_data_dir.clone(),
        target_models_dir: plan.target_models_dir.clone(),
        target_data_dir: plan.target_data_dir.clone(),
        operations: Vec::new(),
        warnings: plan.warnings.clone(),
    };

    migrate_models(&plan, dry_run, &mut receipt)?;
    migrate_library_settings(&plan, dry_run, &mut receipt)?;

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
            operations: Vec::new(),
            warnings: Vec::new(),
        };
        assert!(summary.id.starts_with("phase5-gener8-"));
    }
}
