import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationProgress, GenerateVideoResponse } from '../transport';
import { getVideoSrc } from '../transport';
import { vaultRegisterVideo } from '@everywear/transport';

export type VideoPreviewState =
  | { kind: "idle" }
  | { kind: "generating"; progress: GenerationProgress; jobId: string }
  | { kind: "done"; outputPath: string; response: GenerateVideoResponse }
  | { kind: "error"; message: string };

export interface VideoPreviewProps {
  state: VideoPreviewState;
  onCancel: () => void;
  onRetry: () => void;
}

function formatTime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function VideoPreview({ state, onCancel, onRetry }: VideoPreviewProps) {
  const [vaultSaveState, setVaultSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null);
  const [autoSaveToVault, setAutoSaveToVault] = useState<boolean>(() => {
    try { return localStorage.getItem('3nvizen:auto_save_vault') === '1'; } catch { return false; }
  });

  const handleSaveToVault = useCallback(async () => {
    if (state.kind !== 'done') return;
    setVaultSaveState('saving');
    setVaultSaveError(null);
    try {
      await vaultRegisterVideo({
        title: `Video ${new Date().toISOString().slice(0, 10)}`,
        filePath: state.outputPath,
        durationSeconds: state.response.duration_seconds,
        tags: ['3nvizen', 'video'],
      });
      setVaultSaveState('saved');
      setTimeout(() => setVaultSaveState('idle'), 3000);
    } catch (err) {
      setVaultSaveState('error');
      setVaultSaveError(err instanceof Error ? err.message : 'Vault save failed');
    }
  }, [state]);

  // Auto-save to vault when generation completes
  const prevStateKind = useRef(state.kind);
  useEffect(() => {
    if (prevStateKind.current !== 'done' && state.kind === 'done' && autoSaveToVault) {
      handleSaveToVault();
    }
    prevStateKind.current = state.kind;
  }, [state.kind, autoSaveToVault, handleSaveToVault]);

  const handleDownload = useCallback(() => {
    if (state.kind !== "done") return;
    // Backend serving is available; save-as remains a future Tauri shell polish.
    const src = getVideoSrc(state.outputPath);
    window.open(src, "_blank");
  }, [state]);

  const handleOpenFolder = useCallback(() => {
    if (state.kind !== "done") return;
    // Future UI polish: use Tauri shell.open to open the containing folder.
    // import { open } from '@tauri-apps/plugin-shell';
    // const dir = state.outputPath.replace(/[\\/][^\\/]+$/, '');
    // open(dir);
    console.warn("[3nvizen] Open folder not yet wired to Tauri shell.open");
  }, [state]);

  // ── Idle ──
  if (state.kind === "idle") {
    return (
      <div className="tv-preview tv-preview--idle">
        <div className="tv-preview__empty">
          <div className="tv-preview__empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" fill="none" />
              <polygon points="20,18 32,24 20,30" fill="currentColor" opacity="0.5" />
            </svg>
          </div>
          <div className="tv-preview__empty-title">Generated video will appear here</div>
          <div className="tv-preview__empty-copy">
            Choose a mode, write a prompt, and hit Generate.
          </div>
        </div>
      </div>
    );
  }

  // ── Generating ──
  if (state.kind === "generating") {
    const { progress } = state;
    const pct = ((progress.progress ?? 0) * 100).toFixed(1);
    const stepLabel = progress.step != null && progress.total_steps != null
      ? `${progress.step} / ${progress.total_steps}`
      : null;

    return (
      <div className="tv-preview tv-preview--generating">
        <div className="tv-preview__progress-wrap">
          {/* Phase */}
          <div className="tv-preview__progress-row">
            <span className="tv-preview__progress-label">Phase</span>
            <span className="tv-preview__progress-value">{progress.phase ?? "initializing"}</span>
          </div>

          {/* Step + progress bar */}
          <div className="tv-preview__progress-row">
            <span className="tv-preview__progress-label">Step</span>
            <span className="tv-preview__progress-value">{stepLabel ?? "--"}</span>
          </div>
          <div className="tv-progress-track tv-progress-track--large">
            <div
              className="tv-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* ETA + Elapsed */}
          <div className="tv-preview__progress-row">
            <span className="tv-preview__progress-label">ETA</span>
            <span className="tv-preview__progress-value">{formatTime(progress.eta_seconds)}</span>
          </div>
          <div className="tv-preview__progress-row">
            <span className="tv-preview__progress-label">Elapsed</span>
            <span className="tv-preview__progress-value">{formatTime(progress.elapsed_seconds)}</span>
          </div>

          {/* VRAM */}
          {progress.gpu_info && (
            <div className="tv-preview__progress-row">
              <span className="tv-preview__progress-label">VRAM</span>
              <span className="tv-preview__progress-value tv-preview__progress-value--muted">
                {progress.gpu_info.vram_used_gb.toFixed(1)} / {progress.gpu_info.vram_total_gb.toFixed(1)} GB
              </span>
            </div>
          )}

          {/* Cancel */}
          <button
            className="tv-btn tv-btn--danger tv-btn--outline"
            onClick={onCancel}
          >
            Cancel Generation
          </button>
        </div>
      </div>
    );
  }

  // ── Done ──
  if (state.kind === "done") {
    const videoSrc = getVideoSrc(state.outputPath);

    return (
      <div className="tv-preview tv-preview--done">
        <video
          className="tv-preview__video"
          src={videoSrc}
          controls
          autoPlay
          loop
        />
        <div className="tv-preview__actions">
          <button className="tv-btn tv-btn--primary" onClick={handleDownload}>
            Download
          </button>
          <button className="tv-btn tv-btn--secondary" onClick={handleOpenFolder}>
            Open Folder
          </button>
          {vaultSaveState === 'saved' ? (
            <span className="tv-btn" style={{ color: 'var(--ew-status-green, #4ade80)', cursor: 'default', border: 'none' }}>
              Saved to Vault
            </span>
          ) : vaultSaveState === 'saving' ? (
            <span className="tv-btn" style={{ color: 'var(--ew-text-muted)', cursor: 'default', border: 'none' }}>
              Saving...
            </span>
          ) : (
            <button className="tv-btn tv-btn--secondary" onClick={handleSaveToVault}>
              Save to Vault
            </button>
          )}
        </div>
        {vaultSaveState === 'error' && vaultSaveError && (
          <div style={{ color: 'var(--ew-status-red, #f87171)', fontSize: '11px', marginTop: '4px' }}>
            {vaultSaveError}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--ew-text-muted)', fontSize: '11px', marginTop: '6px' }}>
          <input
            type="checkbox"
            checked={autoSaveToVault}
            onChange={(e) => {
              setAutoSaveToVault(e.target.checked);
              try { localStorage.setItem('3nvizen:auto_save_vault', e.target.checked ? '1' : '0'); } catch {}
            }}
          />
          Auto-save to vault
        </label>
      </div>
    );
  }

  // ── Error ──
  if (state.kind === "error") {
    return (
      <div className="tv-preview tv-preview--error">
        <div className="tv-preview__error-banner">
          <div className="tv-preview__error-message">{state.message}</div>
          <button className="tv-btn tv-btn--primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}
