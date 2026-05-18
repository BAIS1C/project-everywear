/**
 * LogViewerPanel — Full session log viewer.
 *
 * Displays structured log entries with color-coded levels, source/level filters,
 * full-text search, trace grouping, and auto-scroll with pause.
 * Data comes from backend via Tauri invoke + in-memory fallback from the logger buffer.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { LogEntry, LogLevel, LogCategory } from '@everywear/transport';
import { getAllBufferedEntries } from '@everywear/shared';

// ── Constants ───────────────────────────────────────────────────────

const LEVEL_OPTIONS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const SOURCE_OPTIONS = ['shell', '1magen', 'gener8', 'kasai', '3nvizen', 'vid'];

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'var(--ew-text-muted)',
  debug: 'var(--ew-text-muted)',
  info:  'var(--ew-text)',
  warn:  'var(--ew-status-amber)',
  error: 'var(--ew-status-red)',
  fatal: 'var(--ew-status-red)',
};

// ── Styles (all EWDS tokens) ────────────────────────────────────────

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    fontFamily: 'var(--ew-font-body)',
    color: 'var(--ew-text)',
    background: 'transparent',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--ew-space-3) var(--ew-space-4)',
    borderBottom: '1px solid color-mix(in oklab, var(--ew-text) 8%, transparent)',
  },
  headerTitle: {
    fontFamily: 'var(--ew-font-display)',
    fontWeight: 'var(--ew-fw-display)' as any,
    fontSize: '16px',
    letterSpacing: '0.05em',
  },
  headerActions: {
    display: 'flex',
    gap: 'var(--ew-space-2)',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ew-space-3)',
    padding: 'var(--ew-space-2) var(--ew-space-4)',
    borderBottom: '1px solid color-mix(in oklab, var(--ew-text) 6%, transparent)',
    flexWrap: 'wrap' as const,
  },
  select: {
    background: 'color-mix(in oklab, var(--ew-text) 5%, transparent)',
    color: 'var(--ew-text)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 10%, transparent)',
    borderRadius: 'var(--ew-radius)',
    padding: '4px 8px',
    fontSize: '11px',
    fontFamily: 'var(--ew-font-mono)',
    outline: 'none',
  },
  searchInput: {
    background: 'color-mix(in oklab, var(--ew-text) 5%, transparent)',
    color: 'var(--ew-text)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 10%, transparent)',
    borderRadius: 'var(--ew-radius)',
    padding: '4px 8px',
    fontSize: '11px',
    fontFamily: 'var(--ew-font-mono)',
    flex: 1,
    minWidth: '120px',
    outline: 'none',
  },
  logList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 'var(--ew-space-2) 0',
    fontFamily: 'var(--ew-font-mono)',
    fontSize: '11px',
    lineHeight: 1.6,
  },
  logEntry: {
    display: 'flex',
    gap: 'var(--ew-space-2)',
    padding: '2px var(--ew-space-4)',
    cursor: 'pointer',
    transition: `background var(--ew-t-fast) var(--ew-ease)`,
  },
  logEntryHover: {
    background: 'color-mix(in oklab, var(--ew-text) 4%, transparent)',
  },
  timestamp: {
    color: 'var(--ew-text-muted)',
    whiteSpace: 'nowrap' as const,
    minWidth: '85px',
    flexShrink: 0,
  },
  level: {
    minWidth: '42px',
    flexShrink: 0,
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    fontSize: '10px',
    letterSpacing: '0.04em',
  },
  source: {
    minWidth: '55px',
    flexShrink: 0,
    color: 'var(--ew-text-muted)',
    fontSize: '10px',
  },
  message: {
    flex: 1,
    wordBreak: 'break-word' as const,
  },
  detailsBlock: {
    padding: 'var(--ew-space-2) var(--ew-space-4)',
    marginLeft: '190px',
    background: 'color-mix(in oklab, var(--ew-text) 3%, transparent)',
    borderRadius: 'var(--ew-radius)',
    fontFamily: 'var(--ew-font-mono)',
    fontSize: '10px',
    color: 'var(--ew-text-muted)',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  traceGroup: {
    borderLeft: '2px solid color-mix(in oklab, var(--ew-primary) 20%, transparent)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--ew-space-2) var(--ew-space-4)',
    borderTop: '1px solid color-mix(in oklab, var(--ew-text) 8%, transparent)',
    fontSize: '11px',
    color: 'var(--ew-text-muted)',
    fontFamily: 'var(--ew-font-mono)',
  },
  btn: {
    background: 'color-mix(in oklab, var(--ew-text) 8%, transparent)',
    color: 'var(--ew-text)',
    border: '1px solid color-mix(in oklab, var(--ew-text) 12%, transparent)',
    borderRadius: 'var(--ew-radius)',
    padding: '4px 10px',
    fontSize: '11px',
    fontFamily: 'var(--ew-font-body)',
    cursor: 'pointer',
    transition: `background var(--ew-t-fast) var(--ew-ease)`,
  },
} as const;

// ── Component ───────────────────────────────────────────────────────

export function LogViewerPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // ── Fetch log entries ───────────────────────────────────────────

  const fetchLogs = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // CODEX_NEEDED: Backend command "get_session_logs"
      // Args: { session_id?: string, source?: string, level?: string, search?: string, limit?: number, offset?: number }
      // Returns: { entries: LogEntry[], total: number, summary: SessionSummary }
      const result = await invoke<{ entries: LogEntry[]; total: number }>('get_session_logs', {
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        level: levelFilter !== 'all' ? levelFilter : undefined,
        search: search.trim() || undefined,
        limit: 500,
      });
      setEntries(result.entries);
      setTotalCount(result.total);
    } catch {
      // Backend not available: fall back to in-memory buffer
      let buffered = getAllBufferedEntries();
      if (sourceFilter !== 'all') {
        buffered = buffered.filter(e => e.source === sourceFilter);
      }
      if (levelFilter !== 'all') {
        buffered = buffered.filter(e => e.level === levelFilter);
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        buffered = buffered.filter(e =>
          e.message.toLowerCase().includes(q) ||
          (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
        );
      }
      setEntries(buffered);
      setTotalCount(buffered.length);
    }
  }, [sourceFilter, levelFilter, search]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // ── Auto-scroll logic ───────────────────────────────────────────

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    } else if (userScrolledRef.current) {
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  // ── Trace grouping map ──────────────────────────────────────────

  const traceIds = useMemo(() => {
    const map = new Set<string>();
    for (const e of entries) {
      if (e.trace_id) map.add(e.trace_id);
    }
    return map;
  }, [entries]);

  // ── Summary counts ──────────────────────────────────────────────

  const errorCount = useMemo(() => entries.filter(e => e.level === 'error' || e.level === 'fatal').length, [entries]);
  const warnCount = useMemo(() => entries.filter(e => e.level === 'warn').length, [entries]);

  // ── Export handler ──────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // CODEX_NEEDED: Backend command "export_session_log"
      // Args: { session_id?: string, format?: "jsonl"|"txt" }
      // Returns: { file_path: string }
      // Opens a save dialog, writes the session log to the chosen path.
      await invoke('export_session_log', { format: 'jsonl' });
    } catch {
      // Fallback: copy entries as JSON to clipboard
      try {
        await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      } catch { /* silent */ }
    }
  }, [entries]);

  // ── Clear handler ───────────────────────────────────────────────

  const handleClear = useCallback(() => {
    setEntries([]);
    setTotalCount(0);
  }, []);

  // ── Render helper: format timestamp ─────────────────────────────

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any);
    } catch {
      return iso;
    }
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Session Logs</span>
        <div style={styles.headerActions}>
          <button style={styles.btn} onClick={handleExport}>Export</button>
          <button style={styles.btn} onClick={handleClear}>Clear</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <select
          style={styles.select}
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
        >
          <option value="all">All Sources</option>
          {SOURCE_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          style={styles.select}
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
        >
          <option value="all">All Levels</option>
          {LEVEL_OPTIONS.map(l => (
            <option key={l} value={l}>{l.toUpperCase()}</option>
          ))}
        </select>

        <input
          type="text"
          style={styles.searchInput}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        style={styles.logList}
        onScroll={handleScroll}
      >
        {entries.length === 0 && (
          <div style={{ padding: 'var(--ew-space-6)', textAlign: 'center', color: 'var(--ew-text-muted)' }}>
            No log entries yet.
          </div>
        )}
        {entries.map((entry, idx) => {
          const isExpanded = expandedIdx === idx;
          const hasTrace = !!entry.trace_id && traceIds.has(entry.trace_id);
          const isFatal = entry.level === 'fatal';

          return (
            <React.Fragment key={`${entry.timestamp}-${idx}`}>
              <div
                style={{
                  ...styles.logEntry,
                  ...(hasTrace ? styles.traceGroup : {}),
                }}
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in oklab, var(--ew-text) 4%, transparent)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={styles.timestamp}>{fmtTime(entry.timestamp)}</span>
                <span style={{
                  ...styles.level,
                  color: LEVEL_COLORS[entry.level],
                  fontWeight: isFatal ? 700 : 500,
                }}>
                  {entry.level}
                </span>
                <span style={styles.source}>{entry.source}</span>
                <span style={{
                  ...styles.message,
                  color: LEVEL_COLORS[entry.level],
                }}>
                  {entry.message}
                  {entry.duration_ms !== undefined && (
                    <span style={{ color: 'var(--ew-text-muted)', marginLeft: '8px' }}>
                      ({entry.duration_ms}ms)
                    </span>
                  )}
                </span>
              </div>
              {isExpanded && entry.details && (
                <div style={styles.detailsBlock}>
                  {JSON.stringify(entry.details, null, 2)}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <span>
          Showing {entries.length} of {totalCount} entries
          {errorCount > 0 && <span style={{ color: 'var(--ew-status-red)', marginLeft: '8px' }}>{errorCount} errors</span>}
          {warnCount > 0 && <span style={{ color: 'var(--ew-status-amber)', marginLeft: '8px' }}>{warnCount} warnings</span>}
        </span>
        <span>
          {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll paused (scroll to bottom to resume)'}
        </span>
      </div>
    </div>
  );
}
