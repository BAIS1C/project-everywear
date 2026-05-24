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
  'ai-director':      { primary: '#F43F5E', secondary: '#BE123C', rgb: [244, 63, 94] },
  's3studio':         { primary: '#00C2FF', secondary: '#0090CC', rgb: [0, 194, 255] },
  'strands-game':     { primary: '#C4008E', secondary: '#A00074', rgb: [196, 0, 142] },
  'kasai':            { primary: '#FF8800', secondary: '#D97200', rgb: [255, 136, 0] },
  'layeru-osint':     { primary: '#2DD4BF', secondary: '#0F766E', rgb: [45, 212, 191] },
  'character-studio': { primary: '#A855F7', secondary: '#7C3AED', rgb: [168, 85, 247] },
  '3nvizen':          { primary: '#FF6B2E', secondary: '#D45520', rgb: [255, 107, 46] },
  'loom':             { primary: '#69D2C6', secondary: '#2E7D75', rgb: [105, 210, 198] },
  'mymories':         { primary: '#D48A20', secondary: '#B07018', rgb: [212, 138, 32] },
  'settings':         { primary: '#00C2FF', secondary: '#5C9BC4', rgb: [0, 194, 255] },
  'vault':            { primary: '#2DD4BF', secondary: '#0F766E', rgb: [45, 212, 191] },
};

/* ------------------------------------------------------------------ */
/*  Monogram map                                                       */
/* ------------------------------------------------------------------ */

const MONOGRAM: Record<string, string> = {
  '1magen':           '1M',
  'gener8':           'G8',
  'vid':              'VD',
  'ai-director':      'AD',
  's3studio':         'S3',
  'strands-game':     'SN',
  'kasai':            'MM',
  'layeru-osint':     'LU',
  'character-studio': 'CS',
  '3nvizen':          '3N',
  'loom':             'LM',
  'mymories':         'MY',
  'settings':         'ST',
  'vault':            'VA',
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
      <rect x="5.5" y="5.5" width="45" height="45" rx="11" />
      <path className="ew-icon-svg__plain-corner" d="M15 20v-5h7M41 20v-5h-7M15 36v5h7M41 36v5h-7" />
      <path className="ew-icon-svg__plain-glyph" d="M18 38V18h20v20H18Z" />
      <circle cx="43" cy="13" r="3.4" />
      <text x="28" y="30.5">{monogram}</text>
    </svg>
  );
}

function ProjectedGlyphShape({ appletId, stem }: { appletId: string; stem: 'holo' | 'terminal' }) {
  const monogram = MONOGRAM[appletId] || appletId.slice(0, 2).toUpperCase();
  const shapeClass = `ew-icon-svg__${stem}-shape`;
  const textClass = `ew-icon-svg__${stem}-text`;

  if (appletId === 's3studio') {
    return (
      <>
        <path className={shapeClass} d="M12 8h12l5 4h16v23H12V8Z" />
        <path className={`ew-icon-svg__${stem}-detail`} d="M16 19h25M16 28h25" />
        <text className={textClass} x="28" y="25">S3</text>
      </>
    );
  }

  if (appletId === 'settings') {
    return (
      <>
        <circle className={shapeClass} cx="28" cy="22" r="11" />
        <path className={`ew-icon-svg__${stem}-detail`} d="M28 5v7M28 32v6M11 22h7M38 22h7M16.5 10.5l4.8 4.8M34.7 28.7l4.8 4.8M39.5 10.5l-4.8 4.8M21.3 28.7l-4.8 4.8" />
        <circle className={`ew-icon-svg__${stem}-core`} cx="28" cy="22" r="4" />
      </>
    );
  }

  if (appletId === 'vault') {
    return (
      <>
        <rect className={shapeClass} x="14" y="6" width="28" height="30" rx="3" />
        <path className={`ew-icon-svg__${stem}-detail`} d="M19 15h18M19 23h18M19 31h18M23 10v23M33 10v23" />
        <text className={textClass} x="28" y="24">VA</text>
      </>
    );
  }

  return (
    <>
      <path className={shapeClass} d="M14 5h27l5 5v24l-7 4H16l-6-5V10l4-5Z" />
      <path className={`ew-icon-svg__${stem}-detail`} d="M17 15h22M16 25h24M17 34h22" />
      <text className={textClass} x="28" y="25.5">{monogram}</text>
    </>
  );
}

function HolographIcon({ appletId }: { appletId: string }) {
  const gradientId = `ew-holo-${appletId.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg
      className="ew-icon-svg ew-icon-svg--holograph"
      viewBox="0 0 56 56"
      role="img"
      aria-hidden="true"
      style={{
        '--ew-applet-color': '#19C8FF',
        '--ew-applet-color-2': '#7DBBFF',
      } as React.CSSProperties}
    >
      <defs>
        <linearGradient id={gradientId} x1="12" y1="6" x2="43" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ew-applet-color)" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#D9F6FF" stopOpacity="0.74" />
          <stop offset="1" stopColor="var(--ew-applet-color-2)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <ellipse className="ew-icon-svg__holo-shadow" cx="28" cy="47" rx="17" ry="4" />
      <ellipse className="ew-icon-svg__holo-plinth" cx="28" cy="43" rx="17" ry="5" />
      <ellipse className="ew-icon-svg__holo-ring" cx="28" cy="41" rx="12" ry="3" />
      <path className="ew-icon-svg__holo-beam" d="M13 43 22 35h12l9 8Z" fill={`url(#${gradientId})`} />
      <ProjectedGlyphShape appletId={appletId} stem="holo" />
      <path className="ew-icon-svg__holo-sparkles ew-icon-svg__sparkle-a" d="M9 15h5M11.5 12.5v5M43 10h5M45.5 7.5v5M39 34h5M41.5 31.5v5" />
      <path className="ew-icon-svg__holo-sparkles ew-icon-svg__sparkle-b" d="M16 8h3M17.5 6.5v3M47 25h4M49 23v4M12 35h3M13.5 33.5v3" />
    </svg>
  );
}

function TerminalSvgIcon({ appletId }: { appletId: string }) {
  return (
    <svg className="ew-icon-svg ew-icon-svg--terminal" viewBox="0 0 56 56" role="img" aria-hidden="true">
      <ellipse className="ew-icon-svg__terminal-shadow" cx="28" cy="47" rx="17" ry="4" />
      <ellipse className="ew-icon-svg__terminal-plinth" cx="28" cy="43" rx="17" ry="5" />
      <ellipse className="ew-icon-svg__terminal-ring" cx="28" cy="41" rx="12" ry="3" />
      <path className="ew-icon-svg__terminal-beam" d="M13 43 22 35h12l9 8Z" />
      <ProjectedGlyphShape appletId={appletId} stem="terminal" />
      <path className="ew-icon-svg__terminal-sparkles ew-icon-svg__sparkle-a" d="M9 15h5M11.5 12.5v5M43 10h5M45.5 7.5v5M39 34h5M41.5 31.5v5" />
      <path className="ew-icon-svg__terminal-sparkles ew-icon-svg__sparkle-b" d="M16 8h3M17.5 6.5v3M47 25h4M49 23v4M12 35h3M13.5 33.5v3" />
    </svg>
  );
}

export function ThemedIconGlyph({ appletId }: { appletId: string }) {
  const variant = useIconVariant();

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

      ctx!.fillStyle =
        skin === 'terminal'
          ? 'rgba(12, 9, 5, 0.68)'
          : 'rgba(11, 16, 24, 0.62)';
      ctx!.fillRect(0, 0, SIZE, SIZE);

      const glass = ctx!.createLinearGradient(0, 0, SIZE, SIZE);
      glass.addColorStop(0, 'rgba(255,255,255,0.18)');
      glass.addColorStop(0.42, 'rgba(255,255,255,0.035)');
      glass.addColorStop(1, 'rgba(255,255,255,0.09)');
      ctx!.fillStyle = glass;
      ctx!.fillRect(0, 0, SIZE, SIZE);

      const shine = ctx!.createLinearGradient(0, 0, SIZE * 0.74, SIZE * 0.58);
      shine.addColorStop(0, 'rgba(255,255,255,0.28)');
      shine.addColorStop(0.5, 'rgba(255,255,255,0.055)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      ctx!.fillStyle = shine;
      ctx!.beginPath();
      ctx!.roundRect(8, 8, SIZE - 16, SIZE * 0.42, 18);
      ctx!.fill();

      const grad = ctx!.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.6);
      grad.addColorStop(0, `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.07)`);
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

        const pulseAlpha = p.alpha * (0.35 + 0.22 * Math.sin(time * 2 + p.drift));

        // Core
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},${pulseAlpha * 0.75})`;
        ctx!.fill();
      }

      // Connections between close particles
      ctx!.lineWidth = 0.3;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          if (dx * dx + dy * dy < 900) {
            ctx!.strokeStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.035)`;
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.stroke();
          }
        }
      }

      // Monogram text
      ctx!.save();
      ctx!.font = '900 54px "Inter", "SF Pro", -apple-system, sans-serif';
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';

      // Text glow
      ctx!.shadowColor = colors.primary;
      ctx!.shadowBlur = 6;
      ctx!.fillStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.72)`;
      ctx!.fillText(monogram, SIZE / 2, SIZE / 2);

      // Crisp text on top
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = 'rgba(255,255,255,0.92)';
      ctx!.fillText(monogram, SIZE / 2, SIZE / 2);
      ctx!.restore();

      // Subtle border
      ctx!.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.roundRect(0.5, 0.5, SIZE - 1, SIZE - 1, radius);
      ctx!.stroke();

      ctx!.strokeStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.14)`;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.roundRect(4.5, 4.5, SIZE - 9, SIZE - 9, radius - 5);
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
          <ThemedIconGlyph appletId={applet.id} />

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
