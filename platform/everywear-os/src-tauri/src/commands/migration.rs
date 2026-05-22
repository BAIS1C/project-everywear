use crate::migration;

#[tauri::command]
pub async fn get_phase5_migration_plan() -> Result<migration::MigrationPlan, String> {
    migration::plan().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_phase5_migration(
    dry_run: Option<bool>,
) -> Result<migration::MigrationSummary, String> {
    migration::run(dry_run.unwrap_or(true)).map_err(|e| e.to_string())
}
