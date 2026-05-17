//! SHA256 verification for downloaded model files.
//!
//! Every model download is verified against the expected hash from the
//! manifest before being trusted. Hash mismatches trigger file deletion
//! and retry.

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::path::Path;
use tracing::{info, warn};

/// Compute SHA256 hash of a file. Returns lowercase hex string.
pub fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("failed to read {} for hashing", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

/// Verify a file against an expected SHA256 hash.
///
/// Returns Ok(true) if hash matches, Ok(false) if no expected hash
/// was provided (skip verification), or Err if hash mismatches.
pub fn verify_model(path: &Path, expected: &Option<String>) -> Result<bool> {
    let expected = match expected {
        Some(h) => h,
        None => {
            warn!(path = %path.display(), "No SHA256 hash provided, skipping verification");
            return Ok(false);
        }
    };

    info!(path = %path.display(), "Verifying SHA256...");
    let actual = sha256_file(path)?;

    if &actual == expected {
        info!(path = %path.display(), "SHA256 verified OK");
        Ok(true)
    } else {
        anyhow::bail!(
            "SHA256 mismatch for {}: expected {expected}, got {actual}",
            path.display()
        )
    }
}
