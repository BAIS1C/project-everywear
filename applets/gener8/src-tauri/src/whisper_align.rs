//! WhisperAlignManager: spawns the UV-managed Python whisper-align
//! sidecar on port 9878.
//!
//! Uses stable-ts (Whisper forced alignment) to produce per-line LRC
//! timestamps from audio + known lyrics.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Sidecar search uses everywear_paths::bin_dir() first
//!   - UV binary search uses everywear_paths::bin_dir() first

use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

pub const WHISPER_ALIGN_PORT: u16 = 9878;

pub struct WhisperAlignManager {
    child: Option<Child>,
    port: u16,
}

impl WhisperAlignManager {
    pub fn new() -> Self {
        Self {
            child: None,
            port: WHISPER_ALIGN_PORT,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            tracing::info!("whisper-align: killing PID {}", c.id());
            let _ = c.kill();
            let _ = c.wait();
            tracing::info!("whisper-align: process reaped, port {} released", self.port);
        }
    }
}

impl Drop for WhisperAlignManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Locate the whisper-align sidecar directory.
///
/// Probe order:
///   1. Platform standard: ~/.everywear/bin/whisper-align/
///   2. Alongside the applet binary (bundled)
///   3. Dev candidates from cwd
fn find_align_dir() -> Result<PathBuf> {
    // 1. Platform standard
    let platform = everywear_paths::bin_dir().join("whisper-align");
    if platform.join("align_server.py").exists() {
        return Ok(platform);
    }

    // 2. Bundled next to exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let resource = parent
                .join("resources")
                .join("sidecar")
                .join("whisper-align");
            if resource.join("align_server.py").exists() {
                return Ok(resource);
            }
        }
    }

    // 3. Dev candidates
    let candidates = [
        "sidecar/whisper-align",
        "../sidecar/whisper-align",
        "src-tauri/sidecar/whisper-align",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.join("align_server.py").exists() {
            return Ok(std::fs::canonicalize(p)?);
        }
    }
    Err(anyhow!(
        "whisper-align sidecar not found. Expected at {}",
        platform.display()
    ))
}

/// Locate `uv` binary. Prefer platform standard, then PATH.
fn find_uv() -> Result<PathBuf> {
    let bin = if cfg!(target_os = "windows") {
        "uv.exe"
    } else {
        "uv"
    };

    // Platform standard
    let platform = everywear_paths::bin_dir().join(bin);
    if platform.exists() {
        return Ok(platform);
    }

    // Bundled next to exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("resources").join(bin);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // PATH fallback
    if let Ok(p) = which::which(bin) {
        return Ok(p);
    }

    Err(anyhow!(
        "uv binary not found. Install uv: https://docs.astral.sh/uv/"
    ))
}

pub async fn boot(mgr: Arc<Mutex<WhisperAlignManager>>) -> Result<()> {
    let align_dir = find_align_dir()?;
    let uv = find_uv()?;

    tracing::info!("uv:              {}", uv.display());
    tracing::info!("whisper-align:   {}", align_dir.display());
    tracing::info!("listening port:  {}", WHISPER_ALIGN_PORT);

    let mut cmd = Command::new(&uv);
    cmd.args(["run", "--project", &align_dir.to_string_lossy(), "serve"]);
    cmd.env("S3_ALIGN_PORT", WHISPER_ALIGN_PORT.to_string());
    cmd.current_dir(&align_dir);
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
                    Ok(l) => tracing::info!(target: "whisper-align.stdout", "{}", l),
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
                    Ok(l) => tracing::warn!(target: "whisper-align.stderr", "{}", l),
                    Err(_) => break,
                }
            }
        });
    }

    {
        let mut m = mgr.lock().await;
        m.child = Some(child);
    }

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    tracing::info!("whisper-align: sidecar boot complete (model lazy-loads on first call)");
    Ok(())
}

/// Proxy an alignment request to the sidecar and return raw LRC.
pub async fn align(audio_path: &str, lyrics: &str, language: Option<&str>) -> Result<String> {
    let client = reqwest::Client::new();
    let mut body = serde_json::json!({
        "audio_path": audio_path,
        "lyrics": lyrics,
    });
    if let Some(lang) = language {
        body["language"] = serde_json::Value::String(lang.to_string());
    }

    let resp = client
        .post(format!("http://127.0.0.1:{}/align", WHISPER_ALIGN_PORT))
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("whisper-align returned {}: {}", status, text));
    }

    let data: serde_json::Value = resp.json().await?;
    data["lrc"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("whisper-align response missing 'lrc' field"))
}
