//! VRAM tier classification and llama.cpp optimization flags.
//!
//! Shared across the Everywear shell and all applets that need
//! hardware-aware model loading. Extracted from the shell's gpu.rs
//! so applets can import without depending on the platform crate.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// VramTier
// ---------------------------------------------------------------------------

/// VRAM tier determines model selection and flag configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VramTier {
    /// 24+ GB: RTX 3090, 4090, 5090, A6000, etc.
    Ultra,
    /// 16-23 GB: RTX 4060 Ti 16GB, RTX 4080, RTX 5060, RTX 5070, etc.
    Standard,
    /// 12-15 GB: RTX 3060 12GB, RTX 4070, etc.
    Constrained,
    /// 8-11 GB: RTX 3060 8GB, RTX 3070, RTX 2080, GTX 1080, etc.
    Minimal,
    /// <8 GB: GTX 1060 6GB, integrated graphics, CPU-only.
    CpuFallback,
}

impl VramTier {
    pub fn from_vram_mb(mb: u32) -> Self {
        match mb {
            0..=7999 => Self::CpuFallback,
            8000..=11999 => Self::Minimal,
            12000..=15999 => Self::Constrained,
            16000..=23999 => Self::Standard,
            _ => Self::Ultra,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Ultra => "Ultra (24GB+)",
            Self::Standard => "Standard (16GB)",
            Self::Constrained => "Constrained (12GB)",
            Self::Minimal => "Minimal (8GB)",
            Self::CpuFallback => "CPU Fallback (<8GB)",
        }
    }
}

// ---------------------------------------------------------------------------
// LlamaFlags: Five Flags optimization profiles
// ---------------------------------------------------------------------------

/// Complete set of llama.cpp optimization flags for a given hardware profile.
///
/// The "Five Flags" (Codacus-derived) transform baseline inference speed
/// dramatically on consumer hardware:
///
///   Flag 1: n_cpu_moe     Pin MoE expert blocks to CPU RAM, keep routing on GPU
///   Flag 2: no_mmap       Preload entire model to RAM, eliminate disk page faults
///   Flag 3: n_gpu_layers  GPU layer count tuning (balance VRAM vs speed)
///   Flag 4: TurboQuant    Q4 keys / Q3 values for KV cache (4x context expansion)
///   Flag 5: mlock         Lock model memory, prevent kernel paging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamaFlags {
    /// Number of MoE expert layers to offload to CPU.
    /// Only applies to Mixture of Experts models (e.g. Qwen 3.6 35B-A3B).
    pub n_cpu_moe: Option<u32>,

    /// Number of layers to offload to GPU.
    pub n_gpu_layers: u32,

    /// Disable memory-mapped model loading. Forces full preload into RAM.
    pub no_mmap: bool,

    /// Lock model memory to prevent kernel paging.
    pub mlock: bool,

    /// TurboQuant key quantization bits (None = disabled).
    pub turbo_quant_kv_key_bits: Option<u8>,

    /// TurboQuant value quantization bits (None = disabled).
    pub turbo_quant_kv_val_bits: Option<u8>,

    /// Context window size in tokens.
    pub context_size: u32,

    /// Number of threads for CPU inference.
    pub n_threads: Option<u32>,

    /// Batch size for prompt processing.
    pub n_batch: u32,

    /// Flash attention (if supported by model architecture).
    pub flash_attention: bool,
}

impl LlamaFlags {
    /// Build optimized flags for a MoE model (e.g. Qwen 3.6 35B-A3B).
    /// All five flags apply.
    pub fn for_moe_model(tier: &VramTier) -> Self {
        match tier {
            VramTier::Ultra => Self {
                n_cpu_moe: Some(0),
                n_gpu_layers: 999,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 256_000,
                n_threads: None,
                n_batch: 4096,
                flash_attention: true,
            },
            VramTier::Standard => Self {
                n_cpu_moe: Some(12),
                n_gpu_layers: 48,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 256_000,
                n_threads: None,
                n_batch: 1024,
                flash_attention: true,
            },
            VramTier::Constrained => Self {
                n_cpu_moe: Some(28),
                n_gpu_layers: 32,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 128_000,
                n_threads: None,
                n_batch: 512,
                flash_attention: true,
            },
            VramTier::Minimal => Self {
                n_cpu_moe: Some(35),
                n_gpu_layers: 20,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 64_000,
                n_threads: None,
                n_batch: 256,
                flash_attention: true,
            },
            VramTier::CpuFallback => Self {
                n_cpu_moe: Some(41),
                n_gpu_layers: 8,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 32_000,
                n_threads: None,
                n_batch: 128,
                flash_attention: false,
            },
        }
    }

    /// Build flags for a dense (non-MoE) model.
    /// No MoE flags needed. Dense models fit fully on GPU for most tiers.
    pub fn for_dense_model(tier: &VramTier) -> Self {
        match tier {
            VramTier::Ultra => Self {
                n_cpu_moe: None,
                n_gpu_layers: 999,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 128_000,
                n_threads: None,
                n_batch: 2048,
                flash_attention: true,
            },
            VramTier::Standard => Self {
                n_cpu_moe: None,
                n_gpu_layers: 999,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 128_000,
                n_threads: None,
                n_batch: 1024,
                flash_attention: true,
            },
            VramTier::Constrained => Self {
                n_cpu_moe: None,
                n_gpu_layers: 999,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 64_000,
                n_threads: None,
                n_batch: 512,
                flash_attention: true,
            },
            VramTier::Minimal => Self {
                n_cpu_moe: None,
                n_gpu_layers: 999,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 32_000,
                n_threads: None,
                n_batch: 512,
                flash_attention: true,
            },
            VramTier::CpuFallback => Self {
                n_cpu_moe: None,
                n_gpu_layers: 8,
                no_mmap: true,
                mlock: true,
                turbo_quant_kv_key_bits: Some(4),
                turbo_quant_kv_val_bits: Some(3),
                context_size: 16_000,
                n_threads: None,
                n_batch: 128,
                flash_attention: false,
            },
        }
    }

    /// Convert to llama.cpp CLI argument vector.
    /// Used when spawning llama-server as a child process (fallback mode).
    pub fn to_cli_args(&self) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(moe) = self.n_cpu_moe {
            args.extend_from_slice(&["--n-cpu-moe".into(), moe.to_string()]);
        }

        args.extend_from_slice(&["--ngl".into(), self.n_gpu_layers.to_string()]);

        if self.no_mmap {
            args.push("--no-mmap".into());
        }

        if self.mlock {
            args.push("--mlock".into());
        }

        if let Some(kbits) = self.turbo_quant_kv_key_bits {
            args.extend_from_slice(&["--cache-type-k".into(), format!("q{kbits}_0")]);
        }
        if let Some(vbits) = self.turbo_quant_kv_val_bits {
            args.extend_from_slice(&["--cache-type-v".into(), format!("q{vbits}_0")]);
        }

        args.extend_from_slice(&[
            "--ctx-size".into(),
            self.context_size.to_string(),
            "--batch-size".into(),
            self.n_batch.to_string(),
        ]);

        if let Some(threads) = self.n_threads {
            args.extend_from_slice(&["--threads".into(), threads.to_string()]);
        }

        if self.flash_attention {
            args.push("--flash-attn".into());
        }

        args
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vram_tier_classification() {
        assert_eq!(VramTier::from_vram_mb(32768), VramTier::Ultra);
        assert_eq!(VramTier::from_vram_mb(24576), VramTier::Ultra);
        assert_eq!(VramTier::from_vram_mb(16384), VramTier::Standard);
        assert_eq!(VramTier::from_vram_mb(12288), VramTier::Constrained);
        assert_eq!(VramTier::from_vram_mb(8192), VramTier::Minimal);
        assert_eq!(VramTier::from_vram_mb(6144), VramTier::CpuFallback);
    }

    #[test]
    fn moe_standard_has_all_five_flags() {
        let flags = LlamaFlags::for_moe_model(&VramTier::Standard);
        assert!(flags.n_cpu_moe.is_some(), "Flag 1: MoE offloading");
        assert!(flags.no_mmap, "Flag 2: no-mmap");
        assert!(flags.n_gpu_layers > 0, "Flag 3: GPU layers");
        assert!(
            flags.turbo_quant_kv_key_bits.is_some(),
            "Flag 4: TurboQuant"
        );
        assert!(flags.mlock, "Flag 5: mlock");
    }

    #[test]
    fn dense_model_no_moe_flags() {
        let flags = LlamaFlags::for_dense_model(&VramTier::Standard);
        assert!(flags.n_cpu_moe.is_none(), "Dense models have no MoE flag");
        assert!(flags.no_mmap, "Flag 2 still applies");
    }

    #[test]
    fn cli_args_well_formed() {
        let flags = LlamaFlags::for_moe_model(&VramTier::Standard);
        let args = flags.to_cli_args();
        assert!(args.contains(&"--n-cpu-moe".to_string()));
        assert!(args.contains(&"--no-mmap".to_string()));
        assert!(args.contains(&"--mlock".to_string()));
    }

    #[test]
    fn cli_args_dense_no_moe() {
        let flags = LlamaFlags::for_dense_model(&VramTier::Standard);
        let args = flags.to_cli_args();
        assert!(!args.contains(&"--n-cpu-moe".to_string()));
    }
}
