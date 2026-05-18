/**
 * CreateView — primary generation interface.
 *
 * Ported from S3 Studio's CreatePanel. Contains:
 *   - Prompt input with style patch strip
 *   - Generation parameters (duration, BPM, steps, guidance)
 *   - Model selector (reads available models via Tauri invoke)
 *   - Generate button + progress display
 *   - Recent generations gallery
 *
 * Phase 4: fully wired to Gener8 shim on localhost:3001.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Sparkles, Upload, Settings2, ChevronDown, AlertCircle } from 'lucide-react';
import { useSongStore } from '../context/SongStoreContext';
import { vaultRegisterAudio } from '@everywear/transport';
import { getLogger } from '@everywear/shared';

const log = getLogger('gener8');

// ── Types ────────────────────────────────────────────────────────

interface GenerationParams {
  prompt: string;
  duration: number;
  bpm: number;
  steps: number;
  guidanceScale: number;
  seed: number;
  model: string;
}

interface GenerateResponse {
  id: string;
  [key: string]: unknown;
}

interface JobStatus {
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  audio_url?: string;
  error?: string;
  title?: string;
  duration?: number;
  [key: string]: unknown;
}

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  duration: 30,
  bpm: 120,
  steps: 50,
  guidanceScale: 7.0,
  seed: -1,
  model: 'ace-step-v1',
};

const BACKEND_BASE = 'http://localhost:3001';

function apiUrl(path: string): string {
  return `${BACKEND_BASE}${path}`;
}

// ── Component ────────────────────────────────────────────────────

export default function CreateView() {
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [vaultSaveState, setVaultSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null);
  const [autoSaveToVault, setAutoSaveToVault] = useState<boolean>(() => {
    try { return localStorage.getItem('gener8:auto_save_vault') === '1'; } catch { return false; }
  });
  const [lastCompletedJob, setLastCompletedJob] = useState<{ id: string; title: string; duration?: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addSong, refetch } = useSongStore();

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const pollJobStatus = useCallback((jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/generate/status/${jobId}`));
        if (!res.ok) return;
        const data: JobStatus = await res.json();

        if (data.progress !== undefined) {
          setProgress(Math.round(data.progress * 100));
        }

        switch (data.status) {
          case 'queued':
            setStatusText('Queued... waiting for engine');
            break;
          case 'running':
            setStatusText(`Generating${data.progress ? ` (${Math.round(data.progress * 100)}%)` : '...'}`);
            break;
          case 'completed':
            stopPolling();
            setStatusText('Complete!');
            setProgress(100);
            log.endTrace('generation', 'Music generated', {
              job_id: jobId,
              title: data.title,
              duration_seconds: data.duration,
            });
            // Refetch song library to pick up the new track
            await refetch();
            setLastCompletedJob({
              id: jobId,
              title: data.title || params.prompt.slice(0, 60),
              duration: data.duration,
            });
            setVaultSaveState('idle');
            setVaultSaveError(null);
            // Auto-save to vault if enabled
            if (autoSaveToVault && data.audio_url) {
              /**
               * CODEX_NEEDED: Gener8 shim filesystem path for vault registration.
               * The shim returns audio_url as a relative API path (e.g. /api/audio/{key}),
               * NOT a filesystem path. vaultRegisterAudio needs a filePath on disk.
               * Options:
               *   (A) Add a file_path field to the shim's job status response
               *   (B) Add a Tauri command that resolves audio_url → filesystem path
               *   (C) Have the shim save to Everywear Vault dir and return the path
               * Until resolved, we pass the API-relative URL as a placeholder.
               */
              try {
                setVaultSaveState('saving');
                await vaultRegisterAudio({
                  title: data.title || `Song ${new Date().toISOString().slice(0, 10)}`,
                  filePath: data.audio_url ?? '', // CODEX_NEEDED: resolve to actual filesystem path
                  durationSeconds: data.duration ?? params.duration,
                  tags: ['gener8', 'music'],
                });
                setVaultSaveState('saved');
              } catch {
                setVaultSaveState('error');
                setVaultSaveError('Auto-save to vault failed');
              }
            }
            setTimeout(() => {
              setIsGenerating(false);
              setProgress(0);
              setStatusText('');
            }, 1200);
            break;
          case 'failed':
            stopPolling();
            setError(data.error || 'Generation failed');
            log.error('generation', 'Music generation failed', {
              job_id: jobId,
              error: data.error || 'Unknown failure',
            });
            setIsGenerating(false);
            setProgress(0);
            setStatusText('');
            break;
        }
      } catch {
        // Network blip; keep polling
      }
    }, 1500);
  }, [stopPolling, refetch]);

  const handleGenerate = async () => {
    if (!params.prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setProgress(0);
    setStatusText('Submitting to engine...');

    const traceId = log.beginTrace('generation', 'Starting music generation');
    log.info('generation', 'Generate request to shim', {
      prompt: params.prompt.slice(0, 100),
      duration: params.duration,
      bpm: params.bpm,
      model: params.model,
    });

    try {
      const res = await fetch(apiUrl('/api/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: params.prompt,
          duration: params.duration,
          bpm: params.bpm,
          num_inference_steps: params.steps,
          guidance_scale: params.guidanceScale,
          seed: params.seed === -1 ? undefined : params.seed,
          model: params.model,
          title: params.prompt.slice(0, 60),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          typeof errData.error === 'string' ? errData.error : `Engine returned ${res.status}`,
        );
      }

      const data: GenerateResponse = await res.json();
      if (!data.id) {
        throw new Error('No job ID returned from engine');
      }

      log.traceEvent('generation', 'Shim accepted request', { job_id: data.id });
      setStatusText('Queued... waiting for engine');
      pollJobStatus(data.id);
    } catch (e: any) {
      const errMsg = e.message || 'Failed to start generation';
      setError(errMsg);
      log.error('generation', 'Music generation failed', { error: errMsg, trace_id: traceId });
      setIsGenerating(false);
      setProgress(0);
      setStatusText('');
    }
  };

  const updateParam = <K extends keyof GenerationParams>(
    key: K,
    value: GenerationParams[K],
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full p-6 gap-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl tracking-wide text-s3-text-primary">
          Create
        </h1>
        <p className="text-s3-text-muted text-sm mt-1">
          Describe the music you want to generate.
        </p>
      </div>

      {/* Prompt input */}
      <div className="ew-field">
        <label className="ew-field-label">Prompt</label>
        <textarea
          className="ew-textarea"
          placeholder="A cinematic orchestral piece with soaring strings and a powerful brass section..."
          value={params.prompt}
          onChange={(e) => updateParam('prompt', e.target.value)}
          rows={3}
        />
      </div>

      {/* Quick params row */}
      <div className="flex gap-4 flex-wrap">
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">Duration (s)</label>
          <input
            type="number"
            className="ew-input"
            value={params.duration}
            min={5}
            max={300}
            onChange={(e) => updateParam('duration', Number(e.target.value))}
          />
        </div>
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">BPM</label>
          <input
            type="number"
            className="ew-input"
            value={params.bpm}
            min={40}
            max={240}
            onChange={(e) => updateParam('bpm', Number(e.target.value))}
          />
        </div>
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">Model</label>
          <select
            className="ew-select"
            value={params.model}
            onChange={(e) => updateParam('model', e.target.value)}
          >
            <option value="ace-step-v1">ACE-Step v1</option>
            <option value="ace-step-v1.5">ACE-Step v1.5</option>
          </select>
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        className="flex items-center gap-2 text-s3-text-muted hover:text-s3-text-primary text-xs uppercase tracking-widest font-mono transition-colors"
        onClick={() => setShowAdvanced((s) => !s)}
      >
        <Settings2 size={14} />
        Advanced
        <ChevronDown
          size={14}
          className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
        />
      </button>

      {showAdvanced && (
        <div className="flex gap-4 flex-wrap p-4 bg-s3-card border border-s3-border rounded-lg">
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Inference Steps</label>
            <input
              type="number"
              className="ew-input"
              value={params.steps}
              min={10}
              max={200}
              onChange={(e) => updateParam('steps', Number(e.target.value))}
            />
          </div>
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Guidance Scale</label>
            <input
              type="number"
              className="ew-input"
              step={0.5}
              value={params.guidanceScale}
              min={1}
              max={30}
              onChange={(e) => updateParam('guidanceScale', Number(e.target.value))}
            />
          </div>
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Seed (-1 = random)</label>
            <input
              type="number"
              className="ew-input"
              value={params.seed}
              onChange={(e) => updateParam('seed', Number(e.target.value))}
            />
          </div>
        </div>
      )}

      {/* Audio upload (reference track) */}
      <div className="flex items-center gap-3">
        <button className="ew-btn ew-btn--ghost ew-btn--sm">
          <Upload size={14} />
          Reference Audio
        </button>
        <span className="ew-small">Optional. Upload a reference track for style guidance.</span>
      </div>

      {/* Generate button */}
      <button
        className="ew-btn ew-btn--primary ew-btn--lg self-start"
        onClick={handleGenerate}
        disabled={!params.prompt.trim() || isGenerating}
      >
        <Sparkles size={16} />
        {isGenerating ? 'Generating...' : 'Generate'}
      </button>

      {/* Generation progress */}
      {isGenerating && (
        <div className="flex flex-col gap-2">
          <div className="ew-progress">
            <div
              className="ew-progress-bar"
              style={{ width: progress > 0 ? `${progress}%` : undefined }}
            />
          </div>
          <span className="ew-meta">{statusText}</span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 text-[var(--ew-danger)] text-sm">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Vault save controls */}
      {lastCompletedJob && (
        <div className="flex flex-col gap-2 p-4 rounded-lg" style={{ background: 'color-mix(in oklab, var(--ew-text) 3%, transparent)', border: '1px solid var(--ew-border, rgba(255,255,255,0.06))' }}>
          <div className="flex items-center gap-3">
            {vaultSaveState === 'saved' ? (
              <span className="text-xs font-medium" style={{ color: 'var(--ew-status-green, #4ade80)' }}>
                Saved to Vault
              </span>
            ) : vaultSaveState === 'saving' ? (
              <span className="text-xs" style={{ color: 'var(--ew-text-muted)' }}>
                Saving to vault...
              </span>
            ) : (
              <button
                className="ew-btn ew-btn--ghost ew-btn--sm"
                onClick={async () => {
                  if (!lastCompletedJob) return;
                  setVaultSaveState('saving');
                  setVaultSaveError(null);
                  try {
                    /**
                     * CODEX_NEEDED: Same filesystem path gap as auto-save above.
                     * Need shim to expose file_path in job status or a resolve command.
                     */
                    await vaultRegisterAudio({
                      title: lastCompletedJob.title || `Song ${new Date().toISOString().slice(0, 10)}`,
                      filePath: '', // CODEX_NEEDED: resolve to actual filesystem path
                      durationSeconds: lastCompletedJob.duration ?? 0,
                      tags: ['gener8', 'music'],
                    });
                    setVaultSaveState('saved');
                    setTimeout(() => setVaultSaveState('idle'), 3000);
                  } catch (err) {
                    setVaultSaveState('error');
                    setVaultSaveError(err instanceof Error ? err.message : 'Vault save failed');
                  }
                }}
              >
                Save to Vault
              </button>
            )}
            {vaultSaveState === 'error' && vaultSaveError && (
              <span className="text-[10px]" style={{ color: 'var(--ew-status-red, #f87171)' }}>
                {vaultSaveError}
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ew-text-muted)' }}>
            <input
              type="checkbox"
              checked={autoSaveToVault}
              onChange={(e) => {
                setAutoSaveToVault(e.target.checked);
                try { localStorage.setItem('gener8:auto_save_vault', e.target.checked ? '1' : '0'); } catch {}
              }}
            />
            Auto-save to vault
          </label>
        </div>
      )}
    </div>
  );
}
