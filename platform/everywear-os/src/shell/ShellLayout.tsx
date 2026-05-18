import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  getProfile,
  getGpuStatus,
  listModelAssessments,
  closeAppletWebview,
  type AppletEntry,
  type ModelAssessment,
  type UserProfile,
  type SystemGpuState,
} from '../lib/transport';
import { useAuth } from './AuthContext';
import { getLogger, getErrorCount } from '@everywear/shared';
import { LogViewerPanel } from '../components/LogViewerPanel';
import { BugReportModal } from '../components/BugReportModal';

const log = getLogger('shell');
import { LauncherGrid } from '../panels/LauncherGrid';
import { ProfilePanel } from '../panels/ProfilePanel';
import { WalletPanel } from '../panels/WalletPanel';
import { GpuPanel } from '../panels/GpuPanel';
import { DiscoursePanel } from '../panels/DiscoursePanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { HeadlessAppletView } from '../panels/HeadlessAppletView';
import { AppletViewRouter, isRegisteredApplet } from '../components/AppletViewRouter';
import { VaultProvider } from '@applets/gener8/web/src/context/VaultProvider';

// Lazy-load VaultLibraryView (shell-level, not an applet)
const VaultLibraryView = lazy(() => import('@applets/gener8/web/src/views/LibraryView'));

type View = 'launcher' | 'profile' | 'wallet' | 'gpu' | 'community' | 'settings' | 'vault' | 'logs';

interface ActiveAppletView {
  applet_id: string;
  label: string;
  url: string;
  name: string;
}

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: 'launcher', label: 'Applets', icon: '&#9783;' },
  { id: 'profile', label: 'Profile', icon: '&#9673;' },
  { id: 'wallet', label: 'Wallet', icon: '&#9830;' },
  { id: 'community', label: 'Community', icon: '&#9993;' },
  { id: 'gpu', label: 'Hardware', icon: '&#9881;' },
  { id: 'settings', label: 'Settings', icon: '&#9776;' },
];

// ── Applet nav entries for sidebar ──

interface AppletNavEntry {
  id: string;
  label: string;
  icon: string;
  healthUrl?: string; // URL to ping for status dot; undefined = no health check
}

const APPLET_NAV_ITEMS: AppletNavEntry[] = [
  { id: 'kasai', label: 'Kasai', icon: 'K' },
  { id: '3nvizen', label: '3nvizen', icon: '▶', healthUrl: 'http://127.0.0.1:8787/health' },
  { id: 'character-studio', label: 'Character Studio', icon: '🧑' },
];

type AppletHealth = 'online' | 'checking' | 'offline';

export function ShellLayout() {
  const [view, setView] = useState<View>('launcher');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gpu, setGpu] = useState<SystemGpuState | null>(null);
  const [assessments, setAssessments] = useState<ModelAssessment[]>([]);
  const [activeApplet, setActiveApplet] = useState<ActiveAppletView | null>(null);
  const [embeddedApplet, setEmbeddedApplet] = useState<AppletEntry | null>(null);
  const [activeInlineApplet, setActiveInlineApplet] = useState<string | null>(null);
  const [appletHealth, setAppletHealth] = useState<Record<string, AppletHealth>>({});
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user: authUser, tier } = useAuth();

  // ── Bug report + error badge state ──
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [errorBadgeCount, setErrorBadgeCount] = useState(0);

  // Poll error count every 5s
  useEffect(() => {
    const tick = () => setErrorBadgeCount(getErrorCount());
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getProfile().then(setProfile).catch(console.error);
    getGpuStatus().then(setGpu).catch(console.error);
    listModelAssessments().then(setAssessments).catch(console.error);
  }, []);

  // ── Applet health polling (S6) ──
  const checkAppletHealth = useCallback(async () => {
    const results: Record<string, AppletHealth> = {};
    for (const entry of APPLET_NAV_ITEMS) {
      if (!entry.healthUrl) {
        // No health endpoint; always show as online (frontend-only applet)
        results[entry.id] = 'online';
        continue;
      }
      try {
        const resp = await fetch(entry.healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        results[entry.id] = resp.ok ? 'online' : 'offline';
      } catch {
        results[entry.id] = 'offline';
      }
    }
    // Log transitions to offline
    setAppletHealth(prev => {
      for (const [id, status] of Object.entries(results)) {
        if (status === 'offline' && prev[id] === 'online') {
          log.warn('sidecar', 'Applet sidecar offline', { applet: id });
        }
      }
      return results;
    });
  }, []);

  useEffect(() => {
    checkAppletHealth();
    healthTimerRef.current = setInterval(checkAppletHealth, 10000);
    return () => {
      if (healthTimerRef.current) {
        clearInterval(healthTimerRef.current);
        healthTimerRef.current = null;
      }
    };
  }, [checkAppletHealth]);

  // Listen for applet webview lifecycle events
  useEffect(() => {
    const unlistenOpen = listen<ActiveAppletView>('applet-webview-opened', (event) => {
      setActiveApplet(event.payload);
      setView('launcher'); // stay on launcher view but show active indicator
    });
    const unlistenClose = listen<{ applet_id: string }>('applet-webview-closed', () => {
      setActiveApplet(null);
    });
    return () => {
      unlistenOpen.then((fn) => fn());
      unlistenClose.then((fn) => fn());
    };
  }, []);

  const handleCloseApplet = async () => {
    if (activeApplet) {
      try {
        await closeAppletWebview(activeApplet.applet_id);
      } catch (err) {
        console.error('Failed to close applet webview:', err);
      }
      setActiveApplet(null);
    }
  };

  // Use Everywear ID handle for display, fall back to profile
  const displayName = authUser?.handle || profile?.display_name || 'Loading...';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const featuredAssessment = assessments.find((item) => item.applet_id === '1magen');
  const assessmentSummary = featuredAssessment?.recommended_group
    ? `${featuredAssessment.applet_name}: ${featuredAssessment.recommended_group}`
    : featuredAssessment
      ? `${featuredAssessment.applet_name}: ${featuredAssessment.status}`
      : null;

  return (
    <>
      {/* Custom titlebar */}
      <div className="ew-titlebar">
        <span className="ew-titlebar__brand">Everywear OS</span>
        <div className="ew-titlebar__controls">
          {/* Bug Report button — always visible, before window controls */}
          <button
            className="ew-titlebar__btn"
            onClick={() => setBugReportOpen(true)}
            title="Report a problem"
            style={{ position: 'relative', fontSize: '13px' }}
          >
            &#128203;
            {errorBadgeCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '-2px',
                right: '-4px',
                background: 'var(--ew-status-red)',
                color: 'var(--ew-bg)',
                fontSize: '9px',
                fontWeight: 700,
                borderRadius: '999px',
                minWidth: '14px',
                height: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                padding: '0 3px',
              }}>
                {errorBadgeCount > 99 ? '99+' : errorBadgeCount}
              </span>
            )}
          </button>
          <button
            className="ew-titlebar__btn"
            onClick={() => getCurrentWindow().minimize()}
            dangerouslySetInnerHTML={{ __html: '&#9472;' }}
          />
          <button
            className="ew-titlebar__btn"
            onClick={() => getCurrentWindow().toggleMaximize()}
            dangerouslySetInnerHTML={{ __html: '&#9633;' }}
          />
          <button
            className="ew-titlebar__btn ew-titlebar__btn--close"
            onClick={() => getCurrentWindow().close()}
            dangerouslySetInnerHTML={{ __html: '&#10005;' }}
          />
        </div>
      </div>

      <div className="ew-shell">
        {/* Sidebar */}
        <div className="ew-sidebar">
          <div className="ew-sidebar__profile" onClick={() => setView('profile')} style={{ cursor: 'pointer' }}>
            <div className="ew-sidebar__avatar">{initials}</div>
            <div className="ew-sidebar__name">{displayName}</div>
            {authUser?.email && <div className="ew-sidebar__alias">{authUser.email}</div>}
            <div className="ew-sidebar__tier-badge" data-tier={tier}>{tier.replace('_', ' ')}</div>
          </div>

          <nav className="ew-sidebar__nav">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`ew-nav-item ${view === item.id && !activeInlineApplet ? 'ew-nav-item--active' : ''}`}
                onClick={() => { setView(item.id); setActiveInlineApplet(null); }}
              >
                <span
                  className="ew-nav-item__icon"
                  dangerouslySetInnerHTML={{ __html: item.icon }}
                  style={{ fontSize: 16 }}
                />
                {item.label}
              </div>
            ))}
          </nav>

          {/* ── Vault (core OS feature, not an applet) ── */}
          <div className="ew-sidebar__applet-divider" />
          <div
            className={`ew-nav-item ${view === 'vault' && !activeInlineApplet ? 'ew-nav-item--active' : ''}`}
            onClick={() => { setView('vault'); setActiveInlineApplet(null); }}
          >
            <span className="ew-nav-item__icon" style={{ fontSize: 16 }}>&#128230;</span>
            Vault
          </div>
          <div
            className={`ew-nav-item ${view === 'logs' && !activeInlineApplet ? 'ew-nav-item--active' : ''}`}
            onClick={() => { setView('logs'); setActiveInlineApplet(null); }}
          >
            <span className="ew-nav-item__icon" style={{ fontSize: 16 }}>&#128203;</span>
            Logs
          </div>

          {/* ── Applet nav (S1) ── */}
          <div className="ew-sidebar__applet-divider" />
          <div className="ew-sidebar__applet-label">Applets</div>
          {APPLET_NAV_ITEMS.map((entry) => {
            const health = appletHealth[entry.id] ?? 'checking';
            const isActive = activeInlineApplet === entry.id;
            return (
              <div
                key={entry.id}
                className={`ew-applet-nav ${isActive ? 'ew-applet-nav--active' : ''}`}
                onClick={() => {
                  log.info('applet', 'Switching applet', { from: activeInlineApplet, to: entry.id });
                  setActiveInlineApplet(entry.id);
                  setEmbeddedApplet(null); // close any iframe-based applet
                }}
              >
                <span className="ew-applet-nav__icon">{entry.icon}</span>
                <span className="ew-applet-nav__name">{entry.label}</span>
                <span className={`ew-applet-nav__dot ew-applet-nav__dot--${health}`} />
              </div>
            );
          })}

          <div className="ew-sidebar__footer">
            <div className="ew-sidebar__gpu">
              <span className={`ew-sidebar__gpu-dot ${gpu?.backend?.type !== 'Cpu' ? '' : 'ew-sidebar__gpu-dot--off'}`} />
              {gpu?.backend?.type === 'Cuda' ? (
                <span>
                  {gpu.primary_gpu?.replace('NVIDIA ', '').replace('GeForce ', '')} &middot;{' '}
                  {gpu.total_free_mb.toLocaleString()} MB free
                </span>
              ) : gpu?.backend?.type === 'Vulkan' ? (
                <span>
                  Vulkan &middot; {gpu.primary_gpu} &middot;{' '}
                  {gpu.total_free_mb.toLocaleString()} MB
                </span>
              ) : (
                <span>CPU-only mode</span>
              )}
            </div>
            {assessmentSummary && (
              <div className="ew-sidebar__assessment">
                <span>{assessmentSummary}</span>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <main className="ew-main">
          {/* Inline applet via AppletViewRouter (React.lazy) takes highest priority */}
          {activeInlineApplet && isRegisteredApplet(activeInlineApplet) ? (
            <AppletViewRouter
              appletId={activeInlineApplet}
              onClose={() => setActiveInlineApplet(null)}
            />
          ) : embeddedApplet ? (
            /* Embedded headless applet (iframe) takes over the entire main area */
            <HeadlessAppletView
              applet={embeddedApplet}
              onClose={() => setEmbeddedApplet(null)}
            />
          ) : (
            <>
              {view === 'launcher' && activeApplet && (
                <div className="ew-applet-active">
                  <div className="ew-applet-active__header">
                    <button
                      className="ew-applet-active__back"
                      onClick={handleCloseApplet}
                      title="Close applet and return to launcher"
                    >
                      &#8592; Back
                    </button>
                    <span className="ew-applet-active__name">{activeApplet.name}</span>
                    <span className="ew-applet-active__status">Running</span>
                  </div>
                  <div className="ew-applet-active__info">
                    {activeApplet.name} is running in a separate window.
                    The applet backend is active on port {activeApplet.url.split(':').pop()}.
                  </div>
                </div>
              )}
              {view === 'launcher' && !activeApplet && <LauncherGrid onEmbedApplet={setEmbeddedApplet} />}
              {view === 'profile' && <ProfilePanel />}
              {view === 'wallet' && <WalletPanel />}
              {view === 'gpu' && <GpuPanel />}
              {view === 'community' && <DiscoursePanel />}
              {view === 'settings' && <SettingsPanel />}
              {view === 'logs' && <LogViewerPanel />}
              {view === 'vault' && (
                <VaultProvider>
                  <Suspense fallback={<div className="flex items-center justify-center h-full" style={{ color: 'var(--ew-text-muted)' }}>Loading vault...</div>}>
                    <VaultLibraryView />
                  </Suspense>
                </VaultProvider>
              )}
            </>
          )}
        </main>
      </div>

      {/* Bug Report Modal — rendered at root level so it's always accessible */}
      <BugReportModal open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </>
  );
}
