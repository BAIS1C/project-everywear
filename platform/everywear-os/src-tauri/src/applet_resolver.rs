//! Applet binary resolution: how the shell finds applet executables across
//! development and production environments.
//!
//! Three-tier resolution:
//! 1. **Production**: installer manifest (env: EVERYWEAR_APPLET_MANIFEST)
//! 2. **Development**: per-applet env override (env: EVERYWEAR_<ID>_PATH)
//! 3. **Fallback**: relative to shell binary (dev cargo build layout)
//!
//! See MIGRATION_ARCHITECTURE.md Phase 0.7 for design rationale.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;

/// Resolve the binary path for an applet.
///
/// The applet_id should match the manifest `applet.id` (e.g., "gener8", "1magen").
pub fn resolve_applet_binary(applet_id: &str) -> Result<PathBuf> {
    resolve_applet_binary_named(applet_id, applet_id)
}

/// Resolve the binary path for an applet when the executable name differs
/// from the applet id, for example `1magen` -> `onemagen`.
pub fn resolve_applet_binary_named(applet_id: &str, binary_name: &str) -> Result<PathBuf> {
    // Tier 1: Production installer manifest
    if let Some(path) = resolve_from_installer_manifest(applet_id)? {
        tracing::info!(
            applet_id,
            path = %path.display(),
            "Resolved applet via installer manifest"
        );
        return Ok(path);
    }

    // Tier 2: Explicit env override per applet
    if let Some(path) = resolve_from_env_override(applet_id)? {
        tracing::info!(
            applet_id,
            path = %path.display(),
            "Resolved applet via env override"
        );
        return Ok(path);
    }

    // Tier 3: Relative to shell binary (dev mode)
    if let Some(path) = resolve_from_dev_layout(applet_id, binary_name)? {
        tracing::info!(
            applet_id,
            path = %path.display(),
            "Resolved applet via dev layout"
        );
        return Ok(path);
    }

    Err(anyhow!(
        "Cannot resolve binary for applet '{}'. Checked: installer manifest, \
         EVERYWEAR_{}_PATH env, dev layout relative to shell binary.",
        applet_id,
        applet_id.to_uppercase()
    ))
}

/// Tier 1: Look up applet path from an installer manifest JSON file.
///
/// The manifest is a simple JSON object: `{ "applet_id": "/path/to/binary", ... }`
/// Location specified by `EVERYWEAR_APPLET_MANIFEST` env var.
fn resolve_from_installer_manifest(applet_id: &str) -> Result<Option<PathBuf>> {
    let manifest_path = match std::env::var("EVERYWEAR_APPLET_MANIFEST") {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };

    let content = std::fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read installer manifest at {manifest_path}"))?;

    let manifest: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| "failed to parse installer manifest as JSON")?;

    if let Some(path_val) = manifest.get(applet_id) {
        if let Some(path_str) = path_val.as_str() {
            let path = PathBuf::from(path_str);
            if path.exists() {
                return Ok(Some(path));
            }
            tracing::warn!(
                applet_id,
                path = %path.display(),
                "Installer manifest entry exists but binary not found on disk"
            );
        }
    }

    Ok(None)
}

/// Tier 2: Check for `EVERYWEAR_<APPLET_ID>_PATH` environment variable.
///
/// Useful during development to point the shell at a cargo build output
/// without needing the full installer manifest.
fn resolve_from_env_override(applet_id: &str) -> Result<Option<PathBuf>> {
    let env_key = format!("EVERYWEAR_{}_PATH", applet_id.to_uppercase());

    match std::env::var(&env_key) {
        Ok(override_path) => {
            let path = PathBuf::from(&override_path);
            if path.exists() {
                Ok(Some(path))
            } else {
                tracing::warn!(
                    env_key,
                    path = %path.display(),
                    "Env override set but binary not found on disk"
                );
                Ok(None)
            }
        }
        Err(_) => Ok(None),
    }
}

/// Tier 3: Look relative to the shell binary's directory.
///
/// In a cargo workspace dev build, binaries land in `target/debug/` or
/// `target/release/`. Applet binaries are siblings of the shell binary.
///
/// Resolution order:
/// 1. `<shell_dir>/<applet_id>` (or `.exe` on Windows)
/// 2. `<shell_dir>/applets/<applet_id>` (bundled layout)
fn resolve_from_dev_layout(_applet_id: &str, binary_name: &str) -> Result<Option<PathBuf>> {
    let shell_exe = std::env::current_exe().context("failed to determine shell executable path")?;
    let shell_dir = shell_exe
        .parent()
        .ok_or_else(|| anyhow!("shell binary has no parent directory"))?;

    let binary_name = if cfg!(target_os = "windows") && !binary_name.ends_with(".exe") {
        format!("{binary_name}.exe")
    } else {
        binary_name.to_string()
    };

    // Check sibling (cargo workspace target dir)
    let sibling = shell_dir.join(&binary_name);
    if sibling.exists() {
        return Ok(Some(sibling));
    }

    // Check bundled layout
    let bundled = shell_dir.join("applets").join(&binary_name);
    if bundled.exists() {
        return Ok(Some(bundled));
    }

    Ok(None)
}

/// Resolve the manifest path for an applet.
///
/// Looks for `applet.toml` in standard locations:
/// 1. `<workspace_root>/applets/<applet_id>/applet.toml` (dev)
/// 2. `<shell_dir>/manifests/<applet_id>.toml` (production)
/// 3. `EVERYWEAR_<ID>_MANIFEST` env override
pub fn resolve_applet_manifest(applet_id: &str) -> Result<PathBuf> {
    // Env override
    let env_key = format!("EVERYWEAR_{}_MANIFEST", applet_id.to_uppercase());
    if let Ok(path) = std::env::var(&env_key) {
        let p = PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Dev layout: applets/<id>/applet.toml relative to CWD
    let dev_path = PathBuf::from(format!("applets/{applet_id}/applet.toml"));
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // Production layout: next to shell binary
    if let Ok(shell_exe) = std::env::current_exe() {
        if let Some(shell_dir) = shell_exe.parent() {
            let prod_path = shell_dir
                .join("manifests")
                .join(format!("{applet_id}.toml"));
            if prod_path.exists() {
                return Ok(prod_path);
            }
        }
    }

    Err(anyhow!(
        "Cannot find applet.toml for '{}'. Checked: env override, \
         applets/{}/applet.toml, production manifests dir.",
        applet_id,
        applet_id
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_missing_returns_none() {
        // Ensure no env var is set for a fake applet
        std::env::remove_var("EVERYWEAR_FAKE_TEST_APPLET_PATH");
        let result = resolve_from_env_override("fake_test_applet").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn installer_manifest_not_set_returns_none() {
        std::env::remove_var("EVERYWEAR_APPLET_MANIFEST");
        let result = resolve_from_installer_manifest("gener8").unwrap();
        assert!(result.is_none());
    }
}
