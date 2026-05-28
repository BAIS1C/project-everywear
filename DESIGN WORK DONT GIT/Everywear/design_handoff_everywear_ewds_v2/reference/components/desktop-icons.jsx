// components/desktop-icons.jsx — holographic projection icons
// Each icon is: graphite plinth (bevelled disc) + volumetric light cone + glyph above

function DesktopIcons({ items, onLaunch }) {
  // ALWAYS anchored to LEFT regardless of traffic-light side
  return (
    <div style={{
      position:'absolute', top: 56, left: 22,
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 96px)',
      gridAutoRows: 128,
      gap: 12,
      zIndex: 5,
    }}>
      {items.map((it, i) => (
        <DesktopIcon key={i} item={it} onLaunch={onLaunch}/>
      ))}
    </div>
  );
}

function DesktopIcon({ item, onLaunch }) {
  const [hover, setHover] = React.useState(false);
  const accent = item.accent || 'rgba(111, 217, 232, 0.85)';
  const accentSoft = accent.replace(/0\.\d+\)/, '0.35)');
  const accentFaint = accent.replace(/0\.\d+\)/, '0.12)');

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => onLaunch?.(item.id)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 4px 4px',
        cursor: 'pointer', borderRadius: 6,
        position: 'relative',
        outline: hover ? `1px dashed ${accentSoft}` : '1px dashed transparent',
        transition: 'outline-color .15s',
      }}
    >
      {/* projection container — beam + glyph + plinth */}
      <div style={{
        position: 'relative',
        width: 72, height: 78,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
        {/* volumetric light cone rising from plinth */}
        <div style={{
          position: 'absolute',
          left: '50%', bottom: 12, transform: 'translateX(-50%)',
          width: 64, height: 62,
          background: `radial-gradient(ellipse 60% 100% at 50% 100%, ${accentSoft} 0%, ${accentFaint} 35%, transparent 70%)`,
          mixBlendMode: 'screen',
          filter: hover ? 'brightness(1.4) saturate(1.2)' : 'none',
          transition: 'filter .25s',
          pointerEvents: 'none',
        }}/>
        {/* projection cone outline — two slanted hairlines */}
        <svg style={{ position:'absolute', inset: 0, pointerEvents:'none', overflow:'visible' }} viewBox="0 0 72 78">
          <line x1="24" y1="65" x2="14" y2="14" stroke={accentSoft} strokeWidth="0.6" strokeDasharray="1 2"/>
          <line x1="48" y1="65" x2="58" y2="14" stroke={accentSoft} strokeWidth="0.6" strokeDasharray="1 2"/>
          {/* scan tick marks */}
          <line x1="22" y1="32" x2="50" y2="32" stroke={accentSoft} strokeWidth="0.4" strokeDasharray="2 3" opacity="0.6"/>
        </svg>

        {/* holographic glyph (projected) */}
        <div style={{
          position: 'absolute',
          left: '50%', top: 10,
          transform: `translateX(-50%) translateY(${hover ? -2 : 0}px)`,
          transition: 'transform .25s',
          textAlign: 'center',
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26, fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '0.02em',
            textShadow: `
              0 0 4px ${accent},
              0 0 10px ${accentSoft},
              0 0 22px ${accentSoft}
            `,
            display: 'block',
          }}>
            {item.glyph}
          </span>
        </div>

        {/* PLINTH — bevelled graphite hex disc */}
        <div style={{
          position: 'relative',
          alignSelf: 'center',
          width: 56, height: 16,
          clipPath: 'polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)',
          background: 'linear-gradient(180deg, #353b44 0%, #1f242a 45%, #14181d 100%)',
          boxShadow: `
            inset 0 1px 0 rgba(255,255,255,0.20),
            inset 0 -1px 0 rgba(0,0,0,0.7),
            inset 1px 0 0 rgba(255,255,255,0.06),
            inset -1px 0 0 rgba(0,0,0,0.5)
          `,
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.7)) drop-shadow(0 6px 8px rgba(0,0,0,0.4))',
        }}>
          {/* inner recessed slot — the "projector aperture" */}
          <div style={{
            position: 'absolute',
            left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
            width: 28, height: 3, borderRadius: 1,
            background: hover
              ? `linear-gradient(90deg, transparent, ${accent}, transparent)`
              : `linear-gradient(90deg, transparent, ${accentSoft}, transparent)`,
            boxShadow: hover
              ? `0 0 8px ${accent}, inset 0 0 1px rgba(0,0,0,0.8)`
              : `0 0 4px ${accentSoft}`,
            transition: 'box-shadow .25s, background .25s',
          }}/>
          {/* two ventilation dots */}
          <div style={{ position:'absolute', left: 5, top: 6, width: 1.5, height: 1.5, borderRadius:'50%', background: 'rgba(0,0,0,0.7)' }}/>
          <div style={{ position:'absolute', right: 5, top: 6, width: 1.5, height: 1.5, borderRadius:'50%', background: 'rgba(0,0,0,0.7)' }}/>
        </div>
      </div>

      {/* label + serial */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 1, marginTop: 4 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, letterSpacing: '0.12em',
          color: hover ? accent : 'var(--ink-1)',
          textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          transition: 'color .15s',
        }}>{item.label}</span>
        <span className="chrome" style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 7.5, letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.45)',
        }}>{item.code}</span>
      </div>
    </div>
  );
}

window.DesktopIcons = DesktopIcons;
