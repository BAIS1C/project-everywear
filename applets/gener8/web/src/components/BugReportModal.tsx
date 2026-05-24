// @ts-nocheck
/**
 * BugReportModal — structured prompt + mailto.
 *
 * Replaces the v0 bare mailto onClick that lived in Window.tsx by
 * wrapping the email composition in a modal. The modal collects:
 *   - Description (required, primary signal)
 *   - Severity (low / medium / high / blocker)
 *   - Optional screenshot capture of the window (copied to clipboard
 *     so the user can paste it inline once the mail draft opens)
 *
 * On Submit the modal fires `mailto:bugs@s3studio.xyz` with subject
 * + body prefilled (description + severity + window context). The
 * user's mail client opens, they review, attach logs from the S³
 * Studio launcher's Settings -> Logs panel if relevant, and Send.
 *
 * Why mailto and not a server relay: zero infra, the user's email
 * identity is captured automatically (their From: address), the user
 * reviews before sending, works on every device with a configured
 * mail client. Tradeoff: programmatic attachments are blocked by
 * browser security. Screenshot rides via clipboard, log files ride
 * via user-side attach in the mail client.
 *
 * Sean 2026-04-26 SGT (rev 3: mailto path, no Supabase, no Resend).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bug, X, Send, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import styles from './BugReportModal.module.css';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  appId: string;
  windowTitle: string;
  captureTarget?: HTMLElement | null;
}

type Severity = 'low' | 'medium' | 'high' | 'blocker';
type Phase = 'compose' | 'submitting' | 'success' | 'error';

const SEVERITY_OPTIONS: { value: Severity; label: string; description: string }[] = [
  { value: 'low',     label: 'Low',     description: 'Cosmetic / minor UX' },
  { value: 'medium',  label: 'Medium',  description: 'Workaround exists' },
  { value: 'high',    label: 'High',    description: 'Feature broken' },
  { value: 'blocker', label: 'Blocker', description: 'Cannot use the app' },
];

export default function BugReportModal({
  isOpen,
  onClose,
  appId,
  windowTitle,
  captureTarget,
}: BugReportModalProps) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [phase, setPhase] = useState<Phase>('compose');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when the modal opens. Screenshot capture removed
  // 2026-05-02 SGT per Sean: the html-to-image + clipboard write
  // path was not landing reliably across browsers and the modal
  // captureTarget surface area never matched what the user
  // actually wanted to attach. Users grab their own screenshots
  // (Win+Shift+S / Cmd+Shift+4) and paste into the mail draft.
  useEffect(() => {
    if (!isOpen) return;
    setDescription('');
    setSeverity('medium');
    setPhase('compose');
    setErrorMessage('');
    const t = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 4) {
      setErrorMessage('Add a quick description so we can reproduce it.');
      return;
    }
    setPhase('submitting');
    setErrorMessage('');

    try {
      const subject = `[S³ Studio · ${appId}] ${severity.toUpperCase()} — ${windowTitle}`;
      const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const lines = [
        '--- Description ---',
        description.trim(),
        '',
        '--- Context (auto-attached) ---',
        `Window:     ${windowTitle} (${appId})`,
        `Severity:   ${severity}`,
        `URL:        ${pageUrl}`,
        `User-Agent: ${ua}`,
        `Time:       ${new Date().toISOString()}`,
        '',
        '--- Attachments (your turn) ---',
        'Screenshot: grab one with Win+Shift+S / Cmd+Shift+4 and paste into this email.',
        'Logs: open the S³ Studio launcher → Settings → Logs and attach the relevant file(s).',
        '',
      ];
      const body = lines.join('\n');
      const mailto =
        `mailto:bugs@s3studio.xyz` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;

      // mailto opens the user's default mail client. Some browsers
      // surface an "Open in Mail?" prompt the first time; users who
      // dismiss it can fall back to copying the body from clipboard
      // (we copy as a safety net below).
      window.location.href = mailto;

      // Belt-and-braces: also copy the email body to clipboard so the
      // user can paste it into webmail if their OS mail client
      // doesn't pop or they prefer Gmail / Outlook in the browser.
      try {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
        }
      } catch {
        // Non-fatal.
      }

      setPhase('success');
      setTimeout(() => onClose(), 1800);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[BugReportModal] mailto compose failed:', err);
      const msg = err instanceof Error ? err.message : 'Could not open mail client.';
      setErrorMessage(msg);
      setPhase('error');
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className={styles.backdrop}
      data-bug-report-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'submitting') onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Report a bug">
        <header className={styles.header}>
          <Bug size={16} className={styles.headerIcon} />
          <span className={styles.headerTitle}>Report a bug</span>
          <span className={styles.headerContext}>
            {windowTitle} <span className={styles.headerAppId}>{`· ${appId}`}</span>
          </span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={phase === 'submitting'}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        {phase === 'success' ? (
          <div className={styles.successPane}>
            <CheckCircle2 size={28} className={styles.successIcon} />
            <p className={styles.successText}>Mail draft opened. Send when ready.</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              <span className={styles.labelText}>What went wrong?</span>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Steps to reproduce, expected vs actual, anything weird you spotted."
                rows={4}
                disabled={phase === 'submitting'}
                maxLength={4000}
              />
            </label>

            <fieldset className={styles.severityRow} disabled={phase === 'submitting'}>
              <legend className={styles.labelText}>Severity</legend>
              <div className={styles.severityChips}>
                {SEVERITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.severityChip} ${severity === opt.value ? styles.severityChipActive : ''}`}
                    onClick={() => setSeverity(opt.value)}
                    title={opt.description}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className={styles.logsHint}>
              <span className={styles.logsHintTitle}>Screenshot + logs (your turn, attached in your mail client)</span>
              <span className={styles.logsHintBody}>
                Grab a screenshot with Win+Shift+S / Cmd+Shift+4 and paste into the mail draft. For logs, open the S³ Studio launcher → Settings → Logs and drag the relevant file into your email.
              </span>
            </div>

            {phase === 'error' && errorMessage && (
              <div className={styles.errorBanner}>
                <AlertTriangle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            <footer className={styles.footer}>
              <span className={styles.contextHint}>
                Submit opens your mail client with window context, URL, and user-agent prefilled.
              </span>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={phase === 'submitting'}
              >
                {phase === 'submitting' ? (
                  <>
                    <Loader2 size={14} className={styles.spin} />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Submit</span>
                  </>
                )}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

