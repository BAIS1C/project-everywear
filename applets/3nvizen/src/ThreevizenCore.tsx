import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationMode, GenerationProgress, GenerateVideoRequest } from './transport';
import * as api from './transport';
import { ModeSelector } from './components/ModeSelector';
import { ParamsPanel, DEFAULT_PARAMS, ASPECT_PRESETS } from './components/ParamsPanel';
import type { GenerationParams } from './components/ParamsPanel';
import { VideoPreview } from './components/VideoPreview';
import type { VideoPreviewState } from './components/VideoPreview';
import { EngineStatusBar } from './components/EngineStatusBar';
import { getLogger } from '@everywear/shared';
import {
  findEngineEndpoint,
  readEngineHealth,
  subscribeEngineHealth,
  type EngineHealthPayload,
} from '@everywear/shared';

const log = getLogger('3nvizen');
const hasShellRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Props from shell's HeadlessAppletView ──

export interface ThreevizenCoreProps {
  skin?: string;
  mode?: string;
}

// ── Main Workbench ──

export default function ThreevizenCore({ skin, mode: shellMode }: ThreevizenCoreProps) {
  // ── Engine state ──
  const [localOnline, setLocalOnline] = useState(false);
  const [shellHealth, setShellHealth] = useState<EngineHealthPayload | null>(() => readEngineHealth());
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shellRuntime = hasShellRuntime();
  const shellLtxEndpoint = findEngineEndpoint(shellHealth, 'ltx-sidecar');
  const online = shellRuntime ? shellLtxEndpoint?.online === true : localOnline;

  // ── Mode ──
  const [genMode, setGenMode] = useState<GenerationMode>("text-to-video");

  // ── Generation params ──
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<VideoPreviewState>({ kind: "idle" });
  const progressStopRef = useRef<{ stop: () => void } | null>(null);

  // ── Health check on mount + retry every 5s ──
  const checkHealth = useCallback(async () => {
    const healthy = await api.getHealth();
    setLocalOnline(prev => {
      if (prev !== healthy) {
        log.info('sidecar', `LTX health check: ${healthy ? 'online' : 'offline'}`, { online: healthy });
      }
      return healthy;
    });
    return healthy;
  }, []);

  useEffect(() => {
    if (shellRuntime) return;
    checkHealth();
    healthTimerRef.current = setInterval(checkHealth, 5000);
    return () => {
      if (healthTimerRef.current) {
        clearInterval(healthTimerRef.current);
        healthTimerRef.current = null;
      }
    };
  }, [checkHealth, shellRuntime]);

  useEffect(() => {
    if (!shellRuntime) return;
    const current = readEngineHealth();
    if (current) setShellHealth(current);
    return subscribeEngineHealth(setShellHealth);
  }, [shellRuntime]);

  // ── Cleanup progress polling on unmount ──
  useEffect(() => {
    return () => {
      progressStopRef.current?.stop();
      progressStopRef.current = null;
    };
  }, []);

  // ── Generate handler ──
  const handleGenerate = useCallback(async () => {
    if (generating || !online || !params.prompt.trim()) return;

    const traceId = log.beginTrace('generation', 'Starting video generation', { mode: genMode });
    log.info('generation', 'Video generate request', {
      mode: genMode,
      prompt: params.prompt.slice(0, 100),
      duration: params.durationSeconds,
    });

    setGenerating(true);
    setPreviewState({ kind: "generating", progress: {
      job_id: "",
      status: "queued",
      phase: "submitting",
      progress: 0,
    }, jobId: "" });

    const aspect = ASPECT_PRESETS[params.aspectIndex] ?? ASPECT_PRESETS[0];
    const parsedSeed = parseInt(params.seed, 10);

    const request: GenerateVideoRequest = {
      prompt: params.prompt.trim(),
      negative_prompt: params.negativePrompt.trim() || undefined,
      mode: genMode,
      seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
      steps: params.steps,
      cfg_scale: params.cfgScale,
      duration_seconds: params.durationSeconds,
      width: aspect.width,
      height: aspect.height,
      camera_motion_prompt: params.cameraMotion.trim() || undefined,
      frame_rate: params.frameRate,
    };

    // Attach file paths for image/audio modes
    if (genMode === "image-to-video" && params.imagePath) {
      request.image_path = params.imagePath;
    }
    if (genMode === "audio-to-video" && params.audioPath) {
      request.audio_path = params.audioPath;
    }

    try {
      const response = await api.submitGeneration(request);
      const jobId = response.job_id;
      setCurrentJobId(jobId);

      // If already completed (unlikely but possible for cached results)
      if (response.status === "completed" && response.output_path) {
        setPreviewState({ kind: "done", outputPath: response.output_path, response });
        setGenerating(false);
        return;
      }

      if (response.status === "failed") {
        setPreviewState({ kind: "error", message: response.error ?? "Generation failed" });
        setGenerating(false);
        return;
      }

      // Start polling for progress
      const handle = api.pollGenerationProgress(
        jobId,
        (progress: GenerationProgress) => {
          setPreviewState({ kind: "generating", progress, jobId });
          log.traceEvent('generation', 'Generation progress', {
            phase: progress.phase,
            progress: progress.progress,
            job_id: jobId,
          });
        },
        (finalProgress: GenerationProgress) => {
          // Completed: the adapter includes output_path when a real pipeline returns one.
          setGenerating(false);
          progressStopRef.current = null;
          const outputPath = (finalProgress as any).output_path ?? `output_${jobId}.mp4`;
          setPreviewState({
            kind: "done",
            outputPath,
            response: {
              job_id: jobId,
              status: "completed",
              output_path: outputPath,
            },
          });
          log.endTrace('generation', 'Video generated', {
            output_path: outputPath,
            job_id: jobId,
          });
        },
        (error: string) => {
          setGenerating(false);
          progressStopRef.current = null;
          setPreviewState({ kind: "error", message: error });
          log.error('generation', 'Video generation failed', { error, job_id: jobId });
        },
        2000,
      );

      progressStopRef.current = handle;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setGenerating(false);
      setPreviewState({ kind: "error", message: errMsg });
      log.error('generation', 'Video generation request failed', { error: errMsg });
    }
  }, [generating, online, params, genMode]);

  // ── Cancel handler ──
  const handleCancel = useCallback(async () => {
    log.warn('generation', 'Generation cancelled by user', { job_id: currentJobId });
    if (currentJobId) {
      try {
        await api.cancelGeneration(currentJobId);
      } catch {
        // Best effort cancel
      }
    }
    progressStopRef.current?.stop();
    progressStopRef.current = null;
    setGenerating(false);
    setCurrentJobId(null);
    setPreviewState({ kind: "idle" });
  }, [currentJobId]);

  // ── Retry handler ──
  const handleRetry = useCallback(() => {
    setPreviewState({ kind: "idle" });
    // Let the user tweak params and re-generate
  }, []);

  return (
    <div className="tv-workbench" data-skin={skin} data-tour="3nvizen.root">
      {/* Offline banner */}
      {!online && (
        <div className="tv-offline-banner">
          <span className="tv-offline-banner__icon">&#x26A0;</span>
          <span>
            LTX sidecar is offline. Checking connection every 5 seconds...
          </span>
        </div>
      )}

      {/* Engine status bar */}
      <EngineStatusBar
        online={online}
        engineEndpoint={shellLtxEndpoint}
        checkedAtMs={shellHealth?.checked_at_ms ?? null}
      />

      {/* Mode selector */}
      <ModeSelector mode={genMode} onChange={setGenMode} disabled={generating} />

      {/* Main body: sidebar + preview */}
      <div className="tv-workbench__body">
        <aside className="tv-workbench__sidebar">
          <ParamsPanel
            mode={genMode}
            params={params}
            onChange={setParams}
            onGenerate={handleGenerate}
            generating={generating}
            online={online}
            onCancel={handleCancel}
          />
        </aside>

        <main className="tv-workbench__main">
          <VideoPreview
            state={previewState}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        </main>
      </div>
    </div>
  );
}
