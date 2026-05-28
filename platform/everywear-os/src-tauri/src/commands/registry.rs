use crate::{registry, state::AppState};
use tauri::Manager;

// ─── Registry Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_applets(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<registry::AppletEntry>, String> {
    let reg = state.registry.lock().await;
    let tier = *state.licence_tier.lock().await;
    Ok(reg.launchable_for_tier(tier))
}

#[tauri::command]
pub async fn get_applet(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Option<registry::AppletEntry>, String> {
    let reg = state.registry.lock().await;
    let tier = *state.licence_tier.lock().await;
    Ok(reg.get(&id).cloned().map(|entry| {
        if registry::applet_entitlement_error(&entry, tier).is_some()
            && entry.status == registry::AppletStatus::Active
        {
            registry::AppletEntry {
                status: registry::AppletStatus::Locked,
                ..entry
            }
        } else {
            entry
        }
    }))
}

// CLAUDE_INTERFACE: Focus an applet's external window
// Command: "focus_applet_window"
// Args: { label: string }
// Returns: boolean (true if window found and focused, false if not running)
// Known shell-owned labels: "main", "studio". Standalone applets such as 1magen use "main" inside their own Tauri process, so the shell can only focus them when they are represented by a shell-owned window label.
// Usage: Shell sidebar clicks for 1magen/Gener8 call this instead of rendering inline
#[tauri::command]
pub async fn focus_applet_window(label: String, app: tauri::AppHandle) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(true)
}

// CLAUDE_INTERFACE: Check if applet window is open
// Command: "is_applet_window_open"
// Args: { label: string }
// Returns: boolean
// Usage: Shell sidebar can show green dot for running applets
#[tauri::command]
pub async fn is_applet_window_open(label: String, app: tauri::AppHandle) -> Result<bool, String> {
    Ok(app.get_webview_window(&label).is_some())
}
