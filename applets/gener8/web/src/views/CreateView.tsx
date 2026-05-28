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
 * Wired to the Everywear shell-owned Gener8 IPC bridge.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Sparkles, Upload, Settings2, ChevronDown, AlertCircle, Music2, Wand2 } from 'lucide-react';
import { useSongStore } from '../context/SongStoreContext';
import { useAuth } from '../context/AuthContext';
import {
  fileToBase64,
  gener8Generate,
  gener8GenerationStatus,
  gener8UploadAudio,
  vaultRegisterAudio,
} from '@everywear/transport';
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
  jobId?: string;
  [key: string]: unknown;
}

interface JobStatus {
  status: 'pending' | 'queued' | 'running' | 'loading' | 'completed' | 'succeeded' | 'failed';
  progress?: number;
  audio_url?: string;
  file_path?: string;
  error?: string;
  title?: string;
  duration?: number;
  result?: {
    audioUrls?: string[];
    audioKey?: string;
    filePath?: string;
    duration?: number;
    bpm?: number;
  };
  [key: string]: unknown;
}

type AudioMode = 'song' | 'reference' | 'cover';

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  duration: 30,
  bpm: 120,
  steps: 50,
  guidanceScale: 7.0,
  seed: -1,
  model: 'ace-step-v1',
};

// ── Component ────────────────────────────────────────────────────

export default function CreateView() {
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>('song');
  const [referenceAudioUrl, setReferenceAudioUrl] = useState('');
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [referenceLabel, setReferenceLabel] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [vaultSaveState, setVaultSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null);
  const [autoSaveToVault, setAutoSaveToVault] = useState<boolean>(() => {
    try { return localStorage.getItem('gener8:auto_save_vault') !== '0'; } catch { return true; }
  });
  const [lastCompletedJob, setLastCompletedJob] = useState<{ id: string; title: string; duration?: number; filePath?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addSong, refetch } = useSongStore();
  const { hasTier } = useAuth();
  const canUseReferenceCover = hasTier('gener8_pro');

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
        const data = await gener8GenerationStatus(jobId) as JobStatus;

        if (typeof data.progress === 'number') {
          setProgress(Math.round(data.progress <= 1 ? data.progress * 100 : data.progress));
        }

        switch (data.status) {
          case 'queued':
            setStatusText('Queued... waiting for engine');
            break;
          case 'running':
            setStatusText(`Generating${typeof data.progress === 'number' ? ` (${Math.round(data.progress <= 1 ? data.progress * 100 : data.progress)}%)` : '...'}`);
            break;
          case 'loading':
            setStatusText(data.message as string || 'Engine loading model into GPU...');
            break;
          case 'succeeded':
          case 'completed':
            stopPolling();
            setStatusText('Complete!');
            setProgress(100);
            const filePath = data.file_path || data.result?.filePath;
            const duration = data.duration ?? data.result?.duration ?? params.duration;
            log.endTrace('generation', 'Music generated', {
              job_id: jobId,
              title: data.title,
              duration_seconds: duration,
            });
            // Refetch song library to pick up the new track
            await refetch();
            setLastCompletedJob({
              id: jobId,
              title: data.title || params.prompt.slice(0, 60),
              duration,
              filePath,
            });
            setVaultSaveState('idle');
            setVaultSaveError(null);
            // Auto-save to vault if enabled
            if (autoSaveToVault && filePath) {
              try {
                setVaultSaveState('saving');
                await vaultRegisterAudio({
                  title: data.title || `Song ${new Date().toISOString().slice(0, 10)}`,
                  filePath,
                  durationSeconds: duration,
                  bpm: params.bpm,
                  assetKind: 'gener8_song',
                  tags: ['gener8', 'music', audioMode],
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
  }, [stopPolling, refetch, autoSaveToVault, params.duration, params.bpm, params.prompt, audioMode]);

  const handleAudioFile = async (file: File) => {
    if (!canUseReferenceCover || audioMode === 'song') return;
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('Audio uploads are limited to 15 MB.');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const data = await gener8UploadAudio({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64: await fileToBase64(file),
      });
      if (audioMode === 'reference') {
        setReferenceAudioUrl(data.audioUrl || data.path);
        setReferenceLabel(file.name);
      } else {
        setSourceAudioUrl(data.audioUrl || data.path);
        setSourceLabel(file.name);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!params.prompt.trim() || isGenerating) return;
    if (audioMode !== 'song' && !canUseReferenceCover) {
      setError('Reference and Cover require Gener8 Pro or Creator Studio.');
      return;
    }
    if (audioMode === 'reference' && !referenceAudioUrl) {
      setError('Upload reference audio before generating.');
      return;
    }
    if (audioMode === 'cover' && !sourceAudioUrl) {
      setError('Upload source audio before creating a cover.');
      return;
    }
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
      const data = await gener8Generate({
          prompt: params.prompt,
          style: params.prompt,
          lyrics: '',
          duration: params.duration,
          bpm: params.bpm,
          inferenceSteps: params.steps,
          guidanceScale: params.guidanceScale,
          seed: params.seed === -1 ? undefined : params.seed,
          synth_model: params.model,
          model: params.model,
          taskType: audioMode === 'cover' ? 'cover' : 'text2music',
          referenceAudioUrl: audioMode === 'reference' ? referenceAudioUrl : undefined,
          sourceAudioUrl: audioMode === 'cover' ? sourceAudioUrl : undefined,
          audioCoverStrength: audioMode === 'cover' ? 1.0 : undefined,
          inferMethod: 'ode',
          audioFormat: 'mp3',
          title: params.prompt.slice(0, 60),
      });
      const jobId = data.jobId || data.id;
      if (!jobId) {
        throw new Error('No job ID returned from engine');
      }

      log.traceEvent('generation', 'Shim accepted request', { job_id: jobId });
      setStatusText('Queued... waiting for engine');
      pollJobStatus(String(jobId));
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
    <div className="s3-family-route flex flex-col h-full p-6 gap-6 max-w-3xl mx-auto">
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
            <option value="ace-step-v1">Gener8 Music Engine</option>
            <option value="ace-step-v1.5">Gener8 Music Engine Pro</option>
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
        <div className="ew-card ew-v2-bevel flex gap-4 flex-wrap p-4">
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

      {/* Audio mode rail */}
      <div className="ew-card ew-v2-bevel flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide text-s3-text-muted">Audio</span>
          <div className="ew-v2-recessed flex items-center gap-1 p-1">
            <button
              type="button"
              className={`ew-btn ew-btn--sm ${audioMode === 'song' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
              onClick={() => {
                setAudioMode('song');
                setReferenceAudioUrl('');
                setSourceAudioUrl('');
                setError(null);
              }}
            >
              <Music2 size={14} />
              Song
            </button>
            <button
              type="button"
              className={`ew-btn ew-btn--sm ${audioMode === 'reference' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
              onClick={() => {
                if (!canUseReferenceCover) {
                  setError('Reference generation requires Gener8 Pro or Creator Studio.');
                  return;
                }
                setAudioMode('reference');
                setSourceAudioUrl('');
                setError(null);
              }}
            >
              <Wand2 size={14} />
              Reference
            </button>
            <button
              type="button"
              className={`ew-btn ew-btn--sm ${audioMode === 'cover' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
              onClick={() => {
                if (!canUseReferenceCover) {
                  setError('Cover generation requires Gener8 Pro or Creator Studio.');
                  return;
                }
                setAudioMode('cover');
                setReferenceAudioUrl('');
                setError(null);
              }}
            >
              Cover
            </button>
          </div>
        </div>
        {audioMode !== 'song' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void handleAudioFile(file);
              }}
            />
            <button
              className="ew-btn ew-btn--ghost ew-btn--sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              {isUploading ? 'Uploading...' : audioMode === 'reference' ? 'Upload Reference' : 'Upload Source'}
            </button>
            <span className="ew-small">
              {audioMode === 'reference'
                ? referenceLabel || 'Style inspiration audio. Pro execution is enforced by the applet runtime.'
                : sourceLabel || 'Source audio for Cover/Remix. Pro execution is enforced by the applet runtime.'}
            </span>
            {uploadError && <span className="text-[10px] text-[var(--ew-danger)]">{uploadError}</span>}
          </div>
        )}
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
        <div className="ew-card ew-v2-bevel flex flex-col gap-2 p-4">
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
                    if (!lastCompletedJob.filePath) {
                      throw new Error('Completed job has no filesystem path yet.');
                    }
                    await vaultRegisterAudio({
                      title: lastCompletedJob.title || `Song ${new Date().toISOString().slice(0, 10)}`,
                      filePath: lastCompletedJob.filePath,
                      durationSeconds: lastCompletedJob.duration ?? 0,
                      bpm: params.bpm,
                      assetKind: 'gener8_song',
                      tags: ['gener8', 'music', audioMode],
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
