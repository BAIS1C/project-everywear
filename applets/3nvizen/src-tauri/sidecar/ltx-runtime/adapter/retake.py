from __future__ import annotations

from adapter.generate import GenerateVideoRequest, queue_generation


async def queue_retake(req: GenerateVideoRequest) -> dict[str, object]:
    return await queue_generation(req)
