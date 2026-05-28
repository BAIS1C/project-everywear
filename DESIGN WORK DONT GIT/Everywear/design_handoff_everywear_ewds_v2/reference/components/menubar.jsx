// components/menubar.jsx — top system menubar
// Owns traffic lights, system clock, indicators

function MenuBar({ trafficSide = 'left', onTrafficClick }) {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const lights = (
    <div className="tl" style={{ padding: '0 14px' }}>
      <span className="tl-dot" onClick={() => onTrafficClick?.('close')} title="Close"></span>
      <span className="tl-dot amber" onClick={() => onTrafficClick?.('min')} title="Minimize"></span>
      <span className="tl-dot green" onClick={() => onTrafficClick?.('max')} title="Maximize"></span>
    </div>
  );

  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <div style={menubarStyles.bar}>
      {trafficSide === 'left' && lights}

      <div style={menubarStyles.brand}>
        <div style={menubarStyles.brandMark}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7 L7 2 L12 7 L7 12 Z" stroke="var(--accent)" strokeWidth="1.2" fill="none"/>
            <circle cx="7" cy="7" r="1.6" fill="var(--accent)"/>
          </svg>
        </div>
        <span className="t-label" style={{ color: 'var(--ink-1)', letterSpacing: '0.22em' }}>EVERYWEAR</span>
        <span className="t-meta chrome" style={{ marginLeft: 6 }}>EWDS · v2.0.4</span>
      </div>

      <div style={menubarStyles.menus}>
        {['Shell','Applet','Widgets','View','Window','Help'].map(m => (
          <span key={m} className="t-mono" style={menubarStyles.menuItem}>{m}</span>
        ))}
      </div>

      <div style={menubarStyles.spacer}/>

      <div style={menubarStyles.statusGroup}>
        <Indicator label="NET" value="STABLE" dotColor="var(--ok)"/>
        <Indicator label="GPU" value="IDLE" dotColor="var(--ink-3)"/>
        <Indicator label="RAM" value="42%" dotColor="var(--accent)"/>
      </div>

      <div style={menubarStyles.clockBlock} className="bevel">
        <span className="t-meta">{dateStr}</span>
        <span className="t-data" style={{ color: 'var(--accent)', textShadow: '0 0 8px rgba(111,217,232,0.4)' }}>{timeStr}</span>
      </div>

      {trafficSide === 'right' && lights}
    </div>
  );
}

function Indicator({ label, value, dotColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: dotColor, boxShadow: `0 0 6px ${dotColor}`
      }}/>
      <span className="t-label">{label}</span>
      <span className="t-mono" style={{ color: 'var(--ink-1)' }}>{value}</span>
    </div>
  );
}

const menubarStyles = {
  bar: {
    position: 'relative', zIndex: 100,
    height: 36,
    display: 'flex', alignItems: 'center',
    background: 'linear-gradient(180deg, #1c2025 0%, #14171b 100%)',
    borderBottom: '1px solid rgba(0,0,0,0.7)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.4)',
    paddingRight: 8,
    gap: 0,
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 14px 0 6px',
    borderRight: '1px solid var(--hairline)',
    height: '100%',
  },
  brandMark: {
    width: 22, height: 22, borderRadius: 4,
    display: 'grid', placeItems: 'center',
    background: 'linear-gradient(180deg, #2a2f36 0%, #1a1e23 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.6)',
  },
  menus: { display: 'flex', alignItems: 'center', height: '100%' },
  menuItem: {
    padding: '0 11px', height: '100%',
    display: 'flex', alignItems: 'center',
    color: 'var(--ink-2)', cursor: 'pointer',
    borderRight: '1px solid var(--hairline)',
  },
  spacer: { flex: 1 },
  statusGroup: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '0 14px',
    borderLeft: '1px solid var(--hairline)',
    borderRight: '1px solid var(--hairline)',
    height: '100%',
  },
  clockBlock: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 10px',
    margin: '0 8px',
    borderRadius: 3,
  },
};

window.MenuBar = MenuBar;
