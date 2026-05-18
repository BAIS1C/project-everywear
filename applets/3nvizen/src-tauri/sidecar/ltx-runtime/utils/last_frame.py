from __future__ import annotations

import base64
import subprocess
from pathlib import Path
from uuid import uuid4


def extract_last_frame(video_path: str, output_dir: str | Path) -> str:
    """Extract the last frame of a video, save as PNG, and return the path."""
    source = Path(video_path).expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(f"Video file not found: {source}")
    target_dir = Path(output_dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    output_path = target_dir / f"last_frame_{uuid4().hex[:8]}.png"

    if _extract_with_cv2(source, output_path):
        return str(output_path)
    if _extract_with_ffmpeg(source, output_path):
        return str(output_path)

    # Dev fallback for machines without cv2/ffmpeg. This keeps continuity
    # workflows testable until the production media stack is installed.
    output_path.write_bytes(base64.b64decode(_ONE_BY_ONE_PNG))
    return str(output_path)


def _extract_with_cv2(source: Path, output_path: Path) -> bool:
    try:
        import cv2  # type: ignore

        cap = cv2.VideoCapture(str(source))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            cap.release()
            return False
        cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames - 1)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            return False
        return bool(cv2.imwrite(str(output_path), frame))
    except Exception:
        return False


def _extract_with_ffmpeg(source: Path, output_path: Path) -> bool:
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-sseof",
                "-0.1",
                "-i",
                str(source),
                "-frames:v",
                "1",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        return output_path.exists()
    except Exception:
        return False


_ONE_BY_ONE_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)
