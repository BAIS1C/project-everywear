import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  getProfile,
  getGpuStatus,
  listModelAssessments,
  listApplets,
  launchApplet,
  closeAppletWebview,
  type AppletEntry,
  type ModelAssessment,
  type UserProfile,
  type SystemGpuState,
} from '../lib/transport';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { getLogger, getErrorCount } from '@everywear/shared';
import { LogViewerPanel } from '../components/LogViewerPanel';
import { BugReportModal } from '../components/BugReportModal';

const log = getLogger('shell');
import { ProfilePanel } from '../panels/ProfilePanel';
import { GpuPanel } from '../panels/GpuPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { HeadlessAppletView } from '../panels/HeadlessAppletView';
import { AppletViewRouter, isRegisteredApplet } from '../components/AppletViewRouter';
import AppletIcon from '../components/AppletIcon';
import { VaultProvider } from '@applets/gener8/web/src/context/VaultProvider';

const VaultLibraryView = lazy(() => import('@applets/gener8/web/src/views/LibraryView'));

// System panels (not in the Tauri registry, shell-only)
interface SystemIcon {
  id: Exclude<PanelView, null>;
  label: string;
  monogram: string;
  color: string;
}

const SYSTEM_ICONS: SystemIcon[] = [
  { id: 'settings', label: 'Settings', monogram: '⚙', color: 'var(--ew-primary)' },
  { id: 'vault',    label: 'Vault',    monogram: '▦', color: 'var(--ew-primary)' },
];

type PanelView = 'profile' | 'gpu' | 'settings' | 'vault' | null;
type VaultSection = 'media' | 'logs';
const THEME_OPTIONS = ['light', 'classic', 'refined', 'terminal'] as const;
const S3_FOLDER_APPLET_IDS = new Set(['1magen', 'gener8', 'vid', '3nvizen']);
const S3_FOLDER_ORDER = ['1magen', 'gener8', 'vid', '3nvizen'];

function VaultPanel() {
  const [section, setSection] = useState<VaultSection>('media');

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
          <VaultProvider>
            <Suspense fallback={<div className="ew-vault-panel__loading">Loading vault...</div>}>
              <VaultLibraryView />
            </Suspense>
          </VaultProvider>
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

interface ShellWindowState {
  id: string;
  title: string;
  sublabel?: string;
  content: ShellWindowContent;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
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

function ShellWindowFrame({
  win,
  isActive,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  children,
}: {
  win: ShellWindowState;
  isActive: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  children: React.ReactNode;
}) {
  if (win.isMinimized) return null;

  return (
    <div
      className={`ew-window ${isActive ? 'ew-window--active' : ''} ${win.isMaximized ? 'ew-window--maximized' : ''}`}
      style={{ zIndex: win.zIndex }}
      onPointerDown={onFocus}
    >
      <div className="ew-window__titlebar" onDoubleClick={onMaximize}>
        <div className="ew-window__controls">
          <button className="ew-window__control ew-window__control--close" onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" />
          <button className="ew-window__control ew-window__control--minimize" onClick={(e) => { e.stopPropagation(); onMinimize(); }} title="Minimize" />
          <button className="ew-window__control ew-window__control--maximize" onClick={(e) => { e.stopPropagation(); onMaximize(); }} title="Maximize" />
        </div>
        <span className="ew-window__title">{win.title}</span>
        {win.sublabel && <span className="ew-window__subtitle">{win.sublabel}</span>}
      </div>
      <div className="ew-window__body">{children}</div>
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

// ── Desktop canvas (center, skin-dependent) ──

function DesktopCanvas({ theme, gpu }: { theme: string; gpu: SystemGpuState | null }) {
  const isLight = theme === 'light';
  const isTerminal = theme === 'terminal';
  if (isLight || isTerminal || theme === 'classic' || theme === 'refined') {
    return (
      <div
        className={`ew-canvas ${
          isLight
            ? 'ew-canvas--light'
            : isTerminal
              ? 'ew-canvas--terminal'
              : theme === 'refined'
                ? 'ew-canvas--refined-home'
                : 'ew-canvas--classic-home'
        }`}
      >
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
              <div className="ew-canvas__status-value">{gpu?.backend?.type === 'Cuda' ? 'ready' : 'idle'}</div>
              <div className="ew-canvas__status-detail">{gpu?.primary_gpu?.replace('NVIDIA ', '').replace('GeForce ', '') || 'detecting...'}</div>
            </div>
            <div className="ew-canvas__status-card">
              <div className="ew-canvas__status-label">NETWORK</div>
              <div className="ew-canvas__status-value">peers: 0 online</div>
              <div className="ew-canvas__status-detail">friends: 0 present</div>
            </div>
          </div>
        </div>
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
        <div className="ew-folder-icon__badge">
          <span className="ew-folder-icon__tab" />
          <span className="ew-folder-icon__mark">S3</span>
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

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gpu, setGpu] = useState<SystemGpuState | null>(null);
  const [assessments, setAssessments] = useState<ModelAssessment[]>([]);
  const [iconHealth, setIconHealth] = useState<Record<string, 'online' | 'offline' | 'checking'>>({});
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [s3FolderOpen, setS3FolderOpen] = useState(false);
  const { user: authUser, tier } = useAuth();
  const { skin, mode, theme, setTheme } = useTheme();
  const effectiveSkin = theme === 'light' ? 'classic' : skin;

  // Bug report + error badge
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [errorBadgeCount, setErrorBadgeCount] = useState(0);

  const focusWindow = useCallback((id: string) => {
    const zIndex = ++nextZIndexRef.current;
    setActiveWindowId(id);
    setWindows(prev => prev.map(win =>
      win.id === id ? { ...win, zIndex, isMinimized: false } : win
    ));
  }, []);

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
      const nextWindow: ShellWindowState = {
        id,
        title,
        sublabel,
        content,
        zIndex,
        isMinimized: false,
        isMaximized: true,
      };
      setActiveWindowId(id);
      return [...prev, nextWindow];
    });
  }, []);

  const closeShellWindow = useCallback((id: string) => {
    setWindows(prev => {
      const closing = prev.find(win => win.id === id);
      if (closing?.content.kind === 'applet') {
        const { applet, renderMode } = closing.content;
        if (renderMode === 'embedded' || applet.launch_binary) {
          closeAppletWebview(applet.id).catch(() => {});
        }
      }
      const remaining = prev.filter(win => win.id !== id);
      setActiveWindowId(current =>
        current === id
          ? (remaining.filter(win => !win.isMinimized).sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null)
          : current
      );
      return remaining;
    });
  }, []);

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

  // ── Load registry on mount ──
  useEffect(() => {
    getProfile().then(setProfile).catch(console.error);
    getGpuStatus().then(setGpu).catch(console.error);
    listModelAssessments().then(setAssessments).catch(console.error);
    listApplets()
      .then((applets) => {
        log.info('ui', `Registry loaded: ${applets.length} applets`);
        setRegistryApplets(applets);
      })
      .catch((err) => {
        console.error('Failed to load applet registry:', err);
      });
  }, []);

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

  // ── Tauri applet webview lifecycle events ──
  useEffect(() => {
    const unlistenOpen = listen<{ applet_id: string; name: string; url: string }>('applet-webview-opened', (event) => {
      const { applet_id, name, url } = event.payload;
      log.info('ui', `Applet webview opened: ${applet_id} at ${url}`);
      setLaunchingId(null);

      // If the applet has a frontend_port, show it inline via HeadlessAppletView.
      // If it opened a studio window (url != headless), show the banner.
      const entry = registryApplets.find((a) => a.id === applet_id);
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
      if (tauriApplet?.applet_id === event.payload.applet_id) {
        setTauriApplet(null);
      }
    });

    return () => {
      unlistenOpen.then(fn => fn());
      unlistenClose.then(fn => fn());
    };
  }, [registryApplets, openShellWindow, tauriApplet]);

  const handleCloseTauriApplet = async () => {
    if (tauriApplet) {
      try { await closeAppletWebview(tauriApplet.applet_id); } catch (err) { console.error(err); }
      setTauriApplet(null);
    }
  };

  // ── Applet launch handler (goes through the runtime bridge) ──
  const handleAppletLaunch = async (applet: AppletEntry) => {
    if (applet.status === 'Locked') {
      // TODO: show upgrade gate
      log.warn('ui', `Applet ${applet.id} is locked; needs purchase/subscription`);
      return;
    }
    if (applet.status === 'NotBuilt') {
      log.warn('ui', `Applet ${applet.id} is listed but not built yet`);
      return;
    }

    if (isRegisteredApplet(applet.id) && !applet.launch_binary) {
      openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
      return;
    }

    // For launch_url applets (web applets), open externally
    if (applet.launch_url) {
      log.info('ui', `Opening web applet: ${applet.id} at ${applet.launch_url}`);
      // Use Tauri shell:open to launch in default browser
      try {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(applet.launch_url);
      } catch {
        window.open(applet.launch_url, '_blank');
      }
      return;
    }

    // For all other applets: go through the runtime bridge
    setLaunchingId(applet.id);
    log.info('ui', `Launching applet via runtime bridge: ${applet.id}`);
    try {
      await launchApplet(applet.id);
      // The runtime bridge will emit 'applet-webview-opened' when ready.
      // Our event listener above handles the rest.
    } catch (err) {
      console.error(`Failed to launch ${applet.id}:`, err);
      setLaunchingId(null);
      // If launch fails but the applet has a frontend_port, fall through
      // to headless view (dev mode: sidecar may not be needed)
      if (applet.frontend_port) {
        log.warn('ui', `Launch bridge failed for ${applet.id}, falling back to headless iframe`);
        if (isRegisteredApplet(applet.id)) {
          openShellWindow({ kind: 'applet', applet, renderMode: 'inline' });
        } else {
          openShellWindow({ kind: 'applet', applet, renderMode: 'embedded' });
        }
      }
    }
  };

  // ── System panel click handler ──
  const openPanel = (panel: Exclude<PanelView, null>) => {
    openShellWindow({ kind: 'panel', panel });
  };

  const handleSystemClick = (iconId: Exclude<PanelView, null>) => {
    openPanel(iconId);
  };

  const displayName = authUser?.handle || profile?.display_name || 'User';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  // Show the registry as the desktop source of truth. S3 Studio is a desktop
  // folder, not a web shortcut; its child applets still come from the registry.
  const s3FolderApplets = useMemo(
    () => registryApplets
      .filter((applet) => S3_FOLDER_APPLET_IDS.has(applet.id))
      .sort((a, b) => S3_FOLDER_ORDER.indexOf(a.id) - S3_FOLDER_ORDER.indexOf(b.id)),
    [registryApplets]
  );
  const visibleApplets = useMemo(
    () => registryApplets.filter((applet) => !S3_FOLDER_APPLET_IDS.has(applet.id) && applet.id !== 's3studio'),
    [registryApplets]
  );

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
          skin={effectiveSkin}
          mode={mode}
          onClose={() => closeShellWindow(win.id)}
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
      <div className="ew-titlebar">
        <div className="ew-titlebar__left">
          {/* Traffic lights */}
          <div className="ew-traffic-lights">
            <button className="ew-traffic-light ew-traffic-light--close" onClick={() => getCurrentWindow().close()} title="Close" />
            <button className="ew-traffic-light ew-traffic-light--minimize" onClick={() => getCurrentWindow().minimize()} title="Minimize" />
            <button className="ew-traffic-light ew-traffic-light--maximize" onClick={() => getCurrentWindow().toggleMaximize()} title="Maximize" />
          </div>
          <span className="ew-titlebar__sigil">&#9671;</span>
        </div>
        <div className="ew-titlebar__center" data-tauri-drag-region>
          <span className="ew-titlebar__version">EVERYWEAR/1.0 &middot; home node &middot; build 1.0.0</span>
        </div>
        <div className="ew-titlebar__right" />
      </div>

      {/* ── Desktop OS surface ── */}
      <div className="ew-desktop">
        {/* Center canvas / wallpaper layer */}
        <DesktopCanvas theme={theme} gpu={gpu} />

        {/* Icon grid: registry applets + system icons */}
        <div className="ew-icon-grid">
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
            <div
              key={icon.id}
              className="ew-desktop-icon ew-desktop-icon--system"
              onClick={() => handleSystemClick(icon.id)}
            >
              <div className="ew-desktop-icon__badge" style={{ borderColor: icon.color, color: icon.color }}>
                <span>{icon.monogram}</span>
              </div>
              <span className="ew-desktop-icon__label">{icon.label}</span>
            </div>
          ))}
        </div>

        {/* Window layer */}
        <div className="ew-window-layer">
          {visibleWindows.map((win) => (
            <ShellWindowFrame
              key={win.id}
              win={win}
              isActive={win.id === activeWindowId}
              onFocus={() => focusWindow(win.id)}
              onClose={() => closeShellWindow(win.id)}
              onMinimize={() => minimizeShellWindow(win.id)}
              onMaximize={() => maximizeShellWindow(win.id)}
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
          {/* Four shell themes: Light, Classic, Refined, Terminal */}
          <div className="ew-skin-switcher">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t}
                className={`ew-skin-chip ${theme === t ? 'ew-skin-chip--active' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="ew-taskbar__right">
          {/* Profile mini */}
          <button className="ew-taskbar__profile" onClick={() => openPanel('profile')}>
            <span className="ew-taskbar__profile-avatar">{initials}</span>
            <span className="ew-taskbar__profile-name">{authUser?.email?.split('@')[0] || displayName}@ever...</span>
          </button>
          {/* Bug report / notification bell */}
          <button
            className="ew-taskbar__bell"
            onClick={() => setBugReportOpen(true)}
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

      <BugReportModal open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </>
  );
}
