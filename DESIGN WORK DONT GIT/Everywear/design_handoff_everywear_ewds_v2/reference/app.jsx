// app.jsx — Everywear desktop shell root
// Wires theme/accent/dock/widget tweaks and renders the desktop

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "graphite",
  "accent": "cyan",
  "trafficSide": "left",
  "chromeDensity": 0.65,
  "dockMode": "desktop",
  "wallpaperIntensity": 0.65,
  "showClock": true,
  "showWeather": false,
  "showSystem": true,
  "showLocation": true,
  "showTombstones": false,
  "showAppWindow": true,
  "fakeToasts": true
}/*EDITMODE-END*/;

const DESKTOP_ICONS = [
  { id:'oracle',  glyph:'◐', label:'ORACLE',   code:'AI-2204', tone:'#22303a', accent:'rgba(111,217,232,0.6)' },
  { id:'forge',   glyph:'▲', label:'FORGE',    code:'IM-3318', tone:'#322a22', accent:'rgba(232,162,111,0.6)' },
  { id:'scribe',  glyph:'◇', label:'SCRIBE',   code:'TX-4402', tone:'#26303a', accent:'rgba(155,240,106,0.5)' },
  { id:'sentry',  glyph:'⌬', label:'SENTRY',   code:'SY-5510', tone:'#2a2a32', accent:'rgba(232,95,85,0.5)'  },
  { id:'echo',    glyph:'⌒', label:'ECHO',     code:'VC-6612', tone:'#252b32', accent:'rgba(111,217,232,0.5)' },
  { id:'cipher',  glyph:'▣', label:'CIPHER',   code:'CR-7715', tone:'#2c2530', accent:'rgba(168,236,245,0.5)' },
  { id:'atlas',   glyph:'◈', label:'ATLAS',    code:'GE-8820', tone:'#28323a', accent:'rgba(111,217,232,0.5)' },
  { id:'sandbox', glyph:'▢', label:'SANDBOX',  code:'SB-9921', tone:'#2a2a2a', accent:'rgba(255,255,255,0.4)' },
];

const DOCK_ITEMS = [
  { id:'oracle',  glyph:'◐', label:'ORACLE',   active: true, badge: '7' },
  { id:'forge',   glyph:'▲', label:'FORGE'   },
  { id:'scribe',  glyph:'◇', label:'SCRIBE'  },
  { id:'sentry',  glyph:'⌬', label:'SENTRY'  },
  { id:'cipher',  glyph:'▣', label:'CIPHER'  },
  { id:'settings',glyph:'⚙', label:'SETTINGS' },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme + accent + density to :root
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.theme);
    root.setAttribute('data-accent', t.accent);
    root.style.setProperty('--chrome-density', t.chromeDensity);
  }, [t.theme, t.accent, t.chromeDensity]);

  // Toasts demo
  const [toasts, setToasts] = React.useState([]);
  const seedRef = React.useRef(1);
  const addToast = (kind, payload) => {
    const id = seedRef.current++;
    setToasts(arr => [...arr, { id, kind, ...payload }]);
    const ttl = kind === 'info' ? 4200 : 6000;
    setTimeout(() => setToasts(arr => arr.filter(x => x.id !== id)), ttl);
  };
  const dismissToast = (id) => setToasts(arr => arr.filter(x => x.id !== id));

  // Demo toast cadence
  React.useEffect(() => {
    if (!t.fakeToasts) return;
    const seq = [
      { kind:'info',   payload:{ label:'NET', code:'EW-2204', text:'Local node handshake stabilised.', color:'var(--accent)' }, at: 900 },
      { kind:'system', payload:{ label:'PROTOCOL DRIVER', code:'SR-4150', text:'Oracle-7B mounted to RAM. 4.2 GB allocated.', serial:'DS4-1774822-5', color:'var(--warn)' }, at: 2400 },
      { kind:'info',   payload:{ label:'WIDGET', code:'WG-0118', text:'Atmos shard data refreshed.', color:'var(--ok)' }, at: 4200 },
    ];
    const timers = seq.map(s => setTimeout(() => addToast(s.kind, s.payload), s.at));
    return () => timers.forEach(clearTimeout);
  }, [t.fakeToasts, t.theme]);

  // App window state
  const [windowOpen, setWindowOpen] = React.useState(true);
  React.useEffect(() => { setWindowOpen(t.showAppWindow); }, [t.showAppWindow]);

  const dockPos = ({
    desktop: 'hidden',
    'dock-bottom': 'bottom',
    'dock-top': 'top',
    'panel-left': 'hidden',
    'panel-right': 'hidden',
  })[t.dockMode] || 'hidden';

  // chrome density var also affects wallpaper grain
  React.useEffect(() => {
    document.documentElement.style.setProperty('--wallpaper-intensity', t.wallpaperIntensity);
  }, [t.wallpaperIntensity]);

  const trigger = (which) => {
    const map = {
      info:   { kind:'info',   payload:{ label:'INFO', text:'Manual toast fired.', color:'var(--accent)' } },
      ok:     { kind:'info',   payload:{ label:'OK', text:'Action completed successfully.', color:'var(--ok)' } },
      warn:   { kind:'system', payload:{ label:'WARN', text:'Memory bank approaching threshold (78%).', color:'var(--warn)', serial:'WR-2210-3' } },
      crit:   { kind:'system', payload:{ label:'CRITICAL', text:'Disk write integrity check failed.', color:'var(--crit)', serial:'CR-9933-1' } },
    };
    addToast(map[which].kind, map[which].payload);
  };

  return (
    <>
      <div className="ew-wallpaper" style={{ opacity: 1 }}>
        {/* extra hairline grid for high chrome density */}
        {t.chromeDensity > 0.4 && (
          <svg style={{ position:'absolute', inset: 0, width:'100%', height:'100%', opacity: 0.06 * t.chromeDensity }}>
            <defs>
              <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="white" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)"/>
          </svg>
        )}
        {/* corner registration marks */}
        <CornerMarks/>
      </div>

      <MenuBar
        trafficSide={t.trafficSide}
        onTrafficClick={(k) => k==='close' && setWindowOpen(false)}
      />

      {/* Desktop icon grid (default Everywear layout) — always left-anchored */}
      {t.dockMode === 'desktop' && (
        <DesktopIcons items={DESKTOP_ICONS} onLaunch={() => setWindowOpen(true)}/>
      )}

      {/* Side widget panel (informed by EWDS evolution reference) */}
      {(t.dockMode === 'panel-left' || t.dockMode === 'panel-right') && (
        <SidePanel
          side={t.dockMode === 'panel-left' ? 'left' : 'right'}
          onLaunch={() => setWindowOpen(true)}
        />
      )}

      {/* Widget shards floating on the desktop */}
      <WidgetField t={t}/>

      {/* AI applet window */}
      {windowOpen && (
        <AppWindow
          title="ORACLE-7B"
          subtitle="LOCAL · AI ASSISTANT"
          trafficSide={t.trafficSide}
          width={720} height={520}
          x={240}
          y={86}
          onClose={() => setWindowOpen(false)}
        >
          <ChatApplet/>
        </AppWindow>
      )}

      {/* Rocket dock / side rail when enabled */}
      <Dock
        position={dockPos}
        items={DOCK_ITEMS}
        onLaunch={() => setWindowOpen(true)}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast}/>

      <TweaksPanel>
        <TweakSection label="Theme"/>
        <TweakRadio label="Surface" value={t.theme}
          options={['graphite','anodized','carbon']}
          onChange={v => setTweak('theme', v)}/>
        <TweakRadio label="Accent" value={t.accent}
          options={['cyan','amber','acid','crimson','bone']}
          onChange={v => setTweak('accent', v)}/>
        <TweakSlider label="Chrome density" value={t.chromeDensity} min={0} max={1} step={0.05}
          onChange={v => setTweak('chromeDensity', v)}/>
        <TweakSlider label="Wallpaper grain" value={t.wallpaperIntensity} min={0} max={1} step={0.05}
          onChange={v => setTweak('wallpaperIntensity', v)}/>

        <TweakSection label="Layout"/>
        <TweakSelect label="App launcher" value={t.dockMode}
          options={[
            { value:'desktop', label:'Desktop icons (default)' },
            { value:'dock-bottom', label:'Rocket dock — bottom' },
            { value:'dock-top', label:'Rocket dock — top' },
            { value:'panel-left', label:'Side widget panel — left' },
            { value:'panel-right', label:'Side widget panel — right' },
          ]}
          onChange={v => setTweak('dockMode', v)}/>
        <TweakRadio label="Traffic lights" value={t.trafficSide}
          options={['left','right']}
          onChange={v => setTweak('trafficSide', v)}/>

        <TweakSection label="Widgets"/>
        <TweakToggle label="Chrono shard" value={t.showClock} onChange={v => setTweak('showClock', v)}/>
        <TweakToggle label="Atmos shard" value={t.showWeather} onChange={v => setTweak('showWeather', v)}/>
        <TweakToggle label="System shard" value={t.showSystem} onChange={v => setTweak('showSystem', v)}/>
        <TweakToggle label="Weather report" value={t.showLocation} onChange={v => setTweak('showLocation', v)}/>
        <TweakToggle label="Tombstones" value={t.showTombstones} onChange={v => setTweak('showTombstones', v)}/>

        <TweakSection label="Applet"/>
        <TweakToggle label="Show Oracle window" value={t.showAppWindow}
          onChange={v => setTweak('showAppWindow', v)}/>

        <TweakSection label="Toast test"/>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 6 }}>
          <TweakButton label="Info"     onClick={() => trigger('info')}/>
          <TweakButton label="OK"       onClick={() => trigger('ok')}/>
          <TweakButton label="Warn"     onClick={() => trigger('warn')}/>
          <TweakButton label="Critical" onClick={() => trigger('crit')}/>
        </div>
        <TweakToggle label="Boot toast sequence" value={t.fakeToasts}
          onChange={v => setTweak('fakeToasts', v)}/>
      </TweaksPanel>
    </>
  );
}

function CornerMarks() {
  const m = (s) => ({
    position:'absolute', width: 18, height: 18,
    ...s,
  });
  return (
    <>
      <svg style={m({ top: 44, left: 14 })} viewBox="0 0 18 18"><path d="M0 6 L0 0 L6 0" stroke="rgba(255,255,255,0.18)" strokeWidth="1" fill="none"/></svg>
      <svg style={m({ top: 44, right: 14 })} viewBox="0 0 18 18"><path d="M18 6 L18 0 L12 0" stroke="rgba(255,255,255,0.18)" strokeWidth="1" fill="none"/></svg>
      <svg style={m({ bottom: 14, left: 14 })} viewBox="0 0 18 18"><path d="M0 12 L0 18 L6 18" stroke="rgba(255,255,255,0.18)" strokeWidth="1" fill="none"/></svg>
      <svg style={m({ bottom: 14, right: 14 })} viewBox="0 0 18 18"><path d="M18 12 L18 18 L12 18" stroke="rgba(255,255,255,0.18)" strokeWidth="1" fill="none"/></svg>
      {/* vertical serial along right edge */}
      <div style={{
        position:'absolute', right: 18, top: '50%', transform:'translateY(-50%) rotate(180deg)',
        writingMode:'vertical-rl', fontFamily:'var(--font-mono)', fontSize: 9,
        letterSpacing:'0.3em', color: 'rgba(255,255,255,0.18)'
      }}>EVERYWEAR · EWDS-V2 · NODE-A · 8820183·320·02</div>
      {/* corner barcode bottom-left */}
      <div style={{ position:'absolute', bottom: 24, left: 26, opacity: 0.5 }}>
        <Barcode seed={88} width={140} height={18}/>
        <div className="t-meta" style={{ color: 'rgba(255,255,255,0.25)', marginTop: 4, letterSpacing: '0.2em' }}>
          EW · 2204 · 00A · DEEP DIVE WAVE · REV 0.0
        </div>
      </div>
    </>
  );
}

function WidgetField({ t }) {
  // Right-anchored stack
  return (
    <div style={{
      position:'absolute', right: 24, top: 60,
      display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 16,
      zIndex: 4,
    }}>
      {t.showClock && <ClockShard/>}
      {t.showWeather && <WeatherShard/>}
      {t.showSystem && <SystemShard/>}
      {t.showLocation && <WeatherReport/>}
      {t.showTombstones && (
        <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
          <TombstoneShard label="TOKENS" code="TK-0119" kind="info" value="48.2k" subtitle="DAY · ORACLE-7B"/>
          <TombstoneShard label="UPTIME" code="UP-0440" kind="info" value="14d 02h" subtitle="LOCAL NODE · SR-4150"/>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
