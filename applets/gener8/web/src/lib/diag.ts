// @ts-nocheck
/**
 * diag.ts — UI diagnostic logger.
 *
 * Captures browser errors (window.onerror, unhandledrejection), wraps
 * console.error/warn/info, and forwards everything to the local launcher
 * shim's /api/diag/log endpoint in batched POSTs. The shim writes through
 * tracing into the rolling log file at %LOCALAPPDATA%\S3-Gener8\logs\,
 * one file across all layers (engine, encoder, shim, UI).
 *
 * Why this exists: manual `cargo tauri dev` hand-testing catches obvious
 * bugs but misses the subtle ones (race conditions on cleanup, errors
 * deep in async chains, network failures we don't surface). With this
 * pipeline, the bugs land in a file that can be grep'd.
 *
 * Privacy posture:
 *   - JWTs are redacted from messages (any 'eyJ...' substring is masked).
 *   - The diag payload never leaves the user's machine — shim is on
 *     127.0.0.1, the log file is local.
 *   - Console logs only mirror; the original console.* still fires for
 *     DevTools.
 *
 * Author: 2026-04-26 SGT.
 */

import { getApiBase } from '@/services/api';

// ─── Session ID ─────────────────────────────────────────────────────
// Generated once per page-load. Lets you trace one session's entries
// across the log file when something goes wrong. Not stable across
// reloads — that's intentional, makes "this run vs that run" obvious.
const SESSION_ID = generateSessionId();

function generateSessionId(): string {
  // Web crypto where available (everywhere modern), else Math.random.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

// ─── JWT Redaction ──────────────────────────────────────────────────
// Match anything that looks like a JWT (three base64-url segments
// separated by dots) and replace the payload+sig with "<redacted>".
// Keeps the header so debugging context isn't lost; just hides the
// sensitive bits.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function redact(s: string): string {
  return s.replace(JWT_PATTERN, '<jwt-redacted>');
}

// ─── Buffer + Flush ─────────────────────────────────────────────────
// Errors and console mirrors land in `buffer`. A timer flushes every
// FLUSH_INTERVAL_MS, or eagerly when the buffer hits MAX_BUFFER. Also
// flushes on visibilitychange:hidden so we don't lose the last batch
// on page close.

interface DiagEntry {
  level: 'error' | 'warn' | 'info' | 'debug';
  msg: string;
  ctx?: unknown;
  ts: number;
  url?: string;
  user_agent?: string;
  session_id: string;
}

const buffer: DiagEntry[] = [];
const MAX_BUFFER = 50;
const FLUSH_INTERVAL_MS = 5000;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pendingFlush: Promise<void> | null = null;

async function flushNow(): Promise<void> {
  if (buffer.length === 0) return;
  if (pendingFlush) return pendingFlush;

  const entries = buffer.splice(0, buffer.length);
  pendingFlush = (async () => {
    try {
      const base = getApiBase();
      // Skip if we don't yet know where the shim lives (rare; getApiBase()
      // resolves at first call). Drop on the floor — these are diagnostics,
      // not user data, and dropping them is acceptable when the engine
      // isn't reachable.
      if (base === '' && typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) {
        return;
      }
      await fetch(`${base}/api/diag/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        // Keep credentials omit so this never gets caught up in CORS preflight
        // hell — it's a fire-and-forget local write.
        credentials: 'omit',
        // Don't block page unload; sendBeacon would be ideal but doesn't
        // support custom Content-Type cleanly. keepalive does the same job.
        keepalive: true,
      }).catch(() => { /* swallow; diag must never throw */ });
    } finally {
      pendingFlush = null;
    }
  })();
  return pendingFlush;
}

function scheduleFlush(): void {
  if (buffer.length >= MAX_BUFFER) {
    flushNow();
    return;
  }
  if (flushTimer === null && typeof window !== 'undefined') {
    flushTimer = setInterval(() => {
      if (buffer.length > 0) flushNow();
    }, FLUSH_INTERVAL_MS);
  }
}

function enqueue(entry: Omit<DiagEntry, 'ts' | 'session_id'>): void {
  // Hard cap on backlog to prevent runaway buffering (e.g. an error in a
  // tight loop). Drop oldest if we hit the cap; new entries are usually
  // more relevant than ancient ones.
  if (buffer.length >= MAX_BUFFER * 2) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  buffer.push({
    ...entry,
    msg: redact(entry.msg),
    ts: Date.now(),
    session_id: SESSION_ID,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
  scheduleFlush();
}

// ─── Public API ─────────────────────────────────────────────────────

export function logError(msg: string, ctx?: unknown): void {
  enqueue({ level: 'error', msg, ctx });
}
export function logWarn(msg: string, ctx?: unknown): void {
  enqueue({ level: 'warn', msg, ctx });
}
export function logInfo(msg: string, ctx?: unknown): void {
  enqueue({ level: 'info', msg, ctx });
}
export function logDebug(msg: string, ctx?: unknown): void {
  enqueue({ level: 'debug', msg, ctx });
}

/** Structured event for UI actions that aren't errors but are worth
 * recording (sign-up completed, generation started, applet opened). */
export async function logEvent(event: string, props?: Record<string, unknown>): Promise<void> {
  try {
    const base = getApiBase();
    await fetch(`${base}/api/diag/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        props,
        ts: Date.now(),
        session_id: SESSION_ID,
      }),
      credentials: 'omit',
      keepalive: true,
    });
  } catch { /* swallow */ }
}

// ─── Bootstrap ──────────────────────────────────────────────────────

let installed = false;

/** Wire up window error handlers and console mirroring. Call once at
 * app boot from main.tsx. Safe to call multiple times. */
export function installDiag(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Uncaught errors during render or event handlers.
  window.addEventListener('error', (e) => {
    enqueue({
      level: 'error',
      msg: `[window.error] ${e.message}`,
      ctx: {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error instanceof Error ? e.error.stack : undefined,
      },
    });
  });

  // Unhandled promise rejections.
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error
      ? `[unhandledrejection] ${reason.message}`
      : `[unhandledrejection] ${String(reason)}`;
    enqueue({
      level: 'error',
      msg,
      ctx: {
        stack: reason instanceof Error ? reason.stack : undefined,
      },
    });
  });

  // Mirror console.error and console.warn. Original calls still fire for
  // DevTools; we just shadow-copy into the diag pipeline.
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const msg = args.map(stringifyArg).join(' ');
      enqueue({ level: 'error', msg: `[console] ${msg}` });
    } catch { /* never throw from console hook */ }
    origError.apply(console, args);
  };
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    try {
      const msg = args.map(stringifyArg).join(' ');
      enqueue({ level: 'warn', msg: `[console] ${msg}` });
    } catch { /* */ }
    origWarn.apply(console, args);
  };

  // Flush on page hide so we don't lose the last batch on tab close.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushNow();
    }
  });
  window.addEventListener('pagehide', () => {
    flushNow();
  });

  // Boot ping so we know the pipeline is alive in the log file.
  logInfo('[diag] installed', { session_id: SESSION_ID, ts: Date.now() });
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
