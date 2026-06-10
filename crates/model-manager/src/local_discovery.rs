//! Local-first model discovery.
//!
//! This scanner is deliberately read-only. It inventories local model files
//! that may already satisfy Everywear applet requirements before any download
//! path is considered.

use crate::requirements::ModelRequirement;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

const MAX_SCAN_DEPTH: usize = 8;
const MIN_MODEL_BYTES: u64 = 1_024;
const GGUF_READ_LIMIT: u64 = 1024 * 1024;

/// A model found on local disk, not yet managed by Everywear.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredModel {
    pub source_path: PathBuf,
    pub source_tool: ModelSourceTool,
    pub filename: String,
    pub size_bytes: u64,
    pub format: ModelFormat,
    pub gguf_metadata: Option<GgufMetadata>,
    pub safetensors_metadata: Option<SafetensorsMetadata>,
    pub everywear_compatibility: Compatibility,
    pub suggested_everywear_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum ModelSourceTool {
    LmStudio,
    Ollama,
    ComfyUI,
    Automatic1111,
    Fooocus,
    LtxDesktop,
    RawDownload,
    EverywearVault,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ModelFormat {
    GGUF,
    Safetensors,
    CKPT,
    Bin,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum Compatibility {
    /// Exact match: same model, same quant, verified by filename and metadata.
    Exact,
    /// Compatible: same base model, different quant or minor version difference.
    Compatible { note: String },
    /// Possible: same architecture family, might work but untested.
    Possible { note: String },
    /// Incompatible: wrong architecture, wrong format, too small.
    Incompatible { reason: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GgufMetadata {
    pub architecture: String,
    pub quantization: String,
    pub context_length: u64,
    pub embedding_length: u64,
    pub layer_count: u64,
    pub head_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SafetensorsMetadata {
    pub architecture: Option<String>,
    pub tensor_count: usize,
    pub total_size_bytes: u64,
}

pub struct LocalModelScanner {
    pub known_paths: Vec<ScanTarget>,
    pub custom_paths: Vec<PathBuf>,
}

pub struct ScanTarget {
    pub tool: ModelSourceTool,
    pub base_path: PathBuf,
    pub recursive: bool,
    pub file_patterns: Vec<&'static str>,
}

impl LocalModelScanner {
    pub fn new(custom_paths: Vec<PathBuf>) -> Self {
        Self {
            known_paths: default_scan_targets(),
            custom_paths,
        }
    }

    pub fn with_targets(known_paths: Vec<ScanTarget>, custom_paths: Vec<PathBuf>) -> Self {
        Self {
            known_paths,
            custom_paths,
        }
    }

    /// Scan all known local sources for model files.
    pub fn scan_all(&self) -> Result<Vec<DiscoveredModel>> {
        let mut results = Vec::new();

        for target in &self.known_paths {
            if target.base_path.exists() {
                results.extend(self.scan_directory(target)?);
            }
        }

        for path in &self.custom_paths {
            if path.exists() {
                let target = ScanTarget {
                    tool: ModelSourceTool::Unknown,
                    base_path: path.clone(),
                    recursive: true,
                    file_patterns: vec!["*.gguf", "*.safetensors", "*.ckpt", "*.bin"],
                };
                results.extend(self.scan_directory(&target)?);
            }
        }

        Ok(results)
    }

    /// Scan a single directory for model files.
    pub fn scan_directory(&self, target: &ScanTarget) -> Result<Vec<DiscoveredModel>> {
        let mut out = Vec::new();
        scan_dir_inner(target, &target.base_path, 0, &mut out)?;
        Ok(out)
    }

    /// Read GGUF header metadata without loading the full model.
    pub fn read_gguf_metadata(path: &Path) -> Result<GgufMetadata> {
        read_gguf_metadata_impl(path)
    }

    /// Read safetensors metadata (JSON header at start of file).
    pub fn read_safetensors_metadata(path: &Path) -> Result<SafetensorsMetadata> {
        read_safetensors_metadata_impl(path)
    }

    /// Check if a discovered model satisfies an Everywear model requirement.
    pub fn check_compatibility(
        &self,
        discovered: &DiscoveredModel,
        required: &ModelRequirement,
    ) -> Compatibility {
        if discovered.size_bytes < MIN_MODEL_BYTES {
            return Compatibility::Incompatible {
                reason: "file is too small to be a trusted model".into(),
            };
        }

        if !required.accepted_formats.contains(&discovered.format) {
            return Compatibility::Incompatible {
                reason: format!(
                    "format {:?} is not accepted for {}",
                    discovered.format, required.everywear_model_id
                ),
            };
        }

        match discovered.format {
            ModelFormat::GGUF => check_gguf_compatibility(discovered, required),
            ModelFormat::Safetensors | ModelFormat::CKPT => {
                check_tensor_model_compatibility(discovered, required)
            }
            ModelFormat::Bin | ModelFormat::Unknown => Compatibility::Possible {
                note: "binary model format matched by extension only".into(),
            },
        }
    }
}

pub fn default_scan_targets() -> Vec<ScanTarget> {
    let mut targets = Vec::new();
    let home = dirs_home();

    push_target(
        &mut targets,
        ModelSourceTool::EverywearVault,
        everywear_paths::models_dir(),
        true,
        vec!["*.gguf", "*.safetensors", "*.ckpt", "*.bin"],
    );

    if let Ok(path) = std::env::var("LM_STUDIO_MODELS_DIR") {
        push_target(
            &mut targets,
            ModelSourceTool::LmStudio,
            PathBuf::from(path),
            true,
            vec!["*.gguf"],
        );
    }
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        push_target(
            &mut targets,
            ModelSourceTool::LmStudio,
            PathBuf::from(local_appdata)
                .join("LM Studio")
                .join("models"),
            true,
            vec!["*.gguf"],
        );
    }
    push_target(
        &mut targets,
        ModelSourceTool::LmStudio,
        home.join(".lmstudio").join("models"),
        true,
        vec!["*.gguf"],
    );

    if let Ok(path) = std::env::var("OLLAMA_MODELS") {
        push_target(
            &mut targets,
            ModelSourceTool::Ollama,
            PathBuf::from(path),
            true,
            vec!["*"],
        );
    }
    push_target(
        &mut targets,
        ModelSourceTool::Ollama,
        home.join(".ollama").join("models"),
        true,
        vec!["*"],
    );

    if let Ok(path) = std::env::var("COMFYUI_PATH") {
        push_target(
            &mut targets,
            ModelSourceTool::ComfyUI,
            PathBuf::from(path).join("models"),
            true,
            vec!["*.safetensors", "*.ckpt", "*.gguf"],
        );
    }
    push_target(
        &mut targets,
        ModelSourceTool::ComfyUI,
        home.join("ComfyUI").join("models"),
        true,
        vec!["*.safetensors", "*.ckpt", "*.gguf"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::Automatic1111,
        home.join("stable-diffusion-webui").join("models"),
        true,
        vec!["*.safetensors", "*.ckpt"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::Fooocus,
        home.join("Fooocus").join("models").join("checkpoints"),
        true,
        vec!["*.safetensors"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::LtxDesktop,
        PathBuf::from(r"G:\LTX\LTX Desktop\resources\backend\models"),
        true,
        vec!["*.safetensors", "*.ckpt"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::RawDownload,
        home.join("Downloads"),
        false,
        vec!["*.gguf", "*.safetensors", "*.ckpt", "*.bin"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::RawDownload,
        home.join("Models"),
        true,
        vec!["*.gguf", "*.safetensors", "*.ckpt", "*.bin"],
    );
    push_target(
        &mut targets,
        ModelSourceTool::RawDownload,
        home.join("huggingface"),
        true,
        vec!["*.gguf", "*.safetensors", "*.ckpt", "*.bin"],
    );

    targets
}

fn push_target(
    targets: &mut Vec<ScanTarget>,
    tool: ModelSourceTool,
    base_path: PathBuf,
    recursive: bool,
    file_patterns: Vec<&'static str>,
) {
    if !targets.iter().any(|t| t.base_path == base_path) {
        targets.push(ScanTarget {
            tool,
            base_path,
            recursive,
            file_patterns,
        });
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn scan_dir_inner(
    target: &ScanTarget,
    dir: &Path,
    depth: usize,
    out: &mut Vec<DiscoveredModel>,
) -> Result<()> {
    if depth > MAX_SCAN_DEPTH {
        return Ok(());
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if target.recursive {
                scan_dir_inner(target, &path, depth + 1, out)?;
            }
            continue;
        }

        if !matches_patterns(&path, &target.file_patterns) && !looks_like_gguf(&path) {
            continue;
        }

        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() < MIN_MODEL_BYTES {
            continue;
        }

        if let Some(model) = discovered_from_path(&path, &target.tool, meta.len()) {
            out.push(model);
        }
    }

    Ok(())
}

fn matches_patterns(path: &Path, patterns: &[&'static str]) -> bool {
    if patterns.iter().any(|p| *p == "*") {
        return true;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    patterns.iter().any(|pattern| match *pattern {
        "*.gguf" => ext == "gguf",
        "*.safetensors" => ext == "safetensors",
        "*.ckpt" => ext == "ckpt",
        "*.bin" => ext == "bin",
        _ => false,
    })
}

fn looks_like_gguf(path: &Path) -> bool {
    let mut buf = [0u8; 4];
    File::open(path)
        .and_then(|mut f| f.read_exact(&mut buf))
        .is_ok()
        && &buf == b"GGUF"
}

fn discovered_from_path(
    path: &Path,
    tool: &ModelSourceTool,
    size_bytes: u64,
) -> Option<DiscoveredModel> {
    let filename = path.file_name()?.to_string_lossy().to_string();
    let lower = filename.to_ascii_lowercase();

    let (format, gguf_metadata, safetensors_metadata) =
        if lower.ends_with(".gguf") || looks_like_gguf(path) {
            (
                ModelFormat::GGUF,
                LocalModelScanner::read_gguf_metadata(path).ok(),
                None,
            )
        } else if lower.ends_with(".safetensors") {
            (
                ModelFormat::Safetensors,
                None,
                LocalModelScanner::read_safetensors_metadata(path).ok(),
            )
        } else if lower.ends_with(".ckpt") {
            (ModelFormat::CKPT, None, None)
        } else if lower.ends_with(".bin") {
            (ModelFormat::Bin, None, None)
        } else {
            return None;
        };

    Some(DiscoveredModel {
        source_path: path.to_path_buf(),
        source_tool: tool.clone(),
        filename,
        size_bytes,
        format,
        gguf_metadata,
        safetensors_metadata,
        everywear_compatibility: Compatibility::Possible {
            note: "not yet checked against a requirement".into(),
        },
        suggested_everywear_model_id: None,
    })
}

fn check_gguf_compatibility(
    discovered: &DiscoveredModel,
    required: &ModelRequirement,
) -> Compatibility {
    let metadata = discovered.gguf_metadata.as_ref();
    let architecture = metadata
        .map(|m| m.architecture.as_str())
        .unwrap_or_else(|| infer_architecture_from_name(&discovered.filename));
    let quant = metadata
        .map(|m| m.quantization.as_str())
        .unwrap_or_else(|| infer_quant_from_name(&discovered.filename).unwrap_or("unknown"));

    if !required.accepted_architectures.is_empty()
        && !required
            .accepted_architectures
            .iter()
            .any(|accepted| architecture_matches(architecture, accepted))
    {
        return Compatibility::Incompatible {
            reason: format!("{architecture} architecture does not match requirement"),
        };
    }

    if let Some(min_context) = required.min_context_length {
        if let Some(metadata) = metadata {
            if metadata.context_length > 0 && metadata.context_length < min_context {
                return Compatibility::Incompatible {
                    reason: format!(
                        "context length {} is below required {}",
                        metadata.context_length, min_context
                    ),
                };
            }
        }
    }

    if let Some(min_layers) = required.min_layers {
        if let Some(metadata) = metadata {
            if metadata.layer_count > 0 && metadata.layer_count < min_layers {
                return Compatibility::Incompatible {
                    reason: format!(
                        "layer count {} is below required {}",
                        metadata.layer_count, min_layers
                    ),
                };
            }
        }
    }

    if let Some(max_size_gb) = required.max_size_gb {
        if bytes_to_gb(discovered.size_bytes) > max_size_gb {
            return Compatibility::Incompatible {
                reason: format!("file exceeds {:.1} GB size limit", max_size_gb),
            };
        }
    }

    let filename_matches = required
        .filename_patterns
        .iter()
        .any(|pattern| filename_pattern_matches(&discovered.filename, pattern));
    let quant_accepted = required.accepted_quants.is_empty()
        || required
            .accepted_quants
            .iter()
            .any(|accepted| accepted.eq_ignore_ascii_case(quant));

    if filename_matches
        && required
            .preferred_quant
            .as_deref()
            .is_some_and(|preferred| preferred.eq_ignore_ascii_case(quant))
    {
        return Compatibility::Exact;
    }

    if filename_matches && quant_accepted {
        return Compatibility::Exact;
    }

    if quant_accepted {
        return Compatibility::Compatible {
            note: format!("{architecture} architecture matches; filename differs"),
        };
    }

    if !required.accepted_quants.is_empty() {
        return Compatibility::Compatible {
            note: format!("{quant} instead of preferred quant; architecture matches"),
        };
    }

    Compatibility::Compatible {
        note: format!("{architecture} architecture matches"),
    }
}

fn check_tensor_model_compatibility(
    discovered: &DiscoveredModel,
    required: &ModelRequirement,
) -> Compatibility {
    if let Some(max_size_gb) = required.max_size_gb {
        if bytes_to_gb(discovered.size_bytes) > max_size_gb {
            return Compatibility::Incompatible {
                reason: format!("file exceeds {:.1} GB size limit", max_size_gb),
            };
        }
    }

    let discovered_arch = discovered
        .safetensors_metadata
        .as_ref()
        .and_then(|m| m.architecture.as_deref())
        .unwrap_or_else(|| infer_architecture_from_name(&discovered.filename));

    let filename_matches = required
        .filename_patterns
        .iter()
        .any(|pattern| filename_pattern_matches(&discovered.filename, pattern));

    if !required.accepted_architectures.is_empty()
        && !required
            .accepted_architectures
            .iter()
            .any(|accepted| architecture_matches(discovered_arch, accepted))
    {
        if filename_matches {
            return Compatibility::Possible {
                note: "filename matches but tensor architecture is unclear".into(),
            };
        }
        return Compatibility::Incompatible {
            reason: format!("{discovered_arch} architecture does not match requirement"),
        };
    }

    if required
        .exact_filename_match
        .as_ref()
        .is_some_and(|exact| discovered.filename.eq_ignore_ascii_case(exact))
    {
        return Compatibility::Exact;
    }

    if filename_matches {
        Compatibility::Exact
    } else {
        Compatibility::Compatible {
            note: format!("{discovered_arch} architecture appears compatible"),
        }
    }
}

fn bytes_to_gb(bytes: u64) -> f64 {
    bytes as f64 / 1_073_741_824.0
}

fn filename_pattern_matches(filename: &str, pattern: &str) -> bool {
    let filename = filename.to_ascii_lowercase();
    let pattern = pattern.to_ascii_lowercase().replace('*', "");
    pattern.is_empty() || filename.contains(&pattern)
}

pub fn architecture_matches(found: &str, accepted: &str) -> bool {
    let found = normalize_arch(found);
    let accepted = normalize_arch(accepted);
    found == accepted
        || found.starts_with(&accepted)
        || accepted.starts_with(&found)
        || (found.starts_with("qwen") && accepted.starts_with("qwen"))
        || (found.starts_with("ltx") && accepted.starts_with("ltx"))
        || (found.starts_with("sdxl") && accepted == "stable-diffusion")
        || (found.starts_with("sd15") && accepted == "stable-diffusion")
}

fn normalize_arch(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['_', ' ', '-'], "")
        .replace("qwen25", "qwen2.5")
        .replace("stable_diffusion", "stablediffusion")
}

fn infer_architecture_from_name(filename: &str) -> &str {
    let lower = filename.to_ascii_lowercase();
    if lower.contains("qwen3") {
        "qwen3"
    } else if lower.contains("qwen2.5") || lower.contains("qwen25") {
        "qwen2.5"
    } else if lower.contains("qwen") {
        "qwen2"
    } else if lower.contains("llama") {
        "llama"
    } else if lower.contains("nemotron") {
        "nemotron"
    } else if lower.contains("acestep") || lower.contains("ace-step") || lower.contains("vae") {
        "ace-step"
    } else if lower.contains("z-image") || lower.contains("z_image") {
        "z-image"
    } else if lower.contains("ltx") {
        "ltx-video"
    } else if lower.contains("sdxl") {
        "sdxl"
    } else if lower.contains("sd15") || lower.contains("sd-1.5") {
        "sd15"
    } else if lower.contains("gemma") {
        "gemma"
    } else {
        "unknown"
    }
}

fn infer_quant_from_name(filename: &str) -> Option<&'static str> {
    let lower = filename.to_ascii_lowercase();
    [
        ("q8_0", "Q8_0"),
        ("q6_k", "Q6_K"),
        ("q5_k_m", "Q5_K_M"),
        ("q5_k_s", "Q5_K_S"),
        ("q4_k_m", "Q4_K_M"),
        ("q4_k_s", "Q4_K_S"),
        ("q4_0", "Q4_0"),
        ("q3_k_m", "Q3_K_M"),
        ("q3_k_s", "Q3_K_S"),
        ("q2_k", "Q2_K"),
        ("bf16", "BF16"),
        ("f16", "F16"),
    ]
    .into_iter()
    .find_map(|(needle, quant)| lower.contains(needle).then_some(quant))
}

fn read_gguf_metadata_impl(path: &Path) -> Result<GgufMetadata> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut limited = file.take(GGUF_READ_LIMIT);
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes)?;
    let mut cursor = Cursor::new(bytes);

    let mut magic = [0u8; 4];
    cursor.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        return Err(anyhow!("not a GGUF file"));
    }

    let _version = read_u32(&mut cursor)?;
    let _tensor_count = read_u64(&mut cursor)?;
    let metadata_count = read_u64(&mut cursor)?;
    let mut values = HashMap::new();

    for _ in 0..metadata_count.min(512) {
        let key = read_string(&mut cursor)?;
        let value_type = read_u32(&mut cursor)?;
        if let Some(value) = read_metadata_value(&mut cursor, value_type)? {
            values.insert(key, value);
        }
    }

    let architecture = values
        .get("general.architecture")
        .and_then(MetadataValue::as_string)
        .unwrap_or_else(|| infer_architecture_from_name(&path.to_string_lossy()).to_string());
    let prefix = architecture.as_str();

    let quantization = values
        .get("general.file_type")
        .and_then(MetadataValue::as_u64)
        .map(gguf_file_type_label)
        .or_else(|| infer_quant_from_name(&path.to_string_lossy()).map(str::to_string))
        .unwrap_or_else(|| "unknown".into());

    Ok(GgufMetadata {
        architecture: architecture.clone(),
        quantization,
        context_length: metadata_u64(&values, &format!("{prefix}.context_length")),
        embedding_length: metadata_u64(&values, &format!("{prefix}.embedding_length")),
        layer_count: metadata_u64(&values, &format!("{prefix}.block_count")),
        head_count: metadata_u64(&values, &format!("{prefix}.attention.head_count")),
    })
}

fn read_safetensors_metadata_impl(path: &Path) -> Result<SafetensorsMetadata> {
    let mut file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut len_buf = [0u8; 8];
    file.read_exact(&mut len_buf)?;
    let header_len = u64::from_le_bytes(len_buf);
    if header_len > 16 * 1024 * 1024 {
        return Err(anyhow!("safetensors header is unexpectedly large"));
    }

    let mut header = vec![0u8; header_len as usize];
    file.read_exact(&mut header)?;
    let value: serde_json::Value = serde_json::from_slice(&header)?;
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("safetensors header is not a JSON object"))?;

    let tensor_names: Vec<&str> = object
        .keys()
        .filter(|key| key.as_str() != "__metadata__")
        .map(|key| key.as_str())
        .collect();
    let architecture = infer_safetensors_architecture(&tensor_names)
        .or_else(|| Some(infer_architecture_from_name(&path.to_string_lossy()).to_string()));

    Ok(SafetensorsMetadata {
        architecture,
        tensor_count: tensor_names.len(),
        total_size_bytes: std::fs::metadata(path)?.len(),
    })
}

fn infer_safetensors_architecture(tensor_names: &[&str]) -> Option<String> {
    let joined = tensor_names
        .iter()
        .take(64)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    if joined.contains("diffusion_model") && joined.contains("ltx") {
        Some("ltx-video".into())
    } else if joined.contains("transformer_blocks") && joined.contains("time_text_embed") {
        Some("z-image".into())
    } else if joined.contains("conditioner.embedders") || joined.contains("model.diffusion_model") {
        Some("sdxl".into())
    } else if joined.contains("model.layers") || joined.contains("model.model.layers") {
        Some("qwen2".into())
    } else {
        None
    }
}

#[derive(Debug)]
enum MetadataValue {
    String(String),
    U64(u64),
}

impl MetadataValue {
    fn as_string(&self) -> Option<String> {
        match self {
            MetadataValue::String(value) => Some(value.clone()),
            MetadataValue::U64(_) => None,
        }
    }

    fn as_u64(&self) -> Option<u64> {
        match self {
            MetadataValue::U64(value) => Some(*value),
            MetadataValue::String(_) => None,
        }
    }
}

fn metadata_u64(values: &HashMap<String, MetadataValue>, key: &str) -> u64 {
    values.get(key).and_then(MetadataValue::as_u64).unwrap_or(0)
}

fn read_metadata_value(
    cursor: &mut Cursor<Vec<u8>>,
    value_type: u32,
) -> Result<Option<MetadataValue>> {
    match value_type {
        0 => Ok(Some(MetadataValue::U64(read_u8(cursor)? as u64))),
        1 => {
            let mut buf = [0u8; 1];
            cursor.read_exact(&mut buf)?;
            Ok(Some(MetadataValue::U64(i8::from_le_bytes(buf) as u64)))
        }
        2 => Ok(Some(MetadataValue::U64(read_u16(cursor)? as u64))),
        3 => {
            let mut buf = [0u8; 2];
            cursor.read_exact(&mut buf)?;
            Ok(Some(MetadataValue::U64(i16::from_le_bytes(buf) as u64)))
        }
        4 => Ok(Some(MetadataValue::U64(read_u32(cursor)? as u64))),
        5 => {
            let mut buf = [0u8; 4];
            cursor.read_exact(&mut buf)?;
            Ok(Some(MetadataValue::U64(i32::from_le_bytes(buf) as u64)))
        }
        6 => {
            skip(cursor, 4)?;
            Ok(None)
        }
        7 => {
            skip(cursor, 1)?;
            Ok(None)
        }
        8 => Ok(Some(MetadataValue::String(read_string(cursor)?))),
        9 => {
            let array_type = read_u32(cursor)?;
            let len = read_u64(cursor)?;
            skip_array(cursor, array_type, len)?;
            Ok(None)
        }
        10 => Ok(Some(MetadataValue::U64(read_u64(cursor)?))),
        11 => {
            let mut buf = [0u8; 8];
            cursor.read_exact(&mut buf)?;
            Ok(Some(MetadataValue::U64(i64::from_le_bytes(buf) as u64)))
        }
        12 => {
            skip(cursor, 8)?;
            Ok(None)
        }
        _ => Err(anyhow!("unknown GGUF metadata value type {value_type}")),
    }
}

fn skip_array(cursor: &mut Cursor<Vec<u8>>, array_type: u32, len: u64) -> Result<()> {
    let bytes_per_item = match array_type {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4 | 5 | 6 => 4,
        10 | 11 | 12 => 8,
        8 => {
            for _ in 0..len.min(1024) {
                let _ = read_string(cursor)?;
            }
            return Ok(());
        }
        _ => return Err(anyhow!("unknown GGUF array type {array_type}")),
    };
    skip(cursor, bytes_per_item * len)
}

fn skip(cursor: &mut Cursor<Vec<u8>>, count: u64) -> Result<()> {
    let next = cursor.position().saturating_add(count);
    if next > cursor.get_ref().len() as u64 {
        return Err(anyhow!("GGUF metadata ended unexpectedly"));
    }
    cursor.set_position(next);
    Ok(())
}

fn read_u8(cursor: &mut Cursor<Vec<u8>>) -> Result<u8> {
    let mut buf = [0u8; 1];
    cursor.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_u16(cursor: &mut Cursor<Vec<u8>>) -> Result<u16> {
    let mut buf = [0u8; 2];
    cursor.read_exact(&mut buf)?;
    Ok(u16::from_le_bytes(buf))
}

fn read_u32(cursor: &mut Cursor<Vec<u8>>) -> Result<u32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_u64(cursor: &mut Cursor<Vec<u8>>) -> Result<u64> {
    let mut buf = [0u8; 8];
    cursor.read_exact(&mut buf)?;
    Ok(u64::from_le_bytes(buf))
}

fn read_string(cursor: &mut Cursor<Vec<u8>>) -> Result<String> {
    let len = read_u64(cursor)?;
    if len > 256 * 1024 {
        return Err(anyhow!("GGUF string length is unexpectedly large"));
    }
    let mut buf = vec![0u8; len as usize];
    cursor.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(Into::into)
}

fn gguf_file_type_label(file_type: u64) -> String {
    match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        6 => "Q5_0",
        7 => "Q5_1",
        8 => "Q8_0",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        24 => "IQ4_NL",
        25 => "IQ4_XS",
        _ => "unknown",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_gguf(path: &Path, arch: &str, file_type: u32) {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"GGUF");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(&6u64.to_le_bytes());
        write_kv_string(&mut bytes, "general.architecture", arch);
        write_kv_u32(&mut bytes, "general.file_type", file_type);
        write_kv_u64(&mut bytes, &format!("{arch}.context_length"), 8192);
        write_kv_u64(&mut bytes, &format!("{arch}.embedding_length"), 2560);
        write_kv_u64(&mut bytes, &format!("{arch}.block_count"), 36);
        write_kv_u64(&mut bytes, &format!("{arch}.attention.head_count"), 20);
        let mut file = File::create(path).unwrap();
        file.write_all(&bytes).unwrap();
        file.write_all(&vec![0u8; 2048]).unwrap();
    }

    fn write_kv_string(bytes: &mut Vec<u8>, key: &str, value: &str) {
        write_string(bytes, key);
        bytes.extend_from_slice(&8u32.to_le_bytes());
        write_string(bytes, value);
    }

    fn write_kv_u32(bytes: &mut Vec<u8>, key: &str, value: u32) {
        write_string(bytes, key);
        bytes.extend_from_slice(&4u32.to_le_bytes());
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_kv_u64(bytes: &mut Vec<u8>, key: &str, value: u64) {
        write_string(bytes, key);
        bytes.extend_from_slice(&10u32.to_le_bytes());
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_string(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }

    #[test]
    fn reads_gguf_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Qwen3-4B-Q4_K_M.gguf");
        write_gguf(&path, "qwen3", 15);

        let meta = LocalModelScanner::read_gguf_metadata(&path).unwrap();
        assert_eq!(meta.architecture, "qwen3");
        assert_eq!(meta.quantization, "Q4_K_M");
        assert_eq!(meta.context_length, 8192);
        assert_eq!(meta.layer_count, 36);
    }

    #[test]
    fn reads_safetensors_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("z-image-q8.safetensors");
        let header = br#"{"transformer_blocks.0.time_text_embed.weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}"#;
        let mut file = File::create(&path).unwrap();
        file.write_all(&(header.len() as u64).to_le_bytes())
            .unwrap();
        file.write_all(header).unwrap();
        file.write_all(&[0u8; 4]).unwrap();

        let meta = LocalModelScanner::read_safetensors_metadata(&path).unwrap();
        assert_eq!(meta.tensor_count, 1);
        assert_eq!(meta.architecture.as_deref(), Some("z-image"));
    }

    #[test]
    fn scans_lm_studio_gguf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Qwen3-4B-Q4_K_M.gguf");
        write_gguf(&path, "qwen3", 15);
        let scanner = LocalModelScanner::with_targets(
            vec![ScanTarget {
                tool: ModelSourceTool::LmStudio,
                base_path: dir.path().to_path_buf(),
                recursive: true,
                file_patterns: vec!["*.gguf"],
            }],
            Vec::new(),
        );

        let found = scanner.scan_all().unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source_tool, ModelSourceTool::LmStudio);
    }

    #[test]
    fn scans_ollama_blob_by_magic() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = dir.path().join("blobs");
        std::fs::create_dir_all(&blobs).unwrap();
        let path = blobs.join("sha256-deadbeef");
        write_gguf(&path, "qwen3", 15);
        let scanner = LocalModelScanner::with_targets(
            vec![ScanTarget {
                tool: ModelSourceTool::Ollama,
                base_path: dir.path().to_path_buf(),
                recursive: true,
                file_patterns: vec!["*"],
            }],
            Vec::new(),
        );

        let found = scanner.scan_all().unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].format, ModelFormat::GGUF);
    }

    #[test]
    fn compatibility_exact_compatible_and_incompatible() {
        let scanner = LocalModelScanner::with_targets(Vec::new(), Vec::new());
        let discovered = DiscoveredModel {
            source_path: PathBuf::from("Qwen3-4B-Q4_K_M.gguf"),
            source_tool: ModelSourceTool::LmStudio,
            filename: "Qwen3-4B-Q4_K_M.gguf".into(),
            size_bytes: 2_500_000_000,
            format: ModelFormat::GGUF,
            gguf_metadata: Some(GgufMetadata {
                architecture: "qwen3".into(),
                quantization: "Q4_K_M".into(),
                context_length: 8192,
                embedding_length: 2560,
                layer_count: 36,
                head_count: 20,
            }),
            safetensors_metadata: None,
            everywear_compatibility: Compatibility::Possible {
                note: String::new(),
            },
            suggested_everywear_model_id: None,
        };
        let req = ModelRequirement {
            everywear_model_id: "kasai-lite-qwen3-4b-q4km".into(),
            applet_id: "kasai".into(),
            accepted_formats: vec![ModelFormat::GGUF],
            accepted_architectures: vec!["qwen3".into()],
            preferred_quant: Some("Q4_K_M".into()),
            accepted_quants: vec!["Q4_K_M".into(), "Q8_0".into()],
            min_layers: None,
            max_size_gb: Some(8.0),
            min_context_length: Some(4096),
            exact_filename_match: None,
            filename_patterns: vec!["Qwen3-4B".into()],
            hf_repo: None,
            hf_file: None,
            size_bytes: Some(2_500_000_000),
            sha256: None,
            qa_only: false,
            release_manifest_excluded: false,
        };
        assert_eq!(
            scanner.check_compatibility(&discovered, &req),
            Compatibility::Exact
        );

        let mut q8 = discovered.clone();
        q8.filename = "Qwen3-4B-Q8_0.gguf".into();
        q8.gguf_metadata.as_mut().unwrap().quantization = "Q8_0".into();
        assert!(matches!(
            scanner.check_compatibility(&q8, &req),
            Compatibility::Exact | Compatibility::Compatible { .. }
        ));

        let mut llama = discovered;
        llama.gguf_metadata.as_mut().unwrap().architecture = "llama".into();
        assert!(matches!(
            scanner.check_compatibility(&llama, &req),
            Compatibility::Incompatible { .. }
        ));
    }
}
