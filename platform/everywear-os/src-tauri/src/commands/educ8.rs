use crate::{profile, AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};
use tokio::io::AsyncWriteExt;

pub const EDUC8_DOWNLOAD_ROOT_PREF: &str = "educ8.download_root";
const APPLET_ID: &str = "loom";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8Resource {
    pub id: String,
    pub title: String,
    pub url: Option<String>,
    pub filename: Option<String>,
    pub size_bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8ContentPack {
    pub id: String,
    pub module: String,
    pub title: String,
    pub pack_type: String,
    pub status: String,
    pub source: String,
    pub resolver: String,
    pub tooltip: String,
    pub resources: Vec<Educ8Resource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8ContentPlan {
    pub packs: Vec<Educ8ContentPack>,
    pub download_root: String,
    pub canonical_link: String,
    pub link_status: String,
    pub total_size_bytes: u64,
    pub downloadable_size_bytes: u64,
    pub missing_download_root: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8DownloadRoot {
    pub download_root: String,
    pub canonical_link: String,
    pub link_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8DownloadReceipt {
    pub pack_id: String,
    pub resources: Vec<Educ8DownloadedResource>,
    pub download_root: String,
    pub canonical_link: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8DownloadedResource {
    pub resource_id: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8DownloadProgress {
    pub pack_id: String,
    pub resource_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub pct: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Educ8DownloadRequest {
    pub pack_ids: Vec<String>,
}

#[tauri::command]
pub async fn educ8_get_content_manifest() -> Result<Vec<Educ8ContentPack>, String> {
    Ok(content_manifest())
}

#[tauri::command]
pub async fn educ8_get_content_plan(
    pack_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Educ8ContentPlan, String> {
    let packs = selected_packs(&pack_ids)?;
    let profile = state.profile.lock().await;
    Ok(build_plan(packs, &profile))
}

#[tauri::command]
pub async fn educ8_get_download_root(
    state: State<'_, AppState>,
) -> Result<Educ8DownloadRoot, String> {
    let profile = state.profile.lock().await;
    let download_root = configured_download_root(&profile);
    let canonical_link = canonical_download_link();
    Ok(Educ8DownloadRoot {
        download_root: download_root.to_string_lossy().to_string(),
        canonical_link: canonical_link.to_string_lossy().to_string(),
        link_status: link_status(&download_root, &canonical_link),
    })
}

#[tauri::command]
pub async fn educ8_set_download_root(
    path: String,
    state: State<'_, AppState>,
) -> Result<Educ8DownloadRoot, String> {
    let download_root = PathBuf::from(path);
    if download_root.as_os_str().is_empty() {
        return Err("download root cannot be empty".into());
    }
    std::fs::create_dir_all(&download_root).map_err(|error| error.to_string())?;

    let canonical_link = canonical_download_link();
    ensure_directory_symlink(&download_root, &canonical_link).map_err(|error| error.to_string())?;

    let profile = state.profile.lock().await;
    profile
        .set_pref(
            EDUC8_DOWNLOAD_ROOT_PREF,
            &download_root.to_string_lossy().to_string(),
        )
        .map_err(|error| error.to_string())?;

    Ok(Educ8DownloadRoot {
        download_root: download_root.to_string_lossy().to_string(),
        canonical_link: canonical_link.to_string_lossy().to_string(),
        link_status: link_status(&download_root, &canonical_link),
    })
}

#[tauri::command]
pub async fn educ8_download_packs(
    app: tauri::AppHandle,
    request: Educ8DownloadRequest,
    state: State<'_, AppState>,
) -> Result<Vec<Educ8DownloadReceipt>, String> {
    let packs = selected_packs(&request.pack_ids)?;
    let download_root = {
        let profile = state.profile.lock().await;
        configured_download_root(&profile)
    };
    if download_root.as_os_str().is_empty() {
        return Err("choose an Educ8 download location before downloading".into());
    }
    std::fs::create_dir_all(&download_root).map_err(|error| error.to_string())?;
    let canonical_link = canonical_download_link();
    ensure_directory_symlink(&download_root, &canonical_link).map_err(|error| error.to_string())?;

    let mut receipts = Vec::new();
    for pack in packs {
        let mut resources = Vec::new();
        for resource in pack
            .resources
            .iter()
            .filter(|resource| resource.url.is_some())
        {
            let downloaded = download_resource(&app, &pack.id, resource, &download_root).await?;
            resources.push(downloaded);
        }
        receipts.push(Educ8DownloadReceipt {
            pack_id: pack.id,
            resources,
            download_root: download_root.to_string_lossy().to_string(),
            canonical_link: canonical_link.to_string_lossy().to_string(),
        });
    }
    Ok(receipts)
}

fn build_plan(packs: Vec<Educ8ContentPack>, profile: &profile::ProfileManager) -> Educ8ContentPlan {
    let download_root = configured_download_root(profile);
    let canonical_link = canonical_download_link();
    let total_size_bytes = packs
        .iter()
        .flat_map(|pack| pack.resources.iter())
        .map(|resource| resource.size_bytes)
        .sum();
    let downloadable_size_bytes = packs
        .iter()
        .flat_map(|pack| pack.resources.iter())
        .filter(|resource| resource.url.is_some())
        .map(|resource| resource.size_bytes)
        .sum();

    Educ8ContentPlan {
        packs,
        download_root: download_root.to_string_lossy().to_string(),
        canonical_link: canonical_link.to_string_lossy().to_string(),
        link_status: link_status(&download_root, &canonical_link),
        total_size_bytes,
        downloadable_size_bytes,
        missing_download_root: profile.get_pref(EDUC8_DOWNLOAD_ROOT_PREF).is_none(),
    }
}

fn configured_download_root(profile: &profile::ProfileManager) -> PathBuf {
    profile
        .get_pref(EDUC8_DOWNLOAD_ROOT_PREF)
        .map(PathBuf::from)
        .unwrap_or_else(default_download_root)
}

fn default_download_root() -> PathBuf {
    everywear_paths::data_dir(APPLET_ID).join("downloads")
}

fn canonical_download_link() -> PathBuf {
    everywear_paths::data_dir(APPLET_ID)
        .join("content")
        .join("downloads")
}

fn link_status(download_root: &Path, canonical_link: &Path) -> String {
    if !canonical_link.exists() {
        return "missing".into();
    }
    match canonical_link.canonicalize() {
        Ok(target)
            if target
                == download_root
                    .canonicalize()
                    .unwrap_or_else(|_| download_root.to_path_buf()) =>
        {
            "linked".into()
        }
        Ok(target) => format!("points_to:{}", target.display()),
        Err(_) => "unreadable".into(),
    }
}

fn selected_packs(ids: &[String]) -> Result<Vec<Educ8ContentPack>, String> {
    let manifest = content_manifest();
    let selected = if ids.is_empty() {
        manifest
            .into_iter()
            .filter(|pack| pack.status != "optional")
            .collect()
    } else {
        let mut out = Vec::new();
        for id in ids {
            let pack = manifest
                .iter()
                .find(|pack| pack.id == *id)
                .ok_or_else(|| format!("unknown Educ8 content pack: {id}"))?;
            out.push(pack.clone());
        }
        out
    };
    Ok(selected)
}

async fn download_resource(
    app: &tauri::AppHandle,
    pack_id: &str,
    resource: &Educ8Resource,
    download_root: &Path,
) -> Result<Educ8DownloadedResource, String> {
    let url = resource
        .url
        .as_deref()
        .ok_or_else(|| format!("resource {} has no download URL", resource.id))?;
    let filename = resource.filename.as_deref().ok_or_else(|| {
        format!(
            "resource {} has no target filename; refusing ambiguous download",
            resource.id
        )
    })?;
    let target = download_root.join(filename);
    if target.exists() {
        return receipt_for_existing(resource, &target);
    }
    let part = target.with_extension("part");
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let client = reqwest::Client::new();
    let mut response = client
        .get(url)
        .header("User-Agent", "everywear-educ8/0.1")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "download failed: HTTP {} for {url}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(resource.size_bytes);
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;
    let mut last_pct = 0_u64;

    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded.saturating_mul(100) / total).min(100);
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "educ8-download-progress",
                    Educ8DownloadProgress {
                        pack_id: pack_id.to_string(),
                        resource_id: resource.id.clone(),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        pct,
                    },
                );
            }
        }
    }

    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &target)
        .await
        .map_err(|error| error.to_string())?;

    receipt_for_existing(resource, &target)
}

fn receipt_for_existing(
    resource: &Educ8Resource,
    path: &Path,
) -> Result<Educ8DownloadedResource, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let sha256 = sha256_file(path).map_err(|error| error.to_string())?;
    Ok(Educ8DownloadedResource {
        resource_id: resource.id.clone(),
        file_path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        sha256,
    })
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn ensure_directory_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if target.exists() {
        let target_canonical = target.canonicalize().ok();
        let source_canonical = source.canonicalize().ok();
        if target_canonical == source_canonical {
            return Ok(());
        }
        if std::fs::symlink_metadata(target)?.file_type().is_symlink() {
            std::fs::remove_dir(target).or_else(|_| std::fs::remove_file(target))?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!(
                    "canonical Educ8 content path already exists: {}",
                    target.display()
                ),
            ));
        }
    }
    symlink_dir(source, target)
}

#[cfg(windows)]
fn symlink_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(source, target)
}

#[cfg(not(windows))]
fn symlink_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, target)
}

fn mb(value: u64) -> u64 {
    value * 1_048_576
}

fn resource(id: &str, title: &str, url: &str, filename: &str, size_mb: u64) -> Educ8Resource {
    Educ8Resource {
        id: id.into(),
        title: title.into(),
        url: Some(url.into()),
        filename: Some(filename.into()),
        size_bytes: mb(size_mb),
        sha256: None,
    }
}

fn local_resource(id: &str, title: &str, size_bytes: u64) -> Educ8Resource {
    Educ8Resource {
        id: id.into(),
        title: title.into(),
        url: None,
        filename: None,
        size_bytes,
        sha256: None,
    }
}

fn content_manifest() -> Vec<Educ8ContentPack> {
    vec![
        Educ8ContentPack {
            id: "teacher-skill".into(),
            module: "Teacher Agent".into(),
            title: "Educ8 IGCSE Teacher Skill".into(),
            pack_type: "skill".into(),
            status: "required".into(),
            source: "Everywear skills/igcse-teacher".into(),
            resolver: "Local repo skill install".into(),
            tooltip: "Teaching behaviour for diagnostics, scaffolding, retrieval practice, feedback, and exam coaching.".into(),
            resources: vec![local_resource("teacher-skill", "Teacher skill manifest", 1_000_000)],
        },
        Educ8ContentPack {
            id: "loom-db".into(),
            module: "Learning State".into(),
            title: "Educ8 SQLite learning store".into(),
            pack_type: "database".into(),
            status: "required".into(),
            source: "~/.everywear/data/loom/loom.db".into(),
            resolver: "Educ8 learning-store setup".into(),
            tooltip: "Stores learner profile, selected syllabus, progress, retrieval schedule, notes, and teacher feedback.".into(),
            resources: vec![local_resource("loom-db", "Starter learning database", mb(50))],
        },
        Educ8ContentPack {
            id: "mymaits-lite-model".into(),
            module: "Teacher Agent".into(),
            title: "Local AI tutor model slot".into(),
            pack_type: "model".into(),
            status: "required".into(),
            source: "Everywear shared model registry".into(),
            resolver: "Everywear model planner".into(),
            tooltip: "Uses a suitable local model from the Everywear shell model manager instead of downloading a separate tutor model when one already fits.".into(),
            resources: vec![local_resource("mymaits-lite-model", "Shared teacher runtime model", 0)],
        },
        Educ8ContentPack {
            id: "wikipedia-schools".into(),
            module: "Reference Library".into(),
            title: "Wikipedia Quick Reference".into(),
            pack_type: "zim".into(),
            status: "recommended".into(),
            source: "Educ8 curated Wikipedia selector".into(),
            resolver: "Kiwix ZIM, top-mini profile".into(),
            tooltip: "Compact general reference base for offline explanations, vocabulary, historical context, and quick fact checks.".into(),
            resources: vec![resource(
                "wikipedia_en_top_mini",
                "Quick Reference",
                "https://download.kiwix.org/zim/wikipedia/wikipedia_en_top_mini_2025-12.zim",
                "wikipedia_en_top_mini_2025-12.zim",
                313,
            )],
        },
        Educ8ContentPack {
            id: "wikipedia-science".into(),
            module: "Science".into(),
            title: "Science Reference ZIM Set".into(),
            pack_type: "zim".into(),
            status: "recommended".into(),
            source: "Educ8 education collection".into(),
            resolver: "LibreTexts physics, chemistry, and biology ZIM archives".into(),
            tooltip: "Supports Biology, Chemistry, and Physics lessons with offline concept pages and examples.".into(),
            resources: vec![
                resource(
                    "libretexts.org_en_phys",
                    "LibreTexts Physics",
                    "https://download.kiwix.org/zim/libretexts/libretexts.org_en_phys_2026-01.zim",
                    "libretexts.org_en_phys_2026-01.zim",
                    534,
                ),
                resource(
                    "libretexts.org_en_chem",
                    "LibreTexts Chemistry",
                    "https://download.kiwix.org/zim/libretexts/libretexts.org_en_chem_2025-01.zim",
                    "libretexts.org_en_chem_2025-01.zim",
                    2180,
                ),
                resource(
                    "libretexts.org_en_bio",
                    "LibreTexts Biology",
                    "https://download.kiwix.org/zim/libretexts/libretexts.org_en_bio_2025-01.zim",
                    "libretexts.org_en_bio_2025-01.zim",
                    2240,
                ),
            ],
        },
        Educ8ContentPack {
            id: "wikibooks-maths".into(),
            module: "Mathematics".into(),
            title: "Wikibooks Mathematics".into(),
            pack_type: "zim".into(),
            status: "recommended".into(),
            source: "Educ8 education collection".into(),
            resolver: "Wikibooks all-nopic ZIM archive".into(),
            tooltip: "Adds step-by-step written explanations and practice-friendly worked examples for mathematics topics.".into(),
            resources: vec![resource(
                "wikibooks_en_all_nopic",
                "Wikibooks",
                "https://download.kiwix.org/zim/wikibooks/wikibooks_en_all_nopic_2026-01.zim",
                "wikibooks_en_all_nopic_2026-01.zim",
                3100,
            )],
        },
        Educ8ContentPack {
            id: "gutenberg-literature".into(),
            module: "English".into(),
            title: "Project Gutenberg Literature".into(),
            pack_type: "zim".into(),
            status: "optional".into(),
            source: "Educ8 curated collection".into(),
            resolver: "Project Gutenberg literature ZIM archive".into(),
            tooltip: "Optional offline reading library for vocabulary, comprehension, style analysis, and extended English practice.".into(),
            resources: vec![resource(
                "gutenberg_en_lcc-s",
                "Project Gutenberg: Agriculture and Literature-adjacent reference",
                "https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-s_2026-03.zim",
                "gutenberg_en_lcc-s_2026-03.zim",
                4300,
            )],
        },
        Educ8ContentPack {
            id: "stackexchange-cs".into(),
            module: "Computer Science".into(),
            title: "Computing Reference ZIM Set".into(),
            pack_type: "zim".into(),
            status: "optional".into(),
            source: "Educ8 technology collection".into(),
            resolver: "FreeCodeCamp plus DevDocs Python/JS/HTML/CSS".into(),
            tooltip: "Optional programming explanations. The AI tutor still aligns answers to the syllabus, not forum style.".into(),
            resources: vec![
                resource(
                    "freecodecamp_en_all",
                    "FreeCodeCamp",
                    "https://download.kiwix.org/zim/freecodecamp/freecodecamp_en_all_2026-02.zim",
                    "freecodecamp_en_all_2026-02.zim",
                    8,
                ),
                resource(
                    "devdocs_en_python",
                    "DevDocs Python",
                    "https://download.kiwix.org/zim/devdocs/devdocs_en_python_2026-02.zim",
                    "devdocs_en_python_2026-02.zim",
                    4,
                ),
                resource(
                    "devdocs_en_javascript",
                    "DevDocs JavaScript",
                    "https://download.kiwix.org/zim/devdocs/devdocs_en_javascript_2026-01.zim",
                    "devdocs_en_javascript_2026-01.zim",
                    3,
                ),
                resource(
                    "devdocs_en_html",
                    "DevDocs HTML",
                    "https://download.kiwix.org/zim/devdocs/devdocs_en_html_2026-01.zim",
                    "devdocs_en_html_2026-01.zim",
                    2,
                ),
                resource(
                    "devdocs_en_css",
                    "DevDocs CSS",
                    "https://download.kiwix.org/zim/devdocs/devdocs_en_css_2026-01.zim",
                    "devdocs_en_css_2026-01.zim",
                    5,
                ),
            ],
        },
        Educ8ContentPack {
            id: "openstreetmap-world".into(),
            module: "Geography".into(),
            title: "Offline Map Pack".into(),
            pack_type: "map".into(),
            status: "optional".into(),
            source: "Everywear map/content registry".into(),
            resolver: "Select PMTiles by region".into(),
            tooltip: "Useful for Geography lessons, fieldwork, maps, scale, coordinates, and human/physical geography examples.".into(),
            resources: vec![local_resource("pmtiles-region", "Region PMTiles selection", 0)],
        },
    ]
}
