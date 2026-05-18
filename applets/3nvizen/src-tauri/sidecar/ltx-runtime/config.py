from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
SERVICES_MANIFEST = ROOT_DIR / "services.json"

LTX_BACKEND_PATH = Path(
    os.environ.get(
        "THREENVIZEN_LTX_BACKEND_PATH",
        r"G:\LTX\LTX Desktop\resources\backend",
    )
)

MODEL_DIR = Path(os.environ.get("THREENVIZEN_MODEL_DIR", "~/.everywear/models/3nvizen")).expanduser()
OUTPUT_DIR = Path(os.environ.get("THREENVIZEN_OUTPUT_DIR", "~/.everywear/data/3nvizen/output")).expanduser()
CACHE_DIR = Path(os.environ.get("THREENVIZEN_CACHE_DIR", "~/.everywear/data/3nvizen/cache")).expanduser()

FORCE_API_MODE_VRAM_GB = 31
LOCAL_ATTEMPT_VRAM_GB = 12

KNOWN_MODELS: dict[str, dict[str, Any]] = {
    "ltx-2.3-22b-distilled": {
        "repo_id": "Lightricks/LTX-Video",
        "size_gb": 43,
        "filename": "ltx-2.3-22b-distilled.safetensors",
        "min_vram_gb": 12,
        "type": "video_generator",
    },
    "ltx-2.3-spatial-upscaler-x2-1.0": {
        "repo_id": "Lightricks/LTX-Video",
        "size_gb": 1.9,
        "filename": "ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
        "min_vram_gb": 4,
        "type": "upscaler",
    },
    "gemma-3-12b-it-qat-q4_0": {
        "repo_id": "google/gemma-3-12b-it-qat-q4_0",
        "size_gb": 25,
        "filename": "gemma-3-12b-it-q4_0-unquantized.safetensors",
        "min_vram_gb": 8,
        "type": "text_encoder",
    },
}


@dataclass
class GpuInfo:
    gpu_name: str = "Unknown GPU"
    vram_total_gb: float = 0.0
    vram_free_gb: float = 0.0
    cuda_available: bool = False
    cuda_version: str | None = None

    def as_frontend(self) -> dict[str, Any]:
        return {
            "gpu_name": self.gpu_name,
            "vram_total_gb": round(self.vram_total_gb, 2),
            "vram_free_gb": round(self.vram_free_gb, 2),
            "cuda_available": self.cuda_available,
            "cuda_version": self.cuda_version,
        }


gpu_info = GpuInfo()
runtime_mode = "api_fallback"
service_paths: dict[str, str] = {}


def ensure_dirs() -> None:
    for path in (MODEL_DIR, OUTPUT_DIR, CACHE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def load_service_manifest() -> dict[str, str]:
    if SERVICES_MANIFEST.exists():
        data = json.loads(SERVICES_MANIFEST.read_text(encoding="utf-8"))
        services = data.get("services", data)
        return {str(name): str(path) for name, path in services.items()}

    base = LTX_BACKEND_PATH / "services"
    return {
        "fast_video_pipeline": str(base / "fast_video_pipeline"),
        "a2v_pipeline": str(base / "a2v_pipeline"),
        "retake_pipeline": str(base / "retake_pipeline"),
        "ic_lora_pipeline": str(base / "ic_lora_pipeline"),
    }


def add_ltx_backend_to_path() -> None:
    if LTX_BACKEND_PATH.exists():
        backend = str(LTX_BACKEND_PATH)
        if backend not in sys.path:
            sys.path.insert(0, backend)


def configure_runtime(detected_gpu: GpuInfo) -> None:
    global gpu_info, runtime_mode, service_paths
    gpu_info = detected_gpu
    runtime_mode = "local" if detected_gpu.cuda_available and detected_gpu.vram_total_gb >= LOCAL_ATTEMPT_VRAM_GB else "api_fallback"
    service_paths = load_service_manifest()
    ensure_dirs()
    add_ltx_backend_to_path()


def snapshot() -> dict[str, Any]:
    return {
        "runtime_mode": runtime_mode,
        "gpu_info": asdict(gpu_info),
        "model_dir": str(MODEL_DIR),
        "output_dir": str(OUTPUT_DIR),
        "cache_dir": str(CACHE_DIR),
        "ltx_backend_path": str(LTX_BACKEND_PATH),
        "services": service_paths,
    }
