//! 1magen: local AI image generation and editing.
//!
//! Architecture: diffusion-rs (Rust FFI to stable-diffusion.cpp) linked
//! directly into the Tauri binary. No sidecar process, no HTTP.
//! Single binary, single process, direct GPU inference.

mod engine;
mod runtime_ipc;
mod z_image_manifest;

use model_manager::ModelManager;

use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize)]
struct RecommendedStack {
    primary_model_key: String,
    required_model_keys: Vec<String>,
    detected_vram_mb: Option<u64>,
    quality_label: String,
    rationale: String,
}

fn detect_total_vram_mb() -> Option<u64> {
    let mut command = std::process::Command::new("nvidia-smi");
    command.args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = command.output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout
        .lines()
        .find_map(|line| line.trim().parse::<u64>().ok())
}

fn recommended_stack() -> RecommendedStack {
    let detected_vram_mb = detect_total_vram_mb();

    if let Some(vram_mb) = detected_vram_mb {
        if vram_mb >= 10_240 {
            return RecommendedStack {
                primary_model_key: "z-image-turbo-q8".into(),
                required_model_keys: vec![
                    "z-image-turbo-q8".into(),
                    "qwen3-4b-encoder-q4".into(),
                    "pig-flux-vae".into(),
                ],
                detected_vram_mb: Some(vram_mb),
                quality_label: "High Quality".into(),
                rationale: format!(
                    "Detected ~{} MB VRAM, so the higher-quality local 1magen stack is appropriate.",
                    vram_mb
                ),
            };
        }
    }

    RecommendedStack {
        primary_model_key: "z-image-turbo-q4km".into(),
        required_model_keys: vec![
            "z-image-turbo-q4km".into(),
            "qwen3-4b-encoder-q4".into(),
            "pig-flux-vae".into(),
        ],
        detected_vram_mb,
        quality_label: "Standard".into(),
        rationale: detected_vram_mb
            .map(|vram_mb| {
                format!(
                    "Detected ~{} MB VRAM, so the lighter standard local 1magen stack is recommended.",
                    vram_mb
                )
            })
            .unwrap_or_else(|| {
                "GPU VRAM could not be detected reliably, so 1magen is falling back to the lighter standard local stack.".into()
            }),
    }
}

fn default_output_dir() -> std::path::PathBuf {
    let base = dirs::picture_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("Everywear")
}

/// Shared application state injected into all IPC commands.
pub struct AppState {
    pub engine: Arc<Mutex<engine::InferenceEngine>>,
    pub models: Arc<Mutex<ModelManager>>,
}

// ─── IPC commands ───────────────────────────────────────────────────────────

/// Return current engine status.
#[tauri::command]
async fn get_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let eng = state.engine.lock().await;
    let models = state.models.lock().await;
    Ok(serde_json::json!({
        "engine_loaded": eng.is_loaded(),
        "loaded_model": eng.loaded_model(),
        "available_models": models.list_available(),
    }))
}

/// List all discovered and downloaded Z-Image models.
#[tauri::command]
async fn list_models(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<model_manager::ModelInfo>, String> {
    let models = state.models.lock().await;
    Ok(models.list_available())
}

/// Return the recommended local 1magen model stack for this machine.
#[tauri::command]
async fn get_recommended_stack() -> Result<RecommendedStack, String> {
    Ok(recommended_stack())
}

/// Return the default image output directory for 1magen saves.
#[tauri::command]
async fn get_default_output_dir() -> Result<String, String> {
    let dir = default_output_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.display().to_string())
}

/// Download a model from HuggingFace by manifest key.
#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    model_key: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let mut models = state.models.lock().await;
    let app_handle = app.clone();
    models
        .download(&model_key, move |progress| {
            let _ = app_handle.emit("download-progress", &progress);
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load a model into the inference engine (allocates VRAM).
#[tauri::command]
async fn load_model(state: tauri::State<'_, AppState>, model_key: String) -> Result<(), String> {
    let models = state.models.lock().await;
    let model_path = models
        .model_path(&model_key)
        .ok_or_else(|| format!("Model '{}' not downloaded", model_key))?;

    // Z-Image uses a separate Qwen LLM-style text encoder plus VAE.
    let llm_path = models.model_path("qwen3-4b-encoder-q4");
    let vae_path = models.model_path("pig-flux-vae");
    drop(models); // release lock before heavy operation

    let mut eng = state.engine.lock().await;
    eng.load_model(&model_path, vae_path.as_deref(), llm_path.as_deref())
        .map_err(|e| e.to_string())
}

/// Unload model, free VRAM.
#[tauri::command]
async fn unload_model(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut eng = state.engine.lock().await;
    eng.unload();
    Ok(())
}

/// Generate an image from a text prompt.
#[tauri::command]
async fn generate_image(
    state: tauri::State<'_, AppState>,
    prompt: String,
    negative_prompt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    steps: Option<u32>,
    cfg_scale: Option<f32>,
    seed: Option<i64>,
) -> Result<engine::GenerationResult, String> {
    let mut eng = state.engine.lock().await;
    eng.txt2img(engine::Txt2ImgRequest {
        prompt,
        negative_prompt: negative_prompt.unwrap_or_default(),
        width: width.unwrap_or(1024),
        height: height.unwrap_or(1024),
        steps: steps.unwrap_or(9), // Canonical Z-Image Turbo preset
        cfg_scale: cfg_scale.unwrap_or(1.0),
        seed: seed.unwrap_or(-1),
    })
    .map_err(|e| e.to_string())
}

/// Edit an existing image with a text prompt.
#[tauri::command]
async fn edit_image(
    state: tauri::State<'_, AppState>,
    image_path: String,
    prompt: String,
    strength: Option<f32>,
    steps: Option<u32>,
    seed: Option<i64>,
) -> Result<engine::GenerationResult, String> {
    let mut eng = state.engine.lock().await;
    eng.img2img(engine::Img2ImgRequest {
        image_path: std::path::PathBuf::from(image_path),
        prompt,
        strength: strength.unwrap_or(0.65),
        steps: steps.unwrap_or(9),
        seed: seed.unwrap_or(-1),
    })
    .map_err(|e| e.to_string())
}

/// Save a generated image to disk.
#[tauri::command]
async fn save_image(image_base64: String, path: String) -> Result<String, String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &image_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;

    let dest = std::path::PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("write: {e}"))?;
    Ok(dest.display().to_string())
}

// ─── App builder ────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "onemagen=debug,info".parse().unwrap()),
        )
        .init();

    let inference_engine = engine::InferenceEngine::new();
    let model_mgr = ModelManager::new(z_image_manifest::models_dir(), z_image_manifest::manifest());

    let engine_state = Arc::new(Mutex::new(inference_engine));
    let engine_for_ipc = engine_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            engine: engine_state,
            models: Arc::new(Mutex::new(model_mgr)),
        })
        .setup(move |_app| {
            // Connect to shell IPC if launched as a managed applet
            let engine_handle = engine_for_ipc.clone();
            tauri::async_runtime::spawn(async move {
                runtime_ipc::start(engine_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            list_models,
            get_recommended_stack,
            get_default_output_dir,
            download_model,
            load_model,
            unload_model,
            generate_image,
            edit_image,
            save_image,
        ])
        .run(tauri::generate_context!())
        .expect("error running 1magen");
}
