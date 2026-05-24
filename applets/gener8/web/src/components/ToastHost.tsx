// @ts-nocheck
/**
 * ToastHost — global toast stack singleton (EWDS).
 *
 * Caller pattern:
 *   import { showToast } from '@/components/ToastHost';
 *   showToast({ kind: 'success', message: 'Saved' });
 *   showToast({ kind: 'info', eyebrow: 'Engine · model swap', message: 'Loading XL Base · ~85s', durationMs: 90000 });
 *   showToast({ kind: 'error', message: 'Failed', action: { label: 'Retry', onClick: () => ... } });
 *
 * Mount <ToastHost /> exactly once near the root (App.tsx). Stack: max 3
 * visible, FIFO, bottom-right (above the EW taskbar).
 *
 * Skin behaviour: chamfered surface in classic/refined, sharp in terminal.
 * Driven entirely by tokens, no skin-specific JS.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ShowToastInput {
  kind?: ToastKind;
  /** Optional small mono caps line above message. */
  eyebrow?: string;
  message: string;
  /** Optional action button — most common: { label: 'Undo', onClick: ... } */
  action?: { label: string; onClick: () => void };
  /** ms; default 5000. Pass 0 for persistent (must dismiss manually). */
  durationMs?: number;
  /** Optional id for de-duping or programmatic dismissal. */
  id?: string;
}

interface ToastEntry extends ShowToastInput {
  id: string;
  createdAt: number;
}

const MAX_VISIBLE = 3;
const TOAST_EVENT = 's3:toast:add';
const DISMISS_EVENT = 's3:toast:dismiss';

let toastSeq = 0;
function nextId(): string {
  toastSeq += 1;
  return `t-${Date.now().toString(36)}-${toastSeq}`;
}

export function showToast(input: ShowToastInput): string {
  const id = input.id ?? nextId();
  const detail: ToastEntry = {
    ...input,
    id,
    createdAt: Date.now(),
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ToastEntry>(TOAST_EVENT, { detail }));
  }
  return id;
}

export function dismissToast(id: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>(DISMISS_EVENT, { detail: id }));
  }
}

const KIND_TOKEN: Record<ToastKind, string> = {
  success: 'var(--ew-success)',
  error: 'var(--ew-danger)',
  warning: 'var(--ew-warning)',
  info: 'var(--ew-primary)',
};

interface ToastItemProps {
  entry: ToastEntry;
  onDismiss: (id: string) => void;
}

function ToastItem({ entry, onDismiss }: ToastItemProps) {
  const { id, kind = 'success', eyebrow, message, action, durationMs = 5000 } = entry;
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginLeave = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDismiss(id), 180);
  }, [id, onDismiss]);

  useEffect(() => {
    if (durationMs === 0) return;
    timerRef.current = setTimeout(beginLeave, durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [durationMs, beginLeave]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-leaving={leaving ? 'true' : 'false'}
      data-kind={kind}
      className="ew-toast"
      style={{ borderLeft: `3px solid ${KIND_TOKEN[kind]}` }}
    >
      <div className="ew-toast__body">
        {eyebrow && <span className="ew-eyebrow ew-toast__eyebrow">{eyebrow}</span>}
        <span className="ew-toast__msg">{message}</span>
      </div>
      {action && (
        <button
          type="button"
          className="ew-btn ew-btn--ghost ew-btn--sm ew-toast__action"
          onClick={() => {
            try { action.onClick(); } finally { beginLeave(); }
          }}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        className="ew-toast__close"
        aria-label="Dismiss"
        onClick={beginLeave}
      >
        ×
      </button>
    </div>
  );
}

/** Mount once. The host listens on window for `s3:toast:add` events. */
export function ToastHost() {
  const [stack, setStack] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const detail = (e as CustomEvent<ToastEntry>).detail;
      if (!detail) return;
      setStack(prev => {
        // De-dupe by id if same id is already present.
        if (prev.some(t => t.id === detail.id)) return prev;
        const next = [...prev, detail];
        // Cap stack at MAX_VISIBLE × 3 (queued behind, FIFO).
        return next.slice(-MAX_VISIBLE * 3);
      });
    };
    const onDismiss = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setStack(prev => prev.filter(t => t.id !== id));
    };
    window.addEventListener(TOAST_EVENT, onAdd as EventListener);
    window.addEventListener(DISMISS_EVENT, onDismiss as EventListener);
    return () => {
      window.removeEventListener(TOAST_EVENT, onAdd as EventListener);
      window.removeEventListener(DISMISS_EVENT, onDismiss as EventListener);
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setStack(prev => prev.filter(t => t.id !== id));
  }, []);

  if (stack.length === 0) return null;
  // Only render the most recent MAX_VISIBLE; older queued items wait for slots.
  const visible = stack.slice(-MAX_VISIBLE);

  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div className="ew-toast-stack" aria-live="polite" aria-atomic="false">
      {visible.map(entry => (
        <ToastItem key={entry.id} entry={entry} onDismiss={handleDismiss} />
      ))}
    </div>,
    document.body,
  );
}

export default ToastHost;
