// components/dock.jsx — rocket dock + side rail
// Configurable: bottom-bar, top-bar, side-rail
// Desktop icons can also exist on the wallpaper itself (handled by Desktop)

function Dock({ position = 'bottom', items = [], onLaunch, accent }) {
  // position: 'bottom' | 'top' | 'left' | 'right' | 'hidden'
  if (position === 'hidden') return null;
  const isSide = position === 'left' || position === 'right';
  const wrapStyle = {
    position: 'fixed',
    zIndex: 90,
    display: 'flex',
    gap: 10,
    padding: '10px 14px',
    pointerEvents: 'auto',
    flexDirection: isSide ? 'column' : 'row',
    ...(position === 'bottom' ? { bottom: 20, left: '50%', transform: 'translateX(-50%)' } : {}),
    ...(position === 'top'    ? { top: 56, left: '50%', transform: 'translateX(-50%)' } : {}),
    ...(position === 'left'   ? { left: 20, top: '50%', transform: 'translateY(-50%)' } : {}),
    ...(position === 'right'  ? { right: 20, top: '50%', transform: 'translateY(-50%)' } : {}),
  };
  return (
    <div className="bevel-strong" style={{ ...wrapStyle, borderRadius: 14 }}>
      {/* tiny rail line top */}
      <div style={{
        position:'absolute',
        ...(isSide ? { left: 4, top: 8, bottom: 8, width: 2 } : { top: 4, left: 8, right: 8, height: 2 }),
        background: 'linear-gradient(90deg, transparent, var(--hairline-strong), transparent)',
        pointerEvents:'none'
      }}/>
      {items.map((it, i) => (
        <DockItem key={i} item={it} onLaunch={onLaunch}/>
      ))}
      <DockDivider isSide={isSide}/>
      <DockItem item={{ id:'trash', label:'TRASH', glyph: '⌫', system: true }} onLaunch={onLaunch}/>
    </div>
  );
}

function DockItem({ item, onLaunch }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={() => onLaunch?.(item.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position:'relative', cursor:'pointer' }}
    >
      <div className="bevel" style={{
        width: 56, height: 56,
        borderRadius: 12,
        display:'grid', placeItems:'center',
        position:'relative',
        background: item.active
          ? 'linear-gradient(180deg, #2d343d 0%, #1a1e23 100%)'
          : undefined,
        transform: hover ? 'translateY(-2px) scale(1.08)' : 'none',
        transition: 'transform .18s ease-out',
        boxShadow: item.active
          ? `inset 0 1px 0 var(--bevel-top-bright), inset 0 -1px 0 var(--bevel-bot), 0 0 0 1px var(--accent), 0 0 14px rgba(111,217,232,0.4), 0 4px 12px rgba(0,0,0,0.5)`
          : undefined,
      }}>
        {/* glass shine */}
        <div style={{
          position:'absolute', top: 2, left: 2, right: 2, height: '40%',
          borderRadius: '10px 10px 30% 30%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)',
          pointerEvents:'none'
        }}/>
        <span style={{
          fontSize: 22,
          color: item.active ? 'var(--accent)' : 'var(--ink-1)',
          textShadow: item.active ? '0 0 8px rgba(111,217,232,0.5)' : '0 1px 1px rgba(0,0,0,0.6)',
          fontFamily: 'var(--font-display)'
        }}>{item.glyph}</span>
        {item.badge && (
          <span style={{
            position:'absolute', top: -4, right: -4,
            background: 'var(--accent)', color: '#0b0d10',
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            padding: '1px 5px', borderRadius: 8,
            boxShadow: '0 0 8px rgba(111,217,232,0.5)'
          }}>{item.badge}</span>
        )}
        {item.active && (
          <span style={{
            position:'absolute', bottom: -8, left: '50%', transform:'translateX(-50%)',
            width: 4, height: 4, borderRadius: '50%',
            background: 'var(--accent)', boxShadow: 'var(--accent-glow)'
          }}/>
        )}
      </div>
      {hover && (
        <div className="bevel" style={{
          position:'absolute', bottom: 'calc(100% + 10px)', left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 8px', borderRadius: 4,
          whiteSpace:'nowrap', pointerEvents:'none'
        }}>
          <span className="t-mono" style={{ color: 'var(--ink-1)' }}>{item.label}</span>
        </div>
      )}
    </div>
  );
}

function DockDivider({ isSide }) {
  return (
    <div style={{
      ...(isSide ? { height: 1, width: '70%', margin: '4px auto' } : { width: 1, height: '70%', margin: 'auto 4px' }),
      background: 'linear-gradient(90deg, transparent, var(--hairline-strong), transparent)',
    }}/>
  );
}

window.Dock = Dock;
