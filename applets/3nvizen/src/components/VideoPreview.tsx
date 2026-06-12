import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationProgress, GenerateVideoResponse } from '../transport';
import { getVideoSrc } from '../transport';
import { vaultFileUrl, vaultOpenPathFolder, vaultRegisterVideo, type VaultItem } from '@everywear/transport';

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedVaultItem, setSavedVaultItem] = useState<VaultItem | null>(null);
  const [autoSaveToVault, setAutoSaveToVault] = useState<boolean>(() => {
    try { return localStorage.getItem('3nvizen:auto_save_vault') === '1'; } catch { return false; }
  });

  const saveToVault = useCallback(async (outputPath: string, response: GenerateVideoResponse) => {
    setVaultSaveState('saving');
    setVaultSaveError(null);
    setActionError(null);
    try {
      const item = await vaultRegisterVideo({
        title: `Video ${new Date().toISOString().slice(0, 10)}`,
        filePath: outputPath,
        durationSeconds: response.duration_seconds,
        tags: ['3nvizen', 'video'],
        sourceAppId: '3nvizen',
        appletScope: '3nvizen',
        libraryScope: 'videos',
      });
      setSavedVaultItem(item);
      setVaultSaveState('saved');
    } catch (err) {
      setVaultSaveState('error');
      setVaultSaveError(err instanceof Error ? err.message : 'Vault save failed');
    }
  }, []);

  const handleSaveToVault = useCallback(() => {
    if (state.kind !== 'done') return;
    if (vaultSaveState === 'saving' || savedVaultItem) return;
    void saveToVault(state.outputPath, state.response);
  }, [saveToVault, savedVaultItem, state, vaultSaveState]);

  // Auto-save to vault when generation completes
  const prevOutputPath = useRef<string | null>(null);
  useEffect(() => {
    const outputPath = state.kind === 'done' ? state.outputPath : null;
    if (prevOutputPath.current !== outputPath) {
      setVaultSaveState('idle');
      setVaultSaveError(null);
      setActionError(null);
      setSavedVaultItem(null);
      if (outputPath && state.kind === 'done' && autoSaveToVault) {
        void saveToVault(outputPath, state.response);
      }
    }
    prevOutputPath.current = outputPath;
  }, [autoSaveToVault, saveToVault, state]);

  const handleDownload = useCallback(() => {
    if (state.kind !== "done") return;
    const src = savedVaultItem?.file_path
      ? vaultFileUrl(savedVaultItem.file_path)
      : getVideoSrc(state.outputPath);
    window.open(src, "_blank");
  }, [savedVaultItem, state]);

  const handleOpenFolder = useCallback(async () => {
    if (state.kind !== "done") return;
    setActionError(null);
    try {
      await vaultOpenPathFolder(savedVaultItem?.file_path ?? state.outputPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Open folder failed');
    }
  }, [savedVaultItem, state]);

  // ── Idle ──
  if (state.kind === "idle") {
    return (
      <div className="tv-preview tv-preview--idle" data-tour="3nvizen.preview">
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
      <div className="tv-preview tv-preview--generating" data-tour="3nvizen.preview">
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
    const videoSrc = savedVaultItem?.file_path
      ? vaultFileUrl(savedVaultItem.file_path)
      : getVideoSrc(state.outputPath);

    return (
      <div className="tv-preview tv-preview--done" data-tour="3nvizen.preview">
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
        {actionError && (
          <div style={{ color: 'var(--ew-status-red, #f87171)', fontSize: '11px', marginTop: '4px' }}>
            {actionError}
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
      <div className="tv-preview tv-preview--error" data-tour="3nvizen.preview">
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
