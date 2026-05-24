// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   BetterModelsBanner — Reference / Cover panel base-model download UX
   ───────────────────────────────────────────────────────────────────
   Authored 2026-05-03 LATE NIGHT SGT (handover P3.3 + P3.4 + P3.5).

   What it does
     1. On mount + on tier transition, GET /api/engine/pack-status?pack_id
        =better_models to learn whether the XL Base DiT is on disk and how
        big the download would be.
     2. If the user is on Pro+ AND the pack is missing, render an inline
        banner inside the Reference / Cover panel: "Reference and Cover
        require the Pro Model. [Download Pro Model]".
     3. On Download Pro Model click, open a consent modal showing the byte
        total + a confirm button. (Disk-space check via Tauri fs API
        deferred; the launcher's models dir is in %LOCALAPPDATA% and
        most modern installs have plenty of headroom. The modal shows
        the total so the user can self-check.)
     4. On confirm, POST /api/engine/install-pack with body { pack_id }
        and parse the response as Server-Sent Events. Render a progress
        bar driven by the `progress` events. On `done` / `pack_done`,
        celebrate + auto-close after a short delay. On `error`, show
        the message + a Retry button.

   Why a single component: keeps the SSE parser, modal state, and banner
   render co-located. CreatePanel just drops `<BetterModelsBanner show=...
   />` near the Reference/Cover audio body. No external state, no Redux.

   Tier gate semantics: hasTier('gener8_pro') && !isTrialActive matches
   the canRemoveWatermark gate from AuthContext — only PAID Pro users
   see the banner. Trial users see the existing Turbo warning (rendered
   in CreatePanel directly) but no download path; they need to subscribe
   first. This prevents trial-tier users from monopolising bandwidth on
   a download whose entitlement expires in 60 minutes.

   Tier-mapping note (Sean 2026-05-03 LATE NIGHT SGT): Reference + Cover
   are Gener8 Pro features; better_models pack is the Pro entitlement.
   Creator Studio adds StyleForge / DAW / AI Director / Stem on top.
   The shim's pack_entitled() in shim.rs mirrors this: better_models is
   accepted for Gener8Pro and CreatorStudio tiers, rejected otherwise.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle, X, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const SHIM_BASE = 'http://127.0.0.1:3001';
// 2026-05-21 SGT — pro_base means the true capability model. Do not
// substitute the SFTTurbo50 song model or save it under a Base filename.
const PACK_ID = 'pro_base';

interface PackStatus {
  pack_id: string;
  present: boolean;
  bytes_total: number;
  vram_mb: number;
  plan: Array<{
    filename: string;
    role: string;
    quant: string;
    size_bytes: number;
  }>;
}

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'downloading';
      pct: number;
      bytesDone: number;
      bytesTotal: number;
      currentFile: string;
      currentRole: string;
    }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

interface Props {
  /** Render condition — pass true when the audio source pill is reference or cover. */
  show: boolean;
  /** Optional callback when the pack finishes installing. CreatePanel can use
   *  this to trigger a model-list refresh. */
  onInstalled?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${bytes} B`;
};

export const BetterModelsBanner: React.FC<Props> = ({ show, onInstalled }) => {
  const { hasTier, isTrialActive } = useAuth();
  const isPaidPro = hasTier('gener8_pro') && !isTrialActive;

  const [status, setStatus] = useState<PackStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const onInstalledRef = useRef(onInstalled);

  useEffect(() => {
    onInstalledRef.current = onInstalled;
  }, [onInstalled]);

  // Fetch pack status on visibility / tier transition. Best-effort: if
  // the launcher isn't running (web-only session), the catch swallows the
  // network error and the banner stays hidden.
  useEffect(() => {
    if (!show || !isPaidPro) {
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    setStatusLoading(true);
    fetch(`${SHIM_BASE}/api/engine/pack-status?pack_id=${PACK_ID}`, {
      credentials: 'omit',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PackStatus | null) => {
        if (cancelled) return;
        setStatus(data);
        setStatusLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
        setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [show, isPaidPro]);

  const startDownload = useCallback(async () => {
    if (!status) return;
    setPhase({
      kind: 'downloading',
      pct: 0,
      bytesDone: 0,
      bytesTotal: status.bytes_total,
      currentFile: '',
      currentRole: 'Connecting',
    });

    try {
      const res = await fetch(`${SHIM_BASE}/api/engine/install-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: PACK_ID }),
        credentials: 'omit',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setPhase({
          kind: 'error',
          message: `Install rejected (${res.status}): ${text || res.statusText}`,
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setPhase({ kind: 'error', message: 'No response body from launcher.' });
        return;
      }

      // Minimal SSE parser. Frames are delimited by \n\n; within a frame
      // each line is `event: <name>` or `data: <json>`.
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);

          let frameEvent = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue; // comment
            if (line.startsWith('event:')) {
              frameEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }
          currentEvent = frameEvent;
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n');
            try {
              const data = JSON.parse(payload);
              if (currentEvent === 'progress') {
                setPhase({
                  kind: 'downloading',
                  pct: typeof data.overall_pct === 'number' ? data.overall_pct : 0,
                  bytesDone:
                    typeof data.bytes_done_global === 'number'
                      ? data.bytes_done_global
                      : 0,
                  bytesTotal:
                    typeof data.bytes_total_global === 'number'
                      ? data.bytes_total_global
                      : status.bytes_total,
                  currentFile: data.file ?? '',
                  currentRole: data.role ?? '',
                });
              } else if (currentEvent === 'done' || currentEvent === 'pack_done') {
                setPhase({ kind: 'done' });
              } else if (currentEvent === 'error') {
                setPhase({
                  kind: 'error',
                  message: data.error || 'Install failed.',
                });
              }
              // 'plan' and 'file_done' events are informational; the
              // progress handler covers UI updates.
            } catch {
              // Ignore frames we can't parse — the next progress tick
              // will refresh the state.
            }
          }

          frameEnd = buffer.indexOf('\n\n');
        }
      }

      // Stream ended without a 'done' event — treat as success if we
      // got any progress at all, error otherwise.
      setPhase((prev) =>
        prev.kind === 'downloading' && prev.pct >= 99
          ? { kind: 'done' }
          : prev.kind === 'downloading'
          ? {
              kind: 'error',
              message: 'Connection ended before download finished.',
            }
          : prev,
      );
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [status]);

  // Auto-close + onInstalled callback on success.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    setStatus((prev) => (prev ? { ...prev, present: true } : prev));
    onInstalledRef.current?.();
  }, [phase.kind]);

  // Don't render anything when not visible / not paid Pro / status unknown / pack present.
  if (!show || !isPaidPro || statusLoading || !status || status.present) {
    return null;
  }

  return (
    <>
      <div className="px-3 pt-2">
        <div
          className="ew-card p-3"
          style={{
            background: 'color-mix(in srgb, var(--ew-primary) 14%, transparent)',
            borderColor: 'color-mix(in srgb, var(--ew-primary) 40%, transparent)',
          }}
        >
          <div className="flex items-start gap-2">
            <Download size={14} className="text-cyan-400 shrink-0 mt-0.5" />
            <p className="text-[10px]" style={{ color: 'var(--ew-text)' }}>
              <span className="font-semibold">Download Pro Model.</span>{' '}
              Reference and Cover require the Pro Model.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="ew-btn ew-btn--sm ew-btn--primary w-full justify-center mt-2"
          >
            Download Pro Model
          </button>
        </div>
      </div>

      {modalOpen && (
        <ConsentProgressModal
          status={status}
          phase={phase}
          onConfirm={startDownload}
          onClose={() => {
            // Don't allow close mid-download; user can wait or restart launcher
            if (phase.kind === 'downloading') return;
            setModalOpen(false);
            setPhase({ kind: 'idle' });
          }}
        />
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────
//  Consent + Progress modal
// ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  status: PackStatus;
  phase: Phase;
  onConfirm: () => void;
  onClose: () => void;
}

const ConsentProgressModal: React.FC<ModalProps> = ({
  status,
  phase,
  onConfirm,
  onClose,
}) => {
  const sizeLabel = formatBytes(status.bytes_total);

  const isDownloading = phase.kind === 'downloading';
  const isDone = phase.kind === 'done';
  const isError = phase.kind === 'error';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="ew-card relative w-full max-w-md p-5"
        style={{
          background: 'var(--ew-bg-raised, var(--ew-bg))',
          border: '1px solid var(--ew-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!isDownloading && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-3 right-3 text-zinc-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        )}

        <div className="flex items-center gap-2 mb-3">
          {isDone ? (
            <Check size={18} className="text-green-400" />
          ) : isError ? (
            <AlertTriangle size={18} className="text-amber-400" />
          ) : isDownloading ? (
            <Loader2 size={18} className="animate-spin text-cyan-400" />
          ) : (
            <Download size={18} className="text-cyan-400" />
          )}
          <h2
            className="text-sm font-bold uppercase tracking-wider"
            style={{ color: 'var(--ew-text)' }}
          >
            {isDone
              ? 'Pro Model Installed'
              : isError
              ? 'Download Failed'
              : isDownloading
              ? 'Downloading Pro Model'
              : 'Download Pro Model'}
          </h2>
        </div>

        {phase.kind === 'idle' && (
          <>
            <p
              className="text-xs mb-4"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              Install the Pro capability model for full-quality Cover,
              Reference, DAW stems, Lego, Complete, and Creator Studio
              rendering. Song generation can keep using the faster Gener8
              model; the app swaps automatically for capability tasks.
              Stays on disk; works offline once installed.
            </p>
            <p
              className="text-[10px] mb-4 italic"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              This is a one-time download of about {sizeLabel}. You can keep
              working in S³ Studio while it runs in the background.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="ew-btn ew-btn--sm ew-btn--ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="ew-btn ew-btn--sm ew-btn--primary"
              >
                Confirm &amp; Download
              </button>
            </div>
          </>
        )}

        {isDownloading && (
          <>
            <p
              className="text-xs mb-3"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              {phase.currentRole
                ? `Fetching ${phase.currentRole}...`
                : 'Connecting to model server…'}
            </p>
            <div
              className="w-full h-2 rounded-full overflow-hidden mb-2"
              style={{ background: 'var(--ew-surface-sunken)' }}
            >
              <div
                className="h-full transition-all duration-200 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, phase.pct))}%`,
                  background: 'var(--ew-primary)',
                  boxShadow: '0 0 12px var(--ew-primary)',
                }}
              />
            </div>
            <p
              className="text-[10px] font-mono tabular-nums"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              {formatBytes(phase.bytesDone)} / {formatBytes(phase.bytesTotal)}{' '}
              ({phase.pct.toFixed(1)}%)
            </p>
            <p
              className="text-[10px] mt-3 italic"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              Don't close the launcher. The download resumes automatically if
              the connection blips.
            </p>
          </>
        )}

        {isDone && (
          <>
            <p
              className="text-xs mb-2"
              style={{ color: 'var(--ew-text)' }}
            >
              Full-quality Cover, Reference, and stem workflows are now
              available. The app will use the Pro Model automatically for
              capability tasks.
            </p>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={onClose}
                className="ew-btn ew-btn--sm ew-btn--primary"
              >
                Close
              </button>
            </div>
          </>
        )}

        {isError && (
          <>
            <p
              className="text-xs mb-3"
              style={{ color: 'var(--ew-warning, #f59e0b)' }}
            >
              {phase.message}
            </p>
            <p
              className="text-[10px] mb-4"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              The launcher's logs at{' '}
              <code className="font-mono">
                %LOCALAPPDATA%\S3-Gener8\logs\s3-gener8.log
              </code>{' '}
              have the full error trace. Common causes: launcher not running,
              insufficient disk space, network drop.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="ew-btn ew-btn--sm ew-btn--ghost"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="ew-btn ew-btn--sm ew-btn--primary"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BetterModelsBanner;
