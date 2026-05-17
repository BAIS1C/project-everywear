//! VideoEncoderManager: spawns the Node NVENC video-encoder sidecar
//! on port 9877.
//!
//! The sidecar auto-detects NVENC / QSV / AMF / software fallback and
//! encodes raw RGBA frames streamed over WebSocket into MP4 via FFmpeg.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Binary search uses everywear_paths::bin_dir() for platform standard location
//!   - Node runtime search uses everywear_paths::bin_dir() first
//!   - No Tauri resource_root dependency

use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct VideoEncoderManager {
    child: Option<Child>,
    port: u16,
}

impl VideoEncoderManager {
    pub fn new() -> Self {
        Self {
            child: None,
            port: crate::VIDEO_ENCODER_PORT,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            tracing::info!("video-encoder: killing PID {}", c.id());
            let _ = c.kill();
            let _ = c.wait();
            tracing::info!("video-encoder: process reaped, port {} released", self.port);
        }
    }
}

impl Drop for VideoEncoderManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Locate the Node entry point for the encoder.
///
/// Probe order:
///   1. Platform standard: ~/.everywear/bin/video-encoder/dist/index.js
///   2. Alongside the applet binary (dev)
///   3. Dev candidates from cwd
fn find_encoder_entry() -> Result<PathBuf> {
    // 1. Platform standard location
    let platform = everywear_paths::bin_dir()
        .join("video-encoder")
        .join("dist")
        .join("index.js");
    if platform.exists() {
        return Ok(platform);
    }

    // 2. Alongside the applet binary
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

    // 3. Dev candidates
    let candidates = [
        "sidecar/video-encoder/dist/index.js",
        "src-tauri/sidecar/video-encoder/dist/index.js",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Ok(std::fs::canonicalize(p)?);
        }
    }
    Err(anyhow!(
        "video-encoder dist/index.js not found. Expected at {}",
        platform.display()
    ))
}

/// Locate a Node runtime.
///
/// Probe order:
///   1. Platform standard: ~/.everywear/bin/node[.exe]
///   2. Alongside the applet binary
///   3. System PATH (debug only)
fn find_node() -> Result<PathBuf> {
    let bin = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    // 1. Platform standard location
    let platform = everywear_paths::bin_dir().join(bin);
    if platform.exists() {
        return Ok(platform);
    }

    // 2. Alongside the exe (bundled)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("resources").join(bin);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // 3. PATH fallback (debug only)
    #[cfg(debug_assertions)]
    {
        if let Ok(p) = which::which(bin) {
            tracing::warn!(
                "bundled Node not found; using PATH copy at {} (DEV ONLY)",
                p.display()
            );
            return Ok(p);
        }
    }

    Err(anyhow!(
        "node binary not found. Expected at {}",
        platform.display()
    ))
}

pub async fn boot(
    mgr: Arc<Mutex<VideoEncoderManager>>,
    ffmpeg_path: Option<PathBuf>,
) -> Result<()> {
    let entry = find_encoder_entry()?;
    let node = find_node()?;

    tracing::info!("node:            {}", node.display());
    tracing::info!("video-encoder:   {}", entry.display());
    tracing::info!("listening port:  {}", crate::VIDEO_ENCODER_PORT);
    if let Some(ref p) = ffmpeg_path {
        tracing::info!("ffmpeg:          {}", p.display());
    } else {
        tracing::warn!("ffmpeg:          unresolved (sidecar will try PATH)");
    }

    let mut cmd = Command::new(node);
    cmd.arg(entry);
    if let Some(ref p) = ffmpeg_path {
        cmd.env("FFMPEG_PATH", p);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => tracing::info!(target: "video-encoder.stdout", "{}", l),
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
                    Ok(l) => tracing::warn!(target: "video-encoder.stderr", "{}", l),
                    Err(_) => break,
                }
            }
        });
    }

    {
        let mut m = mgr.lock().await;
        m.child = Some(child);
    }

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    Ok(())
}

/// Probe the NVENC sidecar's `/health` endpoint.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EncoderHealth {
    pub encoder: String,
    pub label: String,
    pub hardware: bool,
}

pub async fn health_probe(client: &reqwest::Client) -> Result<EncoderHealth> {
    let url = format!("http://127.0.0.1:{}/health", crate::VIDEO_ENCODER_PORT);
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..12 {
        let resp = client
            .get(&url)
            .timeout(std::time::Duration::from_millis(800))
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let v: serde_json::Value = r
                    .json()
                    .await
                    .map_err(|e| anyhow!("invalid JSON from encoder /health: {}", e))?;
                let encoder = v
                    .get("encoder")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let label = v
                    .get("label")
                    .and_then(|x| x.as_str())
                    .unwrap_or(&encoder)
                    .to_string();
                let hardware = v.get("hardware").and_then(|x| x.as_bool()).unwrap_or(false);
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
                last_err = Some(anyhow!("encoder /health: {}", e));
            }
        }
        if attempt < 11 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("encoder /health timed out")))
}
