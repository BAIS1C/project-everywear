from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

import config
from adapter.progress import progress_tracker


class GenerateVideoRequest(BaseModel):
    prompt: str = ""
    negative_prompt: str | None = None
    mode: str = "text-to-video"
    image_path: str | None = None
    audio_path: str | None = None
    seed: int | None = None
    steps: int = Field(default=30, ge=1)
    cfg_scale: float = 3.0
    duration_seconds: float = 4.0
    width: int = 768
    height: int = 432
    camera_motion_prompt: str | None = None
    frame_rate: int = 25


class CancelRequest(BaseModel):
    job_id: str


def normalize_mode(mode: str) -> str:
    return "audio-to-video" if mode == "lipdub" else mode


async def queue_generation(req: GenerateVideoRequest) -> dict[str, Any]:
    job_id = f"job_{uuid4().hex[:12]}"
    total_steps = max(1, int(req.steps or 30))
    payload = req.model_dump()
    payload["mode"] = normalize_mode(req.mode)
    progress_tracker.start_job(
        job_id,
        total_steps=total_steps,
        request=payload,
        gpu_snapshot=config.gpu_info.as_frontend(),
    )
    asyncio.create_task(run_generation(job_id, payload))
    return {
        "job_id": job_id,
        "status": "queued",
        "duration_seconds": req.duration_seconds,
        "resolution": {"width": req.width, "height": req.height},
    }


async def run_generation(job_id: str, payload: dict[str, Any]) -> None:
    try:
        progress_tracker.update_job(job_id, status="processing", phase="loading_model", progress=0.03)
        await asyncio.sleep(0.1)
        if progress_tracker.should_cancel(job_id):
            return

        local_result = await _try_ltx_generation(job_id, payload)
        if local_result:
            progress_tracker.complete_job(job_id, local_result)
            return

        # Without the full LTX model stack, keep the adapter honest: the job
        # enters the same phases, then fails with an actionable setup message.
        phases = [
            ("encoding", 0.15),
            ("diffusion", 0.45),
            ("vae_decode", 0.75),
        ]
        for phase, progress in phases:
            if progress_tracker.should_cancel(job_id):
                return
            progress_tracker.update_job(job_id, status="processing", phase=phase, progress=progress)
            await asyncio.sleep(0.2)

        raise RuntimeError(
            "LTX Desktop pipeline import/generation is not available yet. "
            "Set THREENVIZEN_LTX_BACKEND_PATH and install the LTX Python environment to enable local inference."
        )
    except Exception as error:
        if progress_tracker.should_cancel(job_id):
            return
        progress_tracker.fail_job(job_id, str(error))


async def _try_ltx_generation(job_id: str, payload: dict[str, Any]) -> str | None:
    # CODEX_NEEDED: Bind to LTX Desktop's concrete pipeline call once the target
    # Python environment is frozen. This adapter already resolves
    # G:\LTX\LTX Desktop\resources\backend on sys.path and tracks phases.
    if not config.LTX_BACKEND_PATH.exists():
        return None
    try:
        return await asyncio.to_thread(_call_ltx_pipeline_sync, job_id, payload)
    except NotImplementedError:
        return None


def _call_ltx_pipeline_sync(job_id: str, payload: dict[str, Any]) -> str:
    mode = normalize_mode(str(payload.get("mode") or "text-to-video"))
    _ = mode
    _ = job_id
    _ = payload
    raise NotImplementedError("Concrete LTX pipeline binding pending target env spike")


def output_path_for_job(job_id: str) -> str:
    return str(Path(config.OUTPUT_DIR) / f"{job_id}.mp4")
