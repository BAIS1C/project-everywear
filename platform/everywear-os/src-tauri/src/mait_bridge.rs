use mait::{AestheticShard, MaitStore};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub type MaitStoreState = Arc<Mutex<MaitStore>>;

#[derive(Debug, Serialize)]
pub struct LoadAvatarResult {
    pub manifest_id: String,
    pub display_name: String,
    pub shard_count: usize,
    pub traits: Vec<String>,
}

// CLAUDE_INTERFACE: Load CharacterStudio avatar manifest into Kasai MAIT store
// Command: "kasai_load_avatar_manifest"
// Args: { manifest_path: string }
// Returns: LoadAvatarResult { manifest_id, display_name, shard_count, traits }
#[tauri::command]
pub async fn kasai_load_avatar_manifest(
    manifest_path: String,
    mait_store: State<'_, MaitStoreState>,
) -> Result<LoadAvatarResult, String> {
    let store = mait_store.lock().await;
    let manifest = store
        .import_strands_avatar_file(&manifest_path)
        .map_err(|e| e.to_string())?;
    Ok(LoadAvatarResult {
        manifest_id: manifest.id,
        display_name: manifest.display_name,
        shard_count: manifest.aesthetic_shards.len(),
        traits: manifest
            .aesthetic_shards
            .iter()
            .map(shard_label)
            .collect::<Vec<_>>(),
    })
}

fn shard_label(shard: &AestheticShard) -> String {
    match shard {
        AestheticShard::StrandsAvatar { name, .. } => format!("avatar:{name}"),
        AestheticShard::Palette { name, .. } => format!("palette:{name}"),
        AestheticShard::StylePrompt { .. } => "style_prompt".into(),
        AestheticShard::AssetRef { role, .. } => format!("asset:{role}"),
        AestheticShard::Custom { label, .. } => format!("custom:{label}"),
    }
}
