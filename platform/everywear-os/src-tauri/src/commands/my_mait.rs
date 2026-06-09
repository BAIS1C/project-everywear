use crate::{gpu, mait_bridge::MaitStoreState, registry, state::AppState};
use base64::{engine::general_purpose, Engine as _};
use model_manager::{AppletManifest, ManifestModelRequirement, ModelRole, ResolutionStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const APPLET_ID: &str = "kasai";
const PREF_MODEL_GROUP_ID: &str = "my_mait.model.preferred_group_id";
const PREF_MODEL_KEYS: &str = "my_mait.model.preferred_model_keys";
const PREF_MODEL_SELECTION_MODE: &str = "my_mait.model.selection_mode";
const PREF_RESIDENCY_POLICY: &str = "my_mait.residency.policy";
const PREF_RESIDENCY_MAX_VRAM_MB: &str = "my_mait.residency.max_vram_mb";
const PREF_COMPANION_ACTIVE_MANIFEST_ID: &str = "my_mait.companion.active_manifest_id";
const PREF_COMPANION_PRESENCE_TIER: &str = "my_mait.companion.presence_tier";
const PREF_COMPANION_WIDGET_VISIBLE: &str = "my_mait.companion.widget_visible";
const PREF_VOICE_ENABLED: &str = "my_mait.voice.enabled";

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitSettingsState {
    pub model_groups: Vec<MyMaitModelGroup>,
    pub model_resolution: Vec<MyMaitModelResolution>,
    pub model_preference: MyMaitModelPreference,
    pub residency: MyMaitResidencyState,
    pub vram_status: MyMaitVramStatus,
    pub companion: MyMaitCompanionState,
    pub manifests: Vec<MaitManifestSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitModelGroup {
    pub id: String,
    pub label: String,
    pub min_vram_mb: u64,
    pub total_vram_mb: u64,
    pub fits_total_vram: bool,
    pub recommended: bool,
    pub models: Vec<MyMaitModelRequirement>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitModelRequirement {
    pub key: String,
    pub role: String,
    pub required: bool,
    pub vram_mb: u64,
    pub filename: Option<String>,
    pub hf_repo: Option<String>,
    pub hf_file: Option<String>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitModelResolution {
    pub everywear_model_id: String,
    pub status: String,
    pub source: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitModelPreference {
    pub selection_mode: String,
    pub preferred_group_id: Option<String>,
    pub preferred_model_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MyMaitResidencyPolicy {
    Auto,
    UnloadOnClose,
    KeepHot,
    AskOnClose,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitResidencyState {
    pub policy: MyMaitResidencyPolicy,
    pub max_vram_mb: Option<u64>,
    pub can_keep_hot: bool,
    pub guardrail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitVramStatus {
    pub total_mb: u64,
    pub free_mb: u64,
    pub used_mb: u64,
    pub nvml_free_mb: Option<u64>,
    pub nvml_used_mb: Option<u64>,
    pub budget_free_mb: u64,
    pub budget_allocated_mb: u64,
    pub active_applet: Option<String>,
    pub active_engine_applet: Option<String>,
    pub my_mait_resident: bool,
    pub allocations: Vec<MyMaitVramAllocation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitVramAllocation {
    pub applet_id: String,
    pub model_key: String,
    pub role: String,
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MyMaitCompanionState {
    pub active_manifest_id: Option<String>,
    pub presence_tier: String,
    pub widget_visible: bool,
    pub voice_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaitManifestSummary {
    pub id: String,
    pub display_name: String,
    pub shard_count: usize,
    pub source_schema: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CharacterStudioAvatarExportRequest {
    pub name: String,
    pub vrm_base64: String,
    pub manifest: serde_json::Value,
    pub target_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterStudioAvatarExportResponse {
    pub success: bool,
    pub method: String,
    pub export_dir: Option<String>,
    pub vrm_path: Option<String>,
    pub manifest_path: Option<String>,
    pub imported_manifest: Option<MaitManifestSummary>,
    pub settings: Option<MyMaitSettingsState>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelPreferenceInput {
    pub group_id: Option<String>,
    pub model_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResidencyPolicyInput {
    pub policy: MyMaitResidencyPolicy,
    pub max_vram_mb: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompanionStateInput {
    pub manifest_id: Option<String>,
    pub presence_tier: Option<String>,
    pub widget_visible: Option<bool>,
    pub voice_enabled: Option<bool>,
}

#[tauri::command]
pub async fn get_my_mait_settings(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
) -> Result<MyMaitSettingsState, String> {
    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn set_my_mait_model_preference(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
    input: ModelPreferenceInput,
) -> Result<MyMaitSettingsState, String> {
    let manifest = load_kasai_manifest()?;
    let valid_groups = manifest
        .model_groups
        .iter()
        .map(|group| group_id(&group.label))
        .collect::<HashSet<_>>();
    let valid_keys = manifest_model_keys(&manifest);

    if let Some(group_id) = input.group_id.as_deref() {
        if !valid_groups.contains(group_id) {
            return Err(format!("Unknown My Mait model group: {group_id}"));
        }
    }
    if let Some(keys) = input.model_keys.as_ref() {
        for key in keys {
            if !valid_keys.contains(key) {
                return Err(format!("Unknown My Mait model key: {key}"));
            }
        }
    }

    {
        let profile = state.profile.lock().await;
        if let Some(group_id) = input.group_id.as_deref() {
            profile
                .set_pref(PREF_MODEL_GROUP_ID, group_id)
                .map_err(|error| error.to_string())?;
        }
        if let Some(keys) = input.model_keys.as_ref() {
            let json = serde_json::to_string(keys).map_err(|error| error.to_string())?;
            profile
                .set_pref(PREF_MODEL_KEYS, &json)
                .map_err(|error| error.to_string())?;
        }
        profile
            .set_pref(PREF_MODEL_SELECTION_MODE, "manual")
            .map_err(|error| error.to_string())?;
    }

    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn clear_my_mait_model_preference(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
) -> Result<MyMaitSettingsState, String> {
    {
        let profile = state.profile.lock().await;
        profile
            .set_pref(PREF_MODEL_GROUP_ID, "")
            .map_err(|error| error.to_string())?;
        profile
            .set_pref(PREF_MODEL_KEYS, "[]")
            .map_err(|error| error.to_string())?;
        profile
            .set_pref(PREF_MODEL_SELECTION_MODE, "auto")
            .map_err(|error| error.to_string())?;
    }

    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn set_my_mait_residency_policy(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
    input: ResidencyPolicyInput,
) -> Result<MyMaitSettingsState, String> {
    if input.policy == MyMaitResidencyPolicy::KeepHot {
        let manifest = load_kasai_manifest()?;
        let groups = model_groups_from_manifest(&manifest, state.gpu.lock().await.total_vram_mb);
        let preference = read_model_preference(&state).await;
        let selected = selected_group(&groups, &preference);
        if let Some(group) = selected {
            let budget = state.budget.lock().await;
            if group.total_vram_mb > budget.total_mb {
                return Err(format!(
                    "Keep-hot needs {} MB VRAM, shell total is {} MB",
                    group.total_vram_mb, budget.total_mb
                ));
            }
        }
    }

    {
        let profile = state.profile.lock().await;
        profile
            .set_pref(
                PREF_RESIDENCY_POLICY,
                residency_policy_pref_value(&input.policy),
            )
            .map_err(|error| error.to_string())?;
        if let Some(max_vram_mb) = input.max_vram_mb {
            profile
                .set_pref(PREF_RESIDENCY_MAX_VRAM_MB, &max_vram_mb.to_string())
                .map_err(|error| error.to_string())?;
        }
    }

    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn get_my_mait_vram_status(
    state: State<'_, AppState>,
) -> Result<MyMaitVramStatus, String> {
    build_vram_status(&state).await
}

#[tauri::command]
pub async fn set_my_mait_companion_state(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
    input: CompanionStateInput,
) -> Result<MyMaitSettingsState, String> {
    validate_presence_tier(input.presence_tier.as_deref())?;

    {
        let profile = state.profile.lock().await;
        if let Some(manifest_id) = input.manifest_id.as_deref() {
            profile
                .set_pref(PREF_COMPANION_ACTIVE_MANIFEST_ID, manifest_id)
                .map_err(|error| error.to_string())?;
        }
        if let Some(presence_tier) = input.presence_tier.as_deref() {
            profile
                .set_pref(PREF_COMPANION_PRESENCE_TIER, presence_tier)
                .map_err(|error| error.to_string())?;
        }
        if let Some(widget_visible) = input.widget_visible {
            profile
                .set_pref(PREF_COMPANION_WIDGET_VISIBLE, bool_pref(widget_visible))
                .map_err(|error| error.to_string())?;
        }
        if let Some(voice_enabled) = input.voice_enabled {
            profile
                .set_pref(PREF_VOICE_ENABLED, bool_pref(voice_enabled))
                .map_err(|error| error.to_string())?;
        }
    }

    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn list_mait_manifests(
    mait_store: State<'_, MaitStoreState>,
) -> Result<Vec<MaitManifestSummary>, String> {
    list_manifest_summaries(&mait_store).await
}

#[tauri::command]
pub async fn import_character_studio_avatar(
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
    manifest_path: String,
) -> Result<MyMaitSettingsState, String> {
    let manifest = {
        let store = mait_store.lock().await;
        store
            .import_strands_avatar_file(&manifest_path)
            .map_err(|error| error.to_string())?
    };

    {
        let profile = state.profile.lock().await;
        profile
            .set_pref(PREF_COMPANION_ACTIVE_MANIFEST_ID, &manifest.id)
            .map_err(|error| error.to_string())?;
    }

    build_settings_state(&state, &mait_store).await
}

#[tauri::command]
pub async fn export_character_studio_avatar(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mait_store: State<'_, MaitStoreState>,
    request: CharacterStudioAvatarExportRequest,
) -> Result<CharacterStudioAvatarExportResponse, String> {
    let export_dir = match request.target_dir.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(target_dir) => PathBuf::from(target_dir),
        None => {
            let picked = app
                .dialog()
                .file()
                .set_title("Export Avatar to Kasai")
                .blocking_pick_folder();
            match picked {
                Some(path) => path
                    .into_path()
                    .map_err(|error| format!("Failed to read selected export folder: {error}"))?,
                None => {
                    return Ok(CharacterStudioAvatarExportResponse {
                        success: false,
                        method: "cancelled".into(),
                        export_dir: None,
                        vrm_path: None,
                        manifest_path: None,
                        imported_manifest: None,
                        settings: None,
                    });
                }
            }
        }
    };

    std::fs::create_dir_all(&export_dir)
        .map_err(|error| format!("Failed to create avatar export directory: {error}"))?;

    let safe_name = sanitize_avatar_export_name(&request.name);
    let vrm_path = export_dir.join(format!("{safe_name}.vrm"));
    let manifest_path = export_dir.join("strands-avatar.json");
    let vrm_bytes = general_purpose::STANDARD
        .decode(request.vrm_base64.as_bytes())
        .map_err(|error| format!("Failed to decode avatar VRM payload: {error}"))?;

    std::fs::write(&vrm_path, vrm_bytes)
        .map_err(|error| format!("Failed to write avatar VRM: {error}"))?;

    let mut manifest = request.manifest;
    enrich_character_studio_manifest(&mut manifest, &safe_name, &vrm_path);
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize avatar sidecar: {error}"))?;
    std::fs::write(&manifest_path, manifest_json)
        .map_err(|error| format!("Failed to write avatar sidecar: {error}"))?;

    let imported = {
        let store = mait_store.lock().await;
        store
            .import_strands_avatar_file(&manifest_path)
            .map_err(|error| error.to_string())?
    };

    {
        let profile = state.profile.lock().await;
        profile
            .set_pref(PREF_COMPANION_ACTIVE_MANIFEST_ID, &imported.id)
            .map_err(|error| error.to_string())?;
    }

    let settings = build_settings_state(&state, &mait_store).await?;
    let imported_manifest = settings
        .manifests
        .iter()
        .find(|manifest| manifest.id == imported.id)
        .cloned()
        .unwrap_or(MaitManifestSummary {
            id: imported.id,
            display_name: imported.display_name,
            shard_count: imported.aesthetic_shards.len(),
            source_schema: imported.source.map(|source| source.schema),
        });

    Ok(CharacterStudioAvatarExportResponse {
        success: true,
        method: "tauri-kasai-import".into(),
        export_dir: Some(export_dir.display().to_string()),
        vrm_path: Some(vrm_path.display().to_string()),
        manifest_path: Some(manifest_path.display().to_string()),
        imported_manifest: Some(imported_manifest),
        settings: Some(settings),
    })
}

async fn build_settings_state(
    state: &State<'_, AppState>,
    mait_store: &State<'_, MaitStoreState>,
) -> Result<MyMaitSettingsState, String> {
    let manifest = load_kasai_manifest()?;
    let total_vram_mb = state.gpu.lock().await.total_vram_mb;
    let model_groups = model_groups_from_manifest(&manifest, total_vram_mb);
    let model_resolution = model_resolution_for_manifest(state, &manifest).await?;
    let model_preference = read_model_preference(state).await;
    let residency = build_residency_state(state, &model_groups, &model_preference).await;
    let vram_status = build_vram_status(state).await?;
    let manifests = list_manifest_summaries(mait_store).await?;
    let companion = read_companion_state(state).await;

    Ok(MyMaitSettingsState {
        model_groups,
        model_resolution,
        model_preference,
        residency,
        vram_status,
        companion,
        manifests,
    })
}

fn load_kasai_manifest() -> Result<AppletManifest, String> {
    let manifest_path = monorepo_root()
        .join("applets")
        .join(APPLET_ID)
        .join("applet.toml");
    AppletManifest::load(&manifest_path)
        .map_err(|error| format!("Failed to load My Mait manifest: {error}"))
}

fn sanitize_avatar_export_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "kasai-avatar".into()
    } else {
        sanitized.into()
    }
}

fn enrich_character_studio_manifest(
    manifest: &mut serde_json::Value,
    safe_name: &str,
    vrm_path: &std::path::Path,
) {
    if let serde_json::Value::Object(map) = manifest {
        map.entry("schema")
            .or_insert_with(|| serde_json::Value::String("strands-avatar-v1".into()));
        map.entry("name")
            .or_insert_with(|| serde_json::Value::String(safe_name.into()));
        map.insert(
            "vrm_path".into(),
            serde_json::Value::String(vrm_path.display().to_string()),
        );
        map.insert(
            "model_path".into(),
            serde_json::Value::String(vrm_path.display().to_string()),
        );
        let assets = map
            .entry("assets")
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if let serde_json::Value::Object(assets) = assets {
            assets.insert(
                "vrm".into(),
                serde_json::Value::String(vrm_path.display().to_string()),
            );
        }
    }
}

fn monorepo_root() -> PathBuf {
    registry::find_monorepo_root_from_exe()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn model_groups_from_manifest(
    manifest: &AppletManifest,
    total_vram_mb: u64,
) -> Vec<MyMaitModelGroup> {
    let recommended = manifest
        .model_groups
        .iter()
        .find(|group| group.min_vram_mb <= total_vram_mb)
        .map(|group| group_id(&group.label));

    manifest
        .model_groups
        .iter()
        .map(|group| {
            let id = group_id(&group.label);
            let total_group_vram = group.models.iter().map(|model| model.vram_mb).sum();
            MyMaitModelGroup {
                id: id.clone(),
                label: group.label.clone(),
                min_vram_mb: group.min_vram_mb,
                total_vram_mb: total_group_vram,
                fits_total_vram: group.min_vram_mb <= total_vram_mb,
                recommended: recommended.as_deref() == Some(id.as_str()),
                models: group.models.iter().map(model_requirement).collect(),
            }
        })
        .collect()
}

fn model_requirement(model: &ManifestModelRequirement) -> MyMaitModelRequirement {
    MyMaitModelRequirement {
        key: model.key.clone(),
        role: role_label(&model.role).to_string(),
        required: model.required,
        vram_mb: model.vram_mb,
        filename: model.filename.clone(),
        hf_repo: model.hf_repo.clone(),
        hf_file: model.hf_file.clone(),
        size_bytes: model.size_bytes,
    }
}

async fn model_resolution_for_manifest(
    state: &State<'_, AppState>,
    manifest: &AppletManifest,
) -> Result<Vec<MyMaitModelResolution>, String> {
    let keys = manifest_model_keys(manifest);
    let resolver = state.model_resolver.lock().await;
    let results = resolver.resolve_all().map_err(|error| error.to_string())?;
    Ok(results
        .into_iter()
        .filter(|result| keys.contains(&result.everywear_model_id))
        .map(|result| MyMaitModelResolution {
            everywear_model_id: result.everywear_model_id,
            status: resolution_status_label(&result.status).to_string(),
            source: format!("{:?}", result.source),
            details: result.details,
        })
        .collect())
}

fn manifest_model_keys(manifest: &AppletManifest) -> HashSet<String> {
    manifest
        .model_groups
        .iter()
        .flat_map(|group| group.models.iter().map(|model| model.key.clone()))
        .collect()
}

async fn read_model_preference(state: &State<'_, AppState>) -> MyMaitModelPreference {
    let profile = state.profile.lock().await;
    let selection_mode = profile
        .get_pref(PREF_MODEL_SELECTION_MODE)
        .filter(|value| value == "manual")
        .unwrap_or_else(|| "auto".into());
    let preferred_group_id = profile
        .get_pref(PREF_MODEL_GROUP_ID)
        .filter(|value| !value.trim().is_empty());
    let preferred_model_keys = profile
        .get_pref(PREF_MODEL_KEYS)
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default();

    MyMaitModelPreference {
        selection_mode,
        preferred_group_id,
        preferred_model_keys,
    }
}

async fn build_residency_state(
    state: &State<'_, AppState>,
    groups: &[MyMaitModelGroup],
    preference: &MyMaitModelPreference,
) -> MyMaitResidencyState {
    let profile = state.profile.lock().await;
    let policy = profile
        .get_pref(PREF_RESIDENCY_POLICY)
        .as_deref()
        .map(parse_residency_policy)
        .unwrap_or(MyMaitResidencyPolicy::Auto);
    let max_vram_mb = profile
        .get_pref(PREF_RESIDENCY_MAX_VRAM_MB)
        .and_then(|value| value.parse::<u64>().ok());
    drop(profile);

    let selected_total = selected_group(groups, preference).map(|group| group.total_vram_mb);
    let budget = state.budget.lock().await;
    let can_keep_hot = selected_total.is_some_and(|need| need <= budget.total_mb);
    let guardrail = if can_keep_hot {
        None
    } else {
        selected_total.map(|need| {
            format!(
                "Selected group wants {need} MB; shell total is {} MB",
                budget.total_mb
            )
        })
    };

    MyMaitResidencyState {
        policy,
        max_vram_mb,
        can_keep_hot,
        guardrail,
    }
}

async fn build_vram_status(state: &State<'_, AppState>) -> Result<MyMaitVramStatus, String> {
    let gpu = state.gpu.lock().await;
    let total_mb = gpu.total_vram_mb;
    let free_mb = gpu.total_free_mb;
    let (nvml_used_mb, nvml_free_mb) = gpu::poll_vram(0)
        .map(|(used, free)| (Some(used), Some(free)))
        .unwrap_or((None, None));
    drop(gpu);

    let budget = state.budget.lock().await;
    let allocations = budget
        .allocations
        .iter()
        .map(|allocation| MyMaitVramAllocation {
            applet_id: allocation.applet_id.clone(),
            model_key: allocation.model_key.clone(),
            role: role_label(&allocation.role).to_string(),
            vram_mb: allocation.vram_mb,
        })
        .collect::<Vec<_>>();
    let budget_free_mb = budget.free_mb();
    let budget_allocated_mb = budget.allocated_mb();
    drop(budget);

    let active_applet = state.active_applet.lock().await.clone();
    let active_engine_applet = state
        .vram_scheduler
        .lock()
        .await
        .active_engine()
        .map(|engine| engine.applet_id.clone());
    let my_mait_resident = active_applet.as_deref() == Some(APPLET_ID)
        || active_engine_applet.as_deref() == Some(APPLET_ID)
        || allocations
            .iter()
            .any(|allocation| allocation.applet_id == APPLET_ID);

    Ok(MyMaitVramStatus {
        total_mb,
        free_mb,
        used_mb: total_mb.saturating_sub(free_mb),
        nvml_free_mb,
        nvml_used_mb,
        budget_free_mb,
        budget_allocated_mb,
        active_applet,
        active_engine_applet,
        my_mait_resident,
        allocations,
    })
}

async fn read_companion_state(state: &State<'_, AppState>) -> MyMaitCompanionState {
    let profile = state.profile.lock().await;
    MyMaitCompanionState {
        active_manifest_id: profile
            .get_pref(PREF_COMPANION_ACTIVE_MANIFEST_ID)
            .filter(|value| !value.trim().is_empty()),
        presence_tier: profile
            .get_pref(PREF_COMPANION_PRESENCE_TIER)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "portrait".into()),
        widget_visible: parse_bool_pref(
            profile.get_pref(PREF_COMPANION_WIDGET_VISIBLE).as_deref(),
            false,
        ),
        voice_enabled: parse_bool_pref(profile.get_pref(PREF_VOICE_ENABLED).as_deref(), false),
    }
}

async fn list_manifest_summaries(
    mait_store: &State<'_, MaitStoreState>,
) -> Result<Vec<MaitManifestSummary>, String> {
    let store = mait_store.lock().await;
    let manifests = store.list().map_err(|error| error.to_string())?;
    Ok(manifests
        .into_iter()
        .map(|manifest| MaitManifestSummary {
            id: manifest.id,
            display_name: manifest.display_name,
            shard_count: manifest.aesthetic_shards.len(),
            source_schema: manifest.source.map(|source| source.schema),
        })
        .collect())
}

fn selected_group<'a>(
    groups: &'a [MyMaitModelGroup],
    preference: &MyMaitModelPreference,
) -> Option<&'a MyMaitModelGroup> {
    if preference.selection_mode == "manual" {
        if let Some(group_id) = preference.preferred_group_id.as_deref() {
            if let Some(group) = groups.iter().find(|group| group.id == group_id) {
                return Some(group);
            }
        }
    }
    groups
        .iter()
        .find(|group| group.recommended)
        .or_else(|| groups.first())
}

fn group_id(label: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

fn role_label(role: &ModelRole) -> &'static str {
    match role {
        ModelRole::Primary => "Primary",
        ModelRole::Encoder => "Encoder",
        ModelRole::Vae => "VAE",
        ModelRole::Lora => "LoRA",
        ModelRole::Projection => "Projection",
        ModelRole::VideoVae => "Video VAE",
        ModelRole::AudioVae => "Audio VAE",
        ModelRole::TextEncoder => "Text Encoder",
    }
}

fn resolution_status_label(status: &ResolutionStatus) -> &'static str {
    match status {
        ResolutionStatus::Available => "available",
        ResolutionStatus::FoundLocally { .. } => "found_locally",
        ResolutionStatus::NeedsDownload { .. } => "needs_download",
        ResolutionStatus::Incompatible { .. } => "incompatible",
    }
}

fn parse_residency_policy(value: &str) -> MyMaitResidencyPolicy {
    match value {
        "unload_on_close" => MyMaitResidencyPolicy::UnloadOnClose,
        "keep_hot" => MyMaitResidencyPolicy::KeepHot,
        "ask_on_close" => MyMaitResidencyPolicy::AskOnClose,
        _ => MyMaitResidencyPolicy::Auto,
    }
}

fn residency_policy_pref_value(policy: &MyMaitResidencyPolicy) -> &'static str {
    match policy {
        MyMaitResidencyPolicy::Auto => "auto",
        MyMaitResidencyPolicy::UnloadOnClose => "unload_on_close",
        MyMaitResidencyPolicy::KeepHot => "keep_hot",
        MyMaitResidencyPolicy::AskOnClose => "ask_on_close",
    }
}

fn validate_presence_tier(value: Option<&str>) -> Result<(), String> {
    match value {
        None | Some("hidden" | "portrait" | "desktop_widget") => Ok(()),
        Some(other) => Err(format!("Unknown My Mait presence tier: {other}")),
    }
}

fn bool_pref(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn parse_bool_pref(value: Option<&str>, default: bool) -> bool {
    match value {
        Some("true") | Some("1") | Some("yes") => true,
        Some("false") | Some("0") | Some("no") => false,
        _ => default,
    }
}
