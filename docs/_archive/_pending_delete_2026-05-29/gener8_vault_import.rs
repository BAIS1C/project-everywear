use anyhow::Result;

fn main() -> Result<()> {
    std::thread::Builder::new()
        .name("gener8-vault-import".to_string())
        .stack_size(64 * 1024 * 1024)
        .spawn(run_import)?
        .join()
        .map_err(|_| anyhow::anyhow!("Gener8 Vault import thread panicked"))?
}

fn run_import() -> Result<()> {
    everywear_paths::ensure_vault_dirs()?;
    let index_dir = everywear_paths::vault_index_dir();
    for name in ["audio", "video"] {
        let path = index_dir.join(name);
        if path.exists() {
            std::fs::remove_dir_all(&path)?;
        }
    }
    let index = ew_vault::VaultIndex::open_or_create(everywear_paths::vault_index_dir())?;
    let summary = everywear_os_lib::migration::run_vault_audio_import(false, Some(&index))?;

    println!("receipt={}", summary.receipt.id);
    if let Some(path) = summary.receipt_path {
        println!("receipt_path={}", path.display());
    }
    println!("operations={}", summary.receipt.operations.len());
    for warning in summary.receipt.warnings {
        println!("warning={warning}");
    }

    Ok(())
}
