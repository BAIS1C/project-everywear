//! Streaming download from HuggingFace with progress callbacks.
//!
//! Downloads model files with streaming progress, emitting callbacks
//! for UI updates. Designed to be Tauri-agnostic: the caller provides
//! a progress callback closure instead of a Tauri AppHandle.

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tracing::info;

/// Progress update emitted during download.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub model_key: String,
    pub downloaded: u64,
    pub total: u64,
    pub pct: u64,
}

/// Download a model file from HuggingFace with streaming progress.
///
/// # Arguments
/// * `url` - Full HuggingFace download URL
/// * `dest` - Local path to write the file
/// * `model_key` - Identifier for progress events
/// * `on_progress` - Callback invoked at ~1% increments
///
/// # Returns
/// The destination path on success.
pub async fn download_with_progress<F>(
    url: &str,
    dest: &Path,
    model_key: &str,
    mut on_progress: F,
) -> Result<PathBuf>
where
    F: FnMut(DownloadProgress),
{
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "everywear-os/0.1")
        .send()
        .await
        .context("download request failed")?;

    if !resp.status().is_success() {
        anyhow::bail!("download failed: HTTP {} for {url}", resp.status());
    }

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).context("failed to create models directory")?;
    }

    let mut file = tokio::fs::File::create(dest)
        .await
        .context("failed to create destination file")?;

    let mut downloaded: u64 = 0;
    let mut last_pct: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("download stream error")?;
        file.write_all(&chunk).await.context("write error")?;
        downloaded += chunk.len() as u64;

        // Emit progress at ~1% granularity
        if total > 0 {
            let pct = (downloaded * 100) / total;
            if pct != last_pct {
                last_pct = pct;
                on_progress(DownloadProgress {
                    model_key: model_key.to_string(),
                    downloaded,
                    total,
                    pct,
                });
            }
        }
    }

    file.flush().await?;
    info!(model = model_key, bytes = downloaded, "Download complete");

    Ok(dest.to_path_buf())
}

/// Download a file to `target` using a resumable `.part` file.
///
/// If a partial file exists, the request resumes with an HTTP Range header.
/// Once the stream completes, the partial file is verified and atomically
/// renamed into place. An empty `expected_sha256` skips hash verification.
pub async fn download_with_resume(
    url: &str,
    target: &Path,
    expected_sha256: &str,
) -> Result<PathBuf> {
    download_with_resume_and_progress(url, target, "", expected_sha256, |_| {}).await
}

/// Download with resume support and progress callbacks.
pub async fn download_with_resume_and_progress<F>(
    url: &str,
    target: &Path,
    model_key: &str,
    expected_sha256: &str,
    mut on_progress: F,
) -> Result<PathBuf>
where
    F: FnMut(DownloadProgress),
{
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).context("failed to create models directory")?;
    }

    let part_file = target.with_extension("part");
    let mut start_byte = std::fs::metadata(&part_file).map(|m| m.len()).unwrap_or(0);

    let client = reqwest::Client::new();
    let mut req = client.get(url).header("User-Agent", "everywear-os/0.1");
    if start_byte > 0 {
        req = req.header("Range", format!("bytes={start_byte}-"));
    }

    let resp = req.send().await.context("download request failed")?;
    let status = resp.status();

    if start_byte > 0 && status == StatusCode::OK {
        // Server ignored Range; restart cleanly instead of appending duplicate bytes.
        tokio::fs::File::create(&part_file)
            .await
            .context("failed to reset partial download")?;
        start_byte = 0;
    } else if !(status.is_success() || status == StatusCode::PARTIAL_CONTENT) {
        anyhow::bail!("download failed: HTTP {} for {url}", status);
    }

    let total = resp
        .content_length()
        .map(|remaining| remaining.saturating_add(start_byte))
        .unwrap_or(start_byte);

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(start_byte > 0)
        .write(true)
        .truncate(start_byte == 0)
        .open(&part_file)
        .await
        .with_context(|| format!("failed to open {}", part_file.display()))?;

    let mut downloaded = start_byte;
    let mut last_pct = if total > 0 {
        (downloaded * 100) / total
    } else {
        0
    };
    if downloaded > 0 {
        on_progress(DownloadProgress {
            model_key: model_key.to_string(),
            downloaded,
            total,
            pct: last_pct,
        });
    }

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("download stream error")?;
        file.write_all(&chunk).await.context("write error")?;
        downloaded += chunk.len() as u64;

        if total > 0 {
            let pct = (downloaded * 100) / total;
            if pct != last_pct {
                last_pct = pct;
                on_progress(DownloadProgress {
                    model_key: model_key.to_string(),
                    downloaded,
                    total,
                    pct,
                });
            }
        }
    }

    file.flush().await?;
    drop(file);

    if !expected_sha256.is_empty() {
        let expected = Some(expected_sha256.to_string());
        crate::verify::verify_model(&part_file, &expected)?;
    }

    tokio::fs::rename(&part_file, target)
        .await
        .with_context(|| format!("rename {} to {}", part_file.display(), target.display()))?;
    info!(model = model_key, bytes = downloaded, "Download complete");

    Ok(target.to_path_buf())
}

/// Build HuggingFace download URL from repo and filename.
pub fn hf_download_url(hf_repo: &str, hf_file: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}",
        hf_repo, hf_file
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("everywear-{name}-{}-{stamp}", std::process::id()))
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }

    fn handle_connection(mut stream: TcpStream, body: &[u8]) {
        let mut buf = [0_u8; 2048];
        let Ok(n) = stream.read(&mut buf) else { return };
        let req = String::from_utf8_lossy(&buf[..n]);
        let range_start = req
            .lines()
            .find_map(|line| line.strip_prefix("Range: bytes="))
            .and_then(|range| range.split('-').next())
            .and_then(|start| start.trim().parse::<usize>().ok());

        let start = range_start.unwrap_or(0).min(body.len());
        let status = if range_start.is_some() {
            "HTTP/1.1 206 Partial Content"
        } else {
            "HTTP/1.1 200 OK"
        };
        let mut headers = format!(
            "{status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len() - start
        );
        if range_start.is_some() {
            headers.push_str(&format!(
                "Content-Range: bytes {start}-{}/{}\r\n",
                body.len().saturating_sub(1),
                body.len()
            ));
        }
        headers.push_str("\r\n");

        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(&body[start..]);
    }

    fn range_server(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().take(1).flatten() {
                handle_connection(stream, &body);
            }
        });
        format!("http://{addr}/model.bin")
    }

    #[tokio::test]
    async fn resumes_from_part_file() {
        let body = b"abcdefghijklmnopqrstuvwxyz".to_vec();
        let dir = tmp_path("resume");
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("model.bin");
        std::fs::write(target.with_extension("part"), &body[..10]).unwrap();

        let url = range_server(body.clone());
        let hash = sha256_hex(&body);
        download_with_resume(&url, &target, &hash).await.unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), body);
        assert!(!target.with_extension("part").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
