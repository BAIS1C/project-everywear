use crate::{budget, state::AppState};

#[tauri::command]
pub async fn platform_status(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (
        gpu_available,
        gpu_primary,
        gpu_total_vram_mb,
        gpu_free_vram_mb,
        gpu_backend,
        gpu_vram_tier,
        vram_policy,
    ) = {
        let gpu_state = state.gpu.lock().await;
        (
            gpu_state.nvml_available,
            gpu_state.primary_gpu.clone(),
            gpu_state.total_vram_mb,
            gpu_state.total_free_mb,
            gpu_state.backend.label(),
            gpu_state.vram_tier.label(),
            budget::PurgePolicy::from_tier(gpu_state.vram_tier).label(),
        )
    };

    let profile = {
        let profile_mgr = state.profile.lock().await;
        profile_mgr.get_profile().map_err(|e| e.to_string())?
    };

    let (wallet_connected, wallet_address) = {
        let wallet = state.wallet.lock().await;
        (wallet.is_connected(), wallet.address().map(str::to_string))
    };

    let launchable_applets = {
        let registry = state.registry.lock().await;
        registry.launchable().len()
    };

    #[cfg(feature = "discourse-native")]
    let discourse_connected = {
        let discourse = state.discourse.lock().await;
        discourse.is_connected()
    };

    #[cfg(not(feature = "discourse-native"))]
    let discourse_connected = false;

    let (budget_total_mb, budget_free_mb, budget_allocated_mb, budget_allocations) = {
        let budget_state = state.budget.lock().await;
        (
            budget_state.total_mb,
            budget_state.free_mb(),
            budget_state.allocated_mb(),
            budget_state.allocations.len(),
        )
    };

    let active = state.active_applet.lock().await.clone();
    let tier = *state.licence_tier.lock().await;
    let session = state.user_session.lock().await.clone();
    let registered_engines = state.engine_registry.lock().await.len();

    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "gpu": {
            "available": gpu_available,
            "primary": gpu_primary,
            "total_vram_mb": gpu_total_vram_mb,
            "free_vram_mb": gpu_free_vram_mb,
            "backend": gpu_backend,
            "vram_tier": gpu_vram_tier,
        },
        "auth": {
            "authenticated": session.is_some(),
            "user_id": session.as_ref().map(|c| c.sub.as_str()),
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
            "connected": wallet_connected,
            "address": wallet_address,
        },
        "discourse": {
            "connected": discourse_connected,
        },
        "applets": {
            "active": launchable_applets,
            "current": active,
        },
        "engines": {
            "registered": registered_engines,
            "router_mode": "active_engine_only_v1",
        },
        "vram_budget": {
            "total_mb": budget_total_mb,
            "free_mb": budget_free_mb,
            "allocated_mb": budget_allocated_mb,
            "allocations": budget_allocations,
            "policy": vram_policy,
        },
    }))
}
