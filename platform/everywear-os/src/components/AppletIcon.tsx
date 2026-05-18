import React, { useRef, useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppletIconProps {
  applet: {
    id: string;
    name: string;
    status: 'Active' | 'Locked' | 'NotBuilt';
  };
  health: 'online' | 'offline' | 'checking';
  isLaunching: boolean;
  onClick: () => void;
}

/* ------------------------------------------------------------------ */
/*  Per-applet colour map                                              */
/* ------------------------------------------------------------------ */

const APPLET_COLORS: Record<string, { primary: string; secondary: string; rgb: [number, number, number] }> = {
  '1magen':           { primary: '#00C2FF', secondary: '#0090CC', rgb: [0, 194, 255] },
  'gener8':           { primary: '#76B900', secondary: '#5A8F00', rgb: [118, 185, 0] },
  'vid':              { primary: '#E040FB', secondary: '#C000D0', rgb: [224, 64, 251] },
  's3studio':         { primary: '#00C2FF', secondary: '#0090CC', rgb: [0, 194, 255] },
  'strands-game':     { primary: '#C4008E', secondary: '#A00074', rgb: [196, 0, 142] },
  'kasai':            { primary: '#FF8800', secondary: '#D97200', rgb: [255, 136, 0] },
  'character-studio': { primary: '#A855F7', secondary: '#7C3AED', rgb: [168, 85, 247] },
  '3nvizen':          { primary: '#FF6B2E', secondary: '#D45520', rgb: [255, 107, 46] },
  'mymories':         { primary: '#D48A20', secondary: '#B07018', rgb: [212, 138, 32] },
};

/* ------------------------------------------------------------------ */
/*  Monogram map                                                       */
/* ------------------------------------------------------------------ */

const MONOGRAM: Record<string, string> = {
  '1magen':           '1M',
  'gener8':           'G8',
  'vid':              'VD',
  's3studio':         'S3',
  'strands-game':     'SN',
  'kasai':            'KS',
  'character-studio': 'CS',
  '3nvizen':          '3N',
  'mymories':         'MY',
};

type IconVariant = 'plain' | 'classic' | 'holograph' | 'terminal';

function resolveIconVariant(): IconVariant {
  if (typeof document === 'undefined') return 'classic';
  if (document.body.dataset.mode === 'light') return 'plain';
  if (document.body.dataset.skin === 'refined') return 'holograph';
  if (document.body.dataset.skin === 'terminal') return 'terminal';
  return 'classic';
}

function useIconVariant() {
  const [variant, setVariant] = useState<IconVariant>(() => resolveIconVariant());

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const update = () => setVariant(resolveIconVariant());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-skin'],
    });

    return () => observer.disconnect();
  }, []);

  return variant;
}

function iconColors(appletId: string) {
  return APPLET_COLORS[appletId] || { primary: '#00C2FF', secondary: '#0090CC', rgb: [0, 194, 255] as [number, number, number] };
}

function PlainSvgIcon({ appletId }: { appletId: string }) {
  const colors = iconColors(appletId);
  const monogram = MONOGRAM[appletId] || appletId.slice(0, 2).toUpperCase();

  return (
    <svg
      className="ew-icon-svg ew-icon-svg--plain"
      viewBox="0 0 56 56"
      role="img"
      aria-hidden="true"
      style={{ '--ew-applet-color': colors.primary } as React.CSSProperties}
    >
      <rect x="6" y="6" width="44" height="44" rx="9" />
      <path d="M15 36V20h26v16M15 28h26M23 20v16M33 20v16" />
      <circle cx="42" cy="14" r="3" />
      <text x="28" y="33">{monogram}</text>
    </svg>
  );
}

function HolographIcon({ appletId }: { appletId: string }) {
  const colors = iconColors(appletId);
  const monogram = MONOGRAM[appletId] || appletId.slice(0, 2).toUpperCase();
  const gradientId = `ew-holo-${appletId.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg
      className="ew-icon-svg ew-icon-svg--holograph"
      viewBox="0 0 56 56"
      role="img"
      aria-hidden="true"
      style={{ '--ew-applet-color': colors.primary, '--ew-applet-color-2': colors.secondary } as React.CSSProperties}
    >
      <defs>
        <linearGradient id={gradientId} x1="9" y1="8" x2="49" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ew-applet-color)" stopOpacity="0.95" />
          <stop offset="0.46" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--ew-applet-color-2)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <path className="ew-icon-svg__holo-shell" d="M11 8h27l7 7v30H18l-7-7V8Z" />
      <path className="ew-icon-svg__holo-plane" d="M15 15h25v26H15V15Z" fill={`url(#${gradientId})`} />
      <path className="ew-icon-svg__holo-line" d="M17 22h21M17 28h21M17 34h21M24 17v22M32 17v22" />
      <text x="28" y="33">{monogram}</text>
    </svg>
  );
}

function TerminalSvgIcon({ appletId }: { appletId: string }) {
  const monogram = MONOGRAM[appletId] || appletId.slice(0, 2).toUpperCase();

  return (
    <svg className="ew-icon-svg ew-icon-svg--terminal" viewBox="0 0 56 56" role="img" aria-hidden="true">
      <rect x="7" y="7" width="42" height="42" rx="1" />
      <path d="M13 15h30M13 41h30M15 13v30M41 13v30" />
      <path className="ew-icon-svg__terminal-scan" d="M13 22h30M13 29h30M13 36h30" />
      <text x="28" y="33">{monogram}</text>
    </svg>
  );
}

function ThemedAppletGlyph({ appletId, variant }: { appletId: string; variant: IconVariant }) {
  if (variant === 'plain') return <PlainSvgIcon appletId={appletId} />;
  if (variant === 'holograph') return <HolographIcon appletId={appletId} />;
  if (variant === 'terminal') return <TerminalSvgIcon appletId={appletId} />;
  return <ParticleIcon appletId={appletId} />;
}

/* ------------------------------------------------------------------ */
/*  Skin overrides (non-Classic surfaces)                              */
/* ------------------------------------------------------------------ */

// Per-skin override for non-Classic surfaces. Approximate sRGB for the
// active primary in dark mode; matches the OKLCH / hex tokens defined
// in tokens.css. Used for both fill and glow.
const SKIN_PRIMARY: Record<string, { primary: string; secondary: string; rgb: [number, number, number] }> = {
  refined:  { primary: '#5C9BC4', secondary: '#3D7AA0', rgb: [92, 155, 196] },
  terminal: { primary: '#FF8800', secondary: '#D97200', rgb: [255, 136, 0] },
};

/* ------------------------------------------------------------------ */
/*  ParticleIcon — canvas-rendered particle field with monogram        */
/* ------------------------------------------------------------------ */

/**
 * Particle-style icon canvas for Everywear OS applets.
 * Renders a miniature particle field with the applet monogram in the centre.
 *
 * Skin awareness (ported from S3 Studio, 2026-04-25 SGT):
 *   In Classic the per-applet brand colours win, because those colours
 *   ARE the applet identity and Classic is the "default brand" surface.
 *   In Refined the entire desktop tints to the steel-blue OKLCH primary;
 *   in Terminal everything goes amber-mono. This keeps the desktop icons
 *   coherent with whatever skin the user picked, instead of leaving them
 *   stranded as cyan/purple regardless of context.
 *
 *   Skin lookup happens inside the animate loop on every frame, so a
 *   skin flip via the Taskbar SkinToggle takes effect on the next paint
 *   without having to tear down and re-init the canvas / particle field.
 */
function ParticleIcon({ appletId }: { appletId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 112; // 2x for retina
    canvas.width = SIZE;
    canvas.height = SIZE;

    // Resolve monogram text for this applet
    const monogram = MONOGRAM[appletId] || appletId.slice(0, 2).toUpperCase();

    // Default fallback colour (cyan)
    const fallbackColor: { primary: string; secondary: string; rgb: [number, number, number] } =
      { primary: '#00C2FF', secondary: '#0090CC', rgb: [0, 194, 255] };

    // Generate particles. Position/size is skin-agnostic; per-frame fill
    // colours come from the active skin lookup inside animate().
    interface MiniParticle {
      x: number; y: number; size: number; alpha: number;
      vx: number; vy: number; drift: number;
    }
    const particles: MiniParticle[] = [];
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * SIZE,
        y: Math.random() * SIZE,
        size: Math.random() * 1.5 + 0.4,
        alpha: Math.random() * 0.4 + 0.1,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        drift: Math.random() * Math.PI * 2,
      });
    }

    let time = 0;

    function animate() {
      time += 0.02;
      ctx!.clearRect(0, 0, SIZE, SIZE);

      // Resolve skin-aware colours once per frame. Reading the body
      // dataset is a single attribute lookup, no DOM traversal cost.
      // Classic keeps per-applet brand colours; Refined and Terminal
      // collapse all icons to the active skin primary so the desktop
      // reads as one coherent surface.
      const skin = (typeof document !== 'undefined' && document.body.dataset.skin) || 'classic';
      const colors =
        skin === 'classic'
          ? (APPLET_COLORS[appletId] || fallbackColor)
          : (SKIN_PRIMARY[skin] || APPLET_COLORS[appletId] || fallbackColor);

      // Background with rounded corners
      const radius = 24;
      ctx!.beginPath();
      ctx!.roundRect(0, 0, SIZE, SIZE, radius);
      ctx!.clip();

      // Keep applet tiles dark even on Light. This matches the S3 Studio
      // desktop reference: the pale wallpaper stays calm while app icons
      // remain inspectable, branded, and high-contrast.
      ctx!.fillStyle =
        skin === 'terminal'
            ? '#0A0907'
            : '#0a0a12';
      ctx!.fillRect(0, 0, SIZE, SIZE);

      // Gradient glow
      const grad = ctx!.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.6);
      grad.addColorStop(0, `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.12)`);
      grad.addColorStop(1, 'transparent');
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, SIZE, SIZE);

      // Particles
      for (const p of particles) {
        p.x += p.vx + Math.sin(time + p.drift) * 0.1;
        p.y += p.vy + Math.cos(time * 0.8 + p.drift) * 0.1;
        if (p.x < 0) p.x = SIZE;
        if (p.x > SIZE) p.x = 0;
        if (p.y < 0) p.y = SIZE;
        if (p.y > SIZE) p.y = 0;

        const pulseAlpha = p.alpha * (0.6 + 0.4 * Math.sin(time * 2 + p.drift));

        // Glow
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},${pulseAlpha * 0.2})`;
        ctx!.fill();

        // Core
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},${pulseAlpha})`;
        ctx!.fill();
      }

      // Connections between close particles
      ctx!.lineWidth = 0.3;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          if (dx * dx + dy * dy < 900) {
            ctx!.strokeStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.06)`;
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.stroke();
          }
        }
      }

      // Monogram text
      ctx!.save();
      ctx!.font = '700 32px var(--ew-font-display), "Inter", "SF Pro", -apple-system, sans-serif';
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';

      // Text glow
      ctx!.shadowColor = colors.primary;
      ctx!.shadowBlur = 12;
      ctx!.fillStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.8)`;
      ctx!.fillText(monogram, SIZE / 2, SIZE / 2);

      // Crisp text on top
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = 'rgba(255,255,255,0.9)';
      ctx!.fillText(monogram, SIZE / 2, SIZE / 2);
      ctx!.restore();

      // Subtle border
      ctx!.strokeStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.15)`;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.roundRect(0.5, 0.5, SIZE - 1, SIZE - 1, radius);
      ctx!.stroke();

      animRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => cancelAnimationFrame(animRef.current);
  }, [appletId]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 56, height: 56, imageRendering: 'auto' }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  AppletIcon — the full desktop icon with label + status             */
/* ------------------------------------------------------------------ */

export default function AppletIcon({ applet, health, isLaunching, onClick }: AppletIconProps) {
  const isLocked = applet.status === 'Locked';
  const isNotBuilt = applet.status === 'NotBuilt';
  const iconVariant = useIconVariant();

  return (
    <div
      className="ew-desktop-icon"
      data-applet-id={applet.id}
      data-status={applet.status}
      data-health={health}
      data-launching={isLaunching || undefined}
      onClick={onClick}
      onDoubleClick={onClick}
    >
      {/* Icon */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            position: 'relative',
            opacity: isLocked ? 0.45 : isNotBuilt ? 0.3 : 1,
            animation: isLaunching ? 'ew-icon-pulse 1.2s ease-in-out infinite' : undefined,
          }}
        >
          <ThemedAppletGlyph appletId={applet.id} variant={iconVariant} />

          {/* Online pulse indicator */}
          {applet.status === 'Active' && health === 'online' && (
            <div
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  backgroundColor: '#4ade80',
                  animation: 'ew-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                  opacity: 0.4,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  backgroundColor: '#4ade80',
                }}
              />
            </div>
          )}

          {/* Offline dot */}
          {applet.status === 'Active' && health === 'offline' && (
            <div
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  backgroundColor: '#6b7280',
                }}
              />
            </div>
          )}

          {/* Locked overlay */}
          {isLocked && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.45)',
                borderRadius: 16,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span
                style={{
                  marginTop: 2,
                  fontSize: 7,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.3)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                LOCKED
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Label */}
      <span className="ew-desktop-icon__label">{applet.name}</span>

      {/* Keyframe styles injected once */}
      <style>{`
        @keyframes ew-ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes ew-icon-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.96); }
        }
      `}</style>
    </div>
  );
}
