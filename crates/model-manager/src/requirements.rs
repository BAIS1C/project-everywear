//! Everywear model requirement specifications.
//!
//! Applet manifests describe launch groups and download metadata. This module
//! normalizes those entries into compatibility requirements that the local
//! scanner can match against models already installed by other tools.

use crate::local_discovery::ModelFormat;
use crate::manifest::{AppletManifest, ModelRequirement as ManifestModelRequirement, UpgradePack};
use serde::{Deserialize, Serialize};

/// What an applet needs from a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRequirement {
    pub everywear_model_id: String,
    pub applet_id: String,
    pub accepted_formats: Vec<ModelFormat>,
    pub accepted_architectures: Vec<String>,
    pub preferred_quant: Option<String>,
    pub accepted_quants: Vec<String>,
    pub min_layers: Option<u64>,
    pub max_size_gb: Option<f64>,
    pub min_context_length: Option<u64>,
    pub exact_filename_match: Option<String>,
    pub filename_patterns: Vec<String>,
    pub hf_repo: Option<String>,
    pub hf_file: Option<String>,
    pub size_bytes: Option<u64>,
    /// Expected SHA256 for pinned remote or adopted local artifacts.
    /// When present, downloads and "use this path" adoption must verify
    /// this digest before the model is trusted.
    pub sha256: Option<String>,
}

/// Build requirements from applet.toml definitions.
pub fn build_requirements_from_manifest(
    applet_id: &str,
    manifest: &AppletManifest,
) -> Vec<ModelRequirement> {
    let mut requirements = Vec::new();

    for group in &manifest.model_groups {
        for model in &group.models {
            push_unique(
                &mut requirements,
                requirement_from_model(applet_id, &manifest.engine.engine_type, model),
            );
        }
    }

    for pack in manifest.upgrade_packs.values() {
        collect_pack_requirements(
            applet_id,
            &manifest.engine.engine_type,
            pack,
            &mut requirements,
        );
    }

    apply_known_applet_overrides(applet_id, &mut requirements);
    requirements
}

pub fn kasai_requirements() -> Vec<ModelRequirement> {
    let mut out = Vec::new();
    for (id, filename, repo, hf_file, size, max_gb, preferred, quants, archs) in [
        (
            "kasai-orchestrator-qwen3-6-35b-a3b-q4km",
            "Qwen3.6-35B-A3B-Q4_K_M.gguf",
            "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
            "Qwen3.6-35B-A3B-Q4_K_M.gguf",
            21_166_757_728,
            24.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q5_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5"],
        ),
        (
            "kasai-agent-qwen3-5-9b-q8",
            "Qwen3.5-9B-Q8_0.gguf",
            "lmstudio-community/Qwen3.5-9B-GGUF",
            "Qwen3.5-9B-Q8_0.gguf",
            9_527_501_216,
            12.0,
            "Q8_0",
            vec!["Q8_0", "Q5_K_M", "Q4_K_M"],
            vec!["qwen3", "qwen2.5"],
        ),
        (
            "kasai-agent-qwen3-5-9b-q4km",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "lmstudio-community/Qwen3.5-9B-GGUF",
            "Qwen3.5-9B-Q4_K_M.gguf",
            5_627_044_256,
            8.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q5_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5"],
        ),
        (
            "kasai-orchestrator-qwen3-5-9b-q5km",
            "Qwen3.5-9B-Q5_K_M.gguf",
            "bartowski/Qwen3.5-9B-GGUF",
            "Qwen3.5-9B-Q5_K_M.gguf",
            6_500_000_000,
            8.0,
            "Q5_K_M",
            vec!["Q5_K_M", "Q4_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5"],
        ),
        (
            "kasai-worker-qwen3-4b-q4km",
            "Qwen3-4B-Q4_K_M.gguf",
            "unsloth/Qwen3-4B-GGUF",
            "Qwen3-4B-Q4_K_M.gguf",
            2_497_281_312,
            8.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q4_0", "Q5_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5", "qwen2"],
        ),
        (
            "kasai-lite-nemotron-3-nano-4b-q4km",
            "NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf",
            "lmstudio-community/NVIDIA-Nemotron-3-Nano-4B-GGUF",
            "NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf",
            2_837_072_896,
            8.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q5_K_M", "Q8_0"],
            vec!["nemotron", "llama"],
        ),
        (
            "kasai-lite-qwen3-4b-q4km",
            "Qwen3-4B-Q4_K_M.gguf",
            "unsloth/Qwen3-4B-GGUF",
            "Qwen3-4B-Q4_K_M.gguf",
            2_497_281_312,
            8.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q4_0", "Q5_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5", "qwen2"],
        ),
    ] {
        out.push(gguf_requirement(
            "kasai", id, filename, repo, hf_file, size, max_gb, preferred, quants, archs,
        ));
    }
    out
}

pub fn onemagen_requirements() -> Vec<ModelRequirement> {
    vec![
        tensor_requirement(
            "1magen",
            "z-image-turbo-q8",
            vec!["z-image", "z_image", "zimage"],
            vec!["z-image", "z_image", "turbo", "q8"],
            Some(12.0),
        ),
        tensor_requirement(
            "1magen",
            "z-image-turbo-q4km",
            vec!["z-image", "z_image", "zimage"],
            vec!["z-image", "z_image", "turbo", "q4"],
            Some(8.0),
        ),
        gguf_requirement(
            "1magen",
            "qwen3-4b-encoder-q4",
            "Qwen3-4B-Q4_K_M.gguf",
            "",
            "",
            2_497_281_312,
            8.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q4_0", "Q5_K_M", "Q8_0"],
            vec!["qwen3", "qwen2.5", "qwen2"],
        ),
        tensor_requirement(
            "1magen",
            "pig-flux-vae",
            vec!["flux", "vae", "sdxl"],
            vec!["pig", "flux", "vae"],
            Some(2.0),
        ),
    ]
}

pub fn threevizen_requirements() -> Vec<ModelRequirement> {
    vec![
        tensor_exact(
            "3nvizen",
            "ltx-2.3-22b-distilled-1.1",
            "ltx-2.3-22b-distilled.safetensors",
            vec!["ltx-video", "ltx"],
            Some(50.0),
        ),
        tensor_requirement(
            "3nvizen",
            "ltx-2.3-text-projection",
            vec!["ltx-video", "ltx"],
            vec!["ltx", "text", "projection"],
            Some(2.0),
        ),
        tensor_requirement(
            "3nvizen",
            "ltx-2.3-video-vae",
            vec!["ltx-video", "ltx", "vae"],
            vec!["ltx", "video", "vae"],
            Some(2.0),
        ),
        tensor_requirement(
            "3nvizen",
            "ltx-2.3-audio-vae",
            vec!["ltx-video", "ltx", "vae"],
            vec!["ltx", "audio", "vae"],
            Some(2.0),
        ),
        tensor_requirement(
            "3nvizen",
            "gemma-3-video-text-encoder",
            vec!["gemma"],
            vec!["gemma", "text", "encoder"],
            Some(8.0),
        ),
    ]
}

pub fn gener8_requirements() -> Vec<ModelRequirement> {
    vec![
        gguf_requirement(
            "gener8",
            "acestep-turbo-q8",
            "acestep-v15-xl-turbo-Q8_0.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-turbo-Q8_0.gguf",
            5_000_000_000,
            6.0,
            "Q8_0",
            vec!["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-turbo-q6k",
            "acestep-v15-xl-turbo-Q6_K.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-turbo-Q6_K.gguf",
            3_900_000_000,
            5.0,
            "Q6_K",
            vec!["Q6_K", "Q5_K_M", "Q4_K_M", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-turbo-q5km",
            "acestep-v15-xl-turbo-Q5_K_M.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-turbo-Q5_K_M.gguf",
            3_300_000_000,
            4.5,
            "Q5_K_M",
            vec!["Q5_K_M", "Q4_K_M", "Q6_K", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-turbo-q4km",
            "acestep-v15-xl-turbo-Q4_K_M.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-turbo-Q4_K_M.gguf",
            2_500_000_000,
            4.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-lm",
            "acestep-5Hz-lm-0.6B-Q8_0.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-5Hz-lm-0.6B-Q8_0.gguf",
            710_000_000,
            2.0,
            "Q8_0",
            vec!["Q8_0", "Q4_K_M"],
            vec!["ace-step", "llama"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-vae",
            "vae-BF16.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "vae-BF16.gguf",
            337_000_000,
            1.0,
            "BF16",
            vec!["BF16", "F16"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-text-encoder",
            "Qwen3-Embedding-0.6B-Q8_0.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "Qwen3-Embedding-0.6B-Q8_0.gguf",
            784_000_000,
            2.0,
            "Q8_0",
            vec!["Q8_0", "Q4_K_M"],
            vec!["qwen3", "qwen2.5", "qwen2"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-base-q4km",
            "acestep-v15-xl-base-Q4_K_M.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-sftturbo50-Q4_K_M.gguf",
            2_990_000_000,
            4.0,
            "Q4_K_M",
            vec!["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-base-q5km",
            "acestep-v15-xl-base-Q5_K_M.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-sftturbo50-Q5_K_M.gguf",
            3_530_000_000,
            4.5,
            "Q5_K_M",
            vec!["Q5_K_M", "Q4_K_M", "Q6_K", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-base-q6k",
            "acestep-v15-xl-base-Q6_K.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-sftturbo50-Q6_K.gguf",
            4_100_000_000,
            5.0,
            "Q6_K",
            vec!["Q6_K", "Q5_K_M", "Q4_K_M", "Q8_0"],
            vec!["ace-step"],
        ),
        gguf_requirement(
            "gener8",
            "acestep-base-q8",
            "acestep-v15-xl-base-Q8_0.gguf",
            "Serveurperso/ACE-Step-1.5-GGUF",
            "acestep-v15-xl-sftturbo50-Q8_0.gguf",
            5_310_000_000,
            6.0,
            "Q8_0",
            vec!["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M"],
            vec!["ace-step"],
        ),
    ]
}

pub fn known_requirements() -> Vec<ModelRequirement> {
    let mut all = Vec::new();
    all.extend(kasai_requirements());
    all.extend(onemagen_requirements());
    all.extend(threevizen_requirements());
    all.extend(gener8_requirements());
    all
}

fn collect_pack_requirements(
    applet_id: &str,
    engine_type: &str,
    pack: &UpgradePack,
    out: &mut Vec<ModelRequirement>,
) {
    if let Some(file) = &pack.file {
        let manifest_req = ManifestModelRequirement {
            key: file.key.clone(),
            role: file.role.clone(),
            required: true,
            vram_mb: 0,
            filename: Some(file.filename.clone()),
            hf_repo: Some(file.hf_repo.clone()),
            hf_file: Some(file.hf_file.clone()),
            size_bytes: Some(file.size_bytes),
            sha256: file.sha256.clone(),
        };
        push_unique(
            out,
            requirement_from_model(applet_id, engine_type, &manifest_req),
        );
    }

    for quant in &pack.quants {
        let manifest_req = ManifestModelRequirement {
            key: quant.key.clone(),
            role: quant.role.clone(),
            required: true,
            vram_mb: quant.min_vram_mb,
            filename: Some(quant.filename.clone()),
            hf_repo: Some(quant.hf_repo.clone()),
            hf_file: Some(quant.hf_file.clone()),
            size_bytes: Some(quant.size_bytes),
            sha256: quant.sha256.clone(),
        };
        push_unique(
            out,
            requirement_from_model(applet_id, engine_type, &manifest_req),
        );
    }
}

fn requirement_from_model(
    applet_id: &str,
    engine_type: &str,
    model: &ManifestModelRequirement,
) -> ModelRequirement {
    let filename = model.filename.as_deref().or(model.hf_file.as_deref());
    let accepted_formats = accepted_formats(filename, engine_type, &model.key);
    let preferred_quant = filename.and_then(infer_quant).map(str::to_string);
    let accepted_quants = preferred_quant
        .as_deref()
        .map(quant_ladder)
        .unwrap_or_default();
    let accepted_architectures = infer_architectures(applet_id, engine_type, &model.key, filename);
    let max_size_gb = model
        .size_bytes
        .map(|bytes| ((bytes as f64 / 1_073_741_824.0) * 1.2).max(1.0));

    ModelRequirement {
        everywear_model_id: model.key.clone(),
        applet_id: applet_id.to_string(),
        accepted_formats,
        accepted_architectures,
        preferred_quant,
        accepted_quants,
        min_layers: None,
        max_size_gb,
        min_context_length: (engine_type == "llm").then_some(4096),
        exact_filename_match: filename.map(str::to_string),
        filename_patterns: filename_patterns(&model.key, filename),
        hf_repo: model.hf_repo.clone(),
        hf_file: model.hf_file.clone(),
        size_bytes: model.size_bytes,
        sha256: model.sha256.clone(),
    }
}

fn apply_known_applet_overrides(applet_id: &str, requirements: &mut Vec<ModelRequirement>) {
    let known = match applet_id {
        "kasai" => kasai_requirements(),
        "1magen" => onemagen_requirements(),
        "3nvizen" => threevizen_requirements(),
        "gener8" => gener8_requirements(),
        _ => Vec::new(),
    };

    for req in known {
        if let Some(existing) = requirements
            .iter_mut()
            .find(|existing| existing.everywear_model_id == req.everywear_model_id)
        {
            *existing = merge_requirement(existing.clone(), req);
        } else {
            requirements.push(req);
        }
    }
}

fn merge_requirement(mut manifest: ModelRequirement, known: ModelRequirement) -> ModelRequirement {
    if manifest.accepted_architectures.is_empty() {
        manifest.accepted_architectures = known.accepted_architectures;
    }
    if manifest.filename_patterns.is_empty() {
        manifest.filename_patterns = known.filename_patterns;
    }
    if manifest.preferred_quant.is_none() {
        manifest.preferred_quant = known.preferred_quant;
    }
    if manifest.accepted_quants.is_empty() {
        manifest.accepted_quants = known.accepted_quants;
    }
    if manifest.exact_filename_match.is_none() {
        manifest.exact_filename_match = known.exact_filename_match;
    }
    if manifest.hf_repo.is_none() {
        manifest.hf_repo = known.hf_repo;
    }
    if manifest.hf_file.is_none() {
        manifest.hf_file = known.hf_file;
    }
    if manifest.size_bytes.is_none() {
        manifest.size_bytes = known.size_bytes;
    }
    if manifest.sha256.is_none() {
        manifest.sha256 = known.sha256;
    }
    manifest
}

fn push_unique(out: &mut Vec<ModelRequirement>, req: ModelRequirement) {
    if !out
        .iter()
        .any(|existing| existing.everywear_model_id == req.everywear_model_id)
    {
        out.push(req);
    }
}

fn accepted_formats(filename: Option<&str>, engine_type: &str, key: &str) -> Vec<ModelFormat> {
    let lower = filename.unwrap_or(key).to_ascii_lowercase();
    if lower.ends_with(".gguf") || engine_type == "llm" || engine_type == "audio" {
        vec![ModelFormat::GGUF]
    } else if lower.ends_with(".safetensors") || key.contains("z-image") || key.contains("ltx") {
        vec![ModelFormat::Safetensors]
    } else if lower.ends_with(".ckpt") {
        vec![ModelFormat::CKPT]
    } else {
        vec![
            ModelFormat::GGUF,
            ModelFormat::Safetensors,
            ModelFormat::CKPT,
        ]
    }
}

fn infer_architectures(
    applet_id: &str,
    engine_type: &str,
    key: &str,
    filename: Option<&str>,
) -> Vec<String> {
    let haystack = format!("{} {}", key, filename.unwrap_or("")).to_ascii_lowercase();
    if haystack.contains("qwen3") {
        vec!["qwen3".into(), "qwen2.5".into(), "qwen2".into()]
    } else if haystack.contains("qwen") {
        vec!["qwen2.5".into(), "qwen2".into(), "qwen3".into()]
    } else if haystack.contains("nemotron") {
        vec!["nemotron".into(), "llama".into()]
    } else if haystack.contains("acestep") || applet_id == "gener8" || engine_type == "audio" {
        vec!["ace-step".into()]
    } else if haystack.contains("z-image") || applet_id == "1magen" {
        vec!["z-image".into(), "sdxl".into(), "sd15".into()]
    } else if haystack.contains("ltx") || applet_id == "3nvizen" {
        vec!["ltx-video".into(), "ltx".into()]
    } else if haystack.contains("gemma") {
        vec!["gemma".into()]
    } else {
        Vec::new()
    }
}

fn filename_patterns(key: &str, filename: Option<&str>) -> Vec<String> {
    let mut patterns = Vec::new();
    if let Some(filename) = filename {
        patterns.push(strip_quant_and_extension(filename).to_string());
        patterns.push(filename.to_string());
    }
    patterns.push(key.replace('-', " "));
    patterns.push(key.to_string());
    patterns
}

fn strip_quant_and_extension(filename: &str) -> &str {
    let without_ext = filename
        .strip_suffix(".gguf")
        .or_else(|| filename.strip_suffix(".safetensors"))
        .or_else(|| filename.strip_suffix(".ckpt"))
        .unwrap_or(filename);
    for quant in [
        "-Q8_0", "-Q6_K", "-Q5_K_M", "-Q4_K_M", "-Q4_0", "_Q8_0", "_Q6_K", "_Q5_K_M", "_Q4_K_M",
        "_Q4_0",
    ] {
        if let Some(prefix) = without_ext.strip_suffix(quant) {
            return prefix;
        }
    }
    without_ext
}

fn infer_quant(filename: &str) -> Option<&'static str> {
    let lower = filename.to_ascii_lowercase();
    [
        ("q8_0", "Q8_0"),
        ("q6_k", "Q6_K"),
        ("q5_k_m", "Q5_K_M"),
        ("q4_k_m", "Q4_K_M"),
        ("q4_0", "Q4_0"),
        ("bf16", "BF16"),
        ("f16", "F16"),
    ]
    .into_iter()
    .find_map(|(needle, quant)| lower.contains(needle).then_some(quant))
}

fn quant_ladder(preferred: &str) -> Vec<String> {
    let mut values = vec![preferred.to_string()];
    for quant in ["Q4_K_M", "Q4_0", "Q5_K_M", "Q6_K", "Q8_0", "BF16", "F16"] {
        if !values.iter().any(|value| value == quant) {
            values.push(quant.into());
        }
    }
    values
}

fn gguf_requirement(
    applet_id: &str,
    id: &str,
    filename: &str,
    hf_repo: &str,
    hf_file: &str,
    size_bytes: u64,
    max_size_gb: f64,
    preferred_quant: &str,
    accepted_quants: Vec<&str>,
    accepted_architectures: Vec<&str>,
) -> ModelRequirement {
    ModelRequirement {
        everywear_model_id: id.into(),
        applet_id: applet_id.into(),
        accepted_formats: vec![ModelFormat::GGUF],
        accepted_architectures: accepted_architectures
            .into_iter()
            .map(str::to_string)
            .collect(),
        preferred_quant: Some(preferred_quant.into()),
        accepted_quants: accepted_quants.into_iter().map(str::to_string).collect(),
        min_layers: None,
        max_size_gb: Some(max_size_gb),
        min_context_length: Some(4096),
        exact_filename_match: Some(filename.into()),
        filename_patterns: filename_patterns(id, Some(filename)),
        hf_repo: (!hf_repo.is_empty()).then(|| hf_repo.into()),
        hf_file: (!hf_file.is_empty()).then(|| hf_file.into()),
        size_bytes: Some(size_bytes),
        sha256: None,
    }
}

fn tensor_requirement(
    applet_id: &str,
    id: &str,
    architectures: Vec<&str>,
    patterns: Vec<&str>,
    max_size_gb: Option<f64>,
) -> ModelRequirement {
    ModelRequirement {
        everywear_model_id: id.into(),
        applet_id: applet_id.into(),
        accepted_formats: vec![ModelFormat::Safetensors, ModelFormat::CKPT],
        accepted_architectures: architectures.into_iter().map(str::to_string).collect(),
        preferred_quant: None,
        accepted_quants: vec![],
        min_layers: None,
        max_size_gb,
        min_context_length: None,
        exact_filename_match: None,
        filename_patterns: patterns.into_iter().map(str::to_string).collect(),
        hf_repo: None,
        hf_file: None,
        size_bytes: None,
        sha256: None,
    }
}

fn tensor_exact(
    applet_id: &str,
    id: &str,
    filename: &str,
    architectures: Vec<&str>,
    max_size_gb: Option<f64>,
) -> ModelRequirement {
    let mut req = tensor_requirement(
        applet_id,
        id,
        architectures,
        vec![strip_quant_and_extension(filename), filename],
        max_size_gb,
    );
    req.exact_filename_match = Some(filename.into());
    req
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn predefined_requirements_cover_model_applets() {
        let reqs = known_requirements();
        for applet in ["kasai", "1magen", "3nvizen", "gener8"] {
            assert!(reqs.iter().any(|req| req.applet_id == applet), "{applet}");
        }
    }

    #[test]
    fn kasai_qwen_fallback_aliases_are_present() {
        let req = kasai_requirements()
            .into_iter()
            .find(|req| req.everywear_model_id == "kasai-lite-qwen3-4b-q4km")
            .unwrap();
        assert!(req.accepted_architectures.contains(&"qwen2.5".to_string()));
        assert_eq!(req.preferred_quant.as_deref(), Some("Q4_K_M"));
    }

    #[test]
    fn manifest_requirements_include_upgrade_packs() {
        let toml = r#"
[applet]
id = "gener8"
name = "Gener8"
version = "0.1.0"
description = "x"
icon = "x"
transport = "ipc"

[engine]
type = "audio"
backend = "server"
server_binary = "ace-server"

[[model_groups]]
label = "Base"
min_vram_mb = 6144
[[model_groups.models]]
key = "acestep-turbo-q4km"
role = "Primary"
required = true
vram_mb = 3072
filename = "acestep-v15-xl-turbo-Q4_K_M.gguf"
hf_repo = "repo"
hf_file = "file.gguf"
size_bytes = 2500000000

[upgrade_packs.better_models]
label = "Better"
min_tier = "gener8_pro"
status = "active"
[[upgrade_packs.better_models.quants]]
quant = "Q5_K_M"
min_vram_mb = 8192
key = "acestep-base-q5km"
role = "Primary"
filename = "acestep-v15-xl-base-Q5_K_M.gguf"
hf_repo = "repo"
hf_file = "remote.gguf"
size_bytes = 3530000000
"#;
        let manifest: AppletManifest = toml::from_str(toml).unwrap();
        let reqs = build_requirements_from_manifest("gener8", &manifest);
        assert!(reqs
            .iter()
            .any(|req| req.everywear_model_id == "acestep-base-q5km"));
    }
}
