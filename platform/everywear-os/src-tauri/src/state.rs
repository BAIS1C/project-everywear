use crate::{
    auth, budget, daw_bridge, engine_registry, gener8_engine, gpu, launcher, profile, registry,
    video_encoder, vram_scheduler, wallet,
};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

/// Shared application state injected into all IPC commands.
pub struct AppState {
    pub gpu: Arc<Mutex<gpu::SystemGpuState>>,
    pub profile: Arc<Mutex<profile::ProfileManager>>,
    pub wallet: Arc<Mutex<wallet::WalletManager>>,
    pub registry: Arc<Mutex<registry::AppletRegistry>>,
    #[cfg(feature = "discourse-native")]
    pub discourse: Arc<Mutex<crate::discourse::DiscourseClient>>,
    pub budget: Arc<Mutex<budget::VramBudget>>,
    pub model_mgr: Arc<Mutex<model_manager::ModelManager>>,
    pub model_resolver: Arc<Mutex<model_manager::ModelResolver>>,
    pub active_applet: Arc<Mutex<Option<String>>>,
    pub applet_processes: Arc<Mutex<HashMap<String, launcher::AppletProcess>>>,
    pub engine_registry: Arc<Mutex<engine_registry::EngineRegistry>>,
    pub vram_scheduler: Arc<Mutex<vram_scheduler::VramScheduler>>,
    pub kasai_tool_calls: Arc<Mutex<Vec<serde_json::Value>>>,
    pub licence_tier: Arc<Mutex<model_manager::LicenceTier>>,
    pub entitlement_flags: Arc<Mutex<HashMap<String, bool>>>,
    pub user_session: Arc<Mutex<Option<auth::UserClaim>>>,
    pub video_encoder: Arc<Mutex<video_encoder::VideoEncoderService>>,
    pub gener8_engine: gener8_engine::Gener8Engine,
    pub daw_bridge: Arc<Mutex<daw_bridge::DawBridgeState>>,
    pub vault: crate::vault_commands::VaultState,
}
