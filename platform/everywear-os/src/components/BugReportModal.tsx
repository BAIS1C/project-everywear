/**
 * BugReportModal — Structured bug report with session log attachment.
 *
 * Opens from shell chrome and crash prompts. Collects user description,
 * lets user toggle log categories, and opens an email draft with logs
 * appended where mail clients allow it.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LogCategory, BugReportPayload, SystemInfo } from '@everywear/transport';
import { LOG_CATEGORY_META } from '@everywear/transport';
import { getAllBufferedEntries, getLastError } from '@everywear/shared';

// ── Types ───────────────────────────────────────────────────────────

type SendTarget = 'team' | 'kasai';
type SendState = 'idle' | 'sending' | 'sent' | 'error';

export interface BugReportSeed {
  source?: string;
  description?: string;
  crashKind?: 'frontend' | 'rust' | 'manual';
  occurredAt?: string;
  errorMessage?: string;
  stack?: string;
  componentStack?: string;
  extra?: Record<string, unknown>;
}

interface BugReportModalProps {
  open: boolean;
  onClose: () => void;
  seed?: BugReportSeed | null;
}

// ── Category defaults: checked by default vs opt-in ─────────────────

const DEFAULT_CHECKED: LogCategory[] = ['system', 'applet', 'generation', 'model', 'sidecar', 'vault'];
const OPT_IN_CATEGORIES: LogCategory[] = ['ui', 'disk', 'auth', 'ipc'];
const ALL_CATEGORIES: LogCategory[] = [...DEFAULT_CHECKED, ...OPT_IN_CATEGORIES];
const BUG_REPORT_EMAIL = 'bugreport@metafintek.xyz';
const MAILTO_BODY_LIMIT = 16000;

function truncateForMailto(body: string): string {
  if (body.length <= MAILTO_BODY_LIMIT) return body;
  return `${body.slice(0, MAILTO_BODY_LIMIT)}\n\n[Report truncated for email draft. The full report was copied to clipboard.]`;
}

async function copyReportToClipboard(report: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(report);
  } catch {
    // Clipboard permission can be denied; the email draft still carries a useful excerpt.
  }
}

async function openMailtoDraft(subject: string, body: string): Promise<void> {
  const href = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(truncateForMailto(body))}`;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(href);
  } catch {
    window.location.href = href;
  }
}

// ── Styles (all EWDS tokens) ────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'color-mix(in oklab, var(--ew-bg) 70%, transparent)',
    zIndex: 'var(--ew-z-overlay)' as any,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: 'var(--ew-surface)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 10%, transparent)',
    borderRadius: 'var(--ew-radius-lg)',
    width: '520px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto' as const,
    fontFamily: 'var(--ew-font-body)',
    color: 'var(--ew-text)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--ew-space-4) var(--ew-space-5)',
    borderBottom: '1px solid color-mix(in oklab, var(--ew-text) 8%, transparent)',
  },
  headerTitle: {
    fontFamily: 'var(--ew-font-display)',
    fontWeight: 'var(--ew-fw-display)' as any,
    fontSize: '16px',
    letterSpacing: '0.04em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--ew-text-muted)',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '4px',
    lineHeight: 1,
  },
  body: {
    padding: 'var(--ew-space-4) var(--ew-space-5)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--ew-space-4)',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--ew-text-muted)',
    letterSpacing: '0.02em',
    marginBottom: 'var(--ew-space-1)',
  },
  textarea: {
    width: '100%',
    minHeight: '80px',
    background: 'color-mix(in oklab, var(--ew-text) 4%, transparent)',
    color: 'var(--ew-text)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 10%, transparent)',
    borderRadius: 'var(--ew-radius)',
    padding: 'var(--ew-space-2) var(--ew-space-3)',
    fontFamily: 'var(--ew-font-body)',
    fontSize: '13px',
    resize: 'vertical' as const,
    outline: 'none',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ew-space-2)',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '2px 0',
  },
  checkCount: {
    marginLeft: 'auto',
    color: 'var(--ew-text-muted)',
    fontSize: '11px',
    fontFamily: 'var(--ew-font-mono)',
  },
  radioGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--ew-space-2)',
    fontSize: '13px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ew-space-2)',
    cursor: 'pointer',
  },
  sizeHint: {
    fontSize: '11px',
    color: 'var(--ew-text-muted)',
    fontFamily: 'var(--ew-font-mono)',
  },
  divider: {
    borderTop: '1px solid color-mix(in oklab, var(--ew-text) 8%, transparent)',
    margin: '0',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--ew-space-3)',
    padding: 'var(--ew-space-3) var(--ew-space-5) var(--ew-space-4)',
  },
  btn: {
    background: 'color-mix(in oklab, var(--ew-text) 8%, transparent)',
    color: 'var(--ew-text)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 12%, transparent)',
    borderRadius: 'var(--ew-radius)',
    padding: '6px 14px',
    fontSize: '12px',
    fontFamily: 'var(--ew-font-body)',
    cursor: 'pointer',
    transition: `background var(--ew-t-fast) var(--ew-ease)`,
  },
  btnPrimary: {
    background: 'var(--ew-primary)',
    color: 'var(--ew-bg)',
    border: 'none',
    borderRadius: 'var(--ew-radius)',
    padding: '6px 14px',
    fontSize: '12px',
    fontFamily: 'var(--ew-font-body)',
    fontWeight: 600,
    cursor: 'pointer',
    transition: `opacity var(--ew-t-fast) var(--ew-ease)`,
  },
  successMsg: {
    color: 'var(--ew-status-green)',
    fontSize: '12px',
    textAlign: 'center' as const,
    padding: 'var(--ew-space-3)',
  },
  errorMsg: {
    color: 'var(--ew-status-red)',
    fontSize: '12px',
  },
} as const;

// ── Component ───────────────────────────────────────────────────────

export function BugReportModal({ open, onClose, seed }: BugReportModalProps) {
  const [description, setDescription] = useState('');
  const [checkedCategories, setCheckedCategories] = useState<Set<LogCategory>>(
    new Set(DEFAULT_CHECKED),
  );
  const [target, setTarget] = useState<SendTarget>('team');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  // Pre-fill description from crash context or the last logged error.
  useEffect(() => {
    if (open) {
      const lastErr = getLastError();
      if (seed?.description) {
        setDescription(seed.description);
      } else if (lastErr) {
        setDescription(`Error in ${lastErr.source}: ${lastErr.message}`);
      } else {
        setDescription('');
      }
      if (seed?.crashKind) {
        setCheckedCategories(new Set([...DEFAULT_CHECKED, 'ui', 'ipc']));
      }
      setSendState('idle');
      setSendError(null);
      setReportId(null);
    }
  }, [open, seed]);

  // ── Category entry counts ─────────────────────────────────────

  const allEntries = useMemo(() => getAllBufferedEntries(), [open]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;
    for (const e of allEntries) {
      if (counts[e.category] !== undefined) counts[e.category]++;
    }
    return counts;
  }, [allEntries]);

  const selectedEntries = useMemo(
    () => allEntries.filter(e => checkedCategories.has(e.category)),
    [allEntries, checkedCategories],
  );

  const estimatedSizeKb = useMemo(() => {
    const json = JSON.stringify(selectedEntries);
    return Math.round(json.length / 1024);
  }, [selectedEntries]);

  // ── Toggle category ───────────────────────────────────────────

  const toggleCategory = useCallback((cat: LogCategory) => {
    setCheckedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  // ── Send handlers ─────────────────────────────────────────────

  const buildPayload = useCallback(async (): Promise<BugReportPayload> => {
    let systemInfo: SystemInfo = {
      os: navigator.platform,
      os_version: '',
      gpu_name: 'Unknown',
      vram_total_gb: 0,
      cuda_version: '',
      app_version: '0.1.0',
      session_duration_seconds: 0,
      models_available: [],
      sidecars_running: [],
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // CODEX_NEEDED: Backend command "get_system_info"
      // Args: {}
      // Returns: SystemInfo { os, os_version, gpu_name, vram_total_gb, cuda_version, app_version, session_duration_seconds, models_available, sidecars_running }
      systemInfo = await invoke<SystemInfo>('get_system_info');
    } catch { /* use defaults */ }

    return {
      session_id: selectedEntries[0]?.session_id ?? 'unknown',
      user_description: description,
      included_categories: [...checkedCategories],
      entries: selectedEntries,
      system_info: systemInfo,
    };
  }, [description, checkedCategories, selectedEntries]);

  const buildReportText = useCallback((payload: BugReportPayload): string => {
    const lines = [
      `Bug Report - ${new Date().toISOString()}`,
      `Session: ${payload.session_id}`,
      `Send to: ${BUG_REPORT_EMAIL}`,
      '',
      'Description:',
      payload.user_description || '(No description provided)',
      '',
    ];

    if (seed) {
      lines.push(
        'Crash context:',
        `Source: ${seed.source || 'unknown'}`,
        `Kind: ${seed.crashKind || 'manual'}`,
        `Occurred: ${seed.occurredAt || 'unknown'}`,
        `Error: ${seed.errorMessage || 'unknown'}`,
      );
      if (seed.stack) lines.push('', 'Stack:', seed.stack);
      if (seed.componentStack) lines.push('', 'React component stack:', seed.componentStack);
      if (seed.extra) lines.push('', 'Extra:', JSON.stringify(seed.extra, null, 2));
      lines.push('');
    }

    lines.push(
      `System: ${payload.system_info.os} ${payload.system_info.os_version}`,
      `GPU: ${payload.system_info.gpu_name} (${payload.system_info.vram_total_gb}GB)`,
      `CUDA: ${payload.system_info.cuda_version}`,
      `App: ${payload.system_info.app_version}`,
      `Categories: ${payload.included_categories.join(', ')}`,
      '',
      `Log entries (${payload.entries.length}):`,
      ...payload.entries.map(e =>
        `${e.timestamp} ${e.level.toUpperCase().padEnd(5)} [${e.category}/${e.source}] ${e.message}${e.details ? ' ' + JSON.stringify(e.details) : ''}`
      ),
    );

    return lines.join('\n');
  }, [seed]);

  const handleSendToTeam = useCallback(async () => {
    setSendState('sending');
    setSendError(null);
    try {
      const payload = await buildPayload();
      const reportText = buildReportText(payload);
      const subjectPrefix = seed?.crashKind ? 'Everywear crash report' : 'Everywear bug report';
      await copyReportToClipboard(reportText);
      await openMailtoDraft(subjectPrefix, reportText);
      setReportId(BUG_REPORT_EMAIL);
      setSendState('sent');
    } catch (err) {
      setSendState('error');
      setSendError(err instanceof Error ? err.message : 'Failed to open email draft');
    }
  }, [buildPayload, buildReportText, seed]);

  const handleSendToKasai = useCallback(async () => {
    setSendState('sending');
    setSendError(null);
    try {
      const payload = await buildPayload();
      await copyReportToClipboard(buildReportText(payload));
      setSendState('error');
      setSendError('Local Kasai diagnostics is not connected yet. The full report was copied to clipboard.');
    } catch (err) {
      setSendState('error');
      setSendError(err instanceof Error ? err.message : 'Failed to send to Kasai');
    }
  }, [buildPayload, buildReportText]);

  const handleSend = useCallback(() => {
    if (target === 'team') handleSendToTeam();
    else handleSendToKasai();
  }, [target, handleSendToTeam, handleSendToKasai]);

  // ── Copy to clipboard ─────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    const payload = await buildPayload();
    await copyReportToClipboard(buildReportText(payload));
  }, [buildPayload, buildReportText]);

  // ── Render ────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>Report a Problem</span>
          <button style={s.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {sendState === 'sent' ? (
          <div style={s.successMsg}>
            Email draft opened for {reportId || BUG_REPORT_EMAIL}. The full report was copied to clipboard.
          </div>
        ) : (
          <>
            <div style={s.body}>
              {/* Description */}
              <div>
                <div style={s.label}>What went wrong?</div>
                <textarea
                  style={s.textarea}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what happened..."
                />
              </div>

              {/* Category checkboxes */}
              <div>
                <div style={s.label}>Include in report:</div>
                {ALL_CATEGORIES.map(cat => {
                  const meta = LOG_CATEGORY_META[cat];
                  const count = categoryCounts[cat] || 0;
                  return (
                    <label key={cat} style={s.checkRow}>
                      <input
                        type="checkbox"
                        checked={checkedCategories.has(cat)}
                        onChange={() => toggleCategory(cat)}
                      />
                      <span>{meta.label} <span style={{ color: 'var(--ew-text-muted)' }}>({meta.description})</span></span>
                      <span style={s.checkCount}>{count} entries</span>
                    </label>
                  );
                })}
                <div style={{ ...s.sizeHint, marginTop: 'var(--ew-space-2)' }}>
                  Estimated size: ~{estimatedSizeKb} KB
                </div>
              </div>

              {/* Send target */}
              <div>
                <div style={s.label}>Send to:</div>
                <div style={s.radioGroup}>
                  <label style={s.radioLabel}>
                    <input
                      type="radio"
                      name="target"
                      checked={target === 'team'}
                      onChange={() => setTarget('team')}
                    />
                    Everywear Team via Email
                  </label>
                  <label style={s.radioLabel}>
                    <input
                      type="radio"
                      name="target"
                      checked={target === 'kasai'}
                      onChange={() => setTarget('kasai')}
                    />
                    Local Kasai for diagnostics
                  </label>
                </div>
              </div>

              {sendError && <div style={s.errorMsg}>{sendError}</div>}
            </div>

            <hr style={s.divider} />

            {/* Footer actions */}
            <div style={s.footer}>
              <button style={s.btn} onClick={handleCopy}>Copy to Clipboard</button>
              <button
                style={{
                  ...s.btnPrimary,
                  opacity: sendState === 'sending' ? 0.6 : 1,
                }}
                onClick={handleSend}
                disabled={sendState === 'sending'}
              >
                {sendState === 'sending' ? 'Sending...' : 'Send Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
