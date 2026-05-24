// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   STRANDS / S³ STUDIO — WINDOW FRAME REFERENCE COMPONENT
   ───────────────────────────────────────────────────────────────────
   2026-05-03 LATE NIGHT SGT (handover P1.2 + P1.3) — bridge wiring +
   forced-darwin platform now landed:

     - window.__TAURI_BRIDGE__ is populated by `lib/tauri-bridge.ts`
       (called from main.tsx pre-render) so minimize / toggleMaximize
       / close / start-dragging now invoke the Tauri 2 runtime.
     - Brand contract: Everywear chrome is Mac-style on every OS.
       Inside Tauri context we override the detected platform to
       'darwin' so the ControlsComponent picks TrafficLights and the
       title-bar layout renders left-side controls + centered title.
       Outside Tauri we keep real platform detection (web fallback
       returns children with no chrome anyway, so the stamp is inert).
     - data-platform stamp on <html> is pre-set to 'darwin' in
       main.tsx before React mounts; this component re-stamps after
       detection so dev preview tools (forceChrome / platformOverride)
       still work for design QA.

   studio.json permission allow-list (already authored 2026-05-03):
     core:window:allow-start-dragging
     core:window:allow-close
     core:window:allow-minimize
     core:window:allow-maximize / unmaximize / toggle-maximize
     core:window:allow-is-maximized
     core:window:allow-set-focus
   ───────────────────────────────────────────────────────────────────
   Drop-in chrome that wraps the SPA when running inside a Tauri webview.

   What it does
     1. Detects Tauri context via window.__TAURI_INTERNALS__ (Tauri 2)
        with a fallback to the legacy window.__TAURI__ flag.
     2. Stamps data-platform on <html> ('darwin' | 'win32' | 'linux')
        so tokens/window-frame.css applies the right platform overrides.
     3. Renders a custom title bar with:
          - S³ logo (ButtonLink to "home")
          - centered window title
          - platform-correct window controls (left on darwin, right elsewhere)
          - drag region via [data-tauri-drag-region]
     4. Wraps the SPA body in an inner frame that paints the chamfer
        (Classic skin only) and the brand-coloured accent line tracing it.
     5. Tracks focus state via Tauri's onFocusChanged event so blur dims
        the chrome to match OS conventions.
     6. Exposes <WindowFrame.DragRegion /> and <WindowFrame.NoDrag /> for
        downstream pages that want to extend the title bar.

   Mount once at the SPA root:
     <WindowFrame title="S³ Studio">
       <App />
     </WindowFrame>

   In a normal browser context (e.g. dev at localhost or s3studio.xyz/app
   without Tauri) the component renders children directly with no chrome,
   so the same SPA code works on the web.

   Source delivery: `Project Ace/Tauri and sintaller webvie wdesign/Strands/components/WindowFrame.tsx`
   Integrated into SPA 2026-05-03 SGT (task #48). See the matching token
   module at `styles/everywear/window-frame.css` and the component
   stylesheet at `styles/everywear/window-frame-component.css`.
   ═══════════════════════════════════════════════════════════════════ */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Minus, Square, X, Copy as RestoreIcon } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
//  Tauri detection + thin invoke helpers
//  We intentionally do NOT import @tauri-apps/api directly so the
//  component compiles without the dependency in web-only builds.
//  Consumers add the dep and the component will pick it up at runtime.
// ─────────────────────────────────────────────────────────────

type Platform = 'darwin' | 'win32' | 'linux' | 'web';

type ResizeDirection =
  | 'North'
  | 'NorthEast'
  | 'East'
  | 'SouthEast'
  | 'South'
  | 'SouthWest'
  | 'West'
  | 'NorthWest';

interface TauriBridge {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  getCurrentWindow?: () => {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    startResizeDragging: (direction: ResizeDirection) => Promise<void>;
    onFocusChanged: (
      handler: (e: { payload: boolean }) => void,
    ) => Promise<() => void>;
    onResized: (handler: () => void) => Promise<() => void>;
  };
  os?: { platform: () => Promise<string> };
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    __TAURI_BRIDGE__?: TauriBridge;
  }
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null);

const detectPlatform = async (): Promise<Platform> => {
  if (!isTauri()) return 'web';
  try {
    const bridge = window.__TAURI_BRIDGE__;
    const raw = bridge?.os ? await bridge.os.platform() : '';
    if (typeof raw === 'string') {
      const v = raw.toLowerCase();
      if (v.includes('mac') || v === 'darwin') return 'darwin';
      if (v.includes('win')) return 'win32';
      if (v.includes('linux')) return 'linux';
    }
  } catch {
    /* fall through */
  }
  // Fallback heuristic — userAgentData where available, else legacy UA
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'darwin';
  if (ua.includes('windows')) return 'win32';
  return 'linux';
};

// ─────────────────────────────────────────────────────────────
//  S³ logo glyph — embedded inline so the title bar renders before
//  any external asset loads. Stroke uses currentColor so it tints
//  to the active skin's primary.
// ─────────────────────────────────────────────────────────────

const S3Glyph: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    role="img"
  >
    <defs>
      <linearGradient id="s3-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--ew-wf-logo-gradient-start)" />
        <stop offset="60%" stopColor="var(--ew-wf-logo-gradient-mid)" />
        <stop offset="100%" stopColor="var(--ew-wf-logo-gradient-end)" />
      </linearGradient>
    </defs>
    {/* Rounded-rectangle "S" — matches brand mark proportions */}
    <path
      d="M5 7 a3 3 0 0 1 3-3 h6 a3 3 0 0 1 0 6 h-4 a3 3 0 0 0 0 6 h6 a3 3 0 0 1 0 6 h-6 a3 3 0 0 1 -3-3"
      stroke="url(#s3-grad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* Superscript "³" */}
    <text
      x="18"
      y="9"
      fontFamily="ui-sans-serif, system-ui"
      fontSize="8"
      fontWeight="700"
      fill="var(--ew-wf-logo-superscript)"
    >
      3
    </text>
  </svg>
);

// ─────────────────────────────────────────────────────────────
//  Window controls — platform-specific
// ─────────────────────────────────────────────────────────────

interface ControlProps {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  isMaximized: boolean;
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

const CaptionControls: React.FC<ControlProps> = ({
  onMinimize,
  onToggleMaximize,
  onClose,
  isMaximized,
}) => (
  <div className="ew-wf-controls ew-wf-controls--win" data-tauri-no-drag>
    <button
      type="button"
      aria-label="Minimize window"
      className="ew-wf-cap"
      onClick={onMinimize}
    >
      <Minus size={14} strokeWidth={1.5} />
    </button>
    <button
      type="button"
      aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
      className="ew-wf-cap"
      onClick={onToggleMaximize}
    >
      {isMaximized ? (
        <RestoreIcon size={12} strokeWidth={1.5} />
      ) : (
        <Square size={12} strokeWidth={1.5} />
      )}
    </button>
    <button
      type="button"
      aria-label="Close window"
      className="ew-wf-cap ew-wf-cap--close"
      onClick={onClose}
    >
      <X size={14} strokeWidth={1.5} />
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────

export interface WindowFrameProps {
  title?: string;
  /** Render chrome even outside Tauri (useful for design previews). */
  forceChrome?: boolean;
  /** Override platform detection (design previews / testing). */
  platformOverride?: Platform;
  children?: ReactNode;
}

export const WindowFrame: React.FC<WindowFrameProps> & {
  DragRegion: React.FC<{ children?: ReactNode; className?: string }>;
  NoDrag: React.FC<{ children?: ReactNode; className?: string }>;
} = ({ title = 'S³ Studio', forceChrome = false, platformOverride, children }) => {
  const [platform, setPlatform] = useState<Platform>(platformOverride ?? 'web');
  const [isFocused, setIsFocused] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const tauriOn = isTauri() || forceChrome;
  const unsubsRef = useRef<Array<() => void>>([]);

  // Platform detection + html attribute stamping
  // ────────────────────────────────────────────────────────────────
  // Brand contract (2026-05-03 SGT): Everywear chrome is Mac-style on
  // every OS — left-side traffic-light controls, centered title,
  // identical aesthetic across Windows / Mac / Linux. Inside Tauri
  // context we force platform = 'darwin' regardless of the actual OS
  // so the cascade resolves with darwin tokens and the
  // ControlsComponent selector picks TrafficLights. Real OS detection
  // is preserved for the web fallback (renders no chrome anyway) and
  // for the platformOverride dev path.
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (platformOverride) {
      document.documentElement.setAttribute('data-platform', platformOverride);
      setPlatform(platformOverride);
      return;
    }
    let cancelled = false;
    detectPlatform().then((p) => {
      if (cancelled) return;
      const stamped: Platform = isTauri() ? 'darwin' : p;
      setPlatform(stamped);
      document.documentElement.setAttribute('data-platform', stamped);
    });
    return () => {
      cancelled = true;
    };
  }, [platformOverride]);

  // Focus tracking — chrome dims when window blurs (OS convention)
  useEffect(() => {
    if (!tauriOn) return;
    const w = window.__TAURI_BRIDGE__?.getCurrentWindow?.();
    if (!w) return;
    let unFocus: (() => void) | undefined;
    let unResize: (() => void) | undefined;
    w.onFocusChanged((e) => setIsFocused(Boolean(e.payload))).then(
      (un) => (unFocus = un),
    );
    w.onResized(async () => {
      try {
        setIsMaximized(await w.isMaximized());
      } catch {
        /* ignore */
      }
    }).then((un) => (unResize = un));
    w.isMaximized().then(setIsMaximized).catch(() => undefined);
    return () => {
      unFocus?.();
      unResize?.();
    };
  }, [tauriOn]);

  // Vibrancy gate — opt in only on darwin or win32 with Mica
  useEffect(() => {
    const supportsVibrancy =
      tauriOn && (platform === 'darwin' || platform === 'win32');
    document.documentElement.setAttribute(
      'data-vibrancy',
      supportsVibrancy ? 'on' : 'off',
    );
  }, [tauriOn, platform]);

  // Cleanup on unmount
  useEffect(() => () => unsubsRef.current.forEach((fn) => fn()), []);

  // Bridge handlers — every Promise gets a .catch so silent rejections
  // (permission denied, IPC failure, runtime drift) surface in the diag
  // log instead of giving the user a no-op button.
  const handleMinimize = useCallback(() => {
    window.__TAURI_BRIDGE__?.getCurrentWindow?.()
      .minimize()
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[wf] minimize failed', err);
      });
  }, []);
  const handleToggleMaximize = useCallback(() => {
    window.__TAURI_BRIDGE__?.getCurrentWindow?.()
      .toggleMaximize()
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[wf] toggleMaximize failed', err);
      });
  }, []);
  const handleClose = useCallback(() => {
    window.__TAURI_BRIDGE__?.getCurrentWindow?.()
      .close()
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[wf] close failed', err);
      });
  }, []);

  const controls: ControlProps = useMemo(
    () => ({
      onMinimize: handleMinimize,
      onToggleMaximize: handleToggleMaximize,
      onClose: handleClose,
      isMaximized,
    }),
    [handleMinimize, handleToggleMaximize, handleClose, isMaximized],
  );

  // Resize-handle helpers — decorations:false strips the OS's own resize
  // edges on Windows + Linux, so we paint our own thin invisible strips
  // around the window perimeter. Each fires startResizeDragging on
  // mousedown and the OS takes over until mouseup. Skip the North edge:
  // that overlaps the title bar's drag region; the user pulls the bottom
  // or sides to resize. macOS keeps native resize behaviour with
  // decorations:false but the handles do no harm there.
  const beginResize = useCallback((direction: ResizeDirection) => {
    return (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      window.__TAURI_BRIDGE__?.getCurrentWindow?.()
        .startResizeDragging(direction)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[wf] startResizeDragging failed', direction, err);
        });
    };
  }, []);

  // Web fallback — render children with no chrome
  if (!tauriOn) return <>{children}</>;

  const ControlsComponent = platform === 'darwin' ? TrafficLights : CaptionControls;

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
        {platform === 'darwin' && <ControlsComponent {...controls} />}

        <div className="ew-wf-brand" data-tauri-no-drag>
          <S3Glyph size={16} />
        </div>

        <div className="ew-wf-title" aria-live="polite">
          {title}
        </div>

        <div className="ew-wf-titlebar-spacer" />

        {platform !== 'darwin' && <ControlsComponent {...controls} />}
      </header>

      <div className="ew-wf-frame">
        <div className="ew-wf-frame-accent" aria-hidden="true" />
        <main className="ew-wf-body">{children}</main>
      </div>

      {/* Resize handles — hidden when maximized. Top edge owned by the
          title bar (drag + double-click-to-maximize). LEFT EDGE
          intentionally absent: the Everywear sidebar of applet icons
          sits on the left, and a resize handle there would steal clicks
          meant for the icons. User resizes via E (right), S (bottom),
          and the SE bottom-right corner. SW corner kept narrow so it
          doesn't eat clicks on the bottom-left taskbar. 2026-05-04 SGT
          revision after Sean's smoke test of the left-side conflict. */}
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

// Slot helpers — let downstream pages extend the bar
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
