use crate::{migration, vault_commands::VaultState};
use tauri::State;

#[tauri::command]
pub async fn get_phase5_migration_plan() -> Result<migration::MigrationPlan, String> {
    migration::plan().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_phase5_migration(
    dry_run: Option<bool>,
    vault: State<'_, VaultState>,
) -> Result<migration::MigrationSummary, String> {
    let dry_run = dry_run.unwrap_or(true);
    let vault = vault.lock().await;
    migration::run(dry_run, Some(&vault)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_gener8_vault_audio_import(
    dry_run: Option<bool>,
    vault: State<'_, VaultState>,
) -> Result<migration::MigrationSummary, String> {
    let dry_run = dry_run.unwrap_or(true);
    let vault = vault.lock().await;
    migration::run_vault_audio_import(dry_run, Some(&vault)).map_err(|e| e.to_string())
}
