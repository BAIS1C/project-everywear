//! GPU & Compute Backend Detection
//!
//! Three-tier GPU detection (ported from Kasai-Local) that determines which
//! inference backend applets should use:
//!   1. CUDA (NVIDIA GPUs) -- cuBLAS + cudart, bundled or system
//!   2. Vulkan (AMD, Intel, NVIDIA fallback) -- ships with GPU driver
//!   3. CPU (no GPU / unsupported) -- OpenBLAS bundled
//!
//! Also provides live VRAM monitoring for the shell's Hardware panel.

use anyhow::{Context, Result};
use nvml_wrapper::Nvml;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tracing::{info, warn};

fn command_no_window(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

// ---------------------------------------------------------------------------
// Compute Backend Types (from Kasai-Local compute_backend.rs)
// ---------------------------------------------------------------------------

/// GPU vendor classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GpuVendor {
    Nvidia,
    Amd,
    Intel,
    Apple,
    Unknown,
    None,
}

/// CUDA runtime status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CudaStatus {
    /// CUDA driver version reported by NVML (e.g. "12.8")
    pub driver_version: String,
    /// CUDA runtime version if toolkit is installed system-wide
    pub toolkit_version: Option<String>,
    /// Whether cuBLAS is available (bundled or system)
    pub cublas_available: bool,
    /// Path to cuBLAS library (bundled takes priority over system)
    pub cublas_path: Option<PathBuf>,
    /// Minimum compute capability of detected GPU
    pub compute_capability: Option<(u32, u32)>,
}

/// Vulkan runtime status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VulkanStatus {
    /// Vulkan API version supported
    pub api_version: Option<String>,
    /// Device name from Vulkan
    pub device_name: String,
    /// Device VRAM in MB (from Vulkan memory heaps)
    pub vram_mb: u32,
}

/// The selected compute backend with all runtime details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ComputeBackend {
    /// NVIDIA CUDA path: cuBLAS acceleration, MoE offloading, flash attention.
    Cuda {
        device_name: String,
        vram_mb: u32,
        cuda: CudaStatus,
        /// Whether runtime needs provisioning (download cuBLAS DLLs)
        needs_provisioning: bool,
    },

    /// Vulkan path: cross-vendor GPU acceleration.
    Vulkan {
        device_name: String,
        vram_mb: u32,
        vulkan: VulkanStatus,
    },

    /// CPU-only path: no GPU acceleration.
    Cpu { has_blas: bool, ram_mb: u64 },
}

impl ComputeBackend {
    pub fn device_name(&self) -> &str {
        match self {
            Self::Cuda { device_name, .. } => device_name,
            Self::Vulkan { device_name, .. } => device_name,
            Self::Cpu { .. } => "CPU",
        }
    }

    pub fn vram_mb(&self) -> u32 {
        match self {
            Self::Cuda { vram_mb, .. } => *vram_mb,
            Self::Vulkan { vram_mb, .. } => *vram_mb,
            Self::Cpu { .. } => 0,
        }
    }

    pub fn supports_moe_offload(&self) -> bool {
        !matches!(self, Self::Cpu { .. })
    }

    pub fn supports_flash_attention(&self) -> bool {
        matches!(self, Self::Cuda { cuda, .. } if cuda.compute_capability
            .map(|(major, _)| major >= 7) // Volta+ (SM 7.0+)
            .unwrap_or(false)
        )
    }

    pub fn needs_provisioning(&self) -> bool {
        matches!(
            self,
            Self::Cuda {
                needs_provisioning: true,
                ..
            }
        )
    }

    pub fn vendor(&self) -> GpuVendor {
        match self {
            Self::Cuda { .. } => GpuVendor::Nvidia,
            Self::Vulkan { device_name, .. } => {
                let lower = device_name.to_lowercase();
                if lower.contains("nvidia")
                    || lower.contains("geforce")
                    || lower.contains("rtx")
                    || lower.contains("gtx")
                {
                    GpuVendor::Nvidia
                } else if lower.contains("amd") || lower.contains("radeon") {
                    GpuVendor::Amd
                } else if lower.contains("intel") || lower.contains("arc") {
                    GpuVendor::Intel
                } else if lower.contains("apple") {
                    GpuVendor::Apple
                } else {
                    GpuVendor::Unknown
                }
            }
            Self::Cpu { .. } => GpuVendor::None,
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Cuda {
                device_name,
                vram_mb,
                cuda,
                ..
            } => {
                format!(
                    "CUDA {} | {} | {}MB VRAM",
                    cuda.driver_version, device_name, vram_mb
                )
            }
            Self::Vulkan {
                device_name,
                vram_mb,
                ..
            } => {
                format!("Vulkan | {} | {}MB VRAM", device_name, vram_mb)
            }
            Self::Cpu { ram_mb, has_blas } => {
                let blas = if *has_blas { " + OpenBLAS" } else { "" };
                format!("CPU{blas} | {}MB RAM", ram_mb)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// VRAM Tier: re-exported from model-manager (shared crate)
// ---------------------------------------------------------------------------

pub use model_manager::VramTier;

// ---------------------------------------------------------------------------
// CUDA Compatibility Matrix
// ---------------------------------------------------------------------------

/// Minimum CUDA compute capability we support.
/// SM 5.0 = Maxwell (GTX 750 Ti and up, 2014+)
pub const MIN_COMPUTE_CAPABILITY: (u32, u32) = (5, 0);

pub fn is_compute_capability_supported(major: u32, minor: u32) -> bool {
    (major, minor) >= MIN_COMPUTE_CAPABILITY
}

/// Get the recommended cuBLAS version for a given CUDA driver version.
pub fn recommended_cublas_version(driver_version: &str) -> &'static str {
    let major: u32 = driver_version
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    match major {
        545.. => "12.8",
        535.. => "12.4",
        525.. => "12.0",
        520.. => "11.8",
        _ => "11.8",
    }
}

// ---------------------------------------------------------------------------
// Live VRAM Monitoring (per-GPU detail for the Hardware panel)
// ---------------------------------------------------------------------------

/// Per-GPU info with live utilization data for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub vram_total_mb: u64,
    pub vram_used_mb: u64,
    pub vram_free_mb: u64,
    pub utilization_gpu: u32,
    pub utilization_memory: u32,
    pub temperature_c: u32,
    pub driver_version: String,
    pub cuda_version: String,
    pub compute_capability: String,
}

/// Aggregate GPU state for the shell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemGpuState {
    pub gpus: Vec<GpuInfo>,
    pub nvml_available: bool,
    pub total_vram_mb: u64,
    pub total_free_mb: u64,
    pub primary_gpu: Option<String>,
    /// The compute backend selected by three-tier detection.
    pub backend: ComputeBackend,
    /// VRAM tier classification.
    pub vram_tier: VramTier,
}

// ---------------------------------------------------------------------------
// Compute Backend Detection (ported from Kasai-Local)
// ---------------------------------------------------------------------------

/// Detect the best available compute backend.
///
/// Priority: CUDA (NVML + nvidia-smi) > Vulkan (vulkaninfo) > CPU.
pub fn detect_compute_backend(app_runtime_dir: &std::path::Path) -> ComputeBackend {
    info!("Detecting compute backend...");

    if let Some(backend) = try_cuda(app_runtime_dir) {
        info!("Selected backend: {}", backend.label());
        return backend;
    }

    if let Some(backend) = try_vulkan() {
        info!("Selected backend: {}", backend.label());
        return backend;
    }

    let ram_mb = system_ram_mb();
    let has_blas = check_openblas_available(app_runtime_dir);
    let backend = ComputeBackend::Cpu { has_blas, ram_mb };
    info!("Selected backend: {}", backend.label());
    backend
}

/// Attempt CUDA backend detection.
fn try_cuda(app_runtime_dir: &std::path::Path) -> Option<ComputeBackend> {
    // Strategy 1: NVML (direct library binding, most reliable)
    if let Ok(backend) = try_cuda_nvml(app_runtime_dir) {
        return Some(backend);
    }

    // Strategy 2: nvidia-smi CLI (works even if NVML library not loadable)
    if let Ok(backend) = try_cuda_nvidia_smi(app_runtime_dir) {
        return Some(backend);
    }

    None
}

fn try_cuda_nvml(app_runtime_dir: &std::path::Path) -> Result<ComputeBackend> {
    let nvml = Nvml::init().context("NVML init failed")?;
    let device = nvml.device_by_index(0).context("No GPU at index 0")?;

    let device_name = device
        .name()
        .unwrap_or_else(|_| "Unknown NVIDIA GPU".into());
    let memory = device.memory_info().context("Failed to read memory")?;
    let vram_mb = (memory.total / (1024 * 1024)) as u32;
    let compute_capability = device
        .cuda_compute_capability()
        .ok()
        .map(|cc| (cc.major as u32, cc.minor as u32));
    let driver_version = nvml
        .sys_driver_version()
        .unwrap_or_else(|_| "unknown".into());

    let (cublas_available, cublas_path) = find_cublas(app_runtime_dir);
    let needs_provisioning = !cublas_available;
    let toolkit_version = detect_cuda_toolkit_version();

    Ok(ComputeBackend::Cuda {
        device_name,
        vram_mb,
        cuda: CudaStatus {
            driver_version,
            toolkit_version,
            cublas_available,
            cublas_path,
            compute_capability,
        },
        needs_provisioning,
    })
}

fn try_cuda_nvidia_smi(app_runtime_dir: &std::path::Path) -> Result<ComputeBackend> {
    let mut cmd = command_no_window("nvidia-smi");
    let output = cmd
        .args([
            "--query-gpu=name,memory.total,driver_version,compute_cap",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .context("nvidia-smi not found")?;

    if !output.status.success() {
        anyhow::bail!("nvidia-smi failed");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().splitn(4, ',').map(|s| s.trim()).collect();

    if parts.len() < 3 {
        anyhow::bail!("Unexpected nvidia-smi output: {stdout}");
    }

    let device_name = parts[0].to_string();
    let vram_mb: u32 = parts[1].parse().unwrap_or(0);
    let driver_version = parts[2].to_string();
    let compute_capability = parts.get(3).and_then(|cc| {
        let cc_parts: Vec<&str> = cc.split('.').collect();
        if cc_parts.len() == 2 {
            Some((
                cc_parts[0].parse::<u32>().unwrap_or(0),
                cc_parts[1].parse::<u32>().unwrap_or(0),
            ))
        } else {
            None
        }
    });

    let (cublas_available, cublas_path) = find_cublas(app_runtime_dir);
    let toolkit_version = detect_cuda_toolkit_version();

    Ok(ComputeBackend::Cuda {
        device_name,
        vram_mb,
        cuda: CudaStatus {
            driver_version,
            toolkit_version,
            cublas_available,
            cublas_path,
            compute_capability,
        },
        needs_provisioning: !cublas_available,
    })
}

/// Look for cuBLAS library. Checks bundled location first, then system paths.
fn find_cublas(app_runtime_dir: &std::path::Path) -> (bool, Option<PathBuf>) {
    // Priority 1: Bundled with the app (app_runtime_dir/cuda/)
    let bundled_paths = if cfg!(target_os = "windows") {
        vec![
            app_runtime_dir.join("cuda").join("cublas64_12.dll"),
            app_runtime_dir.join("cuda").join("cublasLt64_12.dll"),
        ]
    } else {
        vec![
            app_runtime_dir.join("cuda").join("libcublas.so.12"),
            app_runtime_dir.join("cuda").join("libcublasLt.so.12"),
        ]
    };

    let bundled_dir = app_runtime_dir.join("cuda");
    if bundled_paths.iter().all(|p| p.exists()) {
        info!("cuBLAS found bundled at {}", bundled_dir.display());
        return (true, Some(bundled_dir));
    }

    // Priority 2: System CUDA installation
    let system_paths = if cfg!(target_os = "windows") {
        let mut paths = Vec::new();
        if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
            paths.push(PathBuf::from(&cuda_path).join("bin"));
        }
        for version in &["12.8", "12.6", "12.4", "12.2", "12.1", "12.0", "11.8"] {
            paths.push(PathBuf::from(format!(
                r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v{version}\bin"
            )));
        }
        paths
    } else {
        vec![
            PathBuf::from("/usr/local/cuda/lib64"),
            PathBuf::from("/usr/lib/x86_64-linux-gnu"),
            PathBuf::from("/usr/lib64"),
        ]
    };

    let cublas_name = if cfg!(target_os = "windows") {
        "cublas64_12.dll"
    } else {
        "libcublas.so.12"
    };

    for dir in &system_paths {
        let cublas = dir.join(cublas_name);
        if cublas.exists() {
            info!("cuBLAS found at system path: {}", dir.display());
            return (true, Some(dir.clone()));
        }
    }

    warn!("cuBLAS not found in bundled or system paths");
    (false, None)
}

/// Detect system-installed CUDA toolkit version via nvcc.
fn detect_cuda_toolkit_version() -> Option<String> {
    let mut cmd = command_no_window("nvcc");
    let output = cmd.arg("--version").output().ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|line| line.contains("release"))
        .and_then(|line| {
            line.split("release ")
                .nth(1)
                .map(|v| v.split(',').next().unwrap_or(v).trim().to_string())
        })
}

/// Attempt Vulkan backend detection via vulkaninfo CLI.
fn try_vulkan() -> Option<ComputeBackend> {
    try_vulkan_cli().ok()
}

fn try_vulkan_cli() -> Result<ComputeBackend> {
    let mut cmd = command_no_window("vulkaninfo");
    let output = cmd
        .arg("--summary")
        .output()
        .context("vulkaninfo not found")?;

    if !output.status.success() {
        anyhow::bail!("vulkaninfo failed");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let device_name = stdout
        .lines()
        .find(|l| l.contains("deviceName"))
        .map(|l| {
            l.split('=')
                .last()
                .unwrap_or("Unknown GPU")
                .trim()
                .to_string()
        })
        .unwrap_or_else(|| "Unknown Vulkan GPU".into());

    let api_version = stdout
        .lines()
        .find(|l| l.contains("apiVersion"))
        .map(|l| l.split('=').last().unwrap_or("").trim().to_string());

    let vram_mb = stdout
        .lines()
        .find(|l| l.contains("DEVICE_LOCAL") || l.contains("size"))
        .and_then(|l| {
            l.split_whitespace()
                .filter_map(|w| {
                    w.trim_matches(|c: char| !c.is_ascii_digit())
                        .parse::<u64>()
                        .ok()
                })
                .find(|&v| v > 1_000_000)
                .map(|v| (v / (1024 * 1024)) as u32)
        })
        .unwrap_or(0);

    Ok(ComputeBackend::Vulkan {
        device_name: device_name.clone(),
        vram_mb,
        vulkan: VulkanStatus {
            api_version,
            device_name,
            vram_mb,
        },
    })
}

/// Check if OpenBLAS is available (bundled or system).
fn check_openblas_available(app_runtime_dir: &std::path::Path) -> bool {
    let bundled = if cfg!(target_os = "windows") {
        app_runtime_dir.join("blas").join("openblas.dll")
    } else {
        app_runtime_dir.join("blas").join("libopenblas.so")
    };

    if bundled.exists() {
        return true;
    }

    if cfg!(target_os = "linux") {
        PathBuf::from("/usr/lib/x86_64-linux-gnu/libopenblas.so").exists()
            || PathBuf::from("/usr/lib64/libopenblas.so").exists()
    } else {
        false
    }
}

/// Get system RAM in MB. Used for CPU fallback budget.
fn system_ram_mb() -> u64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = std::fs::read_to_string("/proc/meminfo") {
            for line in contents.lines() {
                if line.starts_with("MemTotal:") {
                    if let Some(kb) = line
                        .split_whitespace()
                        .nth(1)
                        .and_then(|s| s.parse::<u64>().ok())
                    {
                        return kb / 1024;
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = command_no_window("wmic");
        if let Ok(output) = cmd
            .args([
                "computersystem",
                "get",
                "TotalPhysicalMemory",
                "/format:value",
            ])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with("TotalPhysicalMemory=") {
                    if let Some(bytes) = line
                        .split('=')
                        .nth(1)
                        .and_then(|s| s.trim().parse::<u64>().ok())
                    {
                        return bytes / (1024 * 1024);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(bytes) = stdout.trim().parse::<u64>() {
                return bytes / (1024 * 1024);
            }
        }
    }

    16384 // Assume 16GB fallback
}

// ---------------------------------------------------------------------------
// Full System GPU State (NVML live monitoring + backend detection)
// ---------------------------------------------------------------------------

/// Detect all GPUs and compute the backend in one pass.
pub fn detect_gpus() -> SystemGpuState {
    // First, detect the compute backend (three-tier)
    let runtime_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("everywear-os")
        .join("runtime");
    let backend = detect_compute_backend(&runtime_dir);

    // Then get live per-GPU details via NVML for the UI
    match try_detect_live(&backend) {
        Ok(state) => state,
        Err(e) => {
            warn!(error = %e, "NVML live detection failed; using backend info only");
            // Build a minimal SystemGpuState from the backend
            let vram = backend.vram_mb();
            let vram_tier = VramTier::from_vram_mb(vram);
            SystemGpuState {
                gpus: if vram > 0 {
                    vec![GpuInfo {
                        index: 0,
                        name: backend.device_name().to_string(),
                        vram_total_mb: vram as u64,
                        vram_used_mb: 0,
                        vram_free_mb: vram as u64,
                        utilization_gpu: 0,
                        utilization_memory: 0,
                        temperature_c: 0,
                        driver_version: match &backend {
                            ComputeBackend::Cuda { cuda, .. } => cuda.driver_version.clone(),
                            _ => "N/A".into(),
                        },
                        cuda_version: "N/A".into(),
                        compute_capability: match &backend {
                            ComputeBackend::Cuda { cuda, .. } => cuda
                                .compute_capability
                                .map(|(maj, min)| format!("{maj}.{min}"))
                                .unwrap_or_else(|| "N/A".into()),
                            _ => "N/A".into(),
                        },
                    }]
                } else {
                    vec![]
                },
                nvml_available: false,
                total_vram_mb: vram as u64,
                total_free_mb: vram as u64,
                primary_gpu: if vram > 0 {
                    Some(backend.device_name().to_string())
                } else {
                    None
                },
                backend,
                vram_tier,
            }
        }
    }
}

/// Full NVML detection for per-GPU live data, enriched with backend info.
fn try_detect_live(backend: &ComputeBackend) -> Result<SystemGpuState> {
    let nvml = Nvml::init().context("Failed to initialize NVML")?;
    let driver = nvml
        .sys_driver_version()
        .unwrap_or_else(|_| "unknown".into());
    let cuda_ver = nvml
        .sys_cuda_driver_version()
        .map(|v| format!("{}.{}", v / 1000, (v % 1000) / 10))
        .unwrap_or_else(|_| "unknown".into());

    let count = nvml.device_count().context("Failed to get device count")?;
    let mut gpus = Vec::with_capacity(count as usize);

    for i in 0..count {
        let device = nvml.device_by_index(i)?;
        let name = device.name().unwrap_or_else(|_| format!("GPU {i}"));
        let mem = device.memory_info()?;
        let util = device
            .utilization_rates()
            .unwrap_or(nvml_wrapper::struct_wrappers::device::Utilization { gpu: 0, memory: 0 });
        let temp = device
            .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
            .unwrap_or(0);

        let cc = device
            .cuda_compute_capability()
            .unwrap_or(nvml_wrapper::structs::device::CudaComputeCapability { major: 0, minor: 0 });
        let (major, minor) = (cc.major, cc.minor);

        let gpu = GpuInfo {
            index: i,
            name: name.clone(),
            vram_total_mb: mem.total / (1024 * 1024),
            vram_used_mb: mem.used / (1024 * 1024),
            vram_free_mb: mem.free / (1024 * 1024),
            utilization_gpu: util.gpu,
            utilization_memory: util.memory,
            temperature_c: temp,
            driver_version: driver.clone(),
            cuda_version: cuda_ver.clone(),
            compute_capability: format!("{major}.{minor}"),
        };

        info!(
            gpu = %gpu.name,
            vram_total = gpu.vram_total_mb,
            vram_free = gpu.vram_free_mb,
            "Detected GPU"
        );
        gpus.push(gpu);
    }

    let total_vram: u64 = gpus.iter().map(|g| g.vram_total_mb).sum();
    let total_free: u64 = gpus.iter().map(|g| g.vram_free_mb).sum();
    let primary = gpus.first().map(|g| g.name.clone());
    let vram_tier = VramTier::from_vram_mb(total_vram as u32);

    Ok(SystemGpuState {
        gpus,
        nvml_available: true,
        total_vram_mb: total_vram,
        total_free_mb: total_free,
        primary_gpu: primary,
        backend: backend.clone(),
        vram_tier,
    })
}

/// Poll current VRAM usage for a specific GPU.
pub fn poll_vram(gpu_index: u32) -> Option<(u64, u64)> {
    let nvml = Nvml::init().ok()?;
    let device = nvml.device_by_index(gpu_index).ok()?;
    let mem = device.memory_info().ok()?;
    Some((mem.used / (1024 * 1024), mem.free / (1024 * 1024)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_capability_check() {
        assert!(is_compute_capability_supported(8, 6)); // Ampere
        assert!(is_compute_capability_supported(7, 5)); // Turing
        assert!(is_compute_capability_supported(6, 1)); // Pascal (GTX 1060)
        assert!(is_compute_capability_supported(5, 0)); // Maxwell
        assert!(!is_compute_capability_supported(3, 5)); // Kepler (too old)
    }

    #[test]
    fn cublas_version_mapping() {
        assert_eq!(recommended_cublas_version("550.54"), "12.8");
        assert_eq!(recommended_cublas_version("535.183"), "12.4");
        assert_eq!(recommended_cublas_version("525.105"), "12.0");
    }

    #[test]
    fn backend_properties() {
        let cuda = ComputeBackend::Cuda {
            device_name: "RTX 5090".into(),
            vram_mb: 32768,
            cuda: CudaStatus {
                driver_version: "550.54".into(),
                toolkit_version: None,
                cublas_available: true,
                cublas_path: Some("/app/cuda".into()),
                compute_capability: Some((12, 0)),
            },
            needs_provisioning: false,
        };

        assert_eq!(cuda.vram_mb(), 32768);
        assert!(cuda.supports_moe_offload());
        assert!(cuda.supports_flash_attention());
        assert!(!cuda.needs_provisioning());
        assert_eq!(cuda.vendor(), GpuVendor::Nvidia);
    }

    #[test]
    fn cpu_fallback_properties() {
        let cpu = ComputeBackend::Cpu {
            has_blas: true,
            ram_mb: 32768,
        };
        assert_eq!(cpu.vram_mb(), 0);
        assert!(!cpu.supports_moe_offload());
        assert!(!cpu.supports_flash_attention());
        assert_eq!(cpu.vendor(), GpuVendor::None);
    }

    #[test]
    fn vram_tier_classification() {
        assert_eq!(VramTier::from_vram_mb(32768), VramTier::Ultra);
        assert_eq!(VramTier::from_vram_mb(24576), VramTier::Ultra);
        assert_eq!(VramTier::from_vram_mb(16384), VramTier::Standard);
        assert_eq!(VramTier::from_vram_mb(12288), VramTier::Constrained);
        assert_eq!(VramTier::from_vram_mb(8192), VramTier::Minimal);
        assert_eq!(VramTier::from_vram_mb(6144), VramTier::CpuFallback);
    }
}
