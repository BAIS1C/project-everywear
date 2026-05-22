use crate::{state::AppState, video_encoder};

/// Acquire the shared video-encoder sidecar. Boots it on first consumer.
/// Returns the WebSocket port (9877) for RGBA frame streaming.
#[tauri::command]
pub async fn request_video_encoder(state: tauri::State<'_, AppState>) -> Result<u16, String> {
    let ffmpeg_path = video_encoder::detect_ffmpeg_path();
    let mut encoder = state.video_encoder.lock().await;
    encoder
        .acquire(ffmpeg_path.as_ref())
        .map_err(|e| e.to_string())
}

/// Release one consumer from the video-encoder sidecar.
/// Stops the sidecar process when the last consumer releases.
#[tauri::command]
pub async fn release_video_encoder(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut encoder = state.video_encoder.lock().await;
    encoder.release();
    Ok(())
}

/// Health-check the running video-encoder sidecar.
#[tauri::command]
pub async fn video_encoder_health() -> Result<video_encoder::EncoderHealth, String> {
    let client = reqwest::Client::new();
    video_encoder::health_probe(&client)
        .await
        .map_err(|e| e.to_string())
}
