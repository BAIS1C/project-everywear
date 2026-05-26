//! Z-Image model manifest for 1magen.
//!
//! Defines the built-in models for the Z-Image diffusion pipeline:
//! DiT (turbo), Qwen3 instruct encoder, and the canonical FLUX VAE.
//! Uses the shared model-manager types.

use model_manager::{ModelInfo, ModelType};
use std::path::PathBuf;

/// Models directory: shared Everywear model cache.
/// Falls back to legacy 1magen-specific path if the shared dir doesn't exist
/// (backward compat for installs that predate the shared model tree).
pub fn models_dir() -> PathBuf {
    let shared = everywear_paths::models_dir();
    if shared.exists() {
        return shared;
    }
    // Legacy fallback for existing installs
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("1magen")
        .join("models")
}

/// Built-in Z-Image model manifest.
pub fn manifest() -> Vec<ModelInfo> {
    vec![
        // ── DiT (main generation model) ─────────────────────────────
        ModelInfo {
            key: "z-image-turbo-q4km".into(),
            name: "Fast Image Model (recommended)".into(),
            filename: "z_image_turbo-Q4_K.gguf".into(),
            size_bytes: 4_511_501_376,
            // The upstream Leejet GGUF hashes differ from the earlier gguf-org mirror.
            // Leave this unset until we pin and verify the exact Q4 artifact we want.
            sha256: None,
            hf_repo: "leejet/Z-Image-Turbo-GGUF".into(),
            hf_file: "z_image_turbo-Q4_K.gguf".into(),
            path: None,
            downloaded: false,
            model_type: ModelType::TextToImage,
        },
        ModelInfo {
            key: "z-image-turbo-q8".into(),
            name: "Quality Image Model".into(),
            filename: "z_image_turbo-Q8_0.gguf".into(),
            size_bytes: 6_577_440_704,
            sha256: Some("df1c5baa86d1398c979495a6072dbcee79444fdb884a2445582ba0769c44e9a1".into()),
            hf_repo: "leejet/Z-Image-Turbo-GGUF".into(),
            hf_file: "z_image_turbo-Q8_0.gguf".into(),
            path: None,
            downloaded: false,
            model_type: ModelType::TextToImage,
        },
        // ── Text encoder (Qwen3 4B Instruct) ───────────────────────
        ModelInfo {
            key: "qwen3-4b-encoder-q4".into(),
            name: "Qwen3 4B Instruct Q4_K_M".into(),
            filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf".into(),
            size_bytes: 2_497_281_120,
            sha256: None,
            hf_repo: "unsloth/Qwen3-4B-Instruct-2507-GGUF".into(),
            hf_file: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf".into(),
            path: None,
            downloaded: false,
            model_type: ModelType::Encoder,
        },
        // ── VAE ─────────────────────────────────────────────────────
        ModelInfo {
            key: "pig-flux-vae".into(),
            name: "FLUX VAE".into(),
            filename: "diffusion_pytorch_model.safetensors".into(),
            size_bytes: 168_000_000,
            sha256: Some("f5b59a26851551b67ae1fe58d32e76486e1e812def4696a4bea97f16604d40a3".into()),
            hf_repo: "diffusers/FLUX.1-vae".into(),
            hf_file: "diffusion_pytorch_model.safetensors".into(),
            path: None,
            downloaded: false,
            model_type: ModelType::Vae,
        },
    ]
}
