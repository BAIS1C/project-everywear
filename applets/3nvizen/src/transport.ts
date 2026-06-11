/**
 * 3nvizen Transport Layer
 * ───────────────────────
 * Typed HTTP wrappers for the LTX 2.3 Desktop sidecar.
 * This is a HEADLESS applet: all calls are fetch() to the sidecar,
 * never Tauri invoke().
 *
 * Types derived from the real LTX Desktop api_types.py Pydantic models
 * and _routes/* endpoint map (reverse-engineered by Codex).
 */

// Confirmed: Codex's adapter listens on :8787. The Rust runtime also defaults
// THREENVIZEN_SIDECAR_URL to this base URL for lifecycle/legacy IPC calls.
const LTX_SIDECAR_URL = "http://127.0.0.1:8787";

// ── Generation Modes ──────────────────────────────────────────────

export type GenerationMode =
  | "text-to-video"
  | "image-to-video"
  | "audio-to-video"; // LTX Desktop calls it this, not "lipdub"

// Confirmed: the adapter maps Rust "lipdub" requests to LTX "audio-to-video".

// ── Core Request ──────────────────────────────────────────────────

export interface GenerateVideoRequest {
  prompt: string;
  negative_prompt?: string;
  mode: GenerationMode;

  // Media inputs (absolute file paths)
  image_path?: string;          // Required for image-to-video
  audio_path?: string;          // Required for audio-to-video

  // Generation parameters
  seed?: number;
  steps?: number;               // Default ~30 for distilled
  cfg_scale?: number;           // Default ~3.0
  duration_seconds?: number;    // Frame-count derived, typically 2-10
  width?: number;               // 768, 1024, etc.
  height?: number;              // 432, 576, 768, etc.

  // Advanced (expose in collapsible "Advanced" section)
  camera_motion_prompt?: string;  // e.g. "pan left, zoom in slowly"
  frame_rate?: number;            // Default 25fps
}

// ── Response ──────────────────────────────────────────────────────

export interface GenerateVideoResponse {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  output_path?: string;         // Absolute path to generated mp4/webm
  error?: string;
  duration_seconds?: number;
  resolution?: { width: number; height: number };
}

// ── Progress (polled) ─────────────────────────────────────────────

export interface GenerationProgress {
  job_id: string;
  status: GenerateVideoResponse["status"];
  phase?: string;               // e.g. "encoding", "diffusion", "vae_decode", "upscaling"
  progress?: number;            // 0.0 - 1.0
  step?: number;                // Current diffusion step
  total_steps?: number;         // Total diffusion steps
  elapsed_seconds?: number;
  eta_seconds?: number;
  gpu_info?: {
    gpu_name: string;
    vram_used_gb: number;
    vram_total_gb: number;
  };
}

// ── Model Status ──────────────────────────────────────────────────

export interface ModelStatusResponse {
  models: Array<{
    model_id: string;
    status: "available" | "downloading" | "not_downloaded" | "loading";
    download_progress?: number;  // 0.0 - 1.0
    path?: string;
    size_gb?: number;
  }>;
  current_model?: string;       // Currently loaded model ID
}

// ── GPU Info ──────────────────────────────────────────────────────

export interface GpuInfo {
  gpu_name: string;
  vram_total_gb: number;
  vram_free_gb: number;
  cuda_available: boolean;
  cuda_version?: string;
}

// ── Retake (P2) ──────────────────────────────────────────────────

export interface RetakeRequest {
  original_video_path: string;
  retake_start_seconds: number;
  retake_end_seconds: number;
  prompt: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  cfg_scale?: number;
}

// ── Gap Prompt Suggestion (P2) ───────────────────────────────────

export interface GapPromptRequest {
  context_before: string;       // Prompt or description of scene before gap
  context_after: string;        // Prompt or description of scene after gap
  gap_duration_seconds: number;
}

// ── Known model display names ────────────────────────────────────

export const KNOWN_MODELS: Record<string, { label: string; sizeGb: number }> = {
  "ltxv-13b-0.9.8-distilled-fp8": { label: "LTXV 13B 0.9.8 Distilled FP8", sizeGb: 14.62 },
  "ltxv-13b-0.9.8-distilled": { label: "LTXV 13B 0.9.8 Distilled", sizeGb: 26.62 },
  "ltxv-2b-0.9.8-distilled-fp8": { label: "LTXV 2B 0.9.8 Distilled FP8", sizeGb: 4.16 },
  "ltxv-spatial-upscaler-0.9.8": { label: "LTXV Spatial Upscaler 0.9.8", sizeGb: 0.47 },
  "ltxv-temporal-upscaler-0.9.8": { label: "LTXV Temporal Upscaler 0.9.8", sizeGb: 0.49 },
};

// ── Helpers ───────────────────────────────────────────────────────

async function sidecarFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${LTX_SIDECAR_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Sidecar ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}

// ── Health ────────────────────────────────────────────────────────

export async function getHealth(): Promise<boolean> {
  try {
    const data = await sidecarFetch<{ status: string }>("/health");
    return data.status === "ok";
  } catch {
    return false;
  }
}

// ── GPU Info ──────────────────────────────────────────────────────

export async function getGpuInfo(): Promise<GpuInfo> {
  return sidecarFetch<GpuInfo>("/api/gpu-info");
}

// ── Model Management ─────────────────────────────────────────────

export async function getModelStatus(): Promise<ModelStatusResponse> {
  return sidecarFetch<ModelStatusResponse>("/models/status");
}

export async function downloadModel(modelId: string): Promise<void> {
  await sidecarFetch<unknown>("/models/download", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId }),
  });
}

export async function loadModel(modelId: string): Promise<void> {
  await sidecarFetch<unknown>("/models/load", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId }),
  });
}

/**
 * Polls getModelStatus() every `intervalMs` until the target model is no
 * longer in "downloading" status. Calls `onProgress` with 0.0-1.0 on each tick.
 * Returns a handle with stop() for cleanup on unmount.
 */
export function downloadModelWithProgress(
  modelId: string,
  onProgress: (pct: number) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  intervalMs = 2000,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    if (stopped) return;
    try {
      const status = await getModelStatus();
      const model = status.models.find((m) => m.model_id === modelId);
      if (!model) {
        onError(`Model ${modelId} not found in status response`);
        stop();
        return;
      }
      if (model.status === "downloading") {
        onProgress(model.download_progress ?? 0);
      } else if (model.status === "available") {
        onProgress(1);
        onComplete();
        stop();
      } else if (model.status === "not_downloaded") {
        // Download may not have started yet, keep waiting
        onProgress(0);
      } else {
        // "loading" or unknown
        onProgress(model.download_progress ?? 0);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      stop();
    }
  };

  const stop = () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  // Kick off download, then start polling
  downloadModel(modelId)
    .then(() => {
      if (!stopped) {
        timer = setInterval(poll, intervalMs);
        poll(); // immediate first poll
      }
    })
    .catch((err) => {
      onError(err instanceof Error ? err.message : String(err));
    });

  return { stop };
}

// ── Generation ───────────────────────────────────────────────────

export async function submitGeneration(
  req: GenerateVideoRequest,
): Promise<GenerateVideoResponse> {
  return sidecarFetch<GenerateVideoResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function cancelGeneration(jobId: string): Promise<void> {
  await sidecarFetch<unknown>("/api/generate/cancel", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });
}

// ── Progress Polling ─────────────────────────────────────────────

/**
 * Polls GET /api/generation/progress?job_id=xxx at the given interval.
 * Calls onUpdate for every progress tick, onComplete when done, onError on failure.
 * Returns a handle with stop() for cleanup on unmount.
 */
export function pollGenerationProgress(
  jobId: string,
  onUpdate: (progress: GenerationProgress) => void,
  onComplete: (response: GenerationProgress) => void,
  onError: (error: string) => void,
  intervalMs = 2000,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    if (stopped) return;
    try {
      const progress = await sidecarFetch<GenerationProgress>(
        `/api/generation/progress?job_id=${encodeURIComponent(jobId)}`,
      );
      if (stopped) return;

      onUpdate(progress);

      if (progress.status === "completed") {
        onComplete(progress);
        stop();
      } else if (progress.status === "failed") {
        onError(progress.phase ?? "Generation failed");
        stop();
      } else if (progress.status === "cancelled") {
        onError("Generation cancelled");
        stop();
      }
    } catch (err) {
      if (!stopped) {
        onError(err instanceof Error ? err.message : String(err));
        stop();
      }
    }
  };

  timer = setInterval(poll, intervalMs);
  poll(); // immediate first poll

  const stop = () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { stop };
}

// ── Video Serving ────────────────────────────────────────────────

export function getVideoSrc(outputPath: string): string {
  return `${LTX_SIDECAR_URL}/api/serve-output?path=${encodeURIComponent(outputPath)}`;
}

// ── P2 Stubs ─────────────────────────────────────────────────────
// These typed wrappers exist so Codex can enable them by removing the
// console.warn and wiring the actual call.

export async function submitRetake(
  req: RetakeRequest,
): Promise<GenerateVideoResponse> {
  // P2: Enable when Codex implements retake endpoint adapter
  console.warn("[3nvizen] Retake not yet implemented in adapter layer");
  return sidecarFetch<GenerateVideoResponse>("/retake", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function suggestGapPrompt(
  req: GapPromptRequest,
): Promise<{ prompt: string }> {
  // P2: Enable when Codex implements gap prompt suggestion adapter
  console.warn("[3nvizen] Gap prompt suggestion not yet implemented in adapter layer");
  return sidecarFetch<{ prompt: string }>("/suggest-gap-prompt", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
