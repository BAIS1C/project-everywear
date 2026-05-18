from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class JobState:
    job_id: str
    status: str = "queued"
    phase: str = "queued"
    progress: float = 0.0
    step: int = 0
    total_steps: int = 0
    started_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    eta_seconds: float = 0.0
    output_path: str | None = None
    error: str | None = None
    gpu_snapshot: dict[str, Any] | None = None
    cancel_requested: bool = False
    request: dict[str, Any] = field(default_factory=dict)

    def to_frontend(self) -> dict[str, Any]:
        elapsed = max(0.0, time.monotonic() - self.started_at)
        gpu_info = None
        if self.gpu_snapshot:
            total = float(self.gpu_snapshot.get("vram_total_gb") or 0.0)
            free = float(self.gpu_snapshot.get("vram_free_gb") or 0.0)
            gpu_info = {
                "gpu_name": self.gpu_snapshot.get("gpu_name", "Unknown GPU"),
                "vram_used_gb": round(max(0.0, total - free), 2),
                "vram_total_gb": round(total, 2),
            }
        return {
            "job_id": self.job_id,
            "status": self.status,
            "phase": self.error if self.status == "failed" and self.error else self.phase,
            "progress": round(self.progress, 4),
            "step": self.step,
            "total_steps": self.total_steps,
            "elapsed_seconds": round(elapsed, 2),
            "eta_seconds": round(self.eta_seconds, 2),
            "output_path": self.output_path,
            "error": self.error,
            "gpu_info": gpu_info,
        }


class ProgressTracker:
    def __init__(self) -> None:
        self._lock = Lock()
        self.jobs: dict[str, JobState] = {}
        self.loaded_model: str | None = None
        self.loading_model: str | None = None
        self.downloads: dict[str, dict[str, Any]] = {}

    def start_job(
        self,
        job_id: str,
        *,
        total_steps: int,
        request: dict[str, Any],
        gpu_snapshot: dict[str, Any] | None = None,
    ) -> JobState:
        with self._lock:
            state = JobState(
                job_id=job_id,
                total_steps=total_steps,
                request=request,
                gpu_snapshot=gpu_snapshot,
            )
            self.jobs[job_id] = state
            return state

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        phase: str | None = None,
        step: int | None = None,
        progress: float | None = None,
        eta_seconds: float | None = None,
    ) -> JobState | None:
        with self._lock:
            state = self.jobs.get(job_id)
            if not state:
                return None
            if status is not None:
                state.status = status
            if phase is not None:
                state.phase = phase
            if step is not None:
                state.step = step
            if progress is not None:
                state.progress = max(0.0, min(1.0, progress))
            if eta_seconds is not None:
                state.eta_seconds = max(0.0, eta_seconds)
            state.updated_at = time.monotonic()
            return state

    def complete_job(self, job_id: str, output_path: str) -> JobState | None:
        with self._lock:
            state = self.jobs.get(job_id)
            if not state:
                return None
            state.status = "completed"
            state.phase = "completed"
            state.progress = 1.0
            state.step = state.total_steps
            state.eta_seconds = 0.0
            state.output_path = output_path
            state.updated_at = time.monotonic()
            return state

    def fail_job(self, job_id: str, error: str) -> JobState | None:
        with self._lock:
            state = self.jobs.get(job_id)
            if not state:
                return None
            state.status = "failed"
            state.phase = "failed"
            state.error = error
            state.eta_seconds = 0.0
            state.updated_at = time.monotonic()
            return state

    def cancel_job(self, job_id: str) -> JobState | None:
        with self._lock:
            state = self.jobs.get(job_id)
            if not state:
                return None
            state.cancel_requested = True
            state.status = "cancelled"
            state.phase = "cancelled"
            state.eta_seconds = 0.0
            state.updated_at = time.monotonic()
            return state

    def should_cancel(self, job_id: str) -> bool:
        with self._lock:
            state = self.jobs.get(job_id)
            return bool(state and state.cancel_requested)

    def get_job(self, job_id: str) -> JobState | None:
        with self._lock:
            return self.jobs.get(job_id)


progress_tracker = ProgressTracker()
