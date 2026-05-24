// @ts-nocheck
/**
 * ConfirmDialog — portal-level confirmation dialog (EWDS).
 *
 * T4, COWORK-BRIEF v3 §4 (2026-05-02 SGT). Replaces in-card overlay
 * confirmations (e.g. LibraryCore mass-delete) with a real modal that
 * dims the whole OS, not just the parent window.
 *
 * Pass `destructive` for delete/remove actions — the confirm button
 * picks up .ew-btn--danger which reads --ew-danger across all skins.
 */
import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Autofocus confirm so Enter accepts. Esc cancels.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div
      className="ew-dialog-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="ew-dialog ew-dialog--sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ew-dialog__header">
          <h2 id="confirm-dialog-title" className="ew-dialog__title">{title}</h2>
        </header>
        <div className="ew-dialog__body">{body}</div>
        <footer className="ew-dialog__footer">
          <button type="button" className="ew-btn ew-btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`ew-btn ${destructive ? 'ew-btn--danger' : 'ew-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default ConfirmDialog;
