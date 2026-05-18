from __future__ import annotations

import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import config
from adapter.generate import CancelRequest, GenerateVideoRequest, queue_generation
from adapter.lipdub import queue_lipdub
from adapter.models import get_models_status, load_model, start_download, unload_models
from adapter.progress import progress_tracker
from utils.gpu import detect_gpu
from utils.last_frame import extract_last_frame


class DownloadRequest(BaseModel):
    model_id: str


class LoadModelRequest(BaseModel):
    model_id: str


class LastFrameRequest(BaseModel):
    video_path: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.configure_runtime(detect_gpu())
    print(f"[3nvizen] runtime={config.runtime_mode} gpu={config.gpu_info.as_frontend()}")
    print(f"[3nvizen] ltx_backend={config.LTX_BACKEND_PATH}")
    yield


app = FastAPI(title="3nvizen LTX Runtime Adapter", version="0.4.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "mode": config.runtime_mode,
        "gpu": config.gpu_info.as_frontend(),
        "runtime": "3nvizen-ltx-adapter",
        "models_loaded": progress_tracker.loaded_model is not None,
    }


@app.get("/api/v1/health")
@app.get("/api/v1/status")
async def legacy_health() -> dict[str, Any]:
    return await health()


@app.get("/api/gpu-info")
async def gpu_info() -> dict[str, Any]:
    return config.gpu_info.as_frontend()


@app.post("/api/generate")
async def generate(req: GenerateVideoRequest) -> dict[str, Any]:
    return await queue_generation(req)


@app.get("/api/generation/progress", response_model=None)
async def generation_progress(job_id: str) -> JSONResponse | dict[str, Any]:
    state = progress_tracker.get_job(job_id)
    if not state:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    return state.to_frontend()


@app.post("/api/generate/cancel")
async def cancel_generation(req: CancelRequest) -> dict[str, Any]:
    state = progress_tracker.cancel_job(req.job_id)
    return {"cancelled": state is not None, "job_id": req.job_id}


@app.get("/models/status")
async def model_status() -> dict[str, Any]:
    return get_models_status()


@app.post("/models/download", response_model=None)
async def download_model(req: DownloadRequest) -> JSONResponse | dict[str, Any]:
    result = await start_download(req.model_id)
    if not result.get("started"):
        return JSONResponse(status_code=404, content=result)
    return result


# CLAUDE_INTERFACE: Load a model into the pipeline
# Endpoint: POST /models/load
# Args: { model_id: string }
# Returns: { status: "loading" | "loaded" | "error", current_model: string }
@app.post("/models/load", response_model=None)
async def load_model_endpoint(req: LoadModelRequest) -> JSONResponse | dict[str, Any]:
    result = load_model(req.model_id)
    if result.get("status") == "error":
        return JSONResponse(status_code=400, content=result)
    return result


@app.post("/api/v1/models/unload")
@app.post("/api/v1/unload")
@app.post("/api/v1/runtime/unload")
@app.post("/unload")
async def unload_model_endpoint() -> dict[str, Any]:
    return unload_models()


# CLAUDE_INTERFACE: Serve generated video file
# Endpoint: GET /api/serve-output?path=<relative_path>
# Returns: video/mp4 FileResponse
# Usage: Set as <video src="http://127.0.0.1:8787/api/serve-output?path=job_abc123.mp4">
@app.get("/api/serve-output", response_model=None)
async def serve_output(path: str = Query(...)) -> JSONResponse | FileResponse:
    return _serve_output(path)


@app.get("/api/serve", response_model=None)
async def serve_output_alias(path: str = Query(...)) -> JSONResponse | FileResponse:
    return _serve_output(path)


def _serve_output(path: str) -> JSONResponse | FileResponse:
    try:
        full_path = _resolve_output_path(path)
    except ValueError as error:
        return JSONResponse(status_code=403, content={"error": str(error)})
    if not full_path.exists() or not full_path.is_file():
        return JSONResponse(status_code=404, content={"error": "File not found"})
    media_type = mimetypes.guess_type(str(full_path))[0] or "video/mp4"
    return FileResponse(
        full_path,
        media_type=media_type,
        filename=full_path.name,
        content_disposition_type="inline",
    )


def _resolve_output_path(raw_path: str) -> Path:
    output_root = config.OUTPUT_DIR.resolve()
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = output_root / candidate
    full_path = candidate.resolve()
    if full_path != output_root and output_root not in full_path.parents:
        raise ValueError("Path traversal blocked")
    return full_path


# CLAUDE_INTERFACE: Extract last frame for 3nvizen video continuity
# Endpoint: POST /api/extract-last-frame
# Args: { video_path: string }
# Returns: { frame_path: string }
@app.post("/api/extract-last-frame", response_model=None)
async def extract_last_frame_endpoint(req: LastFrameRequest) -> JSONResponse | dict[str, str]:
    try:
        frame_path = extract_last_frame(req.video_path, config.OUTPUT_DIR)
        return {"frame_path": frame_path}
    except Exception as error:
        return JSONResponse(status_code=400, content={"error": str(error)})


@app.post("/api/v1/segments/generate")
async def generate_segment_legacy(payload: dict[str, Any]) -> dict[str, Any]:
    req = GenerateVideoRequest(
        prompt=payload.get("prompt", ""),
        negative_prompt=payload.get("negative_prompt"),
        mode="audio-to-video" if payload.get("audio_path") else "image-to-video",
        image_path=payload.get("start_frame_path") or payload.get("image_path"),
        audio_path=payload.get("audio_path"),
        seed=payload.get("seed"),
        duration_seconds=(payload.get("duration_ms") or 4000) / 1000,
        width=payload.get("width") or 768,
        height=payload.get("height") or 432,
        frame_rate=payload.get("fps") or 25,
    )
    return await queue_generation(req)


@app.post("/api/v1/patches/lipdub")
async def lipdub_patch_legacy(payload: dict[str, Any]) -> dict[str, Any]:
    return await queue_lipdub(payload)


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8787, reload=False)
