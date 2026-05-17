//! Inference engine: direct FFI to stable-diffusion.cpp via diffusion-rs.
//!
//! No sd-server sidecar needed. The model is loaded in-process and
//! inference runs on the GPU via the linked stable-diffusion.cpp library.
//!
//! Note: diffusion-rs 0.1.19 `gen_img()` writes output to a file path and
//! returns `Result<(), DiffusionError>`. We use a temp file, read it back,
//! and encode to base64 for the frontend.

use anyhow::{Context, Result};
use diffusion_rs::api::{self, ConfigBuilder, ModelConfig, ModelConfigBuilder, SampleMethod};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::info;

/// Result of a generation operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationResult {
    /// Base64-encoded PNG image data.
    pub image_base64: String,
    /// Seed used for generation.
    pub seed: i64,
    /// Generation time in seconds.
    pub elapsed_secs: f64,
}

/// Request payload for text-to-image generation.
#[derive(Debug, Clone)]
pub struct Txt2ImgRequest {
    pub prompt: String,
    pub negative_prompt: String,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg_scale: f32,
    pub seed: i64,
}

/// Request payload for image-to-image editing.
#[derive(Debug, Clone)]
pub struct Img2ImgRequest {
    pub image_path: PathBuf,
    pub prompt: String,
    pub strength: f32,
    pub steps: u32,
    pub seed: i64,
}

/// The loaded inference engine state.
///
/// SAFETY: `ModelConfig` (from diffusion-rs) contains raw C pointers that are
/// not `Send`/`Sync`. However, `InferenceEngine` is always accessed through a
/// `tokio::Mutex`, which serializes access. The underlying stable-diffusion.cpp
/// context is single-threaded; the mutex guarantees that invariant.
pub struct InferenceEngine {
    model_config: Option<ModelConfig>,
    model_path: Option<PathBuf>,
    /// Temp directory for gen_img output files.
    output_dir: PathBuf,
}

// SAFETY: See doc comment on InferenceEngine. All access is mutex-guarded.
unsafe impl Send for InferenceEngine {}
unsafe impl Sync for InferenceEngine {}

impl InferenceEngine {
    pub fn new() -> Self {
        let output_dir = std::env::temp_dir().join("1magen_output");
        let _ = std::fs::create_dir_all(&output_dir);
        Self {
            model_config: None,
            model_path: None,
            output_dir,
        }
    }

    /// Whether a model is currently loaded.
    pub fn is_loaded(&self) -> bool {
        self.model_config.is_some()
    }

    /// The currently loaded model path.
    pub fn loaded_model(&self) -> Option<String> {
        self.model_path.as_ref().map(|p| p.display().to_string())
    }

    /// Load a model from disk. This initializes the stable-diffusion.cpp
    /// context with the GGUF file.
    pub fn load_model(
        &mut self,
        model_path: &Path,
        vae_path: Option<&Path>,
        llm_path: Option<&Path>,
    ) -> Result<()> {
        info!(model = %model_path.display(), "Loading model via diffusion-rs");

        let mut builder = ModelConfigBuilder::default();
        builder.diffusion_model(model_path.to_path_buf());

        if let Some(vae) = vae_path {
            builder.vae(vae.to_path_buf());
        }
        if let Some(llm) = llm_path {
            builder.llm(llm.to_path_buf());
        }
        builder.flash_attention(true);
        builder.vae_tiling(true);

        let model_config = builder
            .build()
            .map_err(|e| anyhow::anyhow!("ModelConfig build error: {e}"))?;

        self.model_config = Some(model_config);
        self.model_path = Some(model_path.to_path_buf());

        info!("Model loaded successfully");
        Ok(())
    }

    /// Unload the current model, freeing VRAM.
    pub fn unload(&mut self) {
        self.model_config = None;
        self.model_path = None;
        info!("Model unloaded");
    }

    /// Read a generated PNG from disk and encode to base64.
    fn read_output_to_base64(path: &Path) -> Result<String> {
        let png_bytes = std::fs::read(path)
            .with_context(|| format!("failed to read generated image at {}", path.display()))?;
        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &png_bytes,
        ))
    }

    /// Generate an image from a text prompt (txt2img).
    pub fn txt2img(&mut self, req: Txt2ImgRequest) -> Result<GenerationResult> {
        let model_config = self
            .model_config
            .as_mut()
            .context("No model loaded. Call load_model first.")?;

        let start = std::time::Instant::now();

        let output_path = self.output_dir.join("txt2img_output.png");

        let config = ConfigBuilder::default()
            .prompt(req.prompt.clone())
            .negative_prompt(req.negative_prompt.as_str())
            .width(req.width as i32)
            .height(req.height as i32)
            .steps(req.steps as i32)
            .cfg_scale(req.cfg_scale)
            .seed(req.seed)
            .sampling_method(SampleMethod::EULER_SAMPLE_METHOD)
            .output(output_path.clone())
            .build()
            .map_err(|e| anyhow::anyhow!("Config build error: {e}"))?;

        api::gen_img(&config, model_config)
            .map_err(|e| anyhow::anyhow!("Generation failed: {e}"))?;

        let b64 = Self::read_output_to_base64(&output_path)?;

        let elapsed = start.elapsed().as_secs_f64();
        info!(
            elapsed_secs = elapsed,
            seed = req.seed,
            "Generation complete"
        );

        Ok(GenerationResult {
            image_base64: b64,
            seed: req.seed,
            elapsed_secs: elapsed,
        })
    }

    /// Edit an existing image with a text prompt (img2img).
    pub fn img2img(&mut self, req: Img2ImgRequest) -> Result<GenerationResult> {
        let model_config = self
            .model_config
            .as_mut()
            .context("No model loaded. Call load_model first.")?;

        let start = std::time::Instant::now();

        let output_path = self.output_dir.join("img2img_output.png");

        let config = ConfigBuilder::default()
            .prompt(req.prompt.clone())
            .init_img(req.image_path.clone())
            .strength(req.strength)
            .steps(req.steps as i32)
            .seed(req.seed)
            .sampling_method(SampleMethod::EULER_SAMPLE_METHOD)
            .output(output_path.clone())
            .build()
            .map_err(|e| anyhow::anyhow!("Config build error: {e}"))?;

        api::gen_img(&config, model_config).map_err(|e| anyhow::anyhow!("img2img failed: {e}"))?;

        let b64 = Self::read_output_to_base64(&output_path)?;

        let elapsed = start.elapsed().as_secs_f64();
        info!(elapsed_secs = elapsed, "Edit complete");

        Ok(GenerationResult {
            image_base64: b64,
            seed: req.seed,
            elapsed_secs: elapsed,
        })
    }
}
