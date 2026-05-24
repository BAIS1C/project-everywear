//! everywear-paths: single source of truth for all Everywear filesystem paths.
//!
//! Rule: no crate in the workspace may call `dirs::home_dir()` or `dirs::data_dir()`
//! directly. All path derivation goes through this crate.
//!
//! Canonical root: `~/.everywear/` on all platforms (Windows, Linux, macOS).

use std::path::PathBuf;

/// Root of all Everywear data. `~/.everywear/` on all platforms.
pub fn root() -> PathBuf {
    dirs::home_dir()
        .expect("no home directory found")
        .join(".everywear")
}

/// Shared model storage: `~/.everywear/models/`
pub fn models_dir() -> PathBuf {
    root().join("models")
}

/// Per-applet data: `~/.everywear/data/<applet_id>/`
pub fn data_dir(applet_id: &str) -> PathBuf {
    root().join("data").join(applet_id)
}

/// Job staging area: `~/.everywear/staging/`
/// Large file payloads for engine jobs are placed here, referenced by FileRef.
pub fn staging_dir() -> PathBuf {
    root().join("staging")
}

/// Engine/sidecar binaries: `~/.everywear/bin/`
pub fn bin_dir() -> PathBuf {
    root().join("bin")
}

/// Platform and applet configuration: `~/.everywear/config/`
pub fn config_dir() -> PathBuf {
    root().join("config")
}

/// Project MyMory vault root.
///
/// Defaults to `~/Project Mymory/` and can be overridden with `MYMORY_ROOT`
/// for other local installs or external LLM adapter processes.
pub fn mymory_root() -> PathBuf {
    std::env::var_os("MYMORY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .expect("no home directory found")
                .join("Project Mymory")
        })
}

/// Structured log output: `~/.everywear/logs/`
pub fn logs_dir() -> PathBuf {
    root().join("logs")
}

/// Migration receipts and rollback data: `~/.everywear/.migration/`
pub fn migration_dir() -> PathBuf {
    root().join(".migration")
}

/// Default vault location: `~/Documents/Everywear Vault/`.
pub fn vault_root() -> PathBuf {
    dirs::document_dir()
        .expect("No Documents directory found")
        .join("Everywear Vault")
}

/// Generated image storage: `~/Documents/Everywear Vault/Images/`.
pub fn vault_images() -> PathBuf {
    vault_root().join("Images")
}

/// Generated audio storage: `~/Documents/Everywear Vault/Audio/`.
pub fn vault_audio() -> PathBuf {
    vault_root().join("Audio")
}

/// Generated audio stem storage: `~/Documents/Everywear Vault/Audio/Stems/`.
pub fn vault_audio_stems() -> PathBuf {
    vault_audio().join("Stems")
}

/// Generated video storage: `~/Documents/Everywear Vault/Videos/`.
pub fn vault_video() -> PathBuf {
    vault_root().join("Videos")
}

/// Thumbnail cache: `~/Documents/Everywear Vault/.thumbnails/`.
pub fn vault_thumbnails() -> PathBuf {
    vault_root().join(".thumbnails")
}

/// Tantivy indexes: `~/Documents/Everywear Vault/.index/`.
pub fn vault_index_dir() -> PathBuf {
    vault_root().join(".index")
}

/// Ensure all required directories exist. Call once at shell startup.
pub fn ensure_dirs() -> std::io::Result<()> {
    let dirs = [
        root(),
        models_dir(),
        staging_dir(),
        bin_dir(),
        config_dir(),
        logs_dir(),
    ];
    for dir in &dirs {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Ensure the physical vault directory tree exists.
pub fn ensure_vault_dirs() -> std::io::Result<()> {
    let dirs = [
        vault_root(),
        vault_images(),
        vault_audio(),
        vault_audio_stems(),
        vault_video(),
        vault_thumbnails(),
        vault_index_dir(),
    ];
    for dir in &dirs {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Ensure per-applet data directory exists.
pub fn ensure_applet_dir(applet_id: &str) -> std::io::Result<PathBuf> {
    let dir = data_dir(applet_id);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_ends_with_everywear() {
        let r = root();
        assert!(r.ends_with(".everywear"));
    }

    #[test]
    fn models_dir_under_root() {
        let m = models_dir();
        assert!(m.starts_with(root()));
        assert!(m.ends_with("models"));
    }

    #[test]
    fn data_dir_includes_applet_id() {
        let d = data_dir("gener8");
        assert!(d.ends_with("gener8"));
        assert!(d.starts_with(root()));
    }

    #[test]
    fn staging_dir_under_root() {
        let s = staging_dir();
        assert!(s.starts_with(root()));
        assert!(s.ends_with("staging"));
    }

    #[test]
    fn mymory_root_has_expected_default_name() {
        let r = mymory_root();
        assert!(r.ends_with("Project Mymory"));
    }

    #[test]
    fn vault_root_under_documents() {
        let r = vault_root();
        assert!(r.ends_with("Everywear Vault"));
        assert!(dirs::document_dir().is_some_and(|documents| r.starts_with(documents)));
    }

    #[test]
    fn vault_subdirs_under_root() {
        assert!(vault_images().starts_with(vault_root()));
        assert!(vault_audio().starts_with(vault_root()));
        assert!(vault_audio_stems().starts_with(vault_audio()));
        assert!(vault_video().starts_with(vault_root()));
        assert!(vault_thumbnails().starts_with(vault_root()));
        assert!(vault_index_dir().starts_with(vault_root()));
    }
}
