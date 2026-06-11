//! Applet registry: tracks installed, available, and locked applets.
//!
//! The registry reads applet.toml manifests from the applets/ directory
//! and maintains state about which are installed, licensed, and launchable.
//!
//! Design principle: NO greyed-out icons until the applet is actually built.
//! Once built, unlicensed applets show as locked (greyed). Licensed ones
//! show as active and launchable.
//!
//! Applet launch kind is explicit because status and launch fields answer
//! different questions. `status` is availability/licence state; `launch_kind`
//! is the shell route: local binary, inline frontend, external URL, or a
//! placeholder reserved for future work.

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppletEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub status: AppletStatus,
    pub launch_kind: AppletLaunchKind,
    pub engine_type: String,
    pub min_vram_mb: u64,
    pub tags: Vec<String>,
    pub launch_url: Option<String>,
    pub launch_binary: Option<String>,
    /// Minimum compatibility tier required before shell launch. The neutral
    /// entitlement flags remain the durable authority, while this keeps the
    /// existing tier bridge from bypassing bundle-included applets.
    #[serde(default)]
    pub required_tier: Option<String>,
    #[serde(default)]
    pub required_entitlements: Vec<String>,
    /// Port for the applet's web frontend. Shell spawns a WebviewWindow at
    /// http://127.0.0.1:{frontend_port} after the headless backend starts.
    pub frontend_port: Option<u16>,
    /// Optional route suffix appended to the frontend URL.
    /// e.g. "/vid" navigates to http://127.0.0.1:{frontend_port}/vid
    /// Used by sub-applets that share a backend (Vid shares Gener8).
    #[serde(default)]
    pub frontend_route: Option<String>,
    /// If set, this applet shares another applet's backend process.
    /// The shell will launch the parent's binary instead of its own.
    #[serde(default)]
    pub shares_backend: Option<String>,
    #[serde(default, rename = "lockedModel")]
    pub locked_model: Option<String>,
    #[serde(default, rename = "allowedAudioModes")]
    pub allowed_audio_modes: Vec<String>,
    #[serde(default, rename = "stepCeiling")]
    pub step_ceiling: Option<u32>,
    #[serde(default, rename = "vaultScope")]
    pub vault_scope: Option<String>,
    #[serde(default, rename = "vidTarget")]
    pub vid_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AppletStatus {
    /// Applet is built, licensed, and ready to launch.
    Active,
    /// Applet is built but requires purchase/subscription.
    Locked,
    /// Applet is not yet built (should NOT appear in the launcher).
    NotBuilt,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum AppletLaunchKind {
    /// Shell runs a local applet backend and then hands off via IPC/WebView.
    BinaryLocal,
    /// Shell opens an already-registered frontend inside the desktop.
    FrontendInline,
    /// Shell opens a remote URL outside the local applet runtime.
    ExternalUrl,
    /// Reserved applet slot; should stay NotBuilt until real content exists.
    Placeholder,
}

pub struct AppletRegistry {
    applets: Vec<AppletEntry>,
}

impl AppletRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            applets: Self::builtin_applets(),
        };
        registry.refresh_status();
        registry
    }

    /// Built-in applet definitions. Status is determined at runtime
    /// based on what's actually installed and licensed.
    fn builtin_applets() -> Vec<AppletEntry> {
        vec![
            AppletEntry {
                id: "1magen".into(),
                name: "1magen".into(),
                description: "Local AI image generation and editing".into(),
                version: "0.1.0".into(),
                icon: "1magen".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::BinaryLocal,
                engine_type: "diffusion".into(),
                min_vram_mb: 7400,
                tags: vec!["image".into(), "generation".into(), "editing".into()],
                launch_url: None,
                launch_binary: Some("onemagen".into()),
                required_tier: Some("gener8".into()),
                required_entitlements: vec!["1magen".into(), "1magen.image".into()],
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "gener8-4ever".into(),
                name: "Gener8 4ever".into(),
                description: "Local AI text-to-song generation".into(),
                version: "0.1.0".into(),
                icon: "gener8-4ever".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "audio".into(),
                min_vram_mb: 6144,
                tags: vec![
                    "music".into(),
                    "audio".into(),
                    "song".into(),
                    "4ever".into(),
                ],
                launch_url: None,
                launch_binary: None,
                required_tier: Some("gener8".into()),
                required_entitlements: vec!["gener8".into(), "gener8.audio".into()],
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: Some("song".into()),
                allowed_audio_modes: vec!["song".into()],
                step_ceiling: Some(12),
                vault_scope: Some("full".into()),
                vid_target: Some("vid".into()),
            },
            AppletEntry {
                id: "gener8-pro".into(),
                name: "Gener8 Pro".into(),
                description: "Local AI reference and cover audio generation".into(),
                version: "0.1.0".into(),
                icon: "gener8-pro".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "audio".into(),
                min_vram_mb: 6144,
                tags: vec![
                    "music".into(),
                    "audio".into(),
                    "reference".into(),
                    "cover".into(),
                ],
                launch_url: None,
                launch_binary: None,
                required_tier: Some("gener8_pro".into()),
                required_entitlements: vec!["gener8_pro".into()],
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: Some("pro".into()),
                allowed_audio_modes: vec!["reference".into(), "cover".into()],
                step_ceiling: Some(75),
                vault_scope: Some("full".into()),
                vid_target: Some("vid".into()),
            },
            // Vid Studio is a Gener8 studio surface mounted inline by
            // AppletViewRouter. It uses shell IPC for video sidecars.
            AppletEntry {
                id: "vid".into(),
                name: "Vid Studio".into(),
                description: "Audio-reactive visualiser and music video creation".into(),
                version: "0.1.0".into(),
                icon: "vid".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "none".into(),
                min_vram_mb: 0, // NVENC uses dedicated encoder chip, not CUDA cores
                tags: vec!["video".into(), "visualiser".into(), "music".into()],
                launch_url: None,
                launch_binary: None,
                required_tier: Some("gener8".into()),
                required_entitlements: vec!["vid".into()],
                frontend_port: None,
                frontend_route: None,
                shares_backend: Some("gener8-4ever".into()),
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "ai-director".into(),
                name: "AI Director".into(),
                description: "Creator Studio shot planning and music-video direction".into(),
                version: "0.1.0".into(),
                icon: "ai-director".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "video".into(),
                min_vram_mb: 0,
                tags: vec!["video".into(), "director".into(), "creator-studio".into()],
                launch_url: None,
                launch_binary: None,
                required_tier: Some("creator_studio".into()),
                required_entitlements: vec![
                    "ai_director".into(),
                    "ai_director.planner".into(),
                ],
                frontend_port: None,
                frontend_route: None,
                shares_backend: Some("gener8-4ever".into()),
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "daw".into(),
                name: "DAW".into(),
                description: "Multi-track timeline, stem mixing, and arrangement".into(),
                version: "0.1.0".into(),
                icon: "daw".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "none".into(),
                min_vram_mb: 0,
                tags: vec!["daw".into(), "audio".into(), "mixing".into(), "stems".into()],
                launch_url: None,
                launch_binary: None,
                required_tier: Some("creator_studio".into()),
                required_entitlements: vec!["daw_pro".into()],
                frontend_port: None,
                frontend_route: None,
                shares_backend: Some("gener8-4ever".into()),
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "s3studio".into(),
                name: "S3 Studio".into(),
                description: "Strands Sound Studio: cloud music generation (legacy web)".into(),
                version: "0.1.0".into(),
                icon: "s3studio".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::ExternalUrl,
                engine_type: "audio".into(),
                min_vram_mb: 0,
                tags: vec![
                    "music".into(),
                    "audio".into(),
                    "generation".into(),
                    "web".into(),
                ],
                launch_url: Some("https://s3studio.xyz".into()),
                launch_binary: None,
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "strands-game".into(),
                name: "Strands Nation".into(),
                description: "The game: Three.js desktop OS world".into(),
                version: "0.1.0".into(),
                icon: "strands-game".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::ExternalUrl,
                engine_type: "none".into(),
                min_vram_mb: 0,
                tags: vec!["game".into(), "social".into(), "world".into()],
                launch_url: Some("https://strandsnation.xyz".into()),
                launch_binary: None,
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "kasai".into(),
                name: "My Mait".into(),
                description: "Local MAIT agent with planning, orchestration, and full system access"
                    .into(),
                version: "0.1.0".into(),
                icon: "kasai".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::BinaryLocal,
                engine_type: "llm".into(),
                min_vram_mb: 4096,
                tags: vec![
                    "agent".into(),
                    "llm".into(),
                    "assistant".into(),
                    "planning".into(),
                ],
                launch_url: None,
                launch_binary: Some("everywear-kasai".into()),
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "layeru-osint".into(),
                name: "Layer U OSINT".into(),
                description: "Free-tier OSINT information layer powered by Project SON: worldview, map layers, feeds, and source posture"
                    .into(),
                version: "0.1.0".into(),
                icon: "layeru-osint".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "none".into(),
                min_vram_mb: 0,
                tags: vec![
                    "osint".into(),
                    "information".into(),
                    "worldview".into(),
                    "map".into(),
                ],
                launch_url: None,
                launch_binary: None,
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "3nvizen".into(),
                name: "3nvizen".into(),
                description: "AI video generation with Wan 2.2 and LTX".into(),
                version: "0.1.0".into(),
                icon: "3nvizen".into(),
                // 2026-06-10: was NotBuilt, which made native list_applets
                // hide 3nvizen while the browser entitlement fallback showed
                // it Active/Locked (registry drift, CONTEXT 2026-06-07). The
                // frontend exists on port 3004 and native QA opened it
                // 2026-06-10; entitlement/tier gates still apply.
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::BinaryLocal,
                engine_type: "diffusion".into(),
                min_vram_mb: 12288,
                tags: vec!["video".into(), "generation".into()],
                launch_url: None,
                launch_binary: Some("everywear-3nvizen".into()),
                required_tier: Some("creator_studio".into()),
                required_entitlements: vec!["3nvizen".into(), "3nvizen.video".into()],
                frontend_port: Some(3004),
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "character-studio".into(),
                name: "Avatar Studio".into(),
                description: "3D avatar creation and customization for Strands Blanks".into(),
                version: "0.1.0".into(),
                icon: "character-studio".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "none".into(),
                min_vram_mb: 0, // WebGL only, no CUDA
                tags: vec![
                    "avatar".into(),
                    "3d".into(),
                    "character".into(),
                    "blanks".into(),
                ],
                launch_url: None,
                launch_binary: None, // frontend-only: no backend process
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: Some(3007),
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            AppletEntry {
                id: "loom".into(),
                name: "Educ8".into(),
                description: "Educ8: Weaving Agentic Education into your Home.".into(),
                version: "0.1.0".into(),
                icon: "loom".into(),
                status: AppletStatus::Active,
                launch_kind: AppletLaunchKind::FrontendInline,
                engine_type: "none".into(),
                min_vram_mb: 0,
                tags: vec![
                    "knowledge".into(),
                    "offline".into(),
                    "rag".into(),
                    "education".into(),
                ],
                launch_url: None,
                launch_binary: None,
                required_tier: None,
                required_entitlements: Vec::new(),
                frontend_port: Some(3008),
                frontend_route: None,
                shares_backend: None,
                locked_model: None,
                allowed_audio_modes: Vec::new(),
                step_ceiling: None,
                vault_scope: None,
                vid_target: None,
            },
            // Mymories applet removed 2026-05-29 per WIKI.md "Everywear Vault /
            // Project Mymory / MyMaits Boundary" unification: Vault is the
            // user-facing surface, MyMory is the backend, MyMaits is the
            // presentation/operator layer. There is no separate Mymories applet.
        ]
    }

    /// Refresh status based on what's actually installed on disk.
    /// For binary applets, checks whether the compiled binary exists
    /// using the same resolution logic as the launcher.
    fn refresh_status(&mut self) {
        if let Ok(shell_exe) = std::env::current_exe() {
            let monorepo_root = Self::find_monorepo_root(&shell_exe);

            for applet in &mut self.applets {
                if applet.launch_kind != AppletLaunchKind::BinaryLocal {
                    continue;
                }

                if let Some(ref binary) = applet.launch_binary {
                    let bin_name = if cfg!(windows) && !binary.ends_with(".exe") {
                        format!("{binary}.exe")
                    } else {
                        binary.clone()
                    };

                    let found_in_repo = monorepo_root
                        .as_ref()
                        .map(|root| {
                            binary_candidates(root, &applet.id, &bin_name)
                                .into_iter()
                                .any(|path| path.exists())
                        })
                        .unwrap_or(false);

                    let found = found_in_repo
                        || crate::applet_resolver::resolve_applet_binary_named(&applet.id, binary)
                            .is_ok();

                    if !found && applet.status == AppletStatus::Active {
                        info!(
                            applet = %applet.id,
                            "Binary not found on disk; marking as NotBuilt"
                        );
                        applet.status = AppletStatus::NotBuilt;
                    } else if found && applet.status == AppletStatus::NotBuilt {
                        info!(
                            applet = %applet.id,
                            "Binary found on disk; marking as Active"
                        );
                        applet.status = AppletStatus::Active;
                    }
                }
            }
        }

        let active_count = self
            .applets
            .iter()
            .filter(|a| a.status == AppletStatus::Active)
            .count();
        info!(
            total = self.applets.len(),
            active = active_count,
            "Registry loaded"
        );
    }

    /// Walk up from a path to find the monorepo root (directory containing `applets/`).
    fn find_monorepo_root(start: &std::path::Path) -> Option<PathBuf> {
        Self::find_monorepo_root_inner(start)
    }

    /// Get only launchable applets (Active or Locked, NOT NotBuilt).
    pub fn launchable(&self) -> Vec<AppletEntry> {
        self.applets
            .iter()
            .filter(|a| a.status != AppletStatus::NotBuilt)
            .cloned()
            .collect()
    }

    pub fn launchable_for_tier(
        &self,
        tier: model_manager::LicenceTier,
        entitlements: &HashMap<String, bool>,
    ) -> Vec<AppletEntry> {
        self.launchable()
            .into_iter()
            .map(|entry| apply_tier_gate(entry, tier, entitlements))
            .collect()
    }

    /// Get all applets including NotBuilt (admin view).
    pub fn all(&self) -> Vec<AppletEntry> {
        self.applets.clone()
    }

    /// Get a specific applet by ID.
    pub fn get(&self, id: &str) -> Option<&AppletEntry> {
        let id = canonical_applet_id(id);
        self.applets.iter().find(|a| a.id == id)
    }
}

pub fn canonical_applet_id(id: &str) -> &str {
    match id {
        "gener8" => "gener8-4ever",
        _ => id,
    }
}

pub fn applet_entitlement_error(
    applet: &AppletEntry,
    tier: model_manager::LicenceTier,
    entitlements: &HashMap<String, bool>,
) -> Option<String> {
    if applet.status == AppletStatus::NotBuilt {
        return Some("Applet is not yet available.".into());
    }
    if applet
        .required_entitlements
        .iter()
        .any(|key| entitlements.get(key).copied().unwrap_or(false))
    {
        return None;
    }
    let Some(required) = applet
        .required_tier
        .as_deref()
        .and_then(model_manager::LicenceTier::from_tier_str)
    else {
        if applet.required_entitlements.is_empty() {
            return None;
        }
        return Some(format!(
            "{} requires one of: {}.",
            applet.name,
            applet.required_entitlements.join(", ")
        ));
    };
    if tier.satisfies(required) {
        return None;
    }
    Some(format!(
        "{} requires {} or newer.",
        applet.name,
        required.as_str()
    ))
}

fn apply_tier_gate(
    mut entry: AppletEntry,
    tier: model_manager::LicenceTier,
    entitlements: &HashMap<String, bool>,
) -> AppletEntry {
    if entry.status == AppletStatus::Active
        && applet_entitlement_error(&entry, tier, entitlements).is_some()
    {
        entry.status = AppletStatus::Locked;
    }
    entry
}

pub fn binary_candidates(root: &std::path::Path, applet_id: &str, bin_name: &str) -> Vec<PathBuf> {
    vec![
        root.join("applets")
            .join(applet_id)
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join(bin_name),
        root.join("applets")
            .join(applet_id)
            .join("src-tauri")
            .join("target")
            .join("release")
            .join(bin_name),
        root.join("target").join("debug").join(bin_name),
        root.join("target").join("release").join(bin_name),
        root.join("applets").join(applet_id).join(bin_name),
    ]
}

/// Find the monorepo root by walking up from the current executable.
/// Public so the launcher pipeline can resolve applet manifest paths.
pub fn find_monorepo_root_from_exe() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| AppletRegistry::find_monorepo_root_inner(&exe))
}

impl AppletRegistry {
    /// Inner helper so both the struct method and the free function share logic.
    fn find_monorepo_root_inner(start: &std::path::Path) -> Option<PathBuf> {
        let mut cursor = start.parent().map(|p| p.to_path_buf());
        for _ in 0..8 {
            if let Some(ref dir) = cursor {
                if dir.join("applets").is_dir() {
                    return Some(dir.clone());
                }
                cursor = dir.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
        None
    }
}
