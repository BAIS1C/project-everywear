//! Applet registry: tracks installed, available, and locked applets.
//!
//! The registry reads applet.toml manifests from the applets/ directory
//! and maintains state about which are installed, licensed, and launchable.
//!
//! Design principle: NO greyed-out icons until the applet is actually built.
//! Once built, unlicensed applets show as locked (greyed). Licensed ones
//! show as active and launchable.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub status: AppletStatus,
    pub engine_type: String,
    pub min_vram_mb: u64,
    pub tags: Vec<String>,
    pub launch_url: Option<String>,
    pub launch_binary: Option<String>,
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
                description: "AI image generation and editing powered by Z-Image".into(),
                version: "0.1.0".into(),
                icon: "1magen".into(),
                status: AppletStatus::Active,
                engine_type: "diffusion".into(),
                min_vram_mb: 7400,
                tags: vec!["image".into(), "generation".into(), "editing".into()],
                launch_url: None,
                launch_binary: Some("onemagen".into()),
                frontend_port: Some(3002),
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "gener8".into(),
                name: "Gener8".into(),
                description: "AI music generation, stem mixing, and production powered by ACE-Step"
                    .into(),
                version: "0.1.0".into(),
                icon: "gener8".into(),
                status: AppletStatus::Active,
                engine_type: "audio".into(),
                min_vram_mb: 6144,
                tags: vec![
                    "music".into(),
                    "audio".into(),
                    "generation".into(),
                    "daw".into(),
                ],
                launch_url: None,
                launch_binary: Some("gener8".into()),
                frontend_port: Some(3001),
                frontend_route: None,
                shares_backend: None,
            },
            // Vid Studio: standalone frontend-only applet.
            // Uses the shell-owned video-encoder sidecar (port 9877) on
            // demand via request_video_encoder IPC. No backend binary,
            // no VRAM reservation, instant launch.
            AppletEntry {
                id: "vid".into(),
                name: "Vid Studio".into(),
                description: "Audio-reactive visualiser and music video creation".into(),
                version: "0.1.0".into(),
                icon: "vid".into(),
                status: AppletStatus::Active,
                engine_type: "none".into(),
                min_vram_mb: 0, // NVENC uses dedicated encoder chip, not CUDA cores
                tags: vec!["video".into(), "visualiser".into(), "music".into()],
                launch_url: None,
                launch_binary: None,       // frontend-only: no backend process
                frontend_port: Some(3006), // own Vite dev server
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "s3studio".into(),
                name: "S3 Studio".into(),
                description: "Strands Sound Studio: cloud music generation (legacy web)".into(),
                version: "0.1.0".into(),
                icon: "s3studio".into(),
                status: AppletStatus::Active,
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
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "strands-game".into(),
                name: "Strands Nation".into(),
                description: "The game: Three.js desktop OS world".into(),
                version: "0.1.0".into(),
                icon: "strands-game".into(),
                status: AppletStatus::Active,
                engine_type: "none".into(),
                min_vram_mb: 0,
                tags: vec!["game".into(), "social".into(), "world".into()],
                launch_url: Some("https://game.strandsnation.xyz".into()),
                launch_binary: None,
                frontend_port: None,
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "kasai".into(),
                name: "Kasai".into(),
                description: "Local AI agent with planning, orchestration, and full system access"
                    .into(),
                version: "0.1.0".into(),
                icon: "kasai".into(),
                status: AppletStatus::Active,
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
                frontend_port: Some(3003),
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "3nvizen".into(),
                name: "3nvizen".into(),
                description: "AI video generation with Wan 2.2 and LTX".into(),
                version: "0.1.0".into(),
                icon: "3nvizen".into(),
                status: AppletStatus::NotBuilt,
                engine_type: "diffusion".into(),
                min_vram_mb: 12288,
                tags: vec!["video".into(), "generation".into()],
                launch_url: None,
                launch_binary: Some("everywear-3nvizen".into()),
                frontend_port: Some(3004),
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "character-studio".into(),
                name: "Avatar Studio".into(),
                description: "3D avatar creation and customization for Strands Blanks".into(),
                version: "0.1.0".into(),
                icon: "character-studio".into(),
                status: AppletStatus::Active,
                engine_type: "none".into(),
                min_vram_mb: 0, // WebGL only, no CUDA
                tags: vec![
                    "avatar".into(),
                    "3d".into(),
                    "character".into(),
                    "nft".into(),
                ],
                launch_url: None,
                launch_binary: None, // frontend-only: no backend process
                frontend_port: Some(3007),
                frontend_route: None,
                shares_backend: None,
            },
            AppletEntry {
                id: "mymories".into(),
                name: "Mymories".into(),
                description: "Personal knowledge and memory management".into(),
                version: "0.1.0".into(),
                icon: "mymories".into(),
                status: AppletStatus::NotBuilt,
                engine_type: "llm".into(),
                min_vram_mb: 4096,
                tags: vec!["knowledge".into(), "memory".into(), "rag".into()],
                launch_url: None,
                launch_binary: Some("mymories".into()),
                frontend_port: Some(3005),
                frontend_route: None,
                shares_backend: None,
            },
        ]
    }

    /// Refresh status based on what's actually installed on disk.
    /// For binary applets, checks whether the compiled binary exists
    /// using the same resolution logic as the launcher.
    fn refresh_status(&mut self) {
        if let Ok(shell_exe) = std::env::current_exe() {
            let monorepo_root = Self::find_monorepo_root(&shell_exe);

            for applet in &mut self.applets {
                // Web applets and already-Active applets: no binary check needed
                if applet.launch_url.is_some() {
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

    /// Get all applets including NotBuilt (admin view).
    pub fn all(&self) -> Vec<AppletEntry> {
        self.applets.clone()
    }

    /// Get a specific applet by ID.
    pub fn get(&self, id: &str) -> Option<&AppletEntry> {
        self.applets.iter().find(|a| a.id == id)
    }
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
