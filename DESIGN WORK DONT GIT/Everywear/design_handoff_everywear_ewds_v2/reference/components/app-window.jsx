// components/app-window.jsx — bevelled application window
// Drag titlebar to move, drag bottom-right handle to resize.
// (In the production Rust shell, this is native windowing — this mocks the behavior.)

function AppWindow({
  title = 'APPLET', subtitle = '',
  trafficSide = 'left', onClose, onMin, onMax,
  width: initWidth = 720, height: initHeight = 520,
  x: initX = 240, y: initY = 86,
  minWidth = 480, minHeight = 320,
  children,
}) {
  const [box, setBox] = React.useState({ x: initX, y: initY, w: initWidth, h: initHeight });
  const dragRef = React.useRef(null);

  // sync incoming layout when traffic side flips etc.
  React.useEffect(() => {
    setBox(b => ({ ...b, x: initX, y: initY }));
  }, [initX, initY]);

  const onDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...box };
    const move = (ev) => {
      setBox({
        ...start,
        x: Math.max(0, Math.min(window.innerWidth - 80, start.x + ev.clientX - startX)),
        y: Math.max(36, Math.min(window.innerHeight - 60, start.y + ev.clientY - startY)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onResizeStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...box };
    const move = (ev) => {
      setBox({
        ...start,
        w: Math.max(minWidth, start.w + ev.clientX - startX),
        h: Math.max(minHeight, start.h + ev.clientY - startY),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const tl = (
    <div className="tl" style={{ gap: 8 }}>
      <span className="tl-dot" onClick={onClose} title="Close"></span>
      <span className="tl-dot amber" onClick={onMin} title="Minimize"></span>
      <span className="tl-dot green" onClick={onMax} title="Maximize"></span>
    </div>
  );

  return (
    <div ref={dragRef} className="bevel-strong" style={{
      position: 'absolute',
      left: box.x, top: box.y,
      width: box.w, height: box.h,
      borderRadius: 10,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 20,
    }}>
      {/* titlebar — drag handle */}
      <div style={appWinStyles.titlebar} onMouseDown={onDragStart}>
        {trafficSide === 'left' && <div style={{ padding: '0 12px' }} onMouseDown={(e)=>e.stopPropagation()}>{tl}</div>}

        <div style={appWinStyles.titleBlock}>
          <span className="t-display" style={{ fontSize: 12, letterSpacing:'0.16em', color: 'var(--ink-1)' }}>{title}</span>
          {subtitle && <span className="t-meta chrome" style={{ marginLeft: 10 }}>· {subtitle}</span>}
        </div>

        <div style={{ flex: 1 }}/>
        <div className="chrome" style={appWinStyles.titleMeta}>
          <Barcode seed={title.length} width={60} height={10}/>
          <Serial prefix="APP" n={42715}/>
        </div>

        {trafficSide === 'right' && <div style={{ padding: '0 12px' }} onMouseDown={(e)=>e.stopPropagation()}>{tl}</div>}
      </div>

      {/* content recessed plate */}
      <div className="recessed scanlines" style={{ flex: 1, position:'relative', overflow:'hidden' }}>
        {children}
      </div>

      {/* footer */}
      <div style={appWinStyles.footer}>
        <span className="t-label">▣ EWDS</span>
        <span className="t-meta chrome">PROTOCOL 2204·00A · DEEP DIVE WAVE REV 0.0</span>
        <span style={{ flex: 1 }}/>
        <span className="t-label" style={{ color:'var(--accent)' }}>● LIVE</span>
      </div>

      {/* resize handle bottom-right */}
      <div onMouseDown={onResizeStart} title="Drag to resize" style={appWinStyles.resizeHandle}>
        <svg viewBox="0 0 14 14" width="14" height="14">
          <line x1="2" y1="13" x2="13" y2="2" stroke="rgba(255,255,255,0.30)" strokeWidth="1"/>
          <line x1="6" y1="13" x2="13" y2="6" stroke="rgba(255,255,255,0.20)" strokeWidth="1"/>
          <line x1="10" y1="13" x2="13" y2="10" stroke="rgba(255,255,255,0.14)" strokeWidth="1"/>
        </svg>
      </div>
    </div>
  );
}

const appWinStyles = {
  titlebar: {
    height: 38,
    display: 'flex', alignItems: 'center',
    background: 'linear-gradient(180deg, #262b32 0%, #181c21 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.7)',
    borderBottom: '1px solid rgba(0,0,0,0.6)',
    cursor: 'grab',
    userSelect: 'none',
  },
  titleBlock: {
    display:'flex', alignItems:'center', gap: 6,
    padding: '0 10px',
    height: '100%',
    borderLeft: '1px solid var(--hairline)',
    borderRight: '1px solid var(--hairline)',
  },
  titleMeta: {
    display:'flex', alignItems:'center', gap: 10,
    padding: '0 12px',
  },
  footer: {
    height: 28,
    display:'flex', alignItems:'center', gap: 14,
    padding: '0 12px',
    background: 'linear-gradient(180deg, #14181d 0%, #0e1115 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.8)',
    borderTop: '1px solid rgba(0,0,0,0.7)',
  },
  resizeHandle: {
    position: 'absolute',
    right: 2, bottom: 2,
    width: 16, height: 16,
    cursor: 'nwse-resize',
    display: 'grid', placeItems: 'center',
    zIndex: 30,
  },
};

window.AppWindow = AppWindow;
