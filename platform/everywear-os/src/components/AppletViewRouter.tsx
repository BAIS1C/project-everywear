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
import { AppletLoadingSkeleton } from './AppletLoadingSkeleton';

// ── Lazy applet registry ──────────────────────────────────────────

// CODEX_NEEDED: When adding new headless applets, register their lazy
// import here. The import path must resolve via the @applets Vite alias.

const APPLET_COMPONENTS: Record<string, {
  component: React.LazyExoticComponent<React.ComponentType<{ skin?: string; mode?: string }>>;
  displayName: string;
}> = {
  kasai: {
    component: React.lazy(() =>
      import('@applets/kasai/src/shell/KasaiCore').then(m => ({ default: m.KasaiCore }))
    ),
    displayName: 'Kasai',
  },
  '3nvizen': {
    component: React.lazy(() => import('@applets/3nvizen/src/index')),
    displayName: '3nvizen',
  },
  'character-studio': {
    component: React.lazy(() => import('@applets/character-studio/src/index')),
    displayName: 'Character Studio',
  },
};

// ── Error Boundary ────────────────────────────────────────────────

interface ErrorBoundaryProps {
  appletId: string;
  displayName: string;
  onRetry: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppletErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[AppletViewRouter] ${this.props.appletId} crashed:`, error, errorInfo);
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
              this.setState({ hasError: false, error: null });
              this.props.onRetry();
            }}
          >
            Retry
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
  skin?: string;
  mode?: string;
  onClose: () => void;
}

/**
 * Resolves an applet ID to its lazy-loaded component.
 * Returns null if the applet is not in the registry (caller should
 * fall through to HeadlessAppletView or show "not found").
 */
export function isRegisteredApplet(appletId: string): boolean {
  return appletId in APPLET_COMPONENTS;
}

export function AppletViewRouter({ appletId, skin, mode, onClose }: AppletViewRouterProps) {
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
        >
          <Suspense fallback={<AppletLoadingSkeleton appletName={entry.displayName} />}>
            <LazyComponent skin={skin} mode={mode} />
          </Suspense>
        </AppletErrorBoundary>
      </div>
    </div>
  );
}
