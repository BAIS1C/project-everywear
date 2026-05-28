// components/widgets.jsx
// Desktop widget shards: clock face, weather, system, oblique tombstones, hex apps

function Barcode({ seed = 42, width = 80, height = 16 }) {
  // deterministic-ish bars
  const bars = React.useMemo(() => {
    const arr = []; let s = seed;
    for (let i = 0; i < 24; i++) {
      s = (s * 9301 + 49297) % 233280;
      const w = 1 + (s % 4);
      arr.push(w);
    }
    return arr;
  }, [seed]);
  return (
    <div className="barcode" style={{ width, height }}>
      {bars.map((b,i) => <i key={i} style={{ width: b, opacity: (i%5)===0?0.4:1 }}/>)}
    </div>
  );
}
function Serial({ prefix = 'EW', n }) {
  const code = `${prefix}-${String(n||(Math.random()*99999)|0).padStart(5,'0')}/${(Math.random()*99|0)}`;
  return <span className="t-meta" style={{ letterSpacing: '0.12em' }}>{code}</span>;
}
function Corners({ size = 8, color = 'var(--ink-3)' }) {
  const s = { position: 'absolute', width: size, height: size, borderColor: color };
  return (
    <>
      <span style={{ ...s, top: 4, left: 4, borderTop: '1px solid', borderLeft: '1px solid' }}/>
      <span style={{ ...s, top: 4, right: 4, borderTop: '1px solid', borderRight: '1px solid' }}/>
      <span style={{ ...s, bottom: 4, left: 4, borderBottom: '1px solid', borderLeft: '1px solid' }}/>
      <span style={{ ...s, bottom: 4, right: 4, borderBottom: '1px solid', borderRight: '1px solid' }}/>
    </>
  );
}

/* shard wrapper applies drop-shadow filter; inner gets bevel + clip-path */
function ShardWrap({ children, style }) {
  return (
    <div style={{
      filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.6)) drop-shadow(0 16px 30px rgba(0,0,0,0.55)) drop-shadow(0 32px 60px rgba(0,0,0,0.35))',
      ...style,
    }}>{children}</div>
  );
}

/* ================= CLOCK SHARD (hexagonal) ================= */
function ClockShard() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const pad = (n) => String(n).padStart(2,'0');
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  // analog hands
  const ha = (h%12)/12*360 + m/60*30;
  const ma = m*6 + s*0.1;
  const sa = s*6;
  return (
    <ShardWrap>
    <div className="bevel-strong" style={widgetStyles.shardHex}>
      <Corners/>
      <div style={widgetStyles.hexInner}>
        <div style={widgetStyles.clockHeader}>
          <span className="t-label">⌬ CHRONO/01</span>
          <span className="t-label chrome" style={{ color: 'var(--accent)' }}>SYNCED</span>
        </div>
        <div style={widgetStyles.clockFace} className="recessed">
          <svg viewBox="0 0 120 120" width="100%" height="100%">
            {/* tick marks */}
            {Array.from({length: 60}).map((_,i) => {
              const big = i%5===0;
              const a = (i*6) * Math.PI/180;
              const r1 = big ? 50 : 53;
              const r2 = 56;
              return <line key={i}
                x1={60 + Math.sin(a)*r1} y1={60 - Math.cos(a)*r1}
                x2={60 + Math.sin(a)*r2} y2={60 - Math.cos(a)*r2}
                stroke={big?'var(--ink-2)':'var(--ink-4)'} strokeWidth={big?1.2:0.7}/>;
            })}
            {/* hands */}
            <line x1="60" y1="60" x2={60+Math.sin(ha*Math.PI/180)*28} y2={60-Math.cos(ha*Math.PI/180)*28} stroke="var(--ink-1)" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="60" y1="60" x2={60+Math.sin(ma*Math.PI/180)*42} y2={60-Math.cos(ma*Math.PI/180)*42} stroke="var(--ink-1)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="60" y1="60" x2={60+Math.sin(sa*Math.PI/180)*46} y2={60-Math.cos(sa*Math.PI/180)*46} stroke="var(--accent)" strokeWidth="0.8" strokeLinecap="round"/>
            <circle cx="60" cy="60" r="2.5" fill="var(--accent)"/>
          </svg>
        </div>
        <div style={widgetStyles.clockDigi}>
          <span className="t-display" style={{ fontSize: 22, color: 'var(--ink-1)' }}>
            {pad(h)}:{pad(m)}<span style={{ color: 'var(--accent)' }}>:{pad(s)}</span>
          </span>
          <span className="t-meta chrome">UTC+0 · TZ-LOCAL</span>
        </div>
        <div className="chrome" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 6 }}>
          <Barcode seed={s} width={70}/>
          <Serial prefix="CH" n={2204}/>
        </div>
      </div>
    </div>
    </ShardWrap>
  );
}

/* ================= WEATHER SHARD (circle) ================= */
function WeatherShard() {
  return (
    <ShardWrap>
    <div className="bevel-strong" style={widgetStyles.shardCircle}>
      <div style={widgetStyles.circleInner}>
        <div style={{ position:'absolute', top: 12, left: 14, right: 14, display:'flex', justifyContent:'space-between' }}>
          <span className="t-label">◐ ATMOS/02</span>
          <span className="t-label chrome">気象</span>
        </div>
        <div style={{ position:'absolute', inset: 20, borderRadius:'50%' }} className="recessed">
          <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center' }}>
            <div style={{ textAlign:'center' }}>
              <div className="t-display" style={{ fontSize: 30, color: 'var(--ink-1)', lineHeight: 1 }}>14°</div>
              <div className="t-meta" style={{ marginTop: 4 }}>OVERCAST</div>
              <div style={{ display:'flex', gap: 8, justifyContent:'center', marginTop: 8 }}>
                <Mini label="H" val="17°"/>
                <Mini label="L" val="9°"/>
                <Mini label="RH" val="74"/>
              </div>
            </div>
          </div>
          {/* arc ticks */}
          <svg viewBox="0 0 100 100" style={{ position:'absolute', inset:0 }}>
            {Array.from({length:24}).map((_,i)=>{
              const a = (i*15-90) * Math.PI/180;
              return <line key={i}
                x1={50+Math.cos(a)*46} y1={50+Math.sin(a)*46}
                x2={50+Math.cos(a)*49} y2={50+Math.sin(a)*49}
                stroke={i%6===0?'var(--accent)':'var(--ink-4)'} strokeWidth={i%6===0?1.2:0.6}/>;
            })}
          </svg>
        </div>
        <div className="chrome" style={{ position:'absolute', bottom: 8, left: 0, right: 0, display:'flex', justifyContent:'center', gap: 12 }}>
          <Serial prefix="ATM" n={487}/>
        </div>
      </div>
    </div>
    </ShardWrap>
  );
}
function Mini({ label, val }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
      <span className="t-label">{label}</span>
      <span className="t-data">{val}</span>
    </div>
  );
}

/* ================= SYSTEM SHARD (polygon) ================= */
function SystemShard() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(()=>{ const id = setInterval(()=>setTick(t=>t+1), 1500); return ()=>clearInterval(id); },[]);
  const cpu = 12 + ((tick*7)%34);
  const ram = 38 + ((tick*3)%18);
  const dsk = 67;
  const net = 2 + ((tick*11)%14);
  return (
    <ShardWrap>
    <div className="bevel-strong" style={widgetStyles.shardPoly}>
      <Corners/>
      <div style={{ padding: 14, paddingTop: 18 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 12 }}>
          <div>
            <div className="t-label" style={{ color:'var(--accent)' }}>▲ SYSTEM/03</div>
            <div className="t-data" style={{ marginTop: 2 }}>LOCAL · NODE-A</div>
          </div>
          <span className="t-meta chrome">SR-4150</span>
        </div>
        <Stat label="CPU" val={cpu} unit="%"/>
        <Stat label="MEM" val={ram} unit="%" accent/>
        <Stat label="DSK" val={dsk} unit="%"/>
        <Stat label="NET" val={net} unit="mb/s"/>
        <div className="chrome" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 10 }}>
          <Barcode seed={tick} width={90}/>
          <Serial prefix="SYS" n={829412}/>
        </div>
      </div>
    </div>
    </ShardWrap>
  );
}
function Stat({ label, val, unit, accent }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 8, margin: '6px 0' }}>
      <span className="t-label" style={{ width: 28 }}>{label}</span>
      <div className="recessed" style={{ flex: 1, height: 8, borderRadius: 2, overflow: 'hidden', position:'relative' }}>
        <div style={{
          height: '100%', width: `${val}%`,
          background: accent
            ? 'linear-gradient(90deg, var(--accent), var(--accent-strong))'
            : 'linear-gradient(90deg, #5a626c, #8a939d)',
          boxShadow: accent ? 'var(--accent-glow)' : 'none',
          transition: 'width .8s'
        }}/>
      </div>
      <span className="t-data" style={{ width: 50, textAlign:'right', color: accent?'var(--accent)':'var(--ink-1)' }}>{val}{unit}</span>
    </div>
  );
}

/* ================= TOMBSTONE WIDGETS ================= */
function TombstoneShard({ label, code, kind, value, subtitle }) {
  const isWarn = kind === 'warn';
  return (
    <div className="bevel-strong shard shard-tomb" style={widgetStyles.tomb}>
      <div style={{ display:'flex', flexDirection: 'column', height: '100%', padding: '10px 14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span className="t-label" style={{ color: isWarn ? 'var(--warn)' : 'var(--accent)' }}>
            {isWarn ? '⚠' : '◇'} {label}
          </span>
          <span className="t-meta chrome">{code}</span>
        </div>
        <div style={{ flex: 1, display:'flex', alignItems:'center', justifyContent:'space-between', marginTop: 4 }}>
          <span className="t-display" style={{ fontSize: 20, color: 'var(--ink-1)' }}>{value}</span>
          <Barcode seed={code?.charCodeAt?.(0) ?? 9} width={60} height={12}/>
        </div>
        <div className="t-meta chrome" style={{ marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

/* ================= WEATHER REPORT (proper card, replaces Geo) ================= */
function WeatherReport() {
  const hours = [13, 14, 16, 17, 17, 15, 13, 12];
  const max = Math.max(...hours), min = Math.min(...hours);
  return (
    <ShardWrap>
    <div className="bevel-strong" style={widgetStyles.weatherReport}>
      <Corners/>
      <div style={{ padding: 14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div className="t-label" style={{ color:'var(--accent)' }}>◈ GEO/04 · WEATHER</div>
            <div className="t-data" style={{ marginTop: 4, color:'var(--ink-1)' }}>LONDON · SE1</div>
            <div className="t-meta" style={{ marginTop: 1 }}>51.5072°N · 0.1276°W</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div className="t-display" style={{ fontSize: 26, lineHeight: 1, color:'var(--ink-1)' }}>14°</div>
            <div className="t-meta" style={{ marginTop: 2 }}>FEELS 12°</div>
          </div>
        </div>

        {/* hourly bars */}
        <div className="recessed" style={{ marginTop: 10, padding: '8px 8px 4px', borderRadius: 3 }}>
          <div className="t-label" style={{ color:'var(--ink-3)', marginBottom: 4 }}>8H FORECAST</div>
          <div style={{ display:'flex', alignItems:'flex-end', gap: 4, height: 32 }}>
            {hours.map((h,i) => {
              const pct = (h - min + 1) / (max - min + 2);
              return (
                <div key={i} style={{ flex: 1, display:'flex', flexDirection:'column', alignItems:'center', gap: 2 }}>
                  <span style={{ fontSize: 8, fontFamily:'var(--font-mono)', color: i===0?'var(--accent)':'var(--ink-2)' }}>{h}°</span>
                  <div style={{
                    width: '100%', height: `${pct * 14 + 4}px`,
                    background: i===0
                      ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))'
                      : 'linear-gradient(180deg, #5a626c, #353b44)',
                    boxShadow: i===0 ? 'var(--accent-glow)' : 'none',
                  }}/>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
          <Mini label="WIND" val="12kt"/>
          <Mini label="HUM"  val="74%"/>
          <Mini label="PRES" val="998"/>
          <Mini label="AQI"  val="42"/>
        </div>

        <div className="chrome" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 8 }}>
          <Barcode seed={14} width={70} height={10}/>
          <Serial prefix="WTH" n={51072}/>
        </div>
      </div>
    </div>
    </ShardWrap>
  );
}

/* ================= TRI SHARD (location) ================= */
function LocationShard() {
  return (
    <div className="bevel-strong shard shard-tri" style={widgetStyles.tri}>
      <div style={{ padding: '14px 28px', textAlign:'center' }}>
        <div className="t-label" style={{ color:'var(--accent)' }}>▲ GEO/04</div>
        <div className="t-display" style={{ fontSize: 14, marginTop: 6, color:'var(--ink-1)' }}>
          51.5072°N · 0.1276°W
        </div>
        <div className="t-meta chrome" style={{ marginTop: 2 }}>LDN · GMT</div>
        <div className="chrome" style={{ display:'flex', justifyContent:'center', marginTop: 6 }}>
          <Barcode seed={51} width={80} height={10}/>
        </div>
      </div>
    </div>
  );
}

const widgetStyles = {
  shardHex: {
    width: 200, height: 240,
    clipPath: 'polygon(18% 0, 82% 0, 100% 14%, 100% 86%, 82% 100%, 18% 100%, 0 86%, 0 14%)',
    position: 'relative',
    padding: 12,
  },
  hexInner: { position:'relative', height:'100%', display:'flex', flexDirection:'column', gap: 8 },
  clockHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding: '0 4px' },
  clockFace: { aspectRatio: '1', borderRadius:'50%', padding: 6, alignSelf:'center', width: 110 },
  clockDigi: { display:'flex', flexDirection:'column', alignItems:'center' },

  shardCircle: {
    width: 200, height: 200, borderRadius: '50%',
    position: 'relative',
  },
  circleInner: { position:'relative', height: '100%' },

  shardPoly: {
    width: 220, height: 220,
    clipPath: 'polygon(0 12px, 12px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)',
    position:'relative',
  },
  weatherReport: {
    width: 220, height: 230,
    clipPath: 'polygon(0 12px, 12px 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 14px 100%, 0 calc(100% - 14px))',
    background: 'var(--surface-2)',
  },
  tomb: {
    width: 200, height: 78,
    background: 'var(--surface-2)',
  },
  tri: {
    width: 200, height: 96,
    background: 'var(--surface-2)',
  },
};

Object.assign(window, { ClockShard, WeatherShard, WeatherReport, SystemShard, TombstoneShard, LocationShard, Barcode, Serial, Corners });
