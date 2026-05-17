//! Video encoder sidecar process management.
//!
//! Applets bundle their own Node/FFmpeg resources. This crate only provides
//! the Rust API for locating, booting, stopping, and probing the encoder.

use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

pub const DEFAULT_VIDEO_ENCODER_PORT: u16 = 9877;

pub struct VideoEncoderManager {
    child: Option<Child>,
    port: u16,
}

impl VideoEncoderManager {
    pub fn new() -> Self {
        Self::with_port(DEFAULT_VIDEO_ENCODER_PORT)
    }

    pub fn with_port(port: u16) -> Self {
        Self { child: None, port }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            tracing::info!("video-encoder: killing PID {}", child.id());
            let _ = child.kill();
            let _ = child.wait();
            tracing::info!("video-encoder: process reaped, port {} released", self.port);
        }
    }
}

impl Default for VideoEncoderManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for VideoEncoderManager {
    fn drop(&mut self) {
        self.stop();
    }
}

fn find_encoder_entry() -> Result<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let resource = parent
                .join("resources")
                .join("sidecar")
                .join("video-encoder")
                .join("dist")
                .join("index.js");
            if resource.exists() {
                return Ok(resource);
            }
        }
    }

    let candidates = [
        "sidecar/video-encoder/dist/index.js",
        "src-tauri/sidecar/video-encoder/dist/index.js",
        "../../strands-sound-studio/packages/sidecar/video-encoder/dist/index.js",
        "../packages/sidecar/video-encoder/dist/index.js",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(std::fs::canonicalize(path)?);
        }
    }
    Err(anyhow!(
        "video-encoder dist/index.js not found in resources or dev candidates"
    ))
}

fn find_node() -> Result<PathBuf> {
    let bin = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("resources").join(bin);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    let dev_candidates = [
        "resources/node.exe",
        "src-tauri/resources/node.exe",
        "../resources/node.exe",
    ];
    for candidate in dev_candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(std::fs::canonicalize(path)?);
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(path) = which::which(bin) {
            tracing::warn!(
                "bundled Node not found; using PATH copy at {} (DEV ONLY)",
                path.display()
            );
            return Ok(path);
        }
    }

    Err(anyhow!(
        "node binary not found. Bundle node.exe as an applet resource."
    ))
}

pub async fn boot(
    mgr: Arc<Mutex<VideoEncoderManager>>,
    ffmpeg_path: Option<PathBuf>,
) -> Result<()> {
    let entry = find_encoder_entry()?;
    let node = find_node()?;
    let port = mgr.lock().await.port();

    tracing::info!("node:            {}", node.display());
    tracing::info!("video-encoder:   {}", entry.display());
    tracing::info!("listening port:  {}", port);
    if let Some(ref path) = ffmpeg_path {
        tracing::info!("ffmpeg:          {}", path.display());
    } else {
        tracing::warn!("ffmpeg:          unresolved (sidecar will try PATH)");
    }

    let mut cmd = Command::new(node);
    cmd.arg(entry);
    if let Some(ref path) = ffmpeg_path {
        cmd.env("FFMPEG_PATH", path);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => tracing::info!(target: "video-encoder.stdout", "{}", line),
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => tracing::warn!(target: "video-encoder.stderr", "{}", line),
                    Err(_) => break,
                }
            }
        });
    }

    {
        let mut manager = mgr.lock().await;
        manager.child = Some(child);
    }

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncoderHealth {
    pub encoder: String,
    pub label: String,
    pub hardware: bool,
}

pub async fn health_probe(client: &reqwest::Client) -> Result<EncoderHealth> {
    health_probe_on_port(client, DEFAULT_VIDEO_ENCODER_PORT).await
}

pub async fn health_probe_on_port(client: &reqwest::Client, port: u16) -> Result<EncoderHealth> {
    let url = format!("http://127.0.0.1:{port}/health");
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..12 {
        let resp = client
            .get(&url)
            .timeout(std::time::Duration::from_millis(800))
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let value: serde_json::Value = r
                    .json()
                    .await
                    .map_err(|e| anyhow!("invalid JSON from encoder /health: {e}"))?;
                let encoder = value
                    .get("encoder")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let label = value
                    .get("label")
                    .and_then(|x| x.as_str())
                    .unwrap_or(&encoder)
                    .to_string();
                let hardware = value
                    .get("hardware")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
                return Ok(EncoderHealth {
                    encoder,
                    label,
                    hardware,
                });
            }
            Ok(r) => {
                last_err = Some(anyhow!("encoder /health HTTP {}", r.status()));
            }
            Err(e) => {
                last_err = Some(anyhow!("encoder /health: {e}"));
            }
        }
        if attempt < 11 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("encoder /health timed out")))
}
