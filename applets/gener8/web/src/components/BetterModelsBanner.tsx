// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   BetterModelsBanner — Reference / Cover panel base-model download UX
   ───────────────────────────────────────────────────────────────────
   Authored 2026-05-03 LATE NIGHT SGT (handover P3.3 + P3.4 + P3.5).

   What it does
     1. On mount + on tier transition, asks the shell-owned Gener8 model
        inventory whether the Pro capability model is visible.
     2. If the user is on Pro+ AND the pack is missing, render an inline
        banner inside the Reference / Cover panel.
     3. On action, re-check the shell inventory and hand provisioning back
        to the shell lifecycle path. This applet no longer owns model
        downloads or private shim endpoints.

   Why a single component: keeps the SSE parser, modal state, and banner
   render co-located. CreatePanel just drops `<BetterModelsBanner show=...
   />` near the Reference/Cover audio body. No external state, no Redux.

   Tier gate semantics: hasTier('gener8_pro') && !isTrialActive matches
   the canRemoveWatermark gate from AuthContext — only PAID Pro users
   see the banner. Trial users see the existing Turbo warning (rendered
   in CreatePanel directly) but no download path; they need to subscribe
   first. This prevents trial-tier users from monopolising bandwidth on
   a download whose entitlement expires in 60 minutes.

   Tier-mapping note: Reference + Cover are Gener8 Pro features; pro_base
   is the public Pro capability pack id. The shell inventory is the source
   of truth for whether the capability model is available.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle, X, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { showToast } from './ToastHost';
import { gener8EngineModels } from '@everywear/transport';

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

function inventoryHasProModel(inventory: unknown): boolean {
  const text = JSON.stringify(inventory ?? {}).toLowerCase();
  return text.includes('xl-base')
    || text.includes('pro_base')
    || text.includes('stem')
    || text.includes('reference')
    || text.includes('cover');
}

async function readShellPackStatus(): Promise<PackStatus> {
  const inventory = await gener8EngineModels();
  return {
    pack_id: PACK_ID,
    present: inventoryHasProModel(inventory),
    bytes_total: 0,
    vram_mb: 0,
    plan: [],
  };
}

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
    readShellPackStatus()
      .then((data) => {
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
      currentRole: 'Checking shell inventory',
    });
    showToast({
      kind: 'info',
      eyebrow: 'Everywear · model lifecycle',
      message: 'Gener8 Pro requested the Pro Model. Everywear is checking the shell-owned model inventory.',
      durationMs: 6500,
    });

    try {
      const nextStatus = await readShellPackStatus();
      setStatus(nextStatus);
      if (!nextStatus.present) {
        setPhase({
          kind: 'error',
          message: 'The shell model inventory does not expose a Pro capability model yet. Open the shell model lifecycle path to provision it.',
        });
        showToast({
          kind: 'warning',
          eyebrow: 'Everywear · model lifecycle',
          message: 'Pro Model is not visible in shell inventory. LifecycleHud must provision it outside this applet.',
          durationMs: 9000,
        });
        return;
      }
      setPhase({ kind: 'done' });
      showToast({
        kind: 'success',
        eyebrow: 'Everywear · model lifecycle',
        message: 'Pro Model is visible in shell inventory. Capability tasks are ready.',
        durationMs: 6500,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setPhase({
        kind: 'error',
        message,
      });
      showToast({
        kind: 'error',
        eyebrow: 'Everywear · model lifecycle',
        message,
        durationMs: 9000,
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
              <span className="font-semibold">Provision Pro Model.</span>{' '}
              Reference and Cover require the shell-managed Pro Model.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="ew-btn ew-btn--sm ew-btn--primary w-full justify-center mt-2"
          >
            Check Pro Model
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
      ? 'Checking Pro Model'
              : 'Check Pro Model'}
          </h2>
        </div>

        {phase.kind === 'idle' && (
          <>
            <p
              className="text-xs mb-4"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              Provision the Pro capability model for full-quality Cover,
              Reference, DAW stems, Lego, Complete, and Creator Studio
              rendering through the Everywear shell lifecycle path. Song
              generation can keep using the faster Gener8 model; the app
              swaps automatically for capability tasks.
            </p>
            <p
              className="text-[10px] mb-4 italic"
              style={{ color: 'var(--ew-text-muted)' }}
            >
              This applet only verifies inventory. LifecycleHud owns the
              install path and disk-space checks.
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
                Check Inventory
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
                : 'Checking shell inventory...'}
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
              The shell publishes model inventory and progress outside this applet.
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
              available in the shell inventory. The app will use the Pro
              Model automatically for capability tasks.
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
              have the full error trace. Common causes: launcher not running
              or model lifecycle not publishing inventory yet.
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
                Check Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BetterModelsBanner;
