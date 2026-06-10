//! Shared video-encoder sidecar service.
//!
//! The shell owns the NVENC video-encoder sidecar lifecycle. Any applet
//! that needs video encoding (Vid Studio, Gener8, future 3nvizen) calls
//! `request_video_encoder` on mount and `release_video_encoder` on unmount.
//!
//! The sidecar boots on the first request and stops when the last consumer
//! releases. This avoids tying the encoder to any single applet's backend.
//!
//! The sidecar is a Node.js process that auto-detects NVENC / QSV / AMF /
//! software fallback and encodes raw RGBA frames streamed over WebSocket
//! into MP4 via FFmpeg.
//!
//! Port: 9877 (VIDEO_ENCODER_PORT)
//!
//! Resource layout (bundled release):
//!   {exe_dir}/resources/sidecar/video-encoder/dist/index.js
//!   {exe_dir}/resources/node.exe

use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

pub const VIDEO_ENCODER_PORT: u16 = 9877;

pub fn detect_ffmpeg_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FFMPEG_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    if let Ok(path) = which::which("ffmpeg") {
        return Some(path);
    }

    [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        r"C:\Users\MAG MSI\scoop\apps\ffmpeg\current\bin\ffmpeg.exe",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
}

pub struct VideoEncoderService {
    child: Option<Child>,
    /// Number of active consumers (applets using the encoder).
    consumer_count: u32,
    port: u16,
}

impl VideoEncoderService {
    pub fn new() -> Self {
        Self {
            child: None,
            consumer_count: 0,
            port: VIDEO_ENCODER_PORT,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn consumer_count(&self) -> u32 {
        self.consumer_count
    }

    /// Register a consumer. Boots the sidecar if this is the first.
    /// Returns the port number for WebSocket connection.
    pub fn acquire(&mut self, ffmpeg_path: Option<&PathBuf>) -> Result<u16> {
        self.consumer_count += 1;
        tracing::info!(
            consumers = self.consumer_count,
            "video-encoder: consumer acquired"
        );

        if !self.is_running() {
            self.boot(ffmpeg_path)?;
        }
        Ok(self.port)
    }

    /// Unregister a consumer. Stops the sidecar if this was the last.
    pub fn release(&mut self) {
        if self.consumer_count > 0 {
            self.consumer_count -= 1;
        }
        tracing::info!(
            consumers = self.consumer_count,
            "video-encoder: consumer released"
        );

        if self.consumer_count == 0 {
            self.stop();
        }
    }

    /// Force stop regardless of consumer count. Used on app exit.
    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            tracing::info!("video-encoder: killing PID {}", c.id());
            let _ = c.kill();
            let _ = c.wait();
            tracing::info!("video-encoder: process reaped, port {} released", self.port);
        }
    }

    fn boot(&mut self, ffmpeg_path: Option<&PathBuf>) -> Result<()> {
        let entry = find_encoder_entry()?;
        let node = find_node()?;

        tracing::info!("video-encoder node:    {}", node.display());
        tracing::info!("video-encoder entry:   {}", entry.display());
        tracing::info!("video-encoder port:    {}", self.port);
        if let Some(ref p) = ffmpeg_path {
            tracing::info!("video-encoder ffmpeg:  {}", p.display());
        } else {
            tracing::warn!("video-encoder ffmpeg:  unresolved (sidecar will try PATH)");
        }

        let mut cmd = Command::new(&node);
        cmd.arg(&entry);
        if let Some(ref p) = ffmpeg_path {
            cmd.env("FFMPEG_PATH", p);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Suppress console window on Windows
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn()?;

        // Drain stdout/stderr to prevent pipe deadlock
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

        self.child = Some(child);
        Ok(())
    }
}

impl Drop for VideoEncoderService {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── Path resolution ─────────────────────────────────────────────────────────

/// Locate the Node entry point for the encoder sidecar.
fn find_encoder_entry() -> Result<PathBuf> {
    // Release: bundled inside resources/
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

    // Dev candidates
    let candidates = [
        "sidecar/video-encoder/dist/index.js",
        "src-tauri/sidecar/video-encoder/dist/index.js",
        // Everywear monorepo root dev launch path
        "platform/everywear-os/src-tauri/sidecar/video-encoder/dist/index.js",
        // Monorepo: sidecar lives in the Gener8 applet tree during dev
        "../../applets/gener8/src-tauri/sidecar/video-encoder/dist/index.js",
        "../applets/gener8/src-tauri/sidecar/video-encoder/dist/index.js",
        // Legacy S3 Gener8 monorepo path
        "../../s-gener8/src-tauri/sidecar/video-encoder/dist/index.js",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Ok(std::fs::canonicalize(p)?);
        }
    }
    Err(anyhow!(
        "video-encoder dist/index.js not found in resources or dev candidates"
    ))
}

/// Locate a Node runtime to spawn the encoder with.
fn find_node() -> Result<PathBuf> {
    let bin = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    // Release: bundled portable Node next to the exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("resources").join(bin);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Dev-mode: same file, reachable from the project tree
    let dev_candidates = [
        "resources/node.exe",
        "src-tauri/resources/node.exe",
        "platform/everywear-os/src-tauri/resources/node.exe",
        "../resources/node.exe",
        // Monorepo dev: node.exe in Gener8's tree
        "../../applets/gener8/src-tauri/resources/node.exe",
    ];
    for c in dev_candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Ok(std::fs::canonicalize(p)?);
        }
    }

    // PATH fallback: debug builds only (security audit M-01)
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
        "node binary not found. \
         Bundle node.exe as a Tauri resource (src-tauri/resources/node.exe)."
    ))
}

// ── Health probe ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncoderHealth {
    pub encoder: String,
    pub label: String,
    pub hardware: bool,
}

pub async fn health_probe(client: &reqwest::Client) -> Result<EncoderHealth> {
    let url = format!("http://127.0.0.1:{}/health", VIDEO_ENCODER_PORT);
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
