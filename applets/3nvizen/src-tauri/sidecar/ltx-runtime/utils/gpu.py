from __future__ import annotations

import subprocess

from config import GpuInfo


def detect_gpu() -> GpuInfo:
    torch_info = _detect_with_torch()
    if torch_info.cuda_available:
        return torch_info
    return _detect_with_nvidia_smi() or torch_info


def _detect_with_torch() -> GpuInfo:
    try:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
        if not cuda_available:
            return GpuInfo(cuda_available=False)
        index = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(index)
        free_bytes, total_bytes = torch.cuda.mem_get_info(index)
        version = getattr(torch.version, "cuda", None)
        return GpuInfo(
            gpu_name=props.name,
            vram_total_gb=total_bytes / (1024**3),
            vram_free_gb=free_bytes / (1024**3),
            cuda_available=True,
            cuda_version=version,
        )
    except Exception:
        return GpuInfo(cuda_available=False)


def _detect_with_nvidia_smi() -> GpuInfo | None:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=4,
            check=True,
        )
    except Exception:
        return None

    first_line = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    if not first_line:
        return None
    parts = [part.strip() for part in first_line.split(",")]
    if len(parts) < 3:
        return None
    total_mb = float(parts[1])
    free_mb = float(parts[2])
    driver = parts[3] if len(parts) > 3 else None
    return GpuInfo(
        gpu_name=parts[0],
        vram_total_gb=total_mb / 1024,
        vram_free_gb=free_mb / 1024,
        cuda_available=True,
        cuda_version=driver,
    )
