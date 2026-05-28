// components/side-panel.jsx — modular side widget panel
// Inspired by the EWDS evolution reference: rounded outlined applet rows,
// mini tombstone shards down the side, telemetry graph, EWDS knobs/switches.

function SidePanel({ side = 'right', onLaunch }) {
  // side: 'left' | 'right'
  return (
    <div style={{
      position: 'fixed',
      top: 60, bottom: 16,
      [side]: 16,
      width: 280,
      zIndex: 50,
      display: 'flex', gap: 8,
      flexDirection: side === 'right' ? 'row' : 'row-reverse',
    }}>
      {/* Outer mini tombstone shard rail */}
      <MiniShardRail/>
      {/* Main rounded applet panel */}
      <AppletPanel onLaunch={onLaunch}/>
    </div>
  );
}

function MiniShardRail() {
  const cards = [
    { code:'0502', name:'OR01', label:'ORACLE',   fcn:'2501' },
    { code:'0504', name:'FG02', label:'FORGE',    fcn:'2501' },
    { code:'0506', name:'SC03', label:'SCRIBE',   fcn:'2501' },
    { code:'0508', name:'SY04', label:'SENTRY',   fcn:'2501' },
    { code:'0510', name:'EC05', label:'ECHO',     fcn:'2501' },
    { code:'0512', name:'CP06', label:'CIPHER',   fcn:'2501' },
  ];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 6, paddingTop: 4 }}>
      {cards.map((c,i) => <MiniShardCard key={i} card={c} accent={i===0}/>)}
    </div>
  );
}

function MiniShardCard({ card, accent }) {
  return (
    <div style={{ position:'relative' }}>
      <div className="bevel" style={{
        width: 70, padding: '5px 7px 6px',
        clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
        background: accent
          ? 'linear-gradient(180deg, #2b3138 0%, #1a1e23 100%)'
          : undefined,
        borderLeft: accent ? '2px solid var(--accent)' : undefined,
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize: 7.5, letterSpacing:'0.12em', color: accent?'var(--accent)':'var(--ink-3)' }}>
            {card.code}
          </span>
          <span style={{ fontSize: 9, color: accent?'var(--accent)':'var(--ink-3)' }}>⌖</span>
        </div>
        <div style={{ fontFamily:'var(--font-display)', fontSize: 14, fontWeight: 700, color:'var(--ink-1)', letterSpacing:'0.02em', lineHeight: 1, marginTop: 2 }}>
          {card.name}
        </div>
        <div className="chrome" style={{ fontFamily:'var(--font-mono)', fontSize: 6, color:'var(--ink-3)', marginTop: 1, lineHeight: 1.2 }}>
          8847740·225·02<br/>22·8820552<br/>002715
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginTop: 4 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize: 8.5, fontWeight: 600, color:'var(--ink-1)', letterSpacing:'0.06em' }}>
            {card.label}
          </span>
          <span className="chrome" style={{ fontFamily:'var(--font-mono)', fontSize: 6.5, color:'var(--ink-3)' }}>
            FCN {card.fcn}
          </span>
        </div>
      </div>
    </div>
  );
}

function AppletPanel({ onLaunch }) {
  const apps = [
    { id:'oracle',  glyph:'◐', label:'ORACLE',   fcn:'2502 305 20' },
    { id:'forge',   glyph:'▲', label:'FORGE',    fcn:'4492 277 08' },
    { id:'scribe',  glyph:'✎', label:'SCRIBE',   fcn:'8023 442 05' },
    { id:'atlas',   glyph:'◈', label:'ATLAS',    fcn:'8023 442 05' },
    { id:'echo',    glyph:'⌒', label:'ECHO',     fcn:'3282 615 04' },
    { id:'cipher',  glyph:'▣', label:'CIPHER',   fcn:'6488 282 03' },
    { id:'sentry',  glyph:'⌬', label:'SENTRY',   fcn:'5020 802 02' },
    { id:'sandbox', glyph:'▢', label:'SANDBOX',  fcn:'8230 392 01' },
  ];
  return (
    <div style={{
      flex: 1,
      display:'flex', flexDirection:'column',
      gap: 8,
    }}>
      {/* Panel container with notched corners */}
      <div className="bevel" style={{
        flex: 1, padding: 10,
        clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 16px 100%, 0 calc(100% - 16px), 0 16px)',
        border: '1px solid rgba(111, 217, 232, 0.28)',
        display:'flex', flexDirection:'column', gap: 6,
        position:'relative',
      }}>
        {/* header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding: '0 4px 6px', borderBottom: '1px solid var(--hairline)' }}>
          <span className="t-label" style={{ color:'var(--accent)' }}>データベース</span>
          <span className="t-meta chrome">DB · 304/24</span>
        </div>

        {/* Telemetry sparkline */}
        <Sparkline/>

        {/* App rows */}
        <div className="t-label" style={{ marginTop: 4, paddingLeft: 4 }}>APPLETS</div>
        <div style={{ display:'flex', flexDirection:'column', gap: 5, flex: 1, overflow:'auto' }}>
          {apps.map((a,i) => <AppRow key={i} app={a} active={i===0} onLaunch={onLaunch}/>)}
        </div>

        {/* footer */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop: 6, borderTop:'1px solid var(--hairline)' }}>
          <span className="t-label">DATABASE</span>
          <span className="t-meta chrome">FCN 002 202 926 21 001</span>
        </div>
      </div>

      {/* Knobs + switches strip */}
      <KnobsStrip/>
    </div>
  );
}

function AppRow({ app, active, onLaunch }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={() => onLaunch?.(app.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display:'flex', alignItems:'center', gap: 10,
        padding: '6px 10px',
        borderRadius: 6,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline-strong)'}`,
        background: active
          ? 'linear-gradient(90deg, rgba(111,217,232,0.08), rgba(111,217,232,0.02))'
          : (hover ? 'rgba(255,255,255,0.025)' : 'transparent'),
        boxShadow: active ? 'inset 0 0 0 1px rgba(111,217,232,0.15), 0 0 8px rgba(111,217,232,0.18)' : 'none',
        cursor:'pointer',
        transition: 'background .15s',
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: '50%',
        display:'grid', placeItems:'center',
        background: 'linear-gradient(180deg, #2c3239 0%, #181c20 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.6)',
      }}>
        <span style={{
          fontFamily:'var(--font-display)', fontSize: 14,
          color: active ? 'var(--accent)' : 'var(--ink-1)',
          textShadow: active ? '0 0 8px rgba(111,217,232,0.6)' : 'none',
        }}>{app.glyph}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-data" style={{ color: active ? 'var(--ink-1)' : 'var(--ink-2)', fontWeight: 600, letterSpacing: '0.08em' }}>
          {app.label}
        </div>
        <div className="t-meta chrome">FCN {app.fcn}</div>
      </div>
      <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--ink-3)' }}>⌖</span>
    </div>
  );
}

function Sparkline() {
  // simulated waveform
  const pts = React.useMemo(() => {
    const a = [];
    for (let i = 0; i < 48; i++) {
      a.push(0.5 + 0.4 * Math.sin(i*0.35) + 0.12 * Math.sin(i*0.9 + 1.2));
    }
    return a;
  }, []);
  const path = pts.map((y,i) => `${i===0?'M':'L'} ${(i/(pts.length-1))*100} ${(1-y)*100}`).join(' ');
  return (
    <div className="recessed" style={{ padding: '6px 8px', borderRadius: 3 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 2 }}>
        <span className="t-label chrome" style={{ color:'var(--ink-3)' }}>PROTOCOL 2204 00A</span>
        <span className="t-label chrome" style={{ color:'var(--ink-3)' }}>DEEP DIVE WAVE</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 52, display:'block' }}>
        <defs>
          <linearGradient id="grad-line" x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent)"/>
            <stop offset="1" stopColor="var(--accent-strong)"/>
          </linearGradient>
        </defs>
        {/* grid */}
        {Array.from({length:5}).map((_,i)=>(
          <line key={i} x1="0" x2="100" y1={i*25} y2={i*25} stroke="rgba(255,255,255,0.07)" strokeWidth="0.4"/>
        ))}
        <path d={path} fill="none" stroke="url(#grad-line)" strokeWidth="1.2" vectorEffect="non-scaling-stroke"
              style={{ filter: 'drop-shadow(0 0 2px var(--accent))' }}/>
      </svg>
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <span className="t-meta chrome">8820183 · 320 · 02</span>
      </div>
    </div>
  );
}

function KnobsStrip() {
  // The bevelled trough with two recessed knobs + a small switch
  return (
    <div className="bevel" style={{
      height: 50,
      borderRadius: 24,
      padding: '0 14px',
      display:'flex', alignItems:'center', gap: 12,
    }}>
      {/* recessed double-knob trough */}
      <div className="recessed" style={{
        height: 28, padding: '0 8px', borderRadius: 14,
        display:'flex', alignItems:'center', gap: 10,
      }}>
        <Knob value={0.7}/>
        <Knob value={0.45}/>
        <span style={{ width: 4, height: 4, borderRadius:'50%', background: 'var(--accent)', boxShadow:'var(--accent-glow)' }}/>
      </div>
      <div style={{ flex: 1 }}/>
      {/* LEDs */}
      <div style={{ display:'flex', gap: 6 }}>
        <Led on color="var(--accent)"/>
        <Led on color="var(--accent)"/>
        <Led/>
      </div>
      {/* toggle pill */}
      <Switch on/>
    </div>
  );
}

function Knob({ value = 0.5 }) {
  const a = -135 + value * 270;
  return (
    <div style={{
      width: 18, height: 18, borderRadius:'50%',
      background:'radial-gradient(circle at 35% 30%, #3a414a 0%, #20242a 60%, #14181d 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.7), 0 1px 1px rgba(0,0,0,0.6)',
      position:'relative',
    }}>
      <span style={{
        position:'absolute', top: 2, left: '50%', width: 1.5, height: 5,
        transform: `translateX(-50%) rotate(${a}deg)`,
        transformOrigin: '50% 7px',
        background: 'var(--accent)',
        boxShadow: '0 0 4px var(--accent)',
      }}/>
    </div>
  );
}

function Led({ on, color = 'rgba(255,255,255,0.2)' }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: on ? color : 'rgba(0,0,0,0.6)',
      boxShadow: on ? `0 0 6px ${color}, inset 0 0 1px rgba(255,255,255,0.5)` : 'inset 0 1px 1px rgba(0,0,0,0.6)',
    }}/>
  );
}

function Switch({ on }) {
  return (
    <div className="recessed" style={{
      width: 34, height: 18, borderRadius: 9,
      position:'relative', padding: 2,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius:'50%',
        background: 'linear-gradient(180deg, #3a414a, #20242a)',
        boxShadow:'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.6)',
        transform: `translateX(${on ? 16 : 0}px)`,
        transition: 'transform .2s',
      }}>
        <span style={{
          position:'absolute', top: 7, [on?'right':'left']: 5,
          width: 4, height: 4, borderRadius:'50%',
          background: on ? 'var(--accent)' : 'rgba(0,0,0,0.6)',
          boxShadow: on ? '0 0 4px var(--accent)' : 'none',
        }}/>
      </div>
    </div>
  );
}

window.SidePanel = SidePanel;
