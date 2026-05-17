from __future__ import annotations

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="3nvizen LTX Runtime", version="0.1.0")


class GenerateSegmentRequest(BaseModel):
    project_id: str
    segment_index: int = Field(ge=0)
    prompt: str
    negative_prompt: str | None = None
    width: int = Field(ge=32)
    height: int = Field(ge=32)
    fps: int = Field(ge=1)
    duration_ms: int = Field(ge=1000)
    audio_path: str
    start_frame_path: str
    prior_segment_last_frame_path: str | None = None
    seed: int | None = None
    continuity_notes: list[str] = Field(default_factory=list)


class GenerateSegmentQueued(BaseModel):
    job_id: str
    status: Literal["queued"]


class LipDubPatchRequest(BaseModel):
    source_video_path: str
    source_audio_path: str
    translated_script: str
    target_language: str
    emotion_cues: list[str] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "runtime": "3nvizen-ltx-sidecar",
        "inference": "scaffold",
        "lipdub_patch": "planned",
    }


@app.post("/api/v1/segments/generate", response_model=GenerateSegmentQueued)
def generate_segment(request: GenerateSegmentRequest) -> GenerateSegmentQueued:
    job_id = f"seg_{request.project_id}_{request.segment_index:04d}"
    return GenerateSegmentQueued(job_id=job_id, status="queued")


@app.post("/api/v1/patches/lipdub")
def lipdub_patch(_: LipDubPatchRequest) -> dict[str, object]:
    return {
        "status": "planned",
        "detail": "LipDub patch workflow will be wired to the managed local LTX runtime.",
    }

