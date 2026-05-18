/**
 * @everywear/shared — EverywearLogger
 *
 * Lightweight structured logger that applets import via getLogger("source").
 * Buffers LogEntry objects and flushes to the Tauri backend every 5 seconds.
 * Supports trace correlation for end-to-end generation flow debugging.
 *
 * Usage:
 *   import { getLogger, initLogger } from '@everywear/shared';
 *
 *   // Once, on shell mount:
 *   await initLogger(sessionId);
 *
 *   // In any applet or shell component:
 *   const log = getLogger("1magen");
 *   log.info("generation", "Image generated", { width: 1024, height: 1024 });
 */

import type { LogLevel, LogCategory, LogEntry } from '@everywear/transport';

// ── Tauri invoke (lazy — works in non-Tauri contexts too) ───────────

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function resolveInvoke() {
  if (_invoke) return _invoke;
  try {
    const tauri = await import('@tauri-apps/api/core');
    _invoke = tauri.invoke;
    return _invoke;
  } catch {
    // Non-Tauri context (web preview): silently swallow
    _invoke = async () => {};
    return _invoke;
  }
}

// ── Logger class ────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 500;

export class EverywearLogger {
  private buffer: LogEntry[] = [];
  private sessionId: string;
  private source: string;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private traceIdStack: string[] = [];

  constructor(source: string, sessionId: string) {
    this.source = source;
    this.sessionId = sessionId;
  }

  /** Start periodic flush to backend (every 5 seconds). */
  startFlush(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  /** Stop periodic flush and do a final flush. */
  stopFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  /** Update session ID (called by initLogger once backend provides the real ID). */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  // ── Core log method ─────────────────────────────────────────────

  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      level,
      category,
      source: this.source,
      message,
      details,
    };

    // Attach current trace if any
    if (this.traceIdStack.length > 0) {
      entry.trace_id = this.traceIdStack[this.traceIdStack.length - 1];
    }

    this.buffer.push(entry);

    // Cap buffer size to prevent memory leaks if flush is failing
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE);
    }
  }

  // ── Convenience methods ─────────────────────────────────────────

  trace(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("trace", category, message, details);
  }

  debug(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("debug", category, message, details);
  }

  info(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("info", category, message, details);
  }

  warn(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("warn", category, message, details);
  }

  error(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("error", category, message, details);
  }

  fatal(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log("fatal", category, message, details);
  }

  // ── Trace correlation ───────────────────────────────────────────
  // Use for generation flows: beginTrace → traceEvent → endTrace

  beginTrace(category: LogCategory, message: string, details?: Record<string, unknown>): string {
    const traceId = crypto.randomUUID();
    this.traceIdStack.push(traceId);
    this.log("info", category, message, {
      ...details,
      trace_id: traceId,
      trace_phase: "begin",
    });
    return traceId;
  }

  traceEvent(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    const traceId = this.traceIdStack[this.traceIdStack.length - 1];
    this.log("info", category, message, {
      ...details,
      trace_id: traceId,
      trace_phase: "event",
    });
  }

  endTrace(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    const traceId = this.traceIdStack.pop();
    this.log("info", category, message, {
      ...details,
      trace_id: traceId,
      trace_phase: "end",
    });
  }

  // ── Timed operation helper ──────────────────────────────────────

  /**
   * Returns a function that, when called, logs the end of the operation
   * with the elapsed time in duration_ms.
   */
  startTimed(
    level: LogLevel,
    category: LogCategory,
    startMessage: string,
    details?: Record<string, unknown>,
  ): (endMessage: string, endDetails?: Record<string, unknown>) => void {
    const t0 = performance.now();
    this.log(level, category, startMessage, details);
    return (endMessage: string, endDetails?: Record<string, unknown>) => {
      const duration_ms = Math.round(performance.now() - t0);
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        session_id: this.sessionId,
        level,
        category,
        source: this.source,
        message: endMessage,
        details: endDetails,
        duration_ms,
      };
      if (this.traceIdStack.length > 0) {
        entry.trace_id = this.traceIdStack[this.traceIdStack.length - 1];
      }
      this.buffer.push(entry);
    };
  }

  // ── Flush to backend ────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      const invoke = await resolveInvoke();
      // CODEX_NEEDED: Backend command "append_log_entries"
      // Args: { entries: LogEntry[] }
      // Returns: void
      // Appends entries to the current session's JSONL log file at
      // ~/Documents/Everywear Vault/.logs/session-{session_id}.jsonl
      await invoke("append_log_entries", { entries });
    } catch {
      // Backend unreachable: put entries back (capped)
      this.buffer = [...entries.slice(-100), ...this.buffer].slice(-MAX_BUFFER_SIZE);
    }
  }

  /** Number of entries waiting to be flushed. */
  getBufferedCount(): number {
    return this.buffer.length;
  }

  /** Read-only snapshot of current buffer (for log viewer in-memory fallback). */
  getBufferedEntries(): readonly LogEntry[] {
    return this.buffer;
  }
}

// ── Singleton registry ──────────────────────────────────────────────

const loggers: Map<string, EverywearLogger> = new Map();

/** Pending session ID before initLogger is called */
let _sessionId = `local-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Get or create a logger for the given source.
 * Safe to call before initLogger; entries will use a placeholder session ID
 * until initLogger wires in the real one.
 */
export function getLogger(source: string): EverywearLogger {
  if (!loggers.has(source)) {
    loggers.set(source, new EverywearLogger(source, _sessionId));
  }
  return loggers.get(source)!;
}

/**
 * Called once on shell mount to set the backend-provided session ID
 * and start periodic flushing on all loggers.
 */
export async function initLogger(sessionId: string): Promise<void> {
  _sessionId = sessionId;
  for (const logger of loggers.values()) {
    logger.setSessionId(sessionId);
    logger.startFlush();
  }
}

/**
 * Retrieve ALL buffered entries across all loggers (for the log viewer).
 * Returns a flat array sorted by timestamp.
 */
export function getAllBufferedEntries(): LogEntry[] {
  const all: LogEntry[] = [];
  for (const logger of loggers.values()) {
    all.push(...logger.getBufferedEntries());
  }
  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Count errors across all loggers' buffers.
 */
export function getErrorCount(): number {
  let count = 0;
  for (const logger of loggers.values()) {
    for (const entry of logger.getBufferedEntries()) {
      if (entry.level === "error" || entry.level === "fatal") count++;
    }
  }
  return count;
}

/**
 * Get the most recent error entry (for bug report pre-fill).
 */
export function getLastError(): LogEntry | null {
  let latest: LogEntry | null = null;
  for (const logger of loggers.values()) {
    for (const entry of logger.getBufferedEntries()) {
      if (
        (entry.level === "error" || entry.level === "fatal") &&
        (!latest || entry.timestamp > latest.timestamp)
      ) {
        latest = entry;
      }
    }
  }
  return latest;
}
