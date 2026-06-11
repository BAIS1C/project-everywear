from __future__ import annotations

import asyncio
import gc
import math
import os
import traceback
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


# ── LTX pipeline singleton ──────────────────────────────────────────────
# Lazily loaded on first generation request. Held until explicit unload.
_pipeline: Any = None
_pipeline_model_id: str | None = None


def normalize_mode(mode: str) -> str:
    return "audio-to-video" if mode == "lipdub" else mode


def _enforce_geometry(width: int, height: int) -> tuple[int, int]:
    """LTX requires width and height divisible by 32."""
    return (width // 32) * 32, (height // 32) * 32


def _frame_count_for_duration(duration_seconds: float, fps: int) -> int:
    """LTX requires frame count = 8n + 1."""
    raw = max(1, int(duration_seconds * fps))
    n = max(0, math.ceil((raw - 1) / 8))
    return 8 * n + 1


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
        await asyncio.sleep(0.05)
        if progress_tracker.should_cancel(job_id):
            return

        local_result = await _try_ltx_generation(job_id, payload)
        if local_result:
            progress_tracker.complete_job(job_id, local_result)
            return

        # LTX pipeline not available; report actionable setup error.
        raise RuntimeError(
            "LTX pipeline not loaded. Either the model is not downloaded, "
            "THREENVIZEN_LTX_BACKEND_PATH is not set, or the LTX Python "
            "environment is missing. Call POST /models/load first."
        )
    except Exception as error:
        if progress_tracker.should_cancel(job_id):
            return
        progress_tracker.fail_job(job_id, str(error))


async def _try_ltx_generation(job_id: str, payload: dict[str, Any]) -> str | None:
    global _pipeline
    if _pipeline is None:
        return None
    try:
        return await asyncio.to_thread(_call_ltx_pipeline_sync, job_id, payload)
    except Exception as error:
        traceback.print_exc()
        raise


def _call_ltx_pipeline_sync(job_id: str, payload: dict[str, Any]) -> str:
    """Concrete LTX pipeline binding using diffusers LTXVideoTransformer3DModel."""
    import torch

    global _pipeline

    if _pipeline is None:
        raise RuntimeError("Pipeline not loaded; call /models/load first")

    mode = normalize_mode(str(payload.get("mode") or "text-to-video"))
    prompt = str(payload.get("prompt") or "")
    negative_prompt = payload.get("negative_prompt") or ""
    seed = payload.get("seed")
    steps = int(payload.get("steps") or 30)
    cfg_scale = float(payload.get("cfg_scale") or 3.0)
    width_raw = int(payload.get("width") or 768)
    height_raw = int(payload.get("height") or 432)
    duration_seconds = float(payload.get("duration_seconds") or 4.0)
    fps = int(payload.get("frame_rate") or 25)

    width, height = _enforce_geometry(width_raw, height_raw)
    num_frames = _frame_count_for_duration(duration_seconds, fps)

    progress_tracker.update_job(job_id, status="processing", phase="encoding", progress=0.10)

    generator = torch.Generator(device="cpu")
    if seed is not None:
        generator.manual_seed(seed)
    else:
        generator.seed()

    # Build pipeline kwargs based on mode
    pipe_kwargs: dict[str, Any] = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "width": width,
        "height": height,
        "num_frames": num_frames,
        "num_inference_steps": steps,
        "guidance_scale": cfg_scale,
        "generator": generator,
        "output_type": "pt",
    }

    # Image conditioning for image-to-video and audio-to-video
    if mode in ("image-to-video", "audio-to-video") and payload.get("image_path"):
        image_path = Path(payload["image_path"]).expanduser()
        if image_path.exists():
            from PIL import Image
            init_image = Image.open(image_path).convert("RGB").resize((width, height))
            pipe_kwargs["image"] = init_image

    progress_tracker.update_job(job_id, status="processing", phase="diffusion", progress=0.20)

    # Step callback for real progress reporting
    def step_callback(pipe: Any, step: int, timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        if progress_tracker.should_cancel(job_id):
            raise RuntimeError("Generation cancelled")
        pct = 0.20 + 0.60 * (step / max(1, steps))
        progress_tracker.update_job(
            job_id,
            status="processing",
            phase="diffusion",
            step=step,
            progress=pct,
        )
        return callback_kwargs

    pipe_kwargs["callback_on_step_end"] = step_callback

    # Run inference
    with torch.inference_mode():
        result = _pipeline(**pipe_kwargs)

    progress_tracker.update_job(job_id, status="processing", phase="vae_decode", progress=0.85)

    # Export to MP4
    output_file = output_path_for_job(job_id)
    Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    frames = result.frames  # type: ignore[union-attr]
    _export_frames_to_mp4(frames, output_file, fps=fps)

    progress_tracker.update_job(job_id, status="processing", phase="finalizing", progress=0.95)

    return output_file


def _export_frames_to_mp4(frames: Any, output_path: str, fps: int = 25) -> None:
    """Export pipeline output frames to MP4 via torchvision or imageio fallback."""
    import torch

    # frames can be: Tensor [B, C, T, H, W] or [B, T, C, H, W] or list of PIL images
    try:
        from torchvision.io import write_video  # type: ignore[import-not-found]

        if isinstance(frames, torch.Tensor):
            # Expect [B, C, T, H, W] from pipeline output_type="pt"
            video = frames[0]  # remove batch
            if video.shape[0] in (1, 3):  # C, T, H, W
                video = video.permute(1, 2, 3, 0)  # T, H, W, C
            video = (video.clamp(0, 1) * 255).to(torch.uint8).cpu()
            write_video(output_path, video, fps=fps, video_codec="h264")
            return
    except ImportError:
        pass

    # Fallback: imageio
    try:
        import imageio  # type: ignore[import-not-found]
        import numpy as np

        writer = imageio.get_writer(output_path, fps=fps, codec="libx264", quality=8)
        if isinstance(frames, torch.Tensor):
            video = frames[0]
            if video.shape[0] in (1, 3):
                video = video.permute(1, 2, 3, 0)
            video = (video.clamp(0, 1) * 255).to(torch.uint8).cpu().numpy()
            for f in video:
                writer.append_data(f if f.shape[-1] == 3 else f[:, :, :3])
        elif isinstance(frames, (list, tuple)):
            for frame in frames:
                if hasattr(frame, "numpy"):
                    arr = frame.numpy() if frame.dtype == torch.uint8 else (frame.clamp(0, 1) * 255).to(torch.uint8).numpy()
                else:
                    arr = np.array(frame)
                writer.append_data(arr)
        writer.close()
        return
    except ImportError:
        pass

    raise RuntimeError("Neither torchvision nor imageio available for MP4 export")


def load_pipeline(model_id: str) -> dict[str, Any]:
    """Load the LTX video pipeline for a given model_id."""
    global _pipeline, _pipeline_model_id

    if _pipeline is not None and _pipeline_model_id == model_id:
        return {"status": "already_loaded", "model": model_id}

    # Unload previous pipeline if loaded
    if _pipeline is not None:
        unload_pipeline()

    meta = config.KNOWN_MODELS.get(model_id)
    if not meta:
        return {"status": "error", "error": f"Unknown model: {model_id}"}

    model_path = config.MODEL_DIR / str(meta["filename"])
    if not model_path.exists():
        return {"status": "error", "error": f"Model not downloaded: {model_id} at {model_path}"}

    try:
        import torch

        # Determine device and dtype based on VRAM
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if device == "cuda" else torch.float32

        # Try LTX Video diffusers pipeline first (ltx-video >= 2.x)
        try:
            from diffusers import LTXVideoTransformer3DModel, LTXPipeline  # type: ignore[import-not-found]

            # For single safetensors file: load transformer, then build pipeline
            if str(model_path).endswith(".safetensors"):
                transformer = LTXVideoTransformer3DModel.from_single_file(
                    str(model_path),
                    torch_dtype=dtype,
                )
                _pipeline = LTXPipeline.from_pretrained(
                    "Lightricks/LTX-Video",
                    transformer=transformer,
                    torch_dtype=dtype,
                ).to(device)
            else:
                _pipeline = LTXPipeline.from_pretrained(
                    str(model_path),
                    torch_dtype=dtype,
                ).to(device)

            # Enable memory optimizations for constrained VRAM
            if config.gpu_info.vram_total_gb < 24:
                _pipeline.enable_model_cpu_offload()
            if config.gpu_info.vram_total_gb < 16:
                _pipeline.enable_sequential_cpu_offload()
                if hasattr(_pipeline, "enable_vae_slicing"):
                    _pipeline.enable_vae_slicing()

            _pipeline_model_id = model_id
            progress_tracker.loaded_model = model_id
            progress_tracker.loading_model = None
            return {"status": "loaded", "model": model_id, "device": device}

        except ImportError:
            pass

        # Fallback: try LTX Desktop backend pipeline modules
        if config.LTX_BACKEND_PATH.exists():
            try:
                # LTX Desktop exposes pipeline services; attempt import
                from services.fast_video_pipeline import FastVideoPipeline  # type: ignore[import-not-found]

                _pipeline = FastVideoPipeline(
                    model_path=str(model_path),
                    device=device,
                    dtype=dtype,
                )
                _pipeline_model_id = model_id
                progress_tracker.loaded_model = model_id
                progress_tracker.loading_model = None
                return {"status": "loaded", "model": model_id, "device": device, "backend": "ltx_desktop"}
            except ImportError:
                pass

        return {
            "status": "error",
            "error": "Neither diffusers (LTXPipeline) nor LTX Desktop backend available. "
                     "Install diffusers>=0.32 with ltx-video support, or set THREENVIZEN_LTX_BACKEND_PATH.",
        }

    except Exception as error:
        traceback.print_exc()
        return {"status": "error", "error": str(error)}


def unload_pipeline() -> dict[str, Any]:
    """Unload the current pipeline and free VRAM."""
    global _pipeline, _pipeline_model_id

    if _pipeline is None:
        return {"status": "already_unloaded"}

    model = _pipeline_model_id
    _pipeline = None
    _pipeline_model_id = None
    progress_tracker.loaded_model = None
    progress_tracker.loading_model = None

    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
    except ImportError:
        pass

    return {"status": "unloaded", "previous_model": model}


def output_path_for_job(job_id: str) -> str:
    return str(Path(config.OUTPUT_DIR) / f"{job_id}.mp4")
