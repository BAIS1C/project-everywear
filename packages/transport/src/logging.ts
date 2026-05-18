/**
 * @everywear/transport — Logging types.
 *
 * Structured log transport types for the Everywear OS session logging system.
 * Every shell action, applet event, and sidecar interaction produces a typed
 * LogEntry that is buffered client-side and flushed to the backend for
 * persistence in ~/Documents/Everywear Vault/.logs/session-{uuid}.jsonl
 */

// ── Log levels (syslog-adjacent) ────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

// ── Log categories — what subsystem produced the entry ──────────────

export type LogCategory =
  | "system"       // Startup, shutdown, GPU detection, VRAM
  | "applet"       // Applet lifecycle: launch, switch, handoff
  | "generation"   // Any generation request: image, audio, video
  | "model"        // Model resolution, download, load, unload
  | "sidecar"      // Sidecar health, startup, crashes
  | "vault"        // Vault CRUD, search, registration
  | "ipc"          // Shell-applet IPC messages
  | "ui"           // UI state changes, errors, navigation
  | "disk"         // File operations, migration
  | "auth";        // Authentication, licensing

// ── Core log entry ──────────────────────────────────────────────────

export interface LogEntry {
  /** ISO 8601 with milliseconds, e.g. "2026-05-18T14:32:01.234Z" */
  timestamp: string;
  /** UUID for the current shell session */
  session_id: string;
  level: LogLevel;
  category: LogCategory;
  /** Origin: "shell" | "1magen" | "gener8" | "kasai" | "3nvizen" | "vid" */
  source: string;
  message: string;
  /** Structured payload: { gpu_name, vram_gb, error_code, ... } */
  details?: Record<string, unknown>;
  /** For timed operations */
  duration_ms?: number;
  /** Correlate related entries across a single generation flow */
  trace_id?: string;
}

// ── Session log wrapper ─────────────────────────────────────────────

export interface SessionLog {
  session_id: string;
  started_at: string;
  ended_at?: string;
  app_version: string;
  entries: LogEntry[];
  summary: SessionSummary;
}

export interface SessionSummary {
  total_entries: number;
  by_level: Record<LogLevel, number>;
  by_category: Record<LogCategory, number>;
  by_source: Record<string, number>;
  error_count: number;
  warning_count: number;
  duration_seconds: number;
}

// ── Bug report payload ──────────────────────────────────────────────

export interface BugReportPayload {
  session_id: string;
  user_description: string;
  included_categories: LogCategory[];
  /** Filtered by included_categories */
  entries: LogEntry[];
  system_info: SystemInfo;
  /** Additional file paths (screenshots, etc.) */
  attachments?: string[];
}

export interface SystemInfo {
  os: string;
  os_version: string;
  gpu_name: string;
  vram_total_gb: number;
  cuda_version: string;
  app_version: string;
  session_duration_seconds: number;
  models_available: string[];
  sidecars_running: string[];
}

// ── Category metadata (for UI display) ──────────────────────────────

export const LOG_CATEGORY_META: Record<LogCategory, { label: string; description: string }> = {
  system:     { label: "System logs",          description: "Startup, GPU, VRAM" },
  applet:     { label: "Applet logs",          description: "Generation, errors" },
  generation: { label: "Generation logs",      description: "Image, audio, video requests" },
  model:      { label: "Model resolution logs", description: "Load, unload, download" },
  sidecar:    { label: "Sidecar logs",         description: "Health, crashes" },
  vault:      { label: "Vault operations",     description: "Search, register, delete" },
  ipc:        { label: "IPC messages",         description: "Shell-applet communication" },
  ui:         { label: "UI state changes",     description: "Navigation, errors" },
  disk:       { label: "Disk operations",      description: "File I/O, migration" },
  auth:       { label: "Auth logs",            description: "Authentication, licensing" },
};
