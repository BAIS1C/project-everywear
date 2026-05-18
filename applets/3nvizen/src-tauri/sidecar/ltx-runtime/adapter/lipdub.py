from __future__ import annotations

from typing import Any

from adapter.generate import GenerateVideoRequest, queue_generation


async def queue_lipdub(payload: dict[str, Any]) -> dict[str, Any]:
    request = GenerateVideoRequest(
        prompt=payload.get("translated_script") or payload.get("prompt") or "",
        mode="audio-to-video",
        audio_path=payload.get("source_audio_path") or payload.get("audio_path"),
        image_path=payload.get("source_video_path") or payload.get("image_path"),
        duration_seconds=payload.get("duration_seconds") or 4,
    )
    return await queue_generation(request)
