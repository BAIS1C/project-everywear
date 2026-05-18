from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from config import KNOWN_MODELS, MODEL_DIR
from adapter.progress import progress_tracker


def model_path(model_id: str) -> Path:
    return MODEL_DIR / str(KNOWN_MODELS[model_id]["filename"])


def get_models_status() -> dict[str, Any]:
    models: list[dict[str, Any]] = []
    for model_id, meta in KNOWN_MODELS.items():
        path = model_path(model_id)
        download = progress_tracker.downloads.get(model_id)
        if path.exists():
            status = "available"
            progress = 1.0
        elif download and download.get("status") == "downloading":
            status = "downloading"
            progress = float(download.get("progress") or 0.0)
        elif progress_tracker.loading_model == model_id:
            status = "loading"
            progress = float(download.get("progress") or 0.0) if download else 0.0
        else:
            status = "not_downloaded"
            progress = None
        entry = {
            "model_id": model_id,
            "status": status,
            "size_gb": meta["size_gb"],
        }
        if progress is not None:
            entry["download_progress"] = progress
        if path.exists():
            entry["path"] = str(path)
        models.append(entry)
    return {"models": models, "current_model": progress_tracker.loaded_model}


async def start_download(model_id: str) -> dict[str, Any]:
    if model_id not in KNOWN_MODELS:
        return {"started": False, "error": f"Unknown model: {model_id}"}
    existing = progress_tracker.downloads.get(model_id)
    if existing and existing.get("status") == "downloading":
        return {"started": True, "model_id": model_id, "status": "already_downloading"}

    progress_tracker.downloads[model_id] = {"status": "downloading", "progress": 0.0}
    if os.environ.get("THREENVIZEN_ENABLE_HF_DOWNLOADS") == "1":
        asyncio.create_task(_download_model_real(model_id))
    else:
        asyncio.create_task(_download_model_mock(model_id))
    return {"started": True, "model_id": model_id}


async def _download_model_mock(model_id: str) -> None:
    # Mock by default so a frontend click never starts a 40GB pull by surprise.
    for progress in (0.01, 0.03, 0.05):
        await asyncio.sleep(0.5)
        state = progress_tracker.downloads.get(model_id)
        if not state or state.get("status") != "downloading":
            return
        state["progress"] = progress
    progress_tracker.downloads[model_id]["mock"] = True


async def _download_model_real(model_id: str) -> None:
    meta = KNOWN_MODELS[model_id]
    try:
        from huggingface_hub import hf_hub_download

        path = await asyncio.to_thread(
            hf_hub_download,
            repo_id=meta["repo_id"],
            filename=meta["filename"],
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,
        )
        progress_tracker.downloads[model_id] = {
            "status": "available",
            "progress": 1.0,
            "path": path,
        }
    except Exception as error:
        progress_tracker.downloads[model_id] = {
            "status": "failed",
            "progress": 0.0,
            "error": str(error),
        }


def load_model(model_id: str) -> dict[str, Any]:
    if model_id not in KNOWN_MODELS:
        return {"status": "error", "current_model": progress_tracker.loaded_model, "error": f"Unknown model: {model_id}"}
    path = model_path(model_id)
    if not path.exists():
        return {
            "status": "error",
            "current_model": progress_tracker.loaded_model,
            "error": f"Model is not downloaded: {model_id}",
        }
    progress_tracker.loading_model = model_id
    progress_tracker.loaded_model = model_id
    progress_tracker.loading_model = None
    return {"status": "loaded", "current_model": model_id}


def unload_models() -> dict[str, Any]:
    progress_tracker.loaded_model = None
    progress_tracker.loading_model = None
    return {"status": "unloaded", "loaded": False, "models_loaded": False}
