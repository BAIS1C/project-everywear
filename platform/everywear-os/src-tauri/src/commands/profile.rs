use crate::{profile, state::AppState};

#[tauri::command]
pub async fn get_profile(
    state: tauri::State<'_, AppState>,
) -> Result<profile::UserProfile, String> {
    let mgr = state.profile.lock().await;
    mgr.get_profile().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_profile(
    state: tauri::State<'_, AppState>,
    update: profile::ProfileUpdate,
) -> Result<profile::UserProfile, String> {
    let mgr = state.profile.lock().await;
    mgr.update_profile(update).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_preference(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let mgr = state.profile.lock().await;
    mgr.set_pref(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_preference(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let mgr = state.profile.lock().await;
    Ok(mgr.get_pref(&key))
}
