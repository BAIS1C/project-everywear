import os
from functools import lru_cache
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


class AlignRequest(BaseModel):
    audio_path: str = Field(min_length=1)
    lyrics: str = Field(min_length=1)
    language: str | None = None
    model: str | None = None


app = FastAPI(title="Everywear Whisper Align", version="0.1.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": os.getenv("S3_ALIGN_MODEL", "base"),
    }


@app.post("/align")
def align(request: AlignRequest) -> dict[str, Any]:
    audio_path = os.path.abspath(request.audio_path)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail=f"audio file not found: {audio_path}")

    try:
        model = load_model(request.model)
        result = model.align(audio_path, request.lyrics, language=request.language)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"stable-ts is not installed in the whisper-align environment: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"alignment failed: {exc}") from exc

    result_dict = result.to_dict() if hasattr(result, "to_dict") else result
    segments = result_dict.get("segments", []) if isinstance(result_dict, dict) else []
    return {
        "lrc": segments_to_lrc(segments, request.lyrics),
        "segments": segments,
    }


@lru_cache(maxsize=4)
def load_model(model_name: str | None = None):
    import stable_whisper

    selected_model = model_name or os.getenv("S3_ALIGN_MODEL", "base")
    return stable_whisper.load_model(selected_model)


def segments_to_lrc(segments: list[dict[str, Any]], fallback_lyrics: str) -> str:
    lines: list[str] = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        start = float(segment.get("start", 0.0) or 0.0)
        lines.append(f"{lrc_timestamp(start)}{text}")

    if lines:
        return "\n".join(lines) + "\n"

    fallback_lines = [line.strip() for line in fallback_lyrics.splitlines() if line.strip()]
    return "\n".join(f"[00:00.00]{line}" for line in fallback_lines) + "\n"


def lrc_timestamp(seconds: float) -> str:
    total_centiseconds = max(0, round(seconds * 100))
    minutes, centiseconds = divmod(total_centiseconds, 6000)
    secs, cents = divmod(centiseconds, 100)
    return f"[{minutes:02}:{secs:02}.{cents:02}]"


def main() -> None:
    port = int(os.getenv("S3_ALIGN_PORT", "9878"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
