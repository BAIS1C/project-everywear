//! AceServerManager: locates, spawns, and supervises ace-server.exe
//! (the GGUF music inference engine) on port 8080.
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Models dir via everywear_paths::models_dir() instead of util::app_data_dir()
//!   - Binary location searches everywear_paths::bin_dir() first
//!   - No Tauri resource_root; binary ships in ~/.everywear/bin/ace-server/

use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AceServerManager {
    child: Option<Child>,
    bin_path: Option<PathBuf>,
}

impl AceServerManager {
    pub fn new() -> Self {
        Self {
            child: None,
            bin_path: None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn bin_path(&self) -> Option<&Path> {
        self.bin_path.as_deref()
    }

    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let pid = c.id();
            tracing::info!("ace-server: stop() called, killing PID {}", pid);
            let _ = c.kill();
            let _ = c.wait();
            tracing::info!("ace-server: PID {} reaped, VRAM released", pid);
        }
    }
}

impl Drop for AceServerManager {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let pid = c.id();
            tracing::info!("ace-server: Drop firing, killing PID {}", pid);
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// Boot ace-server. Finds the binary, verifies models, spawns the process,
/// waits for /props to respond.
pub async fn boot(mgr: Arc<Mutex<AceServerManager>>) -> Result<()> {
    let models_dir = resolve_models_dir();
    std::fs::create_dir_all(&models_dir)?;

    let bin = locate_binary()?;
    tracing::info!("ace-server binary: {}", bin.display());

    let child = start(&bin, &models_dir, crate::ACE_PORT)?;

    {
        let mut m = mgr.lock().await;
        m.child = Some(child);
        m.bin_path = Some(bin);
    }

    let url = format!("http://127.0.0.1:{}", crate::ACE_PORT);
    wait_for_ready(&url).await?;
    tracing::info!("ace-server ready on {}", url);

    Ok(())
}

/// Search order for the ace-server binary:
///   1. ~/.everywear/bin/ace-server/ace-server.exe  (platform standard)
///   2. Alongside the applet binary (dev layout)
///   3. PATH lookup (debug builds only)
fn locate_binary() -> Result<PathBuf> {
    let bin_name = if cfg!(target_os = "windows") {
        "ace-server.exe"
    } else {
        "ace-server"
    };

    // 1. Platform standard location
    let platform = everywear_paths::bin_dir().join("ace-server").join(bin_name);
    if platform.exists() {
        return Ok(platform);
    }

    // 2. Alongside the applet binary (dev)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for up in [
                parent.to_path_buf(),
                parent.join("../.."),
                parent.join("../../.."),
            ] {
                let d = up.join("bin").join("ace-server").join(bin_name);
                if d.exists() {
                    if let Ok(can) = std::fs::canonicalize(&d) {
                        return Ok(can);
                    }
                    return Ok(d);
                }
            }
        }
    }

    // 3. PATH lookup (debug only)
    #[cfg(debug_assertions)]
    {
        if let Ok(p) = which::which(bin_name.trim_end_matches(".exe")) {
            tracing::warn!(
                "ace-server not in platform dir; using PATH copy at {} (DEV ONLY)",
                p.display()
            );
            return Ok(p);
        }
    }

    Err(anyhow!(
        "ace-server binary not found. Expected at {}",
        platform.display()
    ))
}

fn resolve_models_dir() -> PathBuf {
    if let Ok(primary) = std::env::var("EVERYWEAR_MODEL_PRIMARY") {
        let primary = PathBuf::from(primary);
        if let Some(parent) = primary.parent() {
            return parent.to_path_buf();
        }
    }

    let applet_models = everywear_paths::models_dir().join(crate::APPLET_ID);
    if applet_models.exists() {
        return applet_models;
    }

    everywear_paths::models_dir()
}

fn find_model_file(models_dir: &Path, pattern: &str) -> Option<PathBuf> {
    std::fs::read_dir(models_dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.ends_with(".gguf") && name.contains(pattern) {
            Some(entry.path())
        } else {
            None
        }
    })
}

fn start(bin: &Path, models_dir: &Path, port: u16) -> Result<Child> {
    if find_model_file(models_dir, "xl-base").is_none()
        && find_model_file(models_dir, "xl-turbo").is_none()
    {
        return Err(anyhow!(
            "DiT model (pattern `*xl-base*.gguf` or `*xl-turbo*.gguf`) not found in {}",
            models_dir.display()
        ));
    }

    for (role, pattern) in [("LM", "lm"), ("VAE", "vae")] {
        if find_model_file(models_dir, pattern).is_none() {
            return Err(anyhow!(
                "{role} model (pattern `*{pattern}*.gguf`) not found in {}",
                models_dir.display()
            ));
        }
    }
    if find_model_file(models_dir, "embedding").is_none()
        && find_model_file(models_dir, "qwen3").is_none()
    {
        return Err(anyhow!(
            "Text encoder not found in {}",
            models_dir.display()
        ));
    }

    let mut cmd = Command::new(bin);
    cmd.args([
        "--models",
        &models_dir.to_string_lossy(),
        "--port",
        &port.to_string(),
        "--keep-loaded",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()?;

    // Drain stdout/stderr to prevent pipe buffer deadlock
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => tracing::info!(target: "ace-server.stdout", "{}", l),
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
                    Ok(l) => tracing::warn!(target: "ace-server.stderr", "{}", l),
                    Err(_) => break,
                }
            }
        });
    }

    Ok(child)
}

async fn wait_for_ready(url: &str) -> Result<()> {
    let client = reqwest::Client::new();
    for i in 0..60 {
        if let Ok(r) = client.get(format!("{}/props", url)).send().await {
            if r.status().is_success() {
                tracing::info!("ace-server /props OK after {}s", i);
                return Ok(());
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err(anyhow!("ace-server did not become ready within 60s"))
}

/// Restart ace-server. Stops current child, waits for port release, respawns.
pub async fn restart(mgr: Arc<Mutex<AceServerManager>>) -> Result<()> {
    let bin_path = {
        let m = mgr.lock().await;
        m.bin_path
            .clone()
            .ok_or_else(|| anyhow!("ace-server binary path unknown; was boot() ever called?"))?
    };

    let models_dir = resolve_models_dir();
    std::fs::create_dir_all(&models_dir)?;

    {
        let mut m = mgr.lock().await;
        m.stop();
    }

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let child = start(&bin_path, &models_dir, crate::ACE_PORT)?;
    {
        let mut m = mgr.lock().await;
        m.child = Some(child);
    }

    let url = format!("http://127.0.0.1:{}", crate::ACE_PORT);
    wait_for_ready(&url).await?;
    tracing::info!("ace-server restarted on {}", url);

    Ok(())
}
