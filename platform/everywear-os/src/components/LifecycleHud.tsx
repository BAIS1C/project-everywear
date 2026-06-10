import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

// ── Lifecycle HUD (2026-06-10) ──────────────────────────────────────────────
//
// Persistent, shell-owned surface for the applet switch pipeline. Replaces
// the old behaviour of rendering `download-progress` as disposable toasts.
//
// Listens to three Tauri events:
//   applet-switch-progress  { stage, message }            stage strip + open/close
//   provision-manifest      { session_id, applet_id,      renders all rows up front
//                             models[{key,name,size_bytes}], total_bytes }
//   download-progress       { session_id?, applet_id?,    per-model updates; legacy
//                             model_index?, model_count?,  payloads (no session_id,
//                             model_key, downloaded,       e.g. 1magen's own emitter)
//                             total, pct }                 are tolerated
//
// Rate and ETA are computed client-side from successive events (EMA over
// inter-event deltas), so the Rust contract stays minimal.
//
// Toast policy after this component: toasts carry state transitions only
// (Failed); progress lives here. Docked bottom-LEFT above the taskbar; the
// ToastHost owns bottom-right.

const hasShellRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface ManifestModel {
  key: string;
  name: string;
  size_bytes: number;
}

interface ProvisionManifestPayload {
  session_id?: string;
  applet_id?: string;
  models?: ManifestModel[];
  total_bytes?: number;
}

interface DownloadProgressPayload {
  session_id?: string;
  applet_id?: string;
  model_index?: number;
  model_count?: number;
  model_key?: string;
  downloaded?: number;
  total?: number;
  pct?: number;
}

interface SwitchProgressPayload {
  stage?: string;
  message?: string;
}

interface HudRow {
  key: string;
  name: string;
  sizeBytes: number;
  downloaded: number;
  total: number;
  pct: number;
  done: boolean;
}

type HudStatus = 'active' | 'done' | 'failed';

interface HudState {
  visible: boolean;
  appletId: string | null;
  stage: string;
  stageMessage: string;
  status: HudStatus;
  rows: HudRow[];
}

const IDLE_STATE: HudState = {
  visible: false,
  appletId: null,
  stage: '',
  stageMessage: '',
  status: 'active',
  rows: [],
};

const STAGE_LABELS: Record<string, string> = {
  GateCheck: 'Checking requirements',
  WaitingConfirm: 'Waiting for confirmation',
  Purging: 'Unloading models',
  VerifyingVram: 'Verifying VRAM',
  Downloading: 'Downloading models',
  Launching: 'Launching',
  Ready: 'Ready',
  Failed: 'Failed',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function formatRate(bytesPerSec: number | null): string | null {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return null;
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s left`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min left`;
  return `~${(seconds / 3600).toFixed(1)} h left`;
}

/** Per-row EMA rate tracker: survives re-renders, reset per session. */
interface RateSample {
  t: number;
  bytes: number;
  ema: number | null;
}

export function LifecycleHud({ appletNames }: { appletNames?: Record<string, string> }) {
  const [hud, setHud] = useState<HudState>(IDLE_STATE);
  const [collapsed, setCollapsed] = useState(false);
  const ratesRef = useRef<Map<string, RateSample>>(new Map());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rate map is read at render time; bump to re-render on sample updates.
  const [, setRateTick] = useState(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearHideTimer();
    ratesRef.current.clear();
    setHud(IDLE_STATE);
    setCollapsed(false);
  }, [clearHideTimer]);

  useEffect(() => {
    if (!hasShellRuntime()) return;

    const unlistenStage = listen<SwitchProgressPayload>('applet-switch-progress', (event) => {
      const stage = event.payload?.stage ?? '';
      const message = event.payload?.message ?? '';

      if (stage === 'Ready') {
        clearHideTimer();
        setHud((prev) => ({
          ...prev,
          visible: true,
          stage,
          stageMessage: message,
          status: 'done',
          // Ready means provisioning finished: close out any straggler rows.
          rows: prev.rows.map((row) => ({ ...row, done: true, pct: 100 })),
        }));
        hideTimerRef.current = setTimeout(() => {
          ratesRef.current.clear();
          setHud(IDLE_STATE);
          setCollapsed(false);
          hideTimerRef.current = null;
        }, 4000);
        return;
      }

      if (stage === 'Failed') {
        clearHideTimer();
        setHud((prev) => ({
          ...prev,
          visible: true,
          stage,
          stageMessage: message,
          status: 'failed',
        }));
        return;
      }

      // Any other stage: a switch is in flight. GateCheck starts a fresh
      // session (clears rows from the previous one).
      clearHideTimer();
      setHud((prev) => {
        const fresh = stage === 'GateCheck';
        if (fresh) ratesRef.current.clear();
        return {
          visible: true,
          appletId: fresh ? null : prev.appletId,
          stage,
          stageMessage: message,
          status: 'active',
          rows: fresh ? [] : prev.rows,
        };
      });
    });

    const unlistenManifest = listen<ProvisionManifestPayload>('provision-manifest', (event) => {
      const payload = event.payload ?? {};
      const models = payload.models ?? [];
      clearHideTimer();
      setHud((prev) => {
        const known = new Set(prev.rows.map((row) => row.key));
        const appended: HudRow[] = models
          .filter((m) => !known.has(m.key))
          .map((m) => ({
            key: m.key,
            name: m.name || m.key,
            sizeBytes: m.size_bytes || 0,
            downloaded: 0,
            total: m.size_bytes || 0,
            pct: 0,
            done: false,
          }));
        return {
          ...prev,
          visible: true,
          appletId: payload.applet_id ?? prev.appletId,
          status: 'active',
          rows: [...prev.rows, ...appended],
        };
      });
    });

    const unlistenDownload = listen<DownloadProgressPayload>('download-progress', (event) => {
      const payload = event.payload ?? {};
      const key = payload.model_key;
      if (!key) return;

      const downloaded = payload.downloaded ?? 0;
      const total = payload.total ?? 0;
      const pct = typeof payload.pct === 'number'
        ? payload.pct
        : total > 0 ? Math.round((downloaded / total) * 100) : 0;

      // Client-side EMA rate from inter-event deltas.
      const now = performance.now();
      const sample = ratesRef.current.get(key);
      if (sample) {
        const dtSec = (now - sample.t) / 1000;
        const dBytes = downloaded - sample.bytes;
        if (dtSec > 0.25 && dBytes >= 0) {
          const inst = dBytes / dtSec;
          const ema = sample.ema === null ? inst : 0.3 * inst + 0.7 * sample.ema;
          ratesRef.current.set(key, { t: now, bytes: downloaded, ema });
          setRateTick((tick) => tick + 1);
        }
      } else {
        ratesRef.current.set(key, { t: now, bytes: downloaded, ema: null });
      }

      clearHideTimer();
      setHud((prev) => {
        const existing = prev.rows.find((row) => row.key === key);
        const done = pct >= 100 || (total > 0 && downloaded >= total);
        const rows = existing
          ? prev.rows.map((row) =>
              row.key === key ? { ...row, downloaded, total: total || row.total, pct, done } : row,
            )
          : [
              // Legacy emitter (no manifest seen for this key): ad-hoc row.
              ...prev.rows,
              { key, name: key, sizeBytes: total, downloaded, total, pct, done },
            ];
        return {
          ...prev,
          visible: true,
          appletId: payload.applet_id ?? prev.appletId,
          status: prev.status === 'failed' ? 'failed' : 'active',
          rows,
        };
      });
    });

    return () => {
      unlistenStage.then((fn) => fn());
      unlistenManifest.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
      clearHideTimer();
    };
  }, [clearHideTimer]);

  // Standalone download sessions (e.g. educ8 resources, sidecar pulls that
  // finish without a switch Ready stage) have nothing to close them: when
  // every row is done and no stage event interrupts for 1.5s, settle to done
  // and auto-hide.
  useEffect(() => {
    if (!hud.visible || hud.status !== 'active' || hud.rows.length === 0) return;
    if (!hud.rows.every((row) => row.done)) return;
    const settle = setTimeout(() => {
      setHud((prev) => {
        if (!prev.visible || prev.status !== 'active' || prev.rows.length === 0) return prev;
        if (!prev.rows.every((row) => row.done)) return prev;
        return { ...prev, status: 'done' };
      });
      hideTimerRef.current = setTimeout(() => {
        ratesRef.current.clear();
        setHud(IDLE_STATE);
        setCollapsed(false);
        hideTimerRef.current = null;
      }, 4000);
    }, 1500);
    return () => clearTimeout(settle);
  }, [hud]);

  const appletLabel = useMemo(() => {
    if (!hud.appletId) return null;
    return appletNames?.[hud.appletId] ?? hud.appletId;
  }, [appletNames, hud.appletId]);

  const aggregate = useMemo(() => {
    const sized = hud.rows.filter((row) => row.total > 0);
    const totalBytes = sized.reduce((sum, row) => sum + row.total, 0);
    const doneBytes = sized.reduce((sum, row) => sum + Math.min(row.downloaded, row.total), 0);
    const pct = totalBytes > 0
      ? Math.round((doneBytes / totalBytes) * 100)
      : hud.rows.length > 0
        ? Math.round(hud.rows.reduce((sum, row) => sum + row.pct, 0) / hud.rows.length)
        : 0;
    const rate = hud.rows.reduce((sum, row) => {
      const sample = ratesRef.current.get(row.key);
      return row.done || !sample?.ema ? sum : sum + sample.ema;
    }, 0);
    const remaining = totalBytes - doneBytes;
    const eta = rate > 0 && remaining > 0 ? remaining / rate : null;
    const doneCount = hud.rows.filter((row) => row.done).length;
    return { totalBytes, doneBytes, pct, rate: rate > 0 ? rate : null, eta, doneCount };
  }, [hud.rows]);

  if (!hud.visible) return null;

  const stageLabel = STAGE_LABELS[hud.stage] ?? hud.stage ?? 'Model lifecycle';
  const headline = appletLabel ? `${appletLabel} · ${stageLabel}` : stageLabel;
  const hasRows = hud.rows.length > 0;
  const aggregateRate = formatRate(aggregate.rate);
  const aggregateEta = formatEta(aggregate.eta);

  if (collapsed) {
    return (
      <button
        type="button"
        className={`ew-lifecycle-hud ew-lifecycle-hud--pill ew-lifecycle-hud--${hud.status}`}
        onClick={() => setCollapsed(false)}
        title="Expand model lifecycle progress"
      >
        <span className="ew-lifecycle-hud__pill-dot" aria-hidden="true" />
        {headline}
        {hasRows && hud.status === 'active' ? ` · ${aggregate.pct}%` : ''}
      </button>
    );
  }

  return (
    <section
      className={`ew-lifecycle-hud ew-lifecycle-hud--${hud.status}`}
      role="status"
      aria-live="polite"
      aria-label="Model lifecycle progress"
    >
      <header className="ew-lifecycle-hud__head">
        <span className="ew-lifecycle-hud__eyebrow">Everywear · model lifecycle</span>
        <div className="ew-lifecycle-hud__head-actions">
          <button
            type="button"
            className="ew-lifecycle-hud__head-btn"
            onClick={() => setCollapsed(true)}
            title="Collapse"
            aria-label="Collapse progress panel"
          >
            –
          </button>
          {hud.status !== 'active' && (
            <button
              type="button"
              className="ew-lifecycle-hud__head-btn"
              onClick={dismiss}
              title="Dismiss"
              aria-label="Dismiss progress panel"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <div className="ew-lifecycle-hud__headline">{headline}</div>
      {hud.stageMessage && hud.stageMessage !== headline && (
        <div className="ew-lifecycle-hud__message">{hud.stageMessage}</div>
      )}

      {hasRows && (
        <>
          <div className="ew-lifecycle-hud__aggregate">
            <div className="ew-lifecycle-hud__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, aggregate.pct)}%` }} />
            </div>
            <div className="ew-lifecycle-hud__aggregate-meta">
              <span>
                {aggregate.doneCount}/{hud.rows.length} models
                {aggregate.totalBytes > 0
                  ? ` · ${formatBytes(aggregate.doneBytes)} of ${formatBytes(aggregate.totalBytes)}`
                  : ''}
              </span>
              <span>
                {[aggregateRate, aggregateEta].filter(Boolean).join(' · ') || `${aggregate.pct}%`}
              </span>
            </div>
          </div>

          <ul className="ew-lifecycle-hud__rows">
            {hud.rows.map((row) => {
              const rate = row.done ? null : formatRate(ratesRef.current.get(row.key)?.ema ?? null);
              return (
                <li key={row.key} className={`ew-lifecycle-hud__row ${row.done ? 'ew-lifecycle-hud__row--done' : ''}`}>
                  <div className="ew-lifecycle-hud__row-top">
                    <span className="ew-lifecycle-hud__row-name" title={row.key}>{row.name}</span>
                    <span className="ew-lifecycle-hud__row-pct">{row.done ? 'done' : `${Math.round(row.pct)}%`}</span>
                  </div>
                  <div className="ew-lifecycle-hud__bar ew-lifecycle-hud__bar--row" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, row.pct)}%` }} />
                  </div>
                  <div className="ew-lifecycle-hud__row-meta">
                    <span>
                      {row.total > 0
                        ? `${formatBytes(row.downloaded)} of ${formatBytes(row.total)}`
                        : formatBytes(row.downloaded)}
                    </span>
                    {rate && <span>{rate}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default LifecycleHud;
