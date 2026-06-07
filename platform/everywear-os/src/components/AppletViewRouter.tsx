/**
 * AppletViewRouter — Dynamic applet loader with React.lazy() + Suspense.
 *
 * Replaces the iframe-based HeadlessAppletView for applets that export
 * a React component (headless applets mounted inside the shell).
 *
 * Each applet is lazy-loaded on first mount, wrapped in Suspense with
 * AppletLoadingSkeleton fallback, and guarded by an error boundary.
 *
 * Applet registry maps applet IDs to their dynamic import paths.
 * Non-registered applets fall through to HeadlessAppletView (iframe).
 */

import React, { Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getLogger } from '@everywear/shared';
import { AppletLoadingSkeleton } from './AppletLoadingSkeleton';
import type { BugReportSeed } from './BugReportModal';
import type { AppletEntry } from '../lib/transport';

const log = getLogger('shell');

declare global {
  interface Window {
    __EVERYWEAR_ASSET_BASE__?: string;
  }
}

async function setCharacterStudioAssetBase(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) {
    window.__EVERYWEAR_ASSET_BASE__ = '/cs-assets';
    return;
  }

  try {
    const root = await invoke<string>('get_character_studio_asset_root');
    window.__EVERYWEAR_ASSET_BASE__ = convertFileSrc(root);
  } catch (error) {
    console.warn('[character-studio] Falling back to /cs-assets asset base:', error);
    window.__EVERYWEAR_ASSET_BASE__ = '/cs-assets';
  }
}

// ── Lazy applet registry ──────────────────────────────────────────

// CODEX_NEEDED: When adding new headless applets, register their lazy
// import here. The import path must resolve via the @applets Vite alias.

type AppletLaunchManifest = Pick<AppletEntry, 'id' | 'lockedModel' | 'allowedAudioModes' | 'stepCeiling' | 'vaultScope' | 'vidTarget'>;

interface AppletComponentProps {
  skin?: string;
  mode?: string;
  appletId?: string;
  launchManifest?: AppletLaunchManifest | null;
}

const APPLET_COMPONENTS: Record<string, {
  component: React.LazyExoticComponent<React.ComponentType<AppletComponentProps>>;
  displayName: string;
  needsRouter?: boolean;
  initialPath?: string;
}> = {
  kasai: {
    component: React.lazy(() =>
      import('@applets/kasai/src/shell/KasaiCore').then(m => ({ default: m.KasaiCore }))
    ),
    displayName: 'My Mait',
  },
  'layeru-osint': {
    component: React.lazy(() =>
      import('../son/LayerUOsintApplet').then(m => ({ default: m.LayerUOsintApplet }))
    ),
    displayName: 'Layer U OSINT',
  },
  '1magen': {
    component: React.lazy(() =>
      import('@applets/1magen/src/shell/ImagenCore').then(m => ({ default: m.ImagenCore }))
    ),
    displayName: '1magen',
  },
  gener8: {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'Gener8',
    needsRouter: true,
    initialPath: '/',
  },
  'gener8-4ever': {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'Gener8 4ever',
    needsRouter: true,
    initialPath: '/',
  },
  'gener8-pro': {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'Gener8 Pro',
    needsRouter: true,
    initialPath: '/',
  },
  vid: {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'Vid Studio',
    needsRouter: true,
    initialPath: '/vid',
  },
  'ai-director': {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'AI Director',
    needsRouter: true,
    initialPath: '/director',
  },
  daw: {
    component: React.lazy(() =>
      import('@applets/gener8/web/src/ShellApp').then(m => ({ default: m.Gener8ShellApp }))
    ),
    displayName: 'DAW',
    needsRouter: true,
    initialPath: '/daw',
  },
  '3nvizen': {
    component: React.lazy(() => import('@applets/3nvizen/src/index')),
    displayName: '3nvizen',
  },
  'character-studio': {
    component: React.lazy(async () => {
      await setCharacterStudioAssetBase();
      return import('@applets/character-studio/src/index');
    }),
    displayName: 'Character Studio',
  },
  loom: {
    component: React.lazy(() => import('@applets/educ8/src/index')),
    displayName: 'Educ8',
  },
};

// ── Error Boundary ────────────────────────────────────────────────

interface ErrorBoundaryProps {
  appletId: string;
  displayName: string;
  onRetry: () => void;
  onCrashReport?: (seed: BugReportSeed) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class AppletErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[AppletViewRouter] ${this.props.appletId} crashed:`, error, errorInfo);
    log.error('ui', `${this.props.displayName} crashed`, {
      applet_id: this.props.appletId,
      message: error.message,
      stack: error.stack,
      component_stack: errorInfo.componentStack,
    });
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private reportCrash = () => {
    const error = this.state.error;
    this.props.onCrashReport?.({
      source: this.props.appletId,
      crashKind: 'frontend',
      occurredAt: new Date().toISOString(),
      errorMessage: error?.message || 'Applet crashed',
      stack: error?.stack,
      componentStack: this.state.componentStack || undefined,
      description: `${this.props.displayName} crashed.\n\nWhat were you doing right before it failed?`,
      extra: {
        applet_id: this.props.appletId,
        display_name: this.props.displayName,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="avr-error">
          <div className="avr-error__icon">!</div>
          <h3 className="avr-error__title">{this.props.displayName} failed to load</h3>
          <p className="avr-error__message">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="avr-error__retry"
            onClick={() => {
              this.setState({ hasError: false, error: null, componentStack: null });
              this.props.onRetry();
            }}
          >
            Retry
          </button>
          <button
            className="avr-error__report"
            onClick={this.reportCrash}
          >
            Report Crash
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Router Component ──────────────────────────────────────────────

export interface AppletViewRouterProps {
  appletId: string;
  applet?: AppletEntry;
  skin?: string;
  mode?: string;
  onClose: () => void;
  onCrashReport?: (seed: BugReportSeed) => void;
}

/**
 * Resolves an applet ID to its lazy-loaded component.
 * Returns null if the applet is not in the registry (caller should
 * fall through to HeadlessAppletView or show "not found").
 */
export function isRegisteredApplet(appletId: string): boolean {
  return appletId in APPLET_COMPONENTS;
}

export function AppletViewRouter({ appletId, applet, skin, mode, onClose, onCrashReport }: AppletViewRouterProps) {
  const entry = APPLET_COMPONENTS[appletId];

  if (!entry) {
    return (
      <div className="avr-error">
        <div className="avr-error__icon">?</div>
        <h3 className="avr-error__title">Applet not found</h3>
        <p className="avr-error__message">
          No registered component for applet "{appletId}".
        </p>
        <button className="avr-error__retry" onClick={onClose}>
          Back to Launcher
        </button>
      </div>
    );
  }

  const LazyComponent = entry.component;
  const launchManifest: AppletLaunchManifest | null = applet
    ? {
        id: applet.id,
        lockedModel: applet.lockedModel ?? applet.locked_model ?? null,
        allowedAudioModes: applet.allowedAudioModes ?? applet.allowed_audio_modes ?? null,
        stepCeiling: applet.stepCeiling ?? applet.step_ceiling ?? null,
        vaultScope: applet.vaultScope ?? applet.vault_scope ?? null,
        vidTarget: applet.vidTarget ?? applet.vid_target ?? null,
      }
    : null;

  const appletContent = (
    <Suspense fallback={<AppletLoadingSkeleton appletName={entry.displayName} />}>
      <LazyComponent
        skin={skin}
        mode={mode}
        appletId={appletId}
        launchManifest={launchManifest}
      />
    </Suspense>
  );

  return (
    <div className="avr-container">
      <div className="avr-toolbar">
        <span className="avr-toolbar__name">{entry.displayName}</span>
        <button
          className="avr-toolbar__close"
          onClick={onClose}
          title="Close applet"
        >
          {'✕'}
        </button>
      </div>
      <div className="avr-viewport">
        <AppletErrorBoundary
          appletId={appletId}
          displayName={entry.displayName}
          onRetry={() => { /* re-render triggers lazy re-attempt */ }}
          onCrashReport={onCrashReport}
        >
          {entry.needsRouter ? (
            <MemoryRouter initialEntries={[entry.initialPath ?? '/']}>{appletContent}</MemoryRouter>
          ) : (
            appletContent
          )}
        </AppletErrorBoundary>
      </div>
    </div>
  );
}
