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
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub const VIDEO_ENCODER_PORT: u16 = 9877;
const VIDEO_ENCODER_HOST: &str = "127.0.0.1";
const BOOT_HEALTH_ATTEMPTS: usize = 20;
const BOOT_HEALTH_INTERVAL_MS: u64 = 500;
const TEARDOWN_ATTEMPTS: usize = 20;
const TEARDOWN_INTERVAL_MS: u64 = 250;

pub fn encoder_http_url(path: impl AsRef<str>) -> String {
    let path = path.as_ref();
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("http://{VIDEO_ENCODER_HOST}:{VIDEO_ENCODER_PORT}{path}")
}

pub fn detect_ffmpeg_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FFMPEG_PATH") {
        let path = PathBuf::from(path);
        if path.exists() && release_root_allowed(&path) {
            return Some(path);
        }
        tracing::warn!(
            path = %path.display(),
            "Ignoring FFMPEG_PATH outside Everywear release roots"
        );
    }

    for candidate in resource_candidates("ffmpeg") {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let managed = everywear_paths::bin_dir().join("ffmpeg");
    for candidate in [
        managed.join("bin").join(ffmpeg_binary_name()),
        managed.join(ffmpeg_binary_name()),
    ] {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(path) = which::which("ffmpeg") {
            return Some(path);
        }

        return [
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        ]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.exists());
    }

    #[cfg(not(debug_assertions))]
    {
        None
    }
}

pub fn ffmpeg_repair_message() -> String {
    let resource = current_resource_dir()
        .map(|root| {
            root.join("ffmpeg")
                .join("bin")
                .join(ffmpeg_binary_name())
                .display()
                .to_string()
        })
        .unwrap_or_else(|| "{current_exe}/resources/ffmpeg/bin/ffmpeg.exe".to_string());
    let managed = everywear_paths::bin_dir()
        .join("ffmpeg")
        .join("bin")
        .join(ffmpeg_binary_name())
        .display()
        .to_string();
    format!(
        "FFmpeg is required for GPU video export. Install it at {resource} or {managed}, \
         or rebuild the installer with EVERYWEAR_FFMPEG_EXE/FFMPEG_PATH pointing to ffmpeg.exe."
    )
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
        if ffmpeg_path.is_none() {
            anyhow::bail!("{}", ffmpeg_repair_message());
        }
        self.consumer_count += 1;
        tracing::info!(
            consumers = self.consumer_count,
            "video-encoder: consumer acquired"
        );

        if !self.is_running() {
            if probe_health_once(self.port).is_ok() {
                tracing::info!(
                    port = self.port,
                    "video-encoder: adopting existing healthy listener"
                );
            } else if let Err(err) = self.boot(ffmpeg_path) {
                self.consumer_count = self.consumer_count.saturating_sub(1);
                return Err(err);
            }
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
            let owned_child = self.child.is_some();
            self.stop();
            if owned_child {
                if let Err(err) = wait_for_port_closed(self.port) {
                    tracing::warn!(
                        error = %err,
                        port = self.port,
                        "video-encoder: teardown verification failed"
                    );
                }
            }
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
        if let Err(err) = wait_for_health(self.port) {
            self.stop();
            return Err(anyhow!(
                "video-encoder spawned but /health never came up: {err}"
            ));
        }
        tracing::info!("video-encoder: /health ready on port {}", self.port);
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
    if let Some(resources) = current_resource_dir() {
        let resource = resources
            .join("sidecar")
            .join("video-encoder")
            .join("dist")
            .join("index.js");
        if resource.exists() {
            return Ok(resource);
        }
    }

    // Dev candidates
    #[cfg(debug_assertions)]
    {
        // 2026-06-12 SGT: the original candidates omitted the resources/
        // segment, but the sidecar actually lives under
        // src-tauri/resources/sidecar/. Dev runs therefore never found the
        // entry and the encoder failed with "did not respond on port 9877"
        // on every Vid Studio entry path. Originals kept as fallback.
        let candidates = [
            "resources/sidecar/video-encoder/dist/index.js",
            "src-tauri/resources/sidecar/video-encoder/dist/index.js",
            "platform/everywear-os/src-tauri/resources/sidecar/video-encoder/dist/index.js",
            "sidecar/video-encoder/dist/index.js",
            "src-tauri/sidecar/video-encoder/dist/index.js",
            "platform/everywear-os/src-tauri/sidecar/video-encoder/dist/index.js",
        ];
        for c in candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Ok(std::fs::canonicalize(p)?);
            }
        }
    }
    Err(anyhow!(
        "video-encoder dist/index.js not found. Expected packaged resource at \
         current_exe/resources/sidecar/video-encoder/dist/index.js. \
         Run npm run bundle:prepare before building the Tauri installer."
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
    if let Some(resources) = current_resource_dir() {
        let candidate = resources.join(bin);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // Dev-mode: same file, reachable from the project tree
    #[cfg(debug_assertions)]
    {
        let dev_candidates = [
            "resources/node.exe",
            "src-tauri/resources/node.exe",
            "platform/everywear-os/src-tauri/resources/node.exe",
            "../resources/node.exe",
        ];
        for c in dev_candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Ok(std::fs::canonicalize(p)?);
            }
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
        "node binary not found. Expected packaged resource at current_exe/resources/node.exe. \
         Run npm run bundle:prepare before building the Tauri installer."
    ))
}

fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn current_resource_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join("resources")))
}

fn resource_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(resources) = current_resource_dir() {
        let bin = if name == "ffmpeg" {
            ffmpeg_binary_name()
        } else {
            name
        };
        candidates.push(resources.join(name).join("bin").join(bin));
        candidates.push(resources.join(bin));
    }
    candidates
}

fn release_root_allowed(path: &Path) -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    let absolute = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut roots = vec![everywear_paths::bin_dir()];
    if let Some(resources) = current_resource_dir() {
        roots.push(resources);
    }
    roots.into_iter().any(|root| {
        let root = std::fs::canonicalize(&root).unwrap_or(root);
        absolute.starts_with(root)
    })
}

// ── Health probe ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct EncoderHealth {
    pub encoder: String,
    pub label: String,
    pub hardware: bool,
}

pub async fn health_probe(client: &reqwest::Client) -> Result<EncoderHealth> {
    let url = encoder_http_url("/health");
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

fn wait_for_health(port: u16) -> Result<()> {
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..BOOT_HEALTH_ATTEMPTS {
        match probe_health_once(port) {
            Ok(()) => return Ok(()),
            Err(err) => last_err = Some(err),
        }
        if attempt < BOOT_HEALTH_ATTEMPTS - 1 {
            std::thread::sleep(std::time::Duration::from_millis(BOOT_HEALTH_INTERVAL_MS));
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("encoder /health timed out")))
}

fn probe_health_once(port: u16) -> Result<()> {
    let timeout = std::time::Duration::from_millis(800);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(format!("GET /health HTTP/1.1\r\nHost: {VIDEO_ENCODER_HOST}:{port}\r\nConnection: close\r\n\r\n").as_bytes())?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        return Ok(());
    }
    Err(anyhow!("encoder /health returned non-200 response"))
}

fn wait_for_port_closed(port: u16) -> Result<()> {
    let timeout = std::time::Duration::from_millis(120);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    for attempt in 0..TEARDOWN_ATTEMPTS {
        if TcpStream::connect_timeout(&addr, timeout).is_err() {
            tracing::info!("video-encoder: port {} closed after release", port);
            return Ok(());
        }
        if attempt < TEARDOWN_ATTEMPTS - 1 {
            std::thread::sleep(std::time::Duration::from_millis(TEARDOWN_INTERVAL_MS));
        }
    }
    Err(anyhow!("port {port} was still reachable after release"))
}
