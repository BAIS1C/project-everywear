use crate::{budget, state::AppState};

#[tauri::command]
pub async fn platform_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let gpu_state = state.gpu.lock().await;
    let profile_mgr = state.profile.lock().await;
    let wallet = state.wallet.lock().await;
    let registry = state.registry.lock().await;
    #[cfg(feature = "discourse-native")]
    let discourse = state.discourse.lock().await;
    #[cfg(feature = "discourse-native")]
    let discourse_connected = discourse.is_connected();
    #[cfg(not(feature = "discourse-native"))]
    let discourse_connected = false;
    let budget_state = state.budget.lock().await;
    let active = state.active_applet.lock().await;
    let tier = state.licence_tier.lock().await;
    let session = state.user_session.lock().await;

    let profile = profile_mgr.get_profile().map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "gpu": {
            "available": gpu_state.nvml_available,
            "primary": gpu_state.primary_gpu,
            "total_vram_mb": gpu_state.total_vram_mb,
            "free_vram_mb": gpu_state.total_free_mb,
            "backend": gpu_state.backend.label(),
            "vram_tier": gpu_state.vram_tier.label(),
        },
        "auth": {
            "authenticated": session.is_some(),
            "user_id": session.as_ref().map(|c| &c.sub),
            "handle": session.as_ref().and_then(|c| c.handle.as_deref()),
            "email": session.as_ref().and_then(|c| c.email.as_deref()),
            "tier": tier.as_str(),
            "is_paid": tier.is_paid(),
            "is_pro": tier.is_pro(),
        },
        "profile": {
            "display_name": profile.display_name,
            "alias": profile.alias,
        },
        "wallet": {
            "connected": wallet.is_connected(),
            "address": wallet.address(),
        },
        "discourse": {
            "connected": discourse_connected,
        },
        "applets": {
            "active": registry.launchable().len(),
            "current": *active,
        },
        "engines": {
            "registered": state.engine_registry.lock().await.len(),
            "router_mode": "active_engine_only_v1",
        },
        "vram_budget": {
            "total_mb": budget_state.total_mb,
            "free_mb": budget_state.free_mb(),
            "allocated_mb": budget_state.allocated_mb(),
            "allocations": budget_state.allocations.len(),
            "policy": budget::PurgePolicy::from_tier(gpu_state.vram_tier).label(),
        },
    }))
}
