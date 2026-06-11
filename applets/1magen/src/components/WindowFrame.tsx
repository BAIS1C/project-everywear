/* ═══════════════════════════════════════════════════════════════════
   1MAGEN — EWDS WINDOW FRAME
   ───────────────────────────────────────────────────────────────────
   2026-06-11 SGT. Adapted from the gener8 reference component
   (applets/gener8/web/src/components/WindowFrame.tsx) for the
   standalone onemagen.exe runtime window (bug #10: plain native
   window without Everywear chrome).

   Differences from the reference:
     - Calls @tauri-apps/api/window directly. The reference expected a
       window.__TAURI_BRIDGE__ shim (lib/tauri-bridge.ts) that was
       never landed anywhere in the repo; 1magen ships @tauri-apps/api
       as a dependency, so the indirection buys nothing.
     - TrafficLights only. Brand contract (2026-05-03 SGT): Everywear
       chrome is Mac-style on every OS. Inside Tauri, platform is
       forced to 'darwin'; the win32 caption-controls variant is dead
       code under that contract and is omitted (also drops the
       lucide-react dependency).
     - 1magen glyph instead of the S³ mark.

   Requires:
     - decorations:false in src-tauri/tauri.conf.json
     - window permission grants in src-tauri/capabilities/default.json
     - CSS: @everywear/ewds/css/window-frame.css and
            @everywear/ewds/css/window-frame-component.css
       (imported in main.tsx)

   Web fallback: outside Tauri (browser dev), renders children with no
   chrome so the same SPA runs on the web unchanged.
   ═══════════════════════════════════════════════════════════════════ */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

type Platform = 'darwin' | 'web';

type ResizeDirection = 'East' | 'South' | 'SouthEast';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export const isTauriContext = (): boolean =>
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null);

const isTauri = isTauriContext;

// ─────────────────────────────────────────────────────────────
//  1magen glyph — inline so the title bar renders before any
//  external asset loads. Tints via EWDS window-frame logo tokens.
// ─────────────────────────────────────────────────────────────

const OneMagenGlyph: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    role="img"
  >
    <defs>
      <linearGradient id="onemagen-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--ew-wf-logo-gradient-start)" />
        <stop offset="60%" stopColor="var(--ew-wf-logo-gradient-mid)" />
        <stop offset="100%" stopColor="var(--ew-wf-logo-gradient-end)" />
      </linearGradient>
    </defs>
    {/* numeral "1" with aperture dot: 1magen mark */}
    <path
      d="M9 7 l4 -3 v16"
      stroke="url(#onemagen-grad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <circle
      cx="18.5"
      cy="6"
      r="2.2"
      stroke="var(--ew-wf-logo-superscript)"
      strokeWidth="1.6"
      fill="none"
    />
  </svg>
);

// ─────────────────────────────────────────────────────────────
//  Traffic-light controls (brand contract: Mac-style everywhere)
// ─────────────────────────────────────────────────────────────

interface ControlProps {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const TrafficLights: React.FC<ControlProps> = ({
  onMinimize,
  onToggleMaximize,
  onClose,
}) => (
  <div className="ew-wf-controls ew-wf-controls--darwin" data-tauri-no-drag>
    <button
      type="button"
      aria-label="Close window"
      className="ew-wf-traffic ew-wf-traffic--close"
      onClick={onClose}
    />
    <button
      type="button"
      aria-label="Minimize window"
      className="ew-wf-traffic ew-wf-traffic--min"
      onClick={onMinimize}
    />
    <button
      type="button"
      aria-label="Maximize window"
      className="ew-wf-traffic ew-wf-traffic--max"
      onClick={onToggleMaximize}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────

export interface WindowFrameProps {
  title?: string;
  /** Render chrome even outside Tauri (design previews). */
  forceChrome?: boolean;
  children?: ReactNode;
}

export const WindowFrame: React.FC<WindowFrameProps> & {
  DragRegion: React.FC<{ children?: ReactNode; className?: string }>;
  NoDrag: React.FC<{ children?: ReactNode; className?: string }>;
} = ({ title = '1magen', forceChrome = false, children }) => {
  const tauriOn = isTauri() || forceChrome;
  const platform: Platform = tauriOn ? 'darwin' : 'web';
  const [isFocused, setIsFocused] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);

  // Brand contract stamp: darwin tokens inside Tauri.
  useEffect(() => {
    document.documentElement.setAttribute('data-platform', platform);
  }, [platform]);

  // Focus + maximize tracking; chrome dims on blur (OS convention).
  useEffect(() => {
    if (!tauriOn || !isTauri()) return;
    const w = getCurrentWindow();
    let unFocus: (() => void) | undefined;
    let unResize: (() => void) | undefined;
    w.onFocusChanged(({ payload }) => setIsFocused(Boolean(payload)))
      .then((un) => (unFocus = un))
      .catch((err) => console.warn('[wf] onFocusChanged failed', err));
    w.onResized(() => {
      w.isMaximized()
        .then(setIsMaximized)
        .catch(() => undefined);
    })
      .then((un) => (unResize = un))
      .catch((err) => console.warn('[wf] onResized failed', err));
    w.isMaximized()
      .then(setIsMaximized)
      .catch(() => undefined);
    return () => {
      unFocus?.();
      unResize?.();
    };
  }, [tauriOn]);

  // Control handlers: every Promise catches so permission or IPC
  // failures surface in the console instead of no-op buttons.
  const handleMinimize = useCallback(() => {
    if (!isTauri()) return;
    getCurrentWindow()
      .minimize()
      .catch((err) => console.warn('[wf] minimize failed', err));
  }, []);
  const handleToggleMaximize = useCallback(() => {
    if (!isTauri()) return;
    getCurrentWindow()
      .toggleMaximize()
      .catch((err) => console.warn('[wf] toggleMaximize failed', err));
  }, []);
  const handleClose = useCallback(() => {
    if (!isTauri()) return;
    getCurrentWindow()
      .close()
      .catch((err) => console.warn('[wf] close failed', err));
  }, []);

  const controls: ControlProps = useMemo(
    () => ({
      onMinimize: handleMinimize,
      onToggleMaximize: handleToggleMaximize,
      onClose: handleClose,
    }),
    [handleMinimize, handleToggleMaximize, handleClose],
  );

  // Resize handles: decorations:false strips the OS resize edges on
  // Windows/Linux, so we paint our own. North edge omitted (titlebar
  // owns it); WEST edge omitted per the 2026-05-04 SGT revision (left
  // side reserved for icon rails; a handle there steals clicks).
  const beginResize = useCallback((direction: ResizeDirection) => {
    return (e: React.MouseEvent) => {
      if (e.button !== 0 || !isTauri()) return;
      e.preventDefault();
      e.stopPropagation();
      getCurrentWindow()
        .startResizeDragging(direction)
        .catch((err) =>
          console.warn('[wf] startResizeDragging failed', direction, err),
        );
    };
  }, []);

  // Web fallback: children only, no chrome.
  if (!tauriOn) return <>{children}</>;

  return (
    <div
      className="ew-wf"
      data-focused={isFocused ? 'true' : 'false'}
      data-platform={platform}
      data-maximized={isMaximized ? 'true' : 'false'}
    >
      <header
        className="ew-wf-titlebar"
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
      >
        <TrafficLights {...controls} />

        <div className="ew-wf-brand" data-tauri-no-drag>
          <OneMagenGlyph size={16} />
        </div>

        <div className="ew-wf-title" aria-live="polite">
          {title}
        </div>

        <div className="ew-wf-titlebar-spacer" />
      </header>

      <div className="ew-wf-frame">
        <div className="ew-wf-frame-accent" aria-hidden="true" />
        <main className="ew-wf-body">{children}</main>
      </div>

      {!isMaximized && (
        <>
          <div
            className="ew-wf-resize ew-wf-resize--e"
            onMouseDown={beginResize('East')}
            data-tauri-no-drag
          />
          <div
            className="ew-wf-resize ew-wf-resize--s"
            onMouseDown={beginResize('South')}
            data-tauri-no-drag
          />
          <div
            className="ew-wf-resize ew-wf-resize--se"
            onMouseDown={beginResize('SouthEast')}
            data-tauri-no-drag
          />
        </>
      )}
    </div>
  );
};

// Slot helpers for downstream pages extending the title bar.
const DragRegion: React.FC<{ children?: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div data-tauri-drag-region className={className}>
    {children}
  </div>
);
const NoDrag: React.FC<{ children?: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div data-tauri-no-drag className={className}>
    {children}
  </div>
);
WindowFrame.DragRegion = DragRegion;
WindowFrame.NoDrag = NoDrag;

export default WindowFrame;
