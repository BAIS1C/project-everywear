// components/applet-chat.jsx — mock AI chat applet (EWDS-styled)

function ChatApplet() {
  const [msgs, setMsgs] = React.useState([
    { role:'sys', text: 'EWDS-v2 RUNTIME INITIALIZED · MODEL: ORACLE-7B (LOCAL)' },
    { role:'user', text: 'Plot the difference between the graphite and anodized surface tokens.' },
    { role:'ai', text: 'Graphite emits a 16% top-bevel highlight against a 65% bottom shadow, producing photoreal recession. Anodized flattens the bevel to 10% with finer micro-noise — reads as machined-flat rather than honed. Tokens cross-fade on theme switch in ~250ms.' },
    { role:'user', text: 'Show me a system reading.' },
  ]);
  const [draft, setDraft] = React.useState('');

  return (
    <div style={chatStyles.wrap}>
      {/* left rail — sessions */}
      <div style={chatStyles.rail}>
        <div className="t-label" style={{ padding: '12px 14px', color: 'var(--accent)' }}>◇ SESSIONS</div>
        {['Surface tokens','Bevel theory','Shard geometry','Toast cadence'].map((s,i) => (
          <div key={i} style={{
            padding: '10px 14px',
            background: i===0 ? 'linear-gradient(90deg, rgba(111,217,232,0.08), transparent)' : 'transparent',
            borderLeft: i===0 ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer',
          }}>
            <div className="t-data" style={{ color: i===0?'var(--ink-1)':'var(--ink-2)' }}>{s}</div>
            <div className="t-meta">SESSION · {String(0x4a+i).toUpperCase()}{i}{i+3}</div>
          </div>
        ))}
        <div style={{ flex: 1 }}/>
        <div className="chrome" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
          <Barcode seed={7} width={60} height={10}/>
          <Serial prefix="ORC" n={2210}/>
        </div>
      </div>

      {/* main transcript */}
      <div style={chatStyles.main}>
        <div style={chatStyles.transcript}>
          {msgs.map((m,i) => <ChatBubble key={i} role={m.role} text={m.text}/>)}
          <ChatTyping/>
        </div>
        <div style={chatStyles.composer}>
          <div className="bevel" style={chatStyles.composerBox}>
            <span className="t-label" style={{ color: 'var(--accent)', padding: '0 10px' }}>▸</span>
            <div style={chatStyles.inputWell}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask the local oracle…"
                className="ew-input-bare"
                style={chatStyles.input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    setMsgs([...msgs, { role: 'user', text: draft }]);
                    setDraft('');
                  }
                }}
              />
            </div>
            <div className="chrome" style={{ padding: '0 10px', display:'flex', alignItems:'center', gap: 6 }}>
              <span className="t-meta">⌘+↵</span>
              <button style={chatStyles.sendBtn} onClick={() => { if(draft.trim()){ setMsgs([...msgs,{role:'user',text:draft}]); setDraft(''); } }}>
                <span className="t-label" style={{ color:'var(--bg-0)' }}>SEND</span>
              </button>
            </div>
          </div>
          <div className="chrome" style={{ display:'flex', justifyContent:'space-between', marginTop: 6 }}>
            <span className="t-meta">CTX 4,892 / 8,192 TOK · TEMP 0.7 · NODE-A</span>
            <span className="t-meta">SR-4150 · ENC AES-256</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ role, text }) {
  const isUser = role === 'user';
  const isSys = role === 'sys';
  if (isSys) {
    return (
      <div style={{ margin: '6px 0', display:'flex', justifyContent:'center' }}>
        <span className="t-label" style={{ color: 'var(--ink-3)', letterSpacing:'0.16em' }}>{text}</span>
      </div>
    );
  }
  return (
    <div style={{ display:'flex', justifyContent: isUser?'flex-end':'flex-start', margin: '12px 0' }}>
      <div style={{ maxWidth: '78%', display:'flex', flexDirection:'column', gap: 4 }}>
        <span className="t-label" style={{
          color: isUser ? 'var(--ink-3)' : 'var(--accent)',
          textAlign: isUser ? 'right' : 'left'
        }}>
          {isUser ? '◇ YOU' : '◐ ORACLE-7B'}
        </span>
        <div className={isUser ? 'bevel' : 'recessed'} style={{
          padding: '10px 14px',
          borderRadius: 6,
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          color: 'var(--ink-1)',
          lineHeight: 1.55,
          background: isUser
            ? 'linear-gradient(180deg, #2a3038 0%, #1c2026 100%)'
            : undefined,
          borderLeft: !isUser ? '2px solid var(--accent)' : undefined,
        }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function ChatTyping() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 8, margin: '8px 0' }}>
      <span className="t-label" style={{ color: 'var(--accent)' }}>◐ ORACLE-7B</span>
      <span style={{ display:'inline-flex', gap: 3 }}>
        {[0,1,2].map(i => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--accent)',
            animation: `typingDot 1.2s infinite ${i*0.18}s`,
            boxShadow: 'var(--accent-glow)'
          }}/>
        ))}
      </span>
      <span className="t-meta">streaming · 14 tok/s</span>
      <style>{`@keyframes typingDot { 0%, 60%, 100% { opacity: .25 } 30% { opacity: 1 } }`}</style>
    </div>
  );
}

const chatStyles = {
  wrap: { position:'absolute', inset:0, display:'flex' },
  rail: {
    width: 220,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.025), transparent)',
    borderRight: '1px solid var(--hairline-strong)',
    display:'flex', flexDirection:'column',
  },
  main: { flex: 1, display:'flex', flexDirection:'column' },
  transcript: { flex: 1, padding: '16px 22px', overflowY:'auto', overflowX:'hidden' },
  composer: { padding: '12px 18px 14px', borderTop: '1px solid var(--hairline)' },
  composerBox: {
    display:'flex', alignItems:'center',
    height: 44, borderRadius: 6,
    padding: '0 4px',
  },
  inputWell: {
    flex: 1, height: 28, display:'flex', alignItems:'center',
    background: 'linear-gradient(180deg, #0a0c0f 0%, #14181d 100%)',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(0,0,0,0.9)',
    border: '1px solid rgba(0,0,0,0.6)',
    borderRadius: 4,
    padding: '0 10px',
  },
  input: {
    flex: 1, height: '100%', background: 'transparent',
    border: 'none', outline: 'none',
    fontFamily: 'var(--font-ui)', fontSize: 13,
    color: '#e9ecef',
    caretColor: '#6fd9e8',
    padding: 0,
  },
  sendBtn: {
    background: 'linear-gradient(180deg, var(--accent-strong), var(--accent))',
    border: 'none',
    padding: '5px 10px',
    borderRadius: 3,
    cursor: 'pointer',
    boxShadow: 'var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.3)',
  },
};

window.ChatApplet = ChatApplet;
