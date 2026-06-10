import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  getProfile,
  getGpuStatus,
  listModelAssessments,
  listApplets,
  resolveAppletStatus,
  requestAppletSwitch,
  closeAppletWebview,
  type AppletEntry,
  type ModelAssessment,
  type UserProfile,
  type SystemGpuState,
} from '../lib/transport';
import { useAuth } from './AuthContext';
import { useTheme } from '@everywear/ewds';
import { getLogger, getErrorCount } from '@everywear/shared';
import { LogViewerPanel } from '../components/LogViewerPanel';
import { BugReportModal, type BugReportSeed } from '../components/BugReportModal';

const log = getLogger('shell');
import { ProfilePanel } from '../panels/ProfilePanel';
import { GpuPanel } from '../panels/GpuPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { HeadlessAppletView } from '../panels/HeadlessAppletView';
import { AppletViewRouter, AppletErrorBoundary, isRegisteredApplet } from '../components/AppletViewRouter';
import AppletIcon, { ThemedIconGlyph } from '../components/AppletIcon';
import { FirstRunTourHost } from '../tour/FirstRunTourHost';
import { VaultProvider } from '@applets/gener8/web/src/context/VaultProvider';
import { ShellAudioProvider } from '@applets/gener8/web/src/shell/ShellAudioPlayer';
import { ToastHost, showToast } from '@applets/gener8/web/src/components/ToastHost';

const VaultLibraryView = lazy(() => import('@applets/gener8/web/src/views/LibraryView'));

// System panels (not in the Tauri registry, shell-only)
interface SystemIcon {
  id: Exclude<PanelView, null>;
  label: string;
  glyphId: string;
}

const SYSTEM_ICONS: SystemIcon[] = [
  { id: 'settings', label: 'Settings', glyphId: 'settings' },
  { id: 'vault',    label: 'Vault',    glyphId: 'vault' },
];

type PanelView = 'profile' | 'gpu' | 'settings' | 'vault' | null;
type VaultSection = 'media' | 'logs';
type InferencePhase = 'idle' | 'opening' | 'purging' | 'ready' | 'error';
// 1magen and 3nvizen are desktop-level applets, not S3 folder members.
// Locked 2026-06-07 per visual bugfix handoff. Entitlement gating unchanged.
const S3_FOLDER_APPLET_IDS = new Set(['gener8-4ever', 'gener8-pro', 'vid', 'ai-director', 'daw']);
const S3_FOLDER_ORDER = ['gener8-4ever', 'gener8-pro', 'vid', 'ai-director', 'daw'];
// Suite lifecycle: only one S3 suite applet window may be active at a time.
// Opening one closes the current one (handoff context travels via intentBus/Vault).
const S3_SUITE_APPLET_IDS = new Set(['s3studio', 'gener8-4ever', 'gener8-pro', 'vid', 'ai-director', 'daw']);
const MODEL_BACKED_ENGINE_TYPES = new Set(['diffusion', 'audio', 'llm', 'video', 'tts']);
const LOCAL_MODEL_APPLET_IDS = new Set(['1magen', 'gener8-4ever', 'gener8-pro', 'ai-director', 'daw', '3nvizen', 'kasai']);
const GENER8_SHARED_ENGINE_APPLET_IDS = new Set(['gener8-4ever', 'gener8-pro', 'ai-director', 'daw']);
const TIER_RANK: Record<string, number> = {
  demo: 0,
  gener8: 1,
  gener8_pro: 2,
  creator_studio: 3,
};
const hasShellRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function ChromeBarcode({ seed = 42, width = 72, height = 12 }: { seed?: number; width?: number; height?: number }) {
  let next = seed;
  const bars = Array.from({ length: 24 }, (_, index) => {
    next = (next * 9301 + 49297) % 233280;
    return { width: 1 + (next % 4), dim: index % 5 === 0 };
  });

  return (
    <span className="ew-chrome ew-barcode" style={{ width, height }} aria-hidden="true">
      {bars.map((bar, index) => (
        <i key={index} style={{ width: bar.width, opacity: bar.dim ? 0.42 : 1 }} />
      ))}
    </span>
  );
}

function ChromeSerial({ prefix = 'EW', code = '2204/00' }: { prefix?: string; code?: string }) {
  return <span className="ew-chrome ew-serial">{prefix}-{code}</span>;
}

function TrafficLights({
  onClose,
  onMinimize,
  onMaximize,
  className = '',
}: {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  className?: string;
}) {
  return (
    <div className={`ew-traffic-lights ${className}`}>
      <button className="ew-traffic-light ew-traffic-light--close" onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" />
      <button className="ew-traffic-light ew-traffic-light--minimize" onClick={(e) => { e.stopPropagation(); onMinimize(); }} title="Minimize" />
      <button className="ew-traffic-light ew-traffic-light--maximize" onClick={(e) => { e.stopPropagation(); onMaximize(); }} title="Maximize" />
    </div>
  );
}

function appletLaunchBlocked(
  applet: AppletEntry,
  tier: string,
  entitlements?: Record<string, boolean>,
): string | null {
  if (applet.required_entitlements?.some((key) => entitlements?.[key])) {
    return null;
  }
  if (applet.status === 'Locked') {
    return 'Purchase or subscribe to unlock.';
  }
  if (applet.status === 'NotBuilt') {
    return 'Applet is not yet available.';
  }
  if (applet.required_tier) {
    const currentRank = TIER_RANK[tier] ?? 0;
    const requiredRank = TIER_RANK[applet.required_tier] ?? Number.MAX_SAFE_INTEGER;
    if (currentRank < requiredRank) {
      return `${applet.name} requires ${applet.required_tier} or newer.`;
    }
  }
  return null;
}

function VaultPanel() {
  const [section, setSection] = useState<VaultSection>('media');
  // Remount key for the error boundary's Retry action.
  const [mediaMountKey, setMediaMountKey] = useState(0);

  return (
    <div className="ew-vault-panel">
      <div className="ew-vault-panel__tabs" role="tablist" aria-label="Vault sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'media'}
          className={`ew-vault-panel__tab ${section === 'media' ? 'ew-vault-panel__tab--active' : ''}`}
          onClick={() => setSection('media')}
        >
          Media
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'logs'}
          className={`ew-vault-panel__tab ${section === 'logs' ? 'ew-vault-panel__tab--active' : ''}`}
          onClick={() => setSection('logs')}
        >
          Logs
        </button>
      </div>
      <div className="ew-vault-panel__body">
        {section === 'media' ? (
          // LibraryView calls useShellAudio(); mounting it without
          // ShellAudioProvider crashed the whole shell render to a black
          // screen, with no boundary to catch it. Vault black screen fix,
          // handoff 2026-06-07.
          <AppletErrorBoundary
            key={mediaMountKey}
            appletId="vault"
            displayName="Vault"
            onRetry={() => setMediaMountKey((value) => value + 1)}
          >
            <ShellAudioProvider>
              <VaultProvider>
                <Suspense fallback={<div className="ew-vault-panel__loading">Loading vault...</div>}>
                  <VaultLibraryView />
                </Suspense>
              </VaultProvider>
            </ShellAudioProvider>
          </AppletErrorBoundary>
        ) : (
          <LogViewerPanel />
        )}
      </div>
    </div>
  );
}

type AppletRenderMode = 'inline' | 'embedded';
type ShellWindowContent =
  | { kind: 'panel'; panel: Exclude<PanelView, null> }
  | { kind: 'applet'; applet: AppletEntry; renderMode: AppletRenderMode };
type PendingAppletSwitch = {
  incoming: AppletEntry;
  closing: AppletEntry[];
};

interface ShellWindowState {
  id: string;
  title: string;
  sublabel?: string;
  content: ShellWindowContent;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
}

interface PendingRustCrashReport {
  id: string;
  timestamp: string;
  process: string;
  thread: string;
  message: string;
  location: string | null;
  backtrace: string | null;
}

function windowContentKey(content: ShellWindowContent): string {
  return content.kind === 'panel' ? `panel:${content.panel}` : `applet:${content.applet.id}`;
}

function panelLabel(panel: Exclude<PanelView, null>) {
  if (panel === 'gpu') return 'Hardware';
  if (panel === 'vault') return 'Vault';
  if (panel === 'profile') return 'Profile';
  return 'Settings';
}

function isShellNativeBridgeApplet(applet: AppletEntry) {
  return applet.launch_kind === 'BinaryLocal'
    && isRegisteredApplet(applet.id)
    && !applet.frontend_port;
}

function windowRuntimeLabel(
  content: ShellWindowContent,
  activeInferenceAppletId: string | null,
  launchingId: string | null,
  inferencePhase: InferencePhase,
  health?: 'online' | 'offline' | 'checking',
) {
  if (content.kind === 'panel') return '● READY';

  const applet = content.applet;
  // Status truthfulness: never show READY for an applet whose runtime health
  // check says it is offline. Avatar Studio and Layer U displayed READY while
  // their content was black/offline. (Handoff 2026-06-07.)
  if (health === 'offline') return '● OFFLINE';
  if (!isModelBackedApplet(applet)) {
    return health === 'checking' ? '● CHECKING' : '● READY';
  }
  if (launchingId === applet.id || inferencePhase === 'opening' || inferencePhase === 'purging') {
    return '● LOADING';
  }
  if (inferencePhase === 'error' && activeInferenceAppletId !== applet.id) {
    return '● ERROR';
  }
  if (activeInferenceAppletId === applet.id && inferencePhase === 'ready') {
    return '● LIVE';
  }
  return '● UI';
}

function ShellWindowFrame({
  win,
  isActive,
  trafficSide,
  onFocus,
  onBugReport,
  onClose,
  onMinimize,
  onMaximize,
  onMove,
  runtimeLabel,
  children,
}: {
  win: ShellWindowState;
  isActive: boolean;
  trafficSide: 'left' | 'right';
  onFocus: () => void;
  onBugReport: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onMove: (x: number, y: number) => void;
  runtimeLabel: string;
  children: React.ReactNode;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  if (win.isMinimized) return null;

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (win.isMaximized || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    onFocus();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: win.x,
      originY: win.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onMove(
      drag.originX + event.clientX - drag.startX,
      drag.originY + event.clientY - drag.startY,
    );
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  return (
    <div
      className={`ew-window ${isActive ? 'ew-window--active' : ''} ${win.isMaximized ? 'ew-window--maximized' : ''}`}
      style={win.isMaximized ? { zIndex: win.zIndex } : {
        zIndex: win.zIndex,
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
      }}
      onPointerDown={onFocus}
    >
      <div
        className={`ew-window__titlebar ew-window__titlebar--traffic-${trafficSide}`}
        onDoubleClick={onMaximize}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        {trafficSide === 'left' && (
          <TrafficLights
            className="ew-window__controls"
            onClose={onClose}
            onMinimize={onMinimize}
            onMaximize={onMaximize}
          />
        )}
        <div className="ew-window__title-block">
          <span className="ew-window__title">{win.title}</span>
          {win.sublabel && <span className="ew-window__subtitle">{win.sublabel}</span>}
        </div>
        <div className="ew-window__chrome-head">
          <ChromeBarcode seed={win.title.length + win.id.length} width={62} height={10} />
          <ChromeSerial prefix="APP" code="42715/96" />
          <span className="ew-chrome ew-status-pill">{runtimeLabel}</span>
        </div>
        {trafficSide === 'right' && (
          <TrafficLights
            className="ew-window__controls"
            onClose={onClose}
            onMinimize={onMinimize}
            onMaximize={onMaximize}
          />
        )}
        <div className="ew-window__actions">
          <button
            className="ew-window__report"
            onClick={(e) => { e.stopPropagation(); onBugReport(); }}
            title="Report a problem"
            aria-label={`Report a problem with ${win.title}`}
          >
            !
          </button>
        </div>
      </div>
      <div className="ew-window__body">{children}</div>
      <div className="ew-window__footer">
        <span className="ew-window__footer-label">▣ EWDS</span>
        <span className="ew-chrome ew-window__footer-protocol">PROTOCOL 2204·00A · DEEP DIVE WAVE REV 0.0</span>
        <span className="ew-chrome ew-window__footer-serial">SR-4150 · ENC LOCAL</span>
      </div>
    </div>
  );
}

// ── Clock component ──

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = time.getHours();
  const m = time.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return <span className="ew-taskbar__clock">{h12}:{m} {ampm}</span>;
}

// ── Large clock for Terminal skin canvas ──

function DesktopClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  return (
    <div className="ew-desktop-clock">
      <span className="ew-desktop-clock__time">{h}:{m}</span>
    </div>
  );
}

type WeatherCurrent = {
  temperature: number;
  humidity: number;
  precipitation: number;
  wind: number;
  code: number;
};

type WeatherDay = {
  date: string;
  high: number;
  low: number;
  precipitationChance: number | null;
};

type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

const WEATHER_CODES: Record<number, { label: string; glyph: string }> = {
  0: { label: 'Clear', glyph: 'sun' },
  1: { label: 'Mostly clear', glyph: 'sun' },
  2: { label: 'Partly cloudy', glyph: 'cloud' },
  3: { label: 'Cloudy', glyph: 'cloud' },
  45: { label: 'Fog', glyph: 'mist' },
  48: { label: 'Rime fog', glyph: 'mist' },
  51: { label: 'Light drizzle', glyph: 'rain' },
  53: { label: 'Drizzle', glyph: 'rain' },
  55: { label: 'Heavy drizzle', glyph: 'rain' },
  61: { label: 'Light rain', glyph: 'rain' },
  63: { label: 'Rain', glyph: 'rain' },
  65: { label: 'Heavy rain', glyph: 'rain' },
  71: { label: 'Light snow', glyph: 'snow' },
  73: { label: 'Snow', glyph: 'snow' },
  75: { label: 'Heavy snow', glyph: 'snow' },
  80: { label: 'Rain showers', glyph: 'rain' },
  81: { label: 'Showers', glyph: 'rain' },
  82: { label: 'Heavy showers', glyph: 'rain' },
  95: { label: 'Thunderstorm', glyph: 'storm' },
  96: { label: 'Storm with hail', glyph: 'storm' },
  99: { label: 'Storm with hail', glyph: 'storm' },
};

function weatherCodeMeta(code: number) {
  return WEATHER_CODES[code] ?? { label: 'Local sky', glyph: 'cloud' };
}

function timezoneLabel() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
  const segment = zone.split('/').pop() || zone;
  return segment.replace(/_/g, ' ');
}

function formatForecastDay(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, { weekday: 'short' });
}

function WeatherGlyph({ glyph }: { glyph: string }) {
  return (
    <span className={`ew-weather__glyph ew-weather__glyph--${glyph}`} aria-hidden="true">
      <span />
    </span>
  );
}

function WeatherWidget() {
  const [status, setStatus] = useState<WeatherStatus>('idle');
  const [current, setCurrent] = useState<WeatherCurrent | null>(null);
  const [forecast, setForecast] = useState<WeatherDay[]>([]);
  const [locationLabel, setLocationLabel] = useState(timezoneLabel);
  const [message, setMessage] = useState('Location not set');

  const loadWeather = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      setMessage('Location unavailable');
      return;
    }

    setStatus('loading');
    setMessage('Locating');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const params = new URLSearchParams({
          latitude: latitude.toFixed(4),
          longitude: longitude.toFixed(4),
          current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
          temperature_unit: 'celsius',
          wind_speed_unit: 'kmh',
          precipitation_unit: 'mm',
          forecast_days: '3',
          timezone: 'auto',
        });

        try {
          const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
          if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
          const data = await response.json();
          setCurrent({
            temperature: Math.round(data.current.temperature_2m),
            humidity: Math.round(data.current.relative_humidity_2m),
            precipitation: data.current.precipitation,
            wind: Math.round(data.current.wind_speed_10m),
            code: data.current.weather_code,
          });
          setForecast((data.daily.time as string[]).map((date, index) => ({
            date,
            high: Math.round(data.daily.temperature_2m_max[index]),
            low: Math.round(data.daily.temperature_2m_min[index]),
            precipitationChance: data.daily.precipitation_probability_max?.[index] ?? null,
          })));
          setLocationLabel(timezoneLabel());
          setMessage('Live');
          setStatus('ready');
        } catch (err) {
          console.warn('Weather fetch failed:', err);
          setStatus('error');
          setMessage('Weather offline');
        }
      },
      () => {
        setStatus('error');
        setMessage('Location blocked');
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 },
    );
  }, []);

  const meta = weatherCodeMeta(current?.code ?? 2);
  const displayTemp = current ? `${current.temperature}C` : '--';
  const displayCondition = current ? meta.label : 'Awaiting signal';

  return (
    <section className={`ew-weather ew-weather--${status}`} aria-label="Weather">
      <div className="ew-weather__main">
        <WeatherGlyph glyph={meta.glyph} />
        <div className="ew-weather__readout">
          <div className="ew-weather__temp">{displayTemp}</div>
          <div className="ew-weather__condition">{displayCondition}</div>
        </div>
      </div>
      <div className="ew-weather__meta">
        <span>{locationLabel}</span>
        <span>{message}</span>
      </div>
      <div className="ew-weather__metrics">
        <span>Wind {current ? `${current.wind} km/h` : '--'}</span>
        <span>Rain {current ? `${current.precipitation} mm` : '--'}</span>
        <span>Humidity {current ? `${current.humidity}%` : '--'}</span>
      </div>
      {forecast.length > 0 && (
        <div className="ew-weather__forecast">
          {forecast.map((day) => (
            <div key={day.date} className="ew-weather__day">
              <span>{formatForecastDay(day.date)}</span>
              <strong>{day.high}/{day.low}</strong>
              <em>{day.precipitationChance ?? '--'}%</em>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ew-weather__locate"
        onClick={loadWeather}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Scanning' : status === 'ready' ? 'Refresh' : 'Use location'}
      </button>
    </section>
  );
}

// ── Desktop canvas (center, skin-dependent) ──

function shortGpuName(name: string | null | undefined) {
  return name?.replace('NVIDIA ', '').replace('GeForce ', '') || null;
}

function isModelBackedApplet(applet: AppletEntry | null | undefined) {
  return !!applet && MODEL_BACKED_ENGINE_TYPES.has(applet.engine_type);
}

function usesLocalModelLifecycle(applet: AppletEntry | null | undefined) {
  return !!applet && LOCAL_MODEL_APPLET_IDS.has(applet.id);
}

function formatVram(mb: number | null | undefined) {
  if (!mb || mb <= 0) return null;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

function modelLabelFor(applet: AppletEntry | null | undefined, assessments: ModelAssessment[]) {
  if (!applet) return null;
  const assessment = assessments.find((item) => item.applet_id === applet.id);
  return assessment?.recommended_primary_model
    || assessment?.recommended_group
    || (usesLocalModelLifecycle(applet) || isModelBackedApplet(applet) ? `${applet.engine_type} model` : null);
}

function modelVramLabelFor(applet: AppletEntry | null | undefined, assessments: ModelAssessment[]) {
  if (!applet) return null;
  const assessment = assessments.find((item) => item.applet_id === applet.id);
  return formatVram(assessment?.recommended_vram_mb ?? applet.min_vram_mb);
}

function backendLabelForDesktop(gpu: SystemGpuState | null) {
  if (!gpu) return 'backend: detecting...';
  if (gpu.backend.type === 'Cuda') return `backend: CUDA / ${shortGpuName(gpu.primary_gpu) || gpu.backend.device_name}`;
  if (gpu.backend.type === 'Vulkan') return `backend: Vulkan / ${shortGpuName(gpu.primary_gpu) || gpu.backend.device_name}`;
  return gpu.backend.has_blas ? 'backend: CPU + OpenBLAS' : 'backend: CPU';
}

function buildInferenceReadout({
  gpu,
  assessments,
  launchingApplet,
  activeApplet,
  phase,
}: {
  gpu: SystemGpuState | null;
  assessments: ModelAssessment[];
  launchingApplet: AppletEntry | null;
  activeApplet: AppletEntry | null;
  phase: InferencePhase;
}) {
  if (phase === 'purging' && launchingApplet) {
    return {
      value: 'purging models',
      detail: `freeing VRAM for ${launchingApplet.name}`,
    };
  }

  if ((phase === 'opening' || launchingApplet) && launchingApplet) {
    const targetModel = modelLabelFor(launchingApplet, assessments);
    const vramTarget = modelVramLabelFor(launchingApplet, assessments);
    return {
      value: `opening ${launchingApplet.name}`,
      detail: targetModel
        ? `target: ${targetModel}${vramTarget ? ` / ${vramTarget}` : ''}`
        : 'starting applet engine',
    };
  }

  if (phase === 'error') {
    return {
      value: 'launch error',
      detail: 'engine handoff failed',
    };
  }

  if (activeApplet && isModelBackedApplet(activeApplet)) {
    const vramTarget = modelVramLabelFor(activeApplet, assessments);
    return {
      value: 'model loaded',
      detail: `${modelLabelFor(activeApplet, assessments) || `${activeApplet.name} engine warm`}${vramTarget ? ` / ${vramTarget}` : ''}`,
    };
  }

  const preferredModel = assessments.find((item) => item.recommended_primary_model);
  if (preferredModel?.recommended_primary_model) {
    return {
      value: 'standby',
      detail: `ready target: ${preferredModel.recommended_primary_model}`,
    };
  }

  return {
    value: gpu?.backend?.type === 'Cuda' || gpu?.backend?.type === 'Vulkan' ? 'standby' : 'idle',
    detail: gpu?.total_free_mb ? `${backendLabelForDesktop(gpu)} / ${formatVram(gpu.total_free_mb)} free` : backendLabelForDesktop(gpu),
  };
}

function modelLifecycleLoadMessage(applet: AppletEntry, assessments: ModelAssessment[]) {
  const model = modelLabelFor(applet, assessments);
  const vram = modelVramLabelFor(applet, assessments);
  if (applet.id === 'gener8-pro') {
    return `Loading the Pro audio model for Gener8 Pro${vram ? `, ${vram}` : ''}. Everywear selected the available model size for this GPU.`;
  }
  if (applet.id === 'daw') {
    return `Preparing the Pro Model for DAW stem separation${vram ? `, ${vram}` : ''}. Everywear owns the model size; the applet requests the pack.`;
  }
  if (applet.id === '3nvizen') {
    return `Preparing the local video model stack${vram ? `, ${vram}` : ''}. Everywear will pick the VRAM-fit execution profile.`;
  }
  if (applet.id === '1magen') {
    return `Preparing the local image model${vram ? `, ${vram}` : ''}. Everywear will pick the VRAM-fit model group.`;
  }
  return `Preparing ${model || `${applet.name} model`}${vram ? `, ${vram}` : ''}. Everywear owns provisioning and VRAM accounting.`;
}

function modelLifecycleCloseMessage(applet: AppletEntry) {
  if (applet.id === 'daw') {
    return 'Closing DAW will unload stem-separation models and return VRAM to the desktop pool.';
  }
  return `Closing ${applet.name} will unload its local models and return VRAM to the desktop pool.`;
}

function DesktopCanvas({
  theme,
  gpu,
  assessments,
  launchingApplet,
  activeApplet,
  inferencePhase,
  widgetsEnabled,
}: {
  theme: string;
  gpu: SystemGpuState | null;
  assessments: ModelAssessment[];
  launchingApplet: AppletEntry | null;
  activeApplet: AppletEntry | null;
  inferencePhase: InferencePhase;
  widgetsEnabled: boolean;
}) {
  const isLight = theme === 'light';
  const isTerminal = theme === 'terminal';
  const isV2 = theme === 'graphite' || theme === 'anodized' || theme === 'carbon';
  const inferenceReadout = buildInferenceReadout({
    gpu,
    assessments,
    launchingApplet,
    activeApplet,
    phase: inferencePhase,
  });

  if (isLight || isTerminal || theme === 'classic' || theme === 'refined' || isV2) {
    return (
      <div
        className={`ew-canvas ${
          isLight
            ? 'ew-canvas--light'
            : isTerminal
              ? 'ew-canvas--terminal'
              : theme === 'refined'
                ? 'ew-canvas--refined-home'
                : isV2
                  ? 'ew-canvas--v2-home'
                : 'ew-canvas--classic-home'
        }`}
      >
        {widgetsEnabled && (
          <div className="ew-canvas__center-hud">
            <DesktopClock />
            <div className="ew-canvas__subtitle">LOCAL &middot; HOME NODE &middot; BUILD 1.0.0</div>
            <div className="ew-canvas__status-row">
              <div className="ew-canvas__status-card">
                <div className="ew-canvas__status-label">NODE</div>
                <div className="ew-canvas__status-value">home.strands.local</div>
                <div className="ew-canvas__status-detail">status: awake</div>
              </div>
              <div className="ew-canvas__status-card">
                <div className="ew-canvas__status-label">INFERENCE</div>
                <div className="ew-canvas__status-value">{inferenceReadout.value}</div>
                <div className="ew-canvas__status-detail">{inferenceReadout.detail}</div>
              </div>
              <div className="ew-canvas__status-card">
                <div className="ew-canvas__status-label">NETWORK</div>
                <div className="ew-canvas__status-value">peers: 0 online</div>
                <div className="ew-canvas__status-detail">friends: 0 present</div>
              </div>
            </div>
            <WeatherWidget />
          </div>
        )}
      </div>
    );
  }

  return null;
}

function S3StudioFolder({
  applets,
  iconHealth,
  launchingId,
  isOpen,
  onToggle,
  onLaunch,
}: {
  applets: AppletEntry[];
  iconHealth: Record<string, 'online' | 'offline' | 'checking'>;
  launchingId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onLaunch: (applet: AppletEntry) => void;
}) {
  if (applets.length === 0) return null;

  return (
    <div className={`ew-desktop-folder ${isOpen ? 'ew-desktop-folder--open' : ''}`}>
      <button
        type="button"
        className="ew-desktop-icon ew-desktop-icon--folder"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label="S3 Studio folder"
      >
        <div className="ew-desktop-icon__glyph-wrap">
          <ThemedIconGlyph appletId="s3studio" />
          <span className="ew-folder-icon__count">{applets.length}</span>
        </div>
        <span className="ew-desktop-icon__label">S3 Studio</span>
      </button>

      {isOpen && (
        <div className="ew-folder-tray" role="group" aria-label="S3 Studio apps">
          <div className="ew-folder-tray__rail">
            {applets.map((applet) => (
              <AppletIcon
                key={applet.id}
                applet={applet}
                health={iconHealth[applet.id] ?? 'checking'}
                isLaunching={launchingId === applet.id}
                onClick={() => onLaunch(applet)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ShellLayout ──

export function ShellLayout() {
  // ── Registry-driven applet list (source of truth) ──
  const [registryApplets, setRegistryApplets] = useState<AppletEntry[]>([]);

  // Desktop window state. Mirrors the S3 Studio shell: desktop remains
  // present while applets/panels open as OS windows above it.
  const [windows, setWindows] = useState<ShellWindowState[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const nextZIndexRef = useRef(100);
  // When an applet opens its own studio window (via applet-webview-opened event)
  const [tauriApplet, setTauriApplet] = useState<{ applet_id: string; name: string; url: string } | null>(null);
  // Launching state: tracks which applet is currently going through the launch pipeline
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [activeInferenceAppletId, setActiveInferenceAppletId] = useState<string | null>(null);
  const [inferencePhase, setInferencePhase] = useState<InferencePhase>('idle');
  const [pendingAppletSwitch, setPendingAppletSwitch] = useState<PendingAppletSwitch | null>(null);
  const inferenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gpu, setGpu] = useState<SystemGpuState | null>(null);
  const [assessments, setAssessments] = useState<ModelAssessment[]>([]);
  const [iconHealth, setIconHealth] = useState<Record<string, 'online' | 'offline' | 'checking'>>({});
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [s3FolderOpen, setS3FolderOpen] = useState(false);
  const { user: authUser, tier } = useAuth();
  const { skin, mode, theme, setMode, trafficSide } = useTheme();
  const effectiveSkin = theme === 'light' ? 'classic' : skin;
  const entitlementSignature = useMemo(
    () => Object.entries(authUser?.entitlements ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key)
      .sort()
      .join('|'),
    [authUser?.entitlements],
  );

  const refreshRuntimeReadouts = useCallback(() => {
    getGpuStatus().then(setGpu).catch(console.error);
    listModelAssessments().then(setAssessments).catch(console.error);
  }, []);

  // Bug report + error badge
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportSeed, setBugReportSeed] = useState<BugReportSeed | null>(null);
  const [errorBadgeCount, setErrorBadgeCount] = useState(0);

  const openBugReport = useCallback((seed?: BugReportSeed | null) => {
    setBugReportSeed(seed ?? null);
    setBugReportOpen(true);
  }, []);

  const closeBugReport = useCallback(() => {
    setBugReportOpen(false);
    setBugReportSeed(null);
  }, []);

  const focusWindow = useCallback((id: string) => {
    const zIndex = ++nextZIndexRef.current;
    setActiveWindowId(id);
    setWindows(prev => prev.map(win =>
      win.id === id ? { ...win, zIndex, isMinimized: false } : win
    ));
  }, []);

  const moveShellWindow = useCallback((id: string, x: number, y: number) => {
    const maxX = Math.max(0, window.innerWidth - 96);
    const maxY = Math.max(44, window.innerHeight - 96);
    const nextX = Math.max(0, Math.min(x, maxX));
    const nextY = Math.max(44, Math.min(y, maxY));
    setWindows(prev => prev.map(win =>
      win.id === id ? { ...win, x: nextX, y: nextY } : win
    ));
  }, []);

  const clearInferenceTimer = useCallback(() => {
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
      inferenceTimerRef.current = null;
    }
  }, []);

  const markAppletOpening = useCallback((applet: AppletEntry) => {
    clearInferenceTimer();
    setLaunchingId(applet.id);

    const shouldPurge = isModelBackedApplet(applet)
      && !!activeInferenceAppletId
      && activeInferenceAppletId !== applet.id;
    setInferencePhase(shouldPurge ? 'purging' : 'opening');

    if (shouldPurge) {
      inferenceTimerRef.current = setTimeout(() => {
        setInferencePhase('opening');
        inferenceTimerRef.current = null;
      }, 1400);
    }
  }, [activeInferenceAppletId, clearInferenceTimer]);

  const markAppletReady = useCallback((applet: AppletEntry) => {
    clearInferenceTimer();
    setLaunchingId(null);
    if (isModelBackedApplet(applet)) {
      setActiveInferenceAppletId(applet.id);
      setInferencePhase('ready');
    } else {
      setInferencePhase('idle');
    }
  }, [clearInferenceTimer]);

  const markLaunchError = useCallback(() => {
    clearInferenceTimer();
    setLaunchingId(null);
    setInferencePhase('error');
    inferenceTimerRef.current = setTimeout(() => {
      setInferencePhase(activeInferenceAppletId ? 'ready' : 'idle');
      inferenceTimerRef.current = null;
    }, 3000);
  }, [activeInferenceAppletId, clearInferenceTimer]);

  const openShellWindow = useCallback((content: ShellWindowContent) => {
    const key = windowContentKey(content);
    const zIndex = ++nextZIndexRef.current;
    setWindows(prev => {
      const existing = prev.find(win => windowContentKey(win.content) === key);
      if (existing) {
        setActiveWindowId(existing.id);
        return prev.map(win =>
          win.id === existing.id ? { ...win, zIndex, isMinimized: false } : win
        );
      }

      const id = `${key}:${zIndex}`;
      const title = content.kind === 'panel' ? panelLabel(content.panel) : content.applet.name;
      const sublabel = content.kind === 'panel' ? 'Everywear OS' : content.applet.description;
      const viewportWidth = window.innerWidth || 1280;
      const viewportHeight = window.innerHeight || 800;
      const width = Math.min(1120, Math.max(720, Math.round(viewportWidth * 0.78)));
      const height = Math.min(760, Math.max(520, Math.round(viewportHeight * 0.78)));
      const offset = Math.min(prev.length * 28, 112);
      const x = Math.max(16, Math.min(Math.round(viewportWidth * 0.04) + offset, viewportWidth - width - 16));
      const y = Math.max(56, Math.min(Math.round(viewportHeight * 0.04) + offset, viewportHeight - height - 64));
      const nextWindow: ShellWindowState = {
        id,
        title,
        sublabel,
        content,
        x,
        y,
        width,
        height,
        zIndex,
        isMinimized: false,
        isMaximized: true,
      };
      setActiveWindowId(id);
      return [...prev, nextWindow];
    });
  }, []);

  const unloadInlineAppletModels = useCallback(async (applet: AppletEntry) => {
    if (!GENER8_SHARED_ENGINE_APPLET_IDS.has(applet.id)) return;
    try {
      await fetch('http://127.0.0.1:3001/api/engine/unload-models', {
        method: 'POST',
        credentials: 'omit',
      });
    } catch (err) {
      console.warn(`Failed to request inline model unload for ${applet.id}:`, err);
    } finally {
      refreshRuntimeReadouts();
    }
  }, [refreshRuntimeReadouts]);

  const closeShellWindow = useCallback((id: string) => {
    const closing = windows.find(win => win.id === id);
    if (closing?.content.kind === 'applet') {
      const { applet, renderMode } = closing.content;
      if (usesLocalModelLifecycle(applet)) {
        showToast({
          kind: 'info',
          eyebrow: 'Everywear · model lifecycle',
          message: modelLifecycleCloseMessage(applet),
          durationMs: 7000,
        });
      }
      if (renderMode === 'embedded' || applet.launch_binary) {
        closeAppletWebview(applet.id)
          .catch(() => {})
          .finally(refreshRuntimeReadouts);
      } else {
        void unloadInlineAppletModels(applet);
      }
      setActiveInferenceAppletId((current) => current === applet.id ? null : current);
      if (activeInferenceAppletId === applet.id) {
        setInferencePhase('idle');
      }
    }

    setWindows(prev => {
      const remaining = prev.filter(win => win.id !== id);
      setActiveWindowId(current =>
        current === id
          ? (remaining.filter(win => !win.isMinimized).sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null)
          : current
      );
      return remaining;
    });
  }, [activeInferenceAppletId, refreshRuntimeReadouts, unloadInlineAppletModels, windows]);

  const openAppletEntries = useCallback((exceptId?: string) => {
    const byId = new Map<string, AppletEntry>();
    windows.forEach((win) => {
      if (win.content.kind === 'applet' && win.content.applet.id !== exceptId) {
        byId.set(win.content.applet.id, win.content.applet);
      }
    });
    if (tauriApplet?.applet_id && tauriApplet.applet_id !== exceptId) {
      const entry = registryApplets.find((applet) => applet.id === tauriApplet.applet_id);
      if (entry) byId.set(entry.id, entry);
    }
    if (activeInferenceAppletId && activeInferenceAppletId !== exceptId) {
      const entry = registryApplets.find((applet) => applet.id === activeInferenceAppletId);
      if (entry) byId.set(entry.id, entry);
    }
    return Array.from(byId.values());
  }, [activeInferenceAppletId, registryApplets, tauriApplet, windows]);

  const closeOpenApplets = useCallback(async (exceptId?: string, onlyIds?: Set<string>) => {
    const appletsToClose = openAppletEntries(exceptId)
      .filter((applet) => !onlyIds || onlyIds.has(applet.id));
    if (appletsToClose.length === 0) return;

    appletsToClose
      .filter(usesLocalModelLifecycle)
      .forEach((applet) => {
        showToast({
          kind: 'info',
          eyebrow: 'Everywear · model lifecycle',
          message: modelLifecycleCloseMessage(applet),
          durationMs: 7000,
        });
      });

    setInferencePhase('purging');
    await Promise.all(
      appletsToClose.map((applet) =>
        GENER8_SHARED_ENGINE_APPLET_IDS.has(applet.id)
          ? unloadInlineAppletModels(applet)
          : closeAppletWebview(applet.id).catch((err) => {
              console.warn(`Failed to close applet ${applet.id}:`, err);
            }),
      ),
    );

    const closingIds = new Set(appletsToClose.map((applet) => applet.id));
    setWindows((prev) => prev.filter((win) =>
      win.content.kind !== 'applet' || !closingIds.has(win.content.applet.id)
    ));
    setTauriApplet((current) => current && closingIds.has(current.applet_id) ? null : current);
    setActiveInferenceAppletId((current) => current && closingIds.has(current) ? null : current);
    setInferencePhase('idle');
    refreshRuntimeReadouts();
  }, [openAppletEntries, refreshRuntimeReadouts, unloadInlineAppletModels]);

  const minimizeShellWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(win => win.id === id ? { ...win, isMinimized: true } : win));
    setActiveWindowId(current => current === id ? null : current);
  }, []);

  const maximizeShellWindow = useCallback((id: string) => {
    const zIndex = ++nextZIndexRef.current;
    setWindows(prev => prev.map(win =>
      win.id === id ? { ...win, isMaximized: !win.isMaximized, zIndex } : win
    ));
    setActiveWindowId(id);
  }, []);

  useEffect(() => {
    const tick = () => setErrorBadgeCount(getErrorCount());
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!hasShellRuntime()) return;

    const checkPendingCrashReport = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const report = await invoke<PendingRustCrashReport | null>('take_pending_crash_report');
        if (!report || cancelled) return;
        log.error('system', 'Recovered Rust crash report from previous launch', {
          report_id: report.id,
          message: report.message,
          location: report.location,
        });
        openBugReport({
          source: report.process,
          crashKind: 'rust',
          occurredAt: report.timestamp,
          errorMessage: report.message,
          stack: report.backtrace || undefined,
          description: `Everywear closed unexpectedly on the previous run.\n\nWhat were you doing right before it happened?`,
          extra: {
            report_id: report.id,
            thread: report.thread,
            location: report.location,
          },
        });
      } catch (err) {
        console.warn('Failed to check pending crash report:', err);
      }
    };

    checkPendingCrashReport();
    return () => {
      cancelled = true;
    };
  }, [openBugReport]);

  useEffect(() => () => clearInferenceTimer(), [clearInferenceTimer]);

  // ── Load registry on mount ──
  useEffect(() => {
    getProfile().then(setProfile).catch(console.error);
    refreshRuntimeReadouts();
    listApplets()
      .then((applets) => {
        log.info('ui', `Registry loaded: ${applets.length} applets`);
        setRegistryApplets(applets);
      })
      .catch((err) => {
        console.error('Failed to load applet registry:', err);
      });
  }, [refreshRuntimeReadouts]);

  useEffect(() => {
    if (!authUser) return;
    listApplets()
      .then((applets) => {
        log.info('ui', `Registry refreshed for auth state: ${applets.length} applets`);
        setRegistryApplets(applets);
      })
      .catch((err) => {
        console.error('Failed to refresh applet registry for auth state:', err);
      });
  }, [authUser?.id, tier, entitlementSignature]);

  // ── Health polling based on registry frontend_port ──
  const checkHealth = useCallback(async () => {
    const results: Record<string, 'online' | 'offline' | 'checking'> = {};
    for (const applet of registryApplets) {
      if (applet.status === 'NotBuilt') continue;
      if (!applet.frontend_port) {
        // Web applets or frontend-only with no port: assume online
        results[applet.id] = applet.launch_url ? 'online' : 'online';
        continue;
      }
      try {
        const url = `http://127.0.0.1:${applet.frontend_port}${applet.frontend_route || ''}/`;
        await fetch(url, { method: 'GET', mode: 'no-cors', signal: AbortSignal.timeout(3000) });
        results[applet.id] = 'online';
      } catch {
        results[applet.id] = 'offline';
      }
    }
    setIconHealth(results);
  }, [registryApplets]);

  useEffect(() => {
    if (registryApplets.length === 0) return;
    checkHealth();
    healthTimerRef.current = setInterval(checkHealth, 10000);
    return () => { if (healthTimerRef.current) clearInterval(healthTimerRef.current); };
  }, [checkHealth, registryApplets]);

  // Applet self-reported readiness. Portless inline applets (Layer U, Avatar
  // Studio) are assumed online by the port poll, which let the window chrome
  // show READY over offline content. Applets dispatch
  // `everywear:applet-status` with { appletId, status } to override.
  // (Handoff 2026-06-07: applet status truthfulness.)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ appletId?: string; status?: 'online' | 'offline' | 'checking' }>).detail;
      if (!detail?.appletId || !detail.status) return;
      setIconHealth((prev) =>
        prev[detail.appletId!] === detail.status ? prev : { ...prev, [detail.appletId!]: detail.status! }
      );
    };
    window.addEventListener('everywear:applet-status', handler);
    return () => window.removeEventListener('everywear:applet-status', handler);
  }, []);

  // ── Tauri applet webview lifecycle events ──
  useEffect(() => {
    if (!hasShellRuntime()) return;

    const unlistenOpen = listen<{ applet_id: string; name: string; url: string }>('applet-webview-opened', (event) => {
      const { applet_id, name, url } = event.payload;
      log.info('ui', `Applet webview opened: ${applet_id} at ${url}`);

      // If the applet has a frontend_port, show it inline via HeadlessAppletView.
      // If it opened a studio window (url != headless), show the banner.
      const entry = registryApplets.find((a) => a.id === applet_id);
      if (entry) markAppletReady(entry);
      if (entry && isRegisteredApplet(entry.id)) {
        openShellWindow({ kind: 'applet', applet: entry, renderMode: 'inline' });
      } else if (entry?.frontend_port) {
        // Fallback for applets not registered as shell-native React views.
        openShellWindow({ kind: 'applet', applet: entry, renderMode: 'embedded' });
      } else {
        // Studio window: show overlay banner
        setTauriApplet({ applet_id, name, url });
      }
    });

    const unlistenClose = listen<{ applet_id: string }>('applet-webview-closed', (event) => {
      log.info('ui', `Applet webview closed: ${event.payload.applet_id}`);
      setWindows(prev => prev.filter(win =>
        win.content.kind !== 'applet' || win.content.applet.id !== event.payload.applet_id
      ));
      setActiveInferenceAppletId((current) => current === event.payload.applet_id ? null : current);
      if (activeInferenceAppletId === event.payload.applet_id) {
        setInferencePhase('idle');
      }
      if (tauriApplet?.applet_id === event.payload.applet_id) {
        setTauriApplet(null);
      }
    });

    return () => {
      unlistenOpen.then(fn => fn());
      unlistenClose.then(fn => fn());
    };
  }, [activeInferenceAppletId, markAppletReady, registryApplets, openShellWindow, tauriApplet]);

  useEffect(() => {
    if (!hasShellRuntime()) return;

    const unlistenProgress = listen<{ stage?: string; message?: string }>('applet-switch-progress', (event) => {
      refreshRuntimeReadouts();
      const stage = event.payload?.stage ?? 'Model lifecycle';
      const message = event.payload?.message;
      if (!message) return;
      const kind = stage === 'Failed' ? 'error' : stage === 'Downloading' ? 'info' : 'info';
      showToast({
        kind,
        eyebrow: 'Everywear · model lifecycle',
        message,
        durationMs: stage === 'Downloading' ? 9000 : 5000,
        id: `applet-switch-${stage}-${message}`,
      });
    });

    const unlistenDownload = listen<{ model_key?: string; downloaded?: number; total?: number; pct?: number }>('download-progress', (event) => {
      refreshRuntimeReadouts();
      const pct = typeof event.payload?.pct === 'number'
        ? `${Math.round(event.payload.pct)}%`
        : 'in progress';
      showToast({
        kind: 'info',
        eyebrow: 'Everywear · model download',
        message: `${event.payload?.model_key || 'Model'} download ${pct}.`,
        durationMs: 3500,
        id: `download-${event.payload?.model_key || 'model'}`,
      });
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenDownload.then(fn => fn());
    };
  }, [refreshRuntimeReadouts]);

  const handleCloseTauriApplet = async () => {
    if (tauriApplet) {
      const entry = registryApplets.find((applet) => applet.id === tauriApplet.applet_id);
      if (entry && usesLocalModelLifecycle(entry)) {
        showToast({
          kind: 'info',
          eyebrow: 'Everywear · model lifecycle',
          message: modelLifecycleCloseMessage(entry),
          durationMs: 7000,
        });
      }
      try { await closeAppletWebview(tauriApplet.applet_id); } catch (err) { console.error(err); }
      refreshRuntimeReadouts();
      setTauriApplet(null);
    }
  };

  // ── Applet launch handler (goes through the runtime bridge) ──
  const handleAppletLaunch = async (applet: AppletEntry, options?: { skipSwitchPrompt?: boolean }) => {
    const blockedReason = appletLaunchBlocked(applet, tier, authUser?.entitlements ?? authUser?.tiers);
    if (blockedReason) {
      log.warn('ui', `Applet ${applet.id} blocked before launch: ${blockedReason}`);
      markLaunchError();
      return;
    }

    // S3 suite lifecycle: only one suite applet window at a time. Opening a
    // suite applet silently closes any other open suite applet first; handoff
    // context (e.g. selected song into Vid) travels via intentBus/Vault, not
    // process memory, so it survives the close. (Handoff 2026-06-07.)
    let suiteClosedIds: Set<string> | null = null;
    if (S3_SUITE_APPLET_IDS.has(applet.id)) {
      const openSuite = openAppletEntries(applet.id)
        .filter((entry) => S3_SUITE_APPLET_IDS.has(entry.id));
      if (openSuite.length > 0) {
        await closeOpenApplets(applet.id, S3_SUITE_APPLET_IDS);
        // openAppletEntries reads this render's stale window snapshot, so
        // remember what we closed and exclude it from the switch prompt below.
        suiteClosedIds = new Set(openSuite.map((entry) => entry.id));
      }
    }

    if (!options?.skipSwitchPrompt) {
      const closing = openAppletEntries(applet.id)
        .filter((entry) => !suiteClosedIds?.has(entry.id));
      if (closing.length > 0) {
        setPendingAppletSwitch({ incoming: applet, closing });
        return;
      }
    }

    markAppletOpening(applet);
    refreshRuntimeReadouts();

    if (usesLocalModelLifecycle(applet)) {
      showToast({
        kind: 'info',
        eyebrow: 'Everywear · model lifecycle',
        message: modelLifecycleLoadMessage(applet, assessments),
        durationMs: applet.id === 'daw' || applet.id === 'gener8-pro' ? 9000 : 6500,
      });
    }

    if (applet.launch_kind === 'FrontendInline' && isRegisteredApplet(applet.id)) {
      openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
      markAppletReady(applet);
      refreshRuntimeReadouts();
      return;
    }

    if (applet.launch_kind === 'ExternalUrl' && applet.launch_url) {
      log.info('ui', `Opening web applet internally: ${applet.id} at ${applet.launch_url}`);
      openShellWindow({ kind: 'applet', applet, renderMode: 'embedded' });
      markAppletReady(applet);
      refreshRuntimeReadouts();
      return;
    }

    if (applet.launch_kind === 'Placeholder') {
      log.warn('ui', `Applet ${applet.id} is a placeholder with no runtime yet`);
      markLaunchError();
      return;
    }

    // BinaryLocal applets go through the runtime bridge.
    log.info('ui', `Launching applet via runtime bridge: ${applet.id}`);
    const hasIntegratedFrontendFallback = Boolean(applet.frontend_port && isRegisteredApplet(applet.id));
    if (hasIntegratedFrontendFallback) {
      openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
      showToast({
        kind: 'info',
        eyebrow: `${applet.name} · runtime handoff`,
        message: 'Opening the studio surface now. Everywear will finish local engine handoff in the background.',
        durationMs: 7000,
      });
      markAppletReady(applet);
      refreshRuntimeReadouts();
    }
    try {
      await requestAppletSwitch(applet.id);
      if (isShellNativeBridgeApplet(applet)) {
        openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
        markAppletReady(applet);
        refreshRuntimeReadouts();
      }
      if (!hasShellRuntime()) {
        if (applet.frontend_port) {
          if (isRegisteredApplet(applet.id)) {
            openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
          } else {
            openShellWindow({ kind: 'applet', applet, renderMode: 'embedded' });
          }
        }
        markAppletReady(applet);
        refreshRuntimeReadouts();
      }
      // The runtime bridge will emit 'applet-webview-opened' when ready.
      // Our event listener above handles the rest.
    } catch (err) {
      console.error(`Failed to launch ${applet.id}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      log.error('ui', `Failed to launch ${applet.id}`, {
        applet_id: applet.id,
        message,
      });
      // If launch fails but the applet has a frontend_port, fall through
      // to headless view (dev mode: sidecar may not be needed)
      if (applet.frontend_port) {
        log.warn('ui', `Launch bridge failed for ${applet.id}, falling back to headless iframe`);
        if (isRegisteredApplet(applet.id)) {
          openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
        } else {
          openShellWindow({ kind: 'applet', applet, renderMode: 'embedded' });
        }
        showToast({
          kind: 'warning',
          eyebrow: `${applet.name} · runtime handoff`,
          message: 'Opened the studio surface while the local engine handoff finishes. Generation may still need model setup.',
          durationMs: 8000,
        });
        markAppletReady(applet);
        refreshRuntimeReadouts();
        return;
      }
      markLaunchError();
      openBugReport({
        source: applet.id,
        crashKind: 'frontend',
        occurredAt: new Date().toISOString(),
        errorMessage: message,
        description: `${applet.name} failed to launch.`,
        extra: {
          applet_id: applet.id,
          launch_kind: applet.launch_kind,
          frontend_port: applet.frontend_port,
          launch_binary: applet.launch_binary,
        },
      });
    }
  };

  const confirmAppletSwitch = async () => {
    const pending = pendingAppletSwitch;
    if (!pending) return;
    setPendingAppletSwitch(null);
    await closeOpenApplets(pending.incoming.id);
    await handleAppletLaunch(pending.incoming, { skipSwitchPrompt: true });
  };

  // ── System panel click handler ──
  const openPanel = (panel: Exclude<PanelView, null>) => {
    openShellWindow({ kind: 'panel', panel });
  };

  const handleSystemClick = (iconId: Exclude<PanelView, null>) => {
    openPanel(iconId);
  };

  const quitEverywear = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('quit_everywear');
    } catch (err) {
      console.error('Failed to quit Everywear cleanly:', err);
      await getCurrentWindow().close();
    }
  }, []);

  const displayName = authUser?.displayName || authUser?.handle || profile?.display_name || 'User';
  const profileIndicatorName = authUser?.everywearId
    || (authUser?.rawUsername ? `${authUser.rawUsername}@everywear.id` : null)
    || (authUser?.handle ? `${authUser.handle}@everywear.id` : null)
    || displayName;
  const compactProfileIndicator = profileIndicatorName.length > 19
    ? `${profileIndicatorName.slice(0, 16)}...`
    : profileIndicatorName;
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  // Show the registry as the desktop source of truth. S3 Studio is a desktop
  // folder, not a web shortcut; its child applets still come from the registry.
  // Lock state is derived from the owner's live entitlement flags here, so the
  // launcher badge agrees with appletLaunchBlocked() rather than trusting a
  // stale presentation `Locked` from the registry. (WIKI.md v1.1.16)
  const gatedApplets = useMemo(
    () => {
      const flags = authUser?.entitlements ?? authUser?.tiers;
      return registryApplets.map((applet) => {
        const isVidPro = applet.id === 'vid' && flags?.vid_pro === true;
        return {
          ...applet,
          name: isVidPro ? 'Vid Studio Pro' : applet.name,
          description: isVidPro ? 'Audio-reactive visualizer with Pro video export.' : applet.description,
          status: resolveAppletStatus(applet, flags),
        };
      });
    },
    [registryApplets, authUser?.entitlements, authUser?.tiers]
  );
  const s3FolderApplets = useMemo(
    () => gatedApplets
      .filter((applet) => S3_FOLDER_APPLET_IDS.has(applet.id))
      .sort((a, b) => S3_FOLDER_ORDER.indexOf(a.id) - S3_FOLDER_ORDER.indexOf(b.id)),
    [gatedApplets]
  );
  // My Mait (internal id `kasai`) takes top billing: rendered first in the
  // roster, above the S3 Studio folder. It is the free companion chassis and
  // the front door of Everywear. Excluded from visibleApplets so it is not
  // also rendered in the standalone list. (Display name "My Mait"; id stays kasai.)
  const myMaitApplet = useMemo(
    () => gatedApplets.find((applet) => applet.id === 'kasai') ?? null,
    [gatedApplets]
  );
  const visibleApplets = useMemo(
    () => gatedApplets.filter((applet) => !S3_FOLDER_APPLET_IDS.has(applet.id) && applet.id !== 's3studio' && applet.id !== 'kasai'),
    [gatedApplets]
  );
  useEffect(() => {
    const handleAppletLaunchRequest = (event: Event) => {
      const appletId = (event as CustomEvent<{ appletId?: string }>).detail?.appletId;
      if (!appletId) return;

      const applet = gatedApplets.find((entry) => entry.id === appletId)
        ?? registryApplets.find((entry) => entry.id === appletId);
      if (!applet) {
        log.warn('ui', `Applet launch request ignored; ${appletId} is not registered`);
        return;
      }

      void handleAppletLaunch(applet, { skipSwitchPrompt: true });
    };

    window.addEventListener('everywear:launch-applet', handleAppletLaunchRequest);
    return () => {
      window.removeEventListener('everywear:launch-applet', handleAppletLaunchRequest);
    };
  }, [gatedApplets, registryApplets, handleAppletLaunch]);
  const launchingApplet = launchingId
    ? registryApplets.find((applet) => applet.id === launchingId) ?? null
    : null;
  const activeInferenceApplet = activeInferenceAppletId
    ? registryApplets.find((applet) => applet.id === activeInferenceAppletId) ?? null
    : null;
  const hasOpenApplet = useMemo(
    () => !!launchingId || !!tauriApplet || windows.some((win) => win.content.kind === 'applet'),
    [launchingId, tauriApplet, windows],
  );

  useEffect(() => {
    if (!hasOpenApplet && inferencePhase === 'idle') return;
    const interval = setInterval(refreshRuntimeReadouts, 3000);
    return () => clearInterval(interval);
  }, [hasOpenApplet, inferencePhase, refreshRuntimeReadouts]);

  useEffect(() => {
    if (hasOpenApplet) setS3FolderOpen(false);
  }, [hasOpenApplet]);

  // GPU status for footer
  const gpuLabel = gpu?.backend?.type === 'Cuda'
    ? `${gpu.primary_gpu?.replace('NVIDIA ', '').replace('GeForce ', '')} · ${gpu.total_free_mb.toLocaleString()} MB`
    : gpu?.backend?.type === 'Vulkan'
    ? `Vulkan · ${gpu.primary_gpu}`
    : 'CPU-only';

  const renderWindowContent = (win: ShellWindowState) => {
    if (win.content.kind === 'panel') {
      if (win.content.panel === 'profile') return <ProfilePanel />;
      if (win.content.panel === 'gpu') return <GpuPanel />;
      if (win.content.panel === 'settings') return <SettingsPanel />;
      return <VaultPanel />;
    }

    const { applet, renderMode } = win.content;
    if (renderMode === 'inline') {
      return (
        <AppletViewRouter
          appletId={applet.id}
          applet={applet}
          skin={effectiveSkin}
          mode={mode}
          onClose={() => closeShellWindow(win.id)}
          onCrashReport={openBugReport}
        />
      );
    }
    return <HeadlessAppletView applet={applet} onClose={() => closeShellWindow(win.id)} />;
  };

  const visibleWindows = windows.filter(win => !win.isMinimized);
  const handleShowDesktop = () => {
    setWindows(prev => prev.map(win => ({ ...win, isMinimized: true })));
    setActiveWindowId(null);
  };

  return (
    <>
      {/* ── Titlebar ── */}
      <div className={`ew-titlebar ew-titlebar--traffic-${trafficSide}`}>
        <div className="ew-titlebar__left">
          {trafficSide === 'left' && (
            <TrafficLights
              onClose={quitEverywear}
              onMinimize={() => getCurrentWindow().minimize()}
              onMaximize={() => getCurrentWindow().toggleMaximize()}
            />
          )}
          <span className="ew-titlebar__sigil">&#9671;</span>
          <span className="ew-chrome ew-titlebar__jp">登録</span>
        </div>
        <div className="ew-titlebar__center" data-tauri-drag-region>
          <span className="ew-titlebar__version">EVERYWEAR/1.0 &middot; home node &middot; build 1.0.0</span>
        </div>
        <div className="ew-titlebar__right">
          <ChromeBarcode seed={2204} width={88} height={12} />
          <ChromeSerial prefix="EW" code="2204/00A" />
          {trafficSide === 'right' && (
            <TrafficLights
              onClose={quitEverywear}
              onMinimize={() => getCurrentWindow().minimize()}
              onMaximize={() => getCurrentWindow().toggleMaximize()}
            />
          )}
        </div>
      </div>

      {/* ── Desktop OS surface ── */}
      <div className="ew-desktop">
        {/* Center canvas / wallpaper layer */}
        <DesktopCanvas
          theme={theme}
          gpu={gpu}
          assessments={assessments}
          launchingApplet={launchingApplet}
          activeApplet={activeInferenceApplet}
          inferencePhase={inferencePhase}
          widgetsEnabled={!hasOpenApplet}
        />

        {/* Icon grid: My Mait (top billing) + registry applets + system icons */}
        <div className="ew-icon-grid">
          {myMaitApplet && (
            <AppletIcon
              key={myMaitApplet.id}
              applet={myMaitApplet}
              health={iconHealth[myMaitApplet.id] ?? 'checking'}
              isLaunching={launchingId === myMaitApplet.id}
              onClick={() => handleAppletLaunch(myMaitApplet)}
            />
          )}
          <S3StudioFolder
            applets={s3FolderApplets}
            iconHealth={iconHealth}
            launchingId={launchingId}
            isOpen={s3FolderOpen}
            onToggle={() => setS3FolderOpen((open) => !open)}
            onLaunch={handleAppletLaunch}
          />

          {visibleApplets.map((applet) => (
            <AppletIcon
              key={applet.id}
              applet={applet}
              health={iconHealth[applet.id] ?? 'checking'}
              isLaunching={launchingId === applet.id}
              onClick={() => handleAppletLaunch(applet)}
            />
          ))}

          {SYSTEM_ICONS.map((icon) => (
            <button
              type="button"
              key={icon.id}
              className="ew-desktop-icon ew-desktop-icon--system"
              aria-label={`Open ${icon.label}`}
              title={icon.label}
              onClick={() => handleSystemClick(icon.id)}
            >
              <span className="ew-desktop-icon__glyph-wrap">
                <ThemedIconGlyph appletId={icon.glyphId} />
              </span>
              <span className="ew-desktop-icon__label">{icon.label}</span>
            </button>
          ))}
        </div>

        {/* Window layer */}
        <div className="ew-window-layer">
          {visibleWindows.map((win) => (
            <ShellWindowFrame
              key={win.id}
              win={win}
              isActive={win.id === activeWindowId}
              trafficSide={trafficSide}
              onFocus={() => focusWindow(win.id)}
              onBugReport={() => openBugReport({
                source: win.title,
                crashKind: 'manual',
                description: `Problem with ${win.title}\n\nWhat went wrong?`,
                extra: {
                  window_id: win.id,
                  content: win.content.kind === 'panel' ? win.content.panel : win.content.applet.id,
                },
              })}
              onClose={() => closeShellWindow(win.id)}
              onMinimize={() => minimizeShellWindow(win.id)}
              onMaximize={() => maximizeShellWindow(win.id)}
              onMove={(x, y) => moveShellWindow(win.id, x, y)}
              runtimeLabel={windowRuntimeLabel(
                win.content,
                activeInferenceAppletId,
                launchingId,
                inferencePhase,
                win.content.kind === 'applet' ? iconHealth[win.content.applet.id] : undefined,
              )}
            >
              {renderWindowContent(win)}
            </ShellWindowFrame>
          ))}
        </div>
      </div>

      {/* ── Bottom taskbar ── */}
      <div className="ew-taskbar">
        <div className="ew-taskbar__left">
          <button className="ew-taskbar__start" onClick={handleShowDesktop} title="Show Desktop">
            <span className="ew-taskbar__start-glyph">&#9671;</span>
          </button>
          <div className="ew-taskbar__divider" />
          {/* LED status ring */}
          <div className={`ew-taskbar__led ${gpu?.backend?.type === 'Cuda' ? 'ew-taskbar__led--active' : ''}`} />
          {/* GPU label */}
          <span className="ew-taskbar__gpu-label">{gpuLabel}</span>
          <div className="ew-taskbar__window-list">
            {windows.map((win) => (
              <button
                key={win.id}
                className={`ew-taskitem ${win.id === activeWindowId ? 'ew-taskitem--active' : ''}`}
                onClick={() => focusWindow(win.id)}
                title={win.title}
              >
                <span className="ew-taskitem__dot" />
                <span className="ew-taskitem__label">{win.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ew-taskbar__center">
          <div className="ew-mode-toggle" aria-label="Light or dark desktop mode">
            <button
              type="button"
              className={`ew-mode-toggle__option ${mode === 'light' ? 'ew-mode-toggle__option--active' : ''}`}
              aria-pressed={mode === 'light'}
              onClick={() => setMode('light')}
              title="Light mode"
            >
              Light
            </button>
            <button
              type="button"
              className={`ew-mode-toggle__option ${mode === 'dark' ? 'ew-mode-toggle__option--active' : ''}`}
              aria-pressed={mode === 'dark'}
              onClick={() => setMode('dark')}
              title="Dark mode"
            >
              Dark
            </button>
          </div>
        </div>
        <div className="ew-taskbar__right">
          {/* Profile mini */}
          <button className="ew-taskbar__profile" onClick={() => openPanel('profile')}>
            <span className="ew-taskbar__profile-avatar">{initials}</span>
            <span className="ew-taskbar__profile-name">{compactProfileIndicator}</span>
          </button>
          {/* Bug report / notification bell */}
          <button
            className="ew-taskbar__bell"
            onClick={() => openBugReport()}
            title="Report a problem"
          >
            &#128276;
            {errorBadgeCount > 0 && (
              <span className="ew-taskbar__badge">{errorBadgeCount > 99 ? '99+' : errorBadgeCount}</span>
            )}
          </button>
          {/* Clock */}
          <Clock />
        </div>
      </div>

      {/* Tauri applet running in separate studio window (overlay banner) */}
      {tauriApplet && (
        <div className="ew-tauri-banner">
          <span>{tauriApplet.name} is running in a separate window</span>
          <button onClick={handleCloseTauriApplet}>Close</button>
        </div>
      )}

      {/* Launch progress overlay */}
      {launchingId && (
        <div className="ew-tauri-banner">
          <span>Launching {registryApplets.find(a => a.id === launchingId)?.name || launchingId}...</span>
        </div>
      )}

      {pendingAppletSwitch && (
        <div className="ew-applet-switch" role="dialog" aria-modal="true" aria-labelledby="ew-applet-switch-title">
          <div className="ew-applet-switch__panel">
            <div className="ew-applet-switch__eyebrow">Applet switch</div>
            <h2 id="ew-applet-switch-title">Close {pendingAppletSwitch.closing.map((applet) => applet.name).join(', ')}?</h2>
            <p>
              Everywear will unload its local models before opening {pendingAppletSwitch.incoming.name}.
            </p>
            <div className="ew-applet-switch__actions">
              <button
                type="button"
                className="ew-applet-switch__cancel"
                onClick={() => setPendingAppletSwitch(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ew-applet-switch__confirm"
                onClick={confirmAppletSwitch}
              >
                Close and open
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastHost />
      <FirstRunTourHost />
      <BugReportModal open={bugReportOpen} onClose={closeBugReport} seed={bugReportSeed} />
    </>
  );
}
