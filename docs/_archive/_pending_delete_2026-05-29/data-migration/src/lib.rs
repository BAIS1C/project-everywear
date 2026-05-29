//! Phase 5 data migration from legacy S3 Gener8 paths into Everywear paths.
//!
//! This crate is intentionally isolated from shell and applet binaries so
//! high-risk filesystem moves can be tested and audited independently.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

const APPLET_ID: &str = "gener8";
const LEGACY_APP_DIR: &str = "S3-Gener8";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReceipt {
    pub source: PathBuf,
    pub target: PathBuf,
    pub files_moved: usize,
    pub dry_run: bool,
    pub timestamp: String,
    pub skipped: bool,
    pub phase: String,
    pub warnings: Vec<String>,
    pub operations: Vec<MigrationOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationOperation {
    pub action: String,
    pub source: PathBuf,
    pub target: PathBuf,
    pub status: String,
    pub bytes: u64,
    pub sha256: Option<String>,
}

/// Phase 5.1: migrate `%LOCALAPPDATA%\S3-Gener8\models\` to
/// `~/.everywear/models/gener8`.
pub fn migrate_models(dry_run: bool) -> Result<MigrationReceipt> {
    let source = legacy_app_data_dir()?.join("models");
    let target = everywear_paths::models_dir().join(APPLET_ID);
    let mut receipt = new_receipt("5.1", &source, &target, dry_run);

    if !source.exists() {
        info!(source = %source.display(), "legacy models directory not found; skipping");
        receipt.skipped = true;
        receipt.warnings.push(format!(
            "Legacy models directory not found: {}",
            source.display()
        ));
        return Ok(receipt);
    }

    if dry_run {
        info!(target = %target.display(), "dry run: would ensure target models directory exists");
    } else {
        fs::create_dir_all(&target).with_context(|| format!("create {}", target.display()))?;
    }

    for entry in fs::read_dir(&source).with_context(|| format!("read {}", source.display()))? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let source_file = entry.path();

        if !file_type.is_file() {
            warn!(source = %source_file.display(), "skipping non-file entry in legacy models directory");
            receipt.warnings.push(format!(
                "Skipped non-file model entry: {}",
                source_file.display()
            ));
            continue;
        }

        let Some(name) = source_file.file_name() else {
            warn!(source = %source_file.display(), "skipping nameless model entry");
            continue;
        };
        let target_file = target.join(name);
        let bytes = entry.metadata()?.len();

        info!(source = %source_file.display(), "calculating source SHA256");
        let source_hash = sha256_file(&source_file)?;

        if target_file.exists() {
            warn!(
                source = %source_file.display(),
                target = %target_file.display(),
                "target model already exists; skipping without overwrite"
            );
            receipt.operations.push(MigrationOperation {
                action: "move_model".to_string(),
                source: source_file,
                target: target_file,
                status: "skipped_target_exists".to_string(),
                bytes,
                sha256: Some(source_hash),
            });
            continue;
        }

        if dry_run {
            info!(
                source = %source_file.display(),
                target = %target_file.display(),
                "dry run: would rename model file"
            );
            receipt.operations.push(MigrationOperation {
                action: "move_model".to_string(),
                source: source_file,
                target: target_file,
                status: "dry_run_planned".to_string(),
                bytes,
                sha256: Some(source_hash),
            });
            continue;
        }

        if let Some(parent) = target_file.parent() {
            fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        }

        info!(source = %source_file.display(), target = %target_file.display(), "renaming model file");
        fs::rename(&source_file, &target_file).with_context(|| {
            format!(
                "rename {} -> {}",
                source_file.display(),
                target_file.display()
            )
        })?;

        info!(target = %target_file.display(), "calculating target SHA256");
        let target_hash = sha256_file(&target_file)?;
        if target_hash != source_hash {
            anyhow::bail!(
                "SHA256 mismatch after model move: {} -> {}",
                source_file.display(),
                target_file.display()
            );
        }

        receipt.files_moved += 1;
        receipt.operations.push(MigrationOperation {
            action: "move_model".to_string(),
            source: source_file,
            target: target_file,
            status: "moved_verified".to_string(),
            bytes,
            sha256: Some(source_hash),
        });
    }

    if dry_run {
        info!(source = %source.display(), target = %target.display(), "dry run: would create legacy models junction");
        receipt.operations.push(MigrationOperation {
            action: "create_junction".to_string(),
            source: source.clone(),
            target: target.clone(),
            status: "dry_run_planned".to_string(),
            bytes: 0,
            sha256: None,
        });
    } else {
        create_legacy_directory_link(&source, &target, &mut receipt, "create_junction")?;
        write_receipt("gener8-models.json", &receipt)?;
    }

    Ok(receipt)
}

/// Phase 5.2: migrate legacy library, audio, and settings into Everywear
/// data/config paths.
pub fn migrate_library_and_settings(dry_run: bool) -> Result<MigrationReceipt> {
    let legacy_root = legacy_app_data_dir()?;
    let source = legacy_root.clone();
    let target = everywear_paths::data_dir(APPLET_ID);
    let mut receipt = new_receipt("5.2", &source, &target, dry_run);

    if !legacy_root.exists() {
        info!(source = %legacy_root.display(), "legacy app data directory not found; skipping");
        receipt.skipped = true;
        receipt.warnings.push(format!(
            "Legacy app data directory not found: {}",
            legacy_root.display()
        ));
        return Ok(receipt);
    }

    migrate_single_file(
        &legacy_root.join("library.json"),
        &target.join("library.json"),
        dry_run,
        &mut receipt,
        "move_library",
    )?;

    migrate_audio_dir(
        &legacy_root.join("audio"),
        &target.join("audio"),
        dry_run,
        &mut receipt,
    )?;

    migrate_settings(
        &legacy_root.join("settings.json"),
        &everywear_paths::config_dir().join("gener8.json"),
        dry_run,
        &mut receipt,
    )?;

    if !dry_run {
        write_receipt("gener8-library-settings.json", &receipt)?;
    }

    Ok(receipt)
}

fn migrate_audio_dir(
    source: &Path,
    target: &Path,
    dry_run: bool,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if !source.exists() {
        info!(source = %source.display(), "legacy audio directory not found; skipping");
        receipt.warnings.push(format!(
            "Legacy audio directory not found: {}",
            source.display()
        ));
        return Ok(());
    }

    if target.exists() {
        warn!(
            source = %source.display(),
            target = %target.display(),
            "target audio directory already exists; skipping without overwrite"
        );
        receipt.operations.push(MigrationOperation {
            action: "move_audio_dir".to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "skipped_target_exists".to_string(),
            bytes: directory_size(source)?,
            sha256: None,
        });
        return Ok(());
    }

    if dry_run {
        info!(source = %source.display(), target = %target.display(), "dry run: would rename audio directory");
        for file in collect_files(source)? {
            info!(source = %file.display(), "dry run: calculating audio file SHA256");
            let _ = sha256_file(&file)?;
        }
        receipt.operations.push(MigrationOperation {
            action: "move_audio_dir".to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "dry_run_planned".to_string(),
            bytes: directory_size(source)?,
            sha256: None,
        });
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }

    let before = directory_hashes(source)?;
    info!(source = %source.display(), target = %target.display(), "renaming audio directory");
    fs::rename(source, target)
        .with_context(|| format!("rename {} -> {}", source.display(), target.display()))?;
    let after = directory_hashes(target)?;
    if before != after {
        anyhow::bail!(
            "SHA256 mismatch after audio directory move: {} -> {}",
            source.display(),
            target.display()
        );
    }

    receipt.files_moved += before.len();
    receipt.operations.push(MigrationOperation {
        action: "move_audio_dir".to_string(),
        source: source.to_path_buf(),
        target: target.to_path_buf(),
        status: "moved_verified".to_string(),
        bytes: after.iter().map(|(_, _, bytes)| *bytes).sum(),
        sha256: None,
    });

    create_legacy_directory_link(source, target, receipt, "create_audio_junction")?;
    Ok(())
}

fn migrate_single_file(
    source: &Path,
    target: &Path,
    dry_run: bool,
    receipt: &mut MigrationReceipt,
    action: &str,
) -> Result<()> {
    if !source.exists() {
        info!(source = %source.display(), "legacy file not found; skipping");
        receipt
            .warnings
            .push(format!("Legacy file not found: {}", source.display()));
        return Ok(());
    }

    let bytes = fs::metadata(source)?.len();
    info!(source = %source.display(), "calculating source SHA256");
    let source_hash = sha256_file(source)?;

    if target.exists() {
        warn!(
            source = %source.display(),
            target = %target.display(),
            "target file already exists; skipping without overwrite"
        );
        receipt.operations.push(MigrationOperation {
            action: action.to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "skipped_target_exists".to_string(),
            bytes,
            sha256: Some(source_hash),
        });
        return Ok(());
    }

    if dry_run {
        info!(source = %source.display(), target = %target.display(), "dry run: would rename file");
        receipt.operations.push(MigrationOperation {
            action: action.to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "dry_run_planned".to_string(),
            bytes,
            sha256: Some(source_hash),
        });
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    info!(source = %source.display(), target = %target.display(), "renaming file");
    fs::rename(source, target)
        .with_context(|| format!("rename {} -> {}", source.display(), target.display()))?;
    let target_hash = sha256_file(target)?;
    if target_hash != source_hash {
        anyhow::bail!(
            "SHA256 mismatch after file move: {} -> {}",
            source.display(),
            target.display()
        );
    }

    receipt.files_moved += 1;
    receipt.operations.push(MigrationOperation {
        action: action.to_string(),
        source: source.to_path_buf(),
        target: target.to_path_buf(),
        status: "moved_verified".to_string(),
        bytes,
        sha256: Some(source_hash),
    });
    Ok(())
}

fn migrate_settings(
    source: &Path,
    target: &Path,
    dry_run: bool,
    receipt: &mut MigrationReceipt,
) -> Result<()> {
    if !source.exists() {
        info!(source = %source.display(), "legacy settings not found; skipping");
        receipt
            .warnings
            .push(format!("Legacy settings not found: {}", source.display()));
        return Ok(());
    }

    let bytes = fs::metadata(source)?.len();
    info!(source = %source.display(), "calculating settings SHA256");
    let source_hash = sha256_file(source)?;

    if target.exists() {
        warn!(
            source = %source.display(),
            target = %target.display(),
            "target settings already exists; skipping without overwrite"
        );
        receipt.operations.push(MigrationOperation {
            action: "write_settings".to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "skipped_target_exists".to_string(),
            bytes,
            sha256: Some(source_hash),
        });
        return Ok(());
    }

    if dry_run {
        info!(source = %source.display(), target = %target.display(), "dry run: would read legacy settings and write Everywear config");
        receipt.operations.push(MigrationOperation {
            action: "write_settings".to_string(),
            source: source.to_path_buf(),
            target: target.to_path_buf(),
            status: "dry_run_planned".to_string(),
            bytes,
            sha256: Some(source_hash),
        });
        return Ok(());
    }

    let settings = fs::read(source).with_context(|| format!("read {}", source.display()))?;
    let _: serde_json::Value = serde_json::from_slice(&settings)
        .with_context(|| format!("parse legacy settings {}", source.display()))?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    info!(source = %source.display(), target = %target.display(), "writing Everywear config");
    fs::write(target, &settings).with_context(|| format!("write {}", target.display()))?;
    let target_hash = sha256_file(target)?;
    if target_hash != source_hash {
        anyhow::bail!(
            "SHA256 mismatch after settings write: {} -> {}",
            source.display(),
            target.display()
        );
    }

    receipt.files_moved += 1;
    receipt.operations.push(MigrationOperation {
        action: "write_settings".to_string(),
        source: source.to_path_buf(),
        target: target.to_path_buf(),
        status: "written_verified_source_preserved".to_string(),
        bytes,
        sha256: Some(source_hash),
    });
    Ok(())
}

fn create_legacy_directory_link(
    old_path: &Path,
    new_path: &Path,
    receipt: &mut MigrationReceipt,
    action: &str,
) -> Result<()> {
    if old_path.exists() {
        match fs::remove_dir(old_path) {
            Ok(_) => {}
            Err(error) => {
                warn!(
                    source = %old_path.display(),
                    target = %new_path.display(),
                    %error,
                    "could not remove old directory before junction creation"
                );
                receipt.warnings.push(format!(
                    "Could not remove old directory before junction creation: {} ({error})",
                    old_path.display()
                ));
                return Ok(());
            }
        }
    }

    match create_directory_junction_or_link(old_path, new_path) {
        Ok(_) => {
            info!(source = %old_path.display(), target = %new_path.display(), "created legacy directory junction/link");
            receipt.operations.push(MigrationOperation {
                action: action.to_string(),
                source: old_path.to_path_buf(),
                target: new_path.to_path_buf(),
                status: "created".to_string(),
                bytes: 0,
                sha256: None,
            });
        }
        Err(error) => {
            warn!(
                source = %old_path.display(),
                target = %new_path.display(),
                %error,
                "junction creation failed; migration remains valid"
            );
            receipt.warnings.push(format!(
                "Junction creation failed for {} -> {}: {error}",
                old_path.display(),
                new_path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn create_directory_junction_or_link(link: &Path, target: &Path) -> std::io::Result<()> {
    use std::process::Command;

    let status = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &link.to_string_lossy(),
            &target.to_string_lossy(),
        ])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("mklink /J exited with {status}"),
        ))
    }
}

#[cfg(unix)]
fn create_directory_junction_or_link(link: &Path, target: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(target_os = "windows", unix)))]
fn create_directory_junction_or_link(_link: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "directory junction/link unsupported on this platform",
    ))
}

fn write_receipt(name: &str, receipt: &MigrationReceipt) -> Result<()> {
    let dir = everywear_paths::migration_dir();
    fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let path = dir.join(name);
    info!(path = %path.display(), "writing migration receipt");
    fs::write(&path, serde_json::to_vec_pretty(receipt)?)
        .with_context(|| format!("write receipt {}", path.display()))?;
    Ok(())
}

fn new_receipt(phase: &str, source: &Path, target: &Path, dry_run: bool) -> MigrationReceipt {
    MigrationReceipt {
        source: source.to_path_buf(),
        target: target.to_path_buf(),
        files_moved: 0,
        dry_run,
        timestamp: timestamp_string(),
        skipped: false,
        phase: phase.to_string(),
        warnings: Vec::new(),
        operations: Vec::new(),
    }
}

fn legacy_app_data_dir() -> Result<PathBuf> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .context("LOCALAPPDATA is not set; cannot locate legacy S3-Gener8 data")?;
    Ok(PathBuf::from(local_app_data).join(LEGACY_APP_DIR))
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
    Ok(hex_encode(&hasher.finalize()))
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_inner(root, &mut files)?;
    Ok(files)
}

fn collect_files_inner(root: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root).with_context(|| format!("read {}", root.display()))? {
        let entry = entry?;
        let path = entry.path();
        let ty = entry.file_type()?;
        if ty.is_dir() {
            collect_files_inner(&path, files)?;
        } else if ty.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn directory_hashes(root: &Path) -> Result<Vec<(PathBuf, String, u64)>> {
    let mut hashes = Vec::new();
    for file in collect_files(root)? {
        let rel = file
            .strip_prefix(root)
            .with_context(|| format!("strip prefix {}", file.display()))?
            .to_path_buf();
        let bytes = fs::metadata(&file)?.len();
        hashes.push((rel, sha256_file(&file)?, bytes));
    }
    hashes.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(hashes)
}

fn directory_size(root: &Path) -> Result<u64> {
    let mut total = 0;
    for file in collect_files(root)? {
        total += fs::metadata(file)?.len();
    }
    Ok(total)
}

fn timestamp_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_encode_lowercase() {
        assert_eq!(hex_encode(&[0xab, 0xcd, 0x01]), "abcd01");
    }
}
