/**
 * ToolCallCard — Inline tool-call renderer for Kasai chat timeline.
 *
 * Subscribes to kasai://tool-call/update and kasai://tool-call/complete events
 * emitted by Codex's K1-K6 tool-call event system, and renders a card showing
 * status, arguments, result, duration, source slot, and audit badge.
 *
 * This component is shared between the shell and Kasai applet.
 */

import React, { useState, useCallback } from 'react';

// ── Types (from CLAUDE_INTERFACE) ──────────────────────────────────

export type ToolCallStatus =
  | 'Pending'
  | 'Executing'
  | 'Success'
  | 'Failed'
  | 'Timeout'
  | 'Rejected';

export type AuditResult = 'Pending' | 'Approved' | 'Rejected';

export interface ToolCallInfo {
  index: number;
  session_id: string;
  timestamp: number;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  source_slot?: string;
  audit_result?: AuditResult;
}

// ── Icon mapping ───────────────────────────────────────────────────

function toolIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('shell') || lower.includes('exec') || lower.includes('command')) return '>_';
  if (lower.includes('file') || lower.includes('read') || lower.includes('write') || lower.includes('dir')) return '\u{1F4C1}';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http')) return '\u{1F310}';
  if (lower.includes('search') || lower.includes('grep')) return '\u{1F50D}';
  if (lower.includes('memory') || lower.includes('mymory') || lower.includes('vault')) return '\u{1F9E0}';
  return '\u{1F527}'; // wrench default
}

// ── Status badge ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: ToolCallStatus }) {
  const config: Record<ToolCallStatus, { label: string; className: string }> = {
    Pending: { label: 'Pending', className: 'tcc-status--pending' },
    Executing: { label: 'Executing', className: 'tcc-status--executing' },
    Success: { label: 'Success', className: 'tcc-status--success' },
    Failed: { label: 'Failed', className: 'tcc-status--failed' },
    Timeout: { label: 'Timeout', className: 'tcc-status--timeout' },
    Rejected: { label: 'Rejected', className: 'tcc-status--rejected' },
  };
  const c = config[status] ?? config.Pending;

  return (
    <span className={`tcc-status ${c.className}`}>
      {status === 'Executing' && <span className="tcc-spinner" />}
      {status === 'Success' && <span className="tcc-icon-check">{'✓'}</span>}
      {status === 'Failed' && <span className="tcc-icon-x">{'✗'}</span>}
      {status === 'Timeout' && <span className="tcc-icon-timer">{'⏱'}</span>}
      {status === 'Rejected' && <span className="tcc-icon-shield">{'\u{1F6E1}'}</span>}
      {c.label}
    </span>
  );
}

// ── Audit badge ────────────────────────────────────────────────────

function AuditBadge({ result }: { result: AuditResult }) {
  if (result === 'Pending') return null;
  return (
    <span className={`tcc-audit ${result === 'Approved' ? 'tcc-audit--approved' : 'tcc-audit--rejected'}`}>
      {result === 'Approved' ? '✓ Approved' : '✗ Rejected'}
    </span>
  );
}

// ── Collapsible section ────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="tcc-section">
      <button
        type="button"
        className="tcc-section__toggle"
        onClick={() => setOpen(!open)}
      >
        <span className="tcc-section__chevron">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="tcc-section__body">{children}</div>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const icon = toolIcon(toolCall.tool_name);
  const durationLabel = toolCall.duration_ms != null
    ? `${(toolCall.duration_ms / 1000).toFixed(1)}s`
    : null;

  const argsString = JSON.stringify(toolCall.tool_args, null, 2);
  const resultString = toolCall.result != null
    ? (typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2))
    : toolCall.error ?? null;

  const isTerminal = ['Success', 'Failed', 'Timeout', 'Rejected'].includes(toolCall.status);

  return (
    <div className={`tcc-card ${isTerminal ? 'tcc-card--terminal' : ''}`}>
      {/* Header: icon + name + status */}
      <div className="tcc-card__header">
        <span className="tcc-card__icon">{icon}</span>
        <span className="tcc-card__name">{toolCall.tool_name}</span>
        <StatusBadge status={toolCall.status} />
      </div>

      {/* Arguments (collapsible) */}
      <CollapsibleSection title="Arguments">
        <pre className="tcc-json">{argsString}</pre>
      </CollapsibleSection>

      {/* Result (collapsible, shown during/after execution) */}
      {(toolCall.status !== 'Pending' || resultString) && (
        <CollapsibleSection
          title={toolCall.status === 'Executing' ? 'Result (pending...)' : toolCall.error ? 'Error' : 'Result'}
        >
          {resultString ? (
            <pre className={`tcc-json ${toolCall.error ? 'tcc-json--error' : ''}`}>{resultString}</pre>
          ) : (
            <span className="tcc-pending-text">Waiting for result...</span>
          )}
        </CollapsibleSection>
      )}

      {/* Footer: duration, source slot, audit */}
      <div className="tcc-card__footer">
        {durationLabel && (
          <span className="tcc-footer-item">{'⏱'} {durationLabel}</span>
        )}
        {toolCall.source_slot && (
          <span className="tcc-footer-item">{'\u{1F4CD}'} {toolCall.source_slot}</span>
        )}
        {toolCall.audit_result && toolCall.audit_result !== 'Pending' && (
          <AuditBadge result={toolCall.audit_result} />
        )}
      </div>
    </div>
  );
}

// ── ToolCallGroup: renders "Running X tools..." then individual cards ──

export interface ToolCallGroupProps {
  toolCalls: Map<number, ToolCallInfo>;
  initiatedCount: number;
}

export function ToolCallGroup({ toolCalls, initiatedCount }: ToolCallGroupProps) {
  const cards = Array.from(toolCalls.values()).sort((a, b) => a.index - b.index);
  const allDone = cards.length > 0 && cards.every(
    (tc) => ['Success', 'Failed', 'Timeout', 'Rejected'].includes(tc.status)
  );

  return (
    <div className="tcc-group">
      {cards.length === 0 && initiatedCount > 0 && (
        <div className="tcc-group__placeholder">
          <span className="tcc-spinner" />
          Running {initiatedCount} tool{initiatedCount !== 1 ? 's' : ''}...
        </div>
      )}
      {cards.map((tc) => (
        <ToolCallCard key={tc.index} toolCall={tc} />
      ))}
    </div>
  );
}
