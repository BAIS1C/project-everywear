// components/toasts.jsx — two flavors
// 'info' = oblique-cut sliver, top-right
// 'system' = tombstone card, bottom-center

function ToastStack({ toasts, onDismiss }) {
  const info = toasts.filter(t => t.kind === 'info');
  const sys  = toasts.filter(t => t.kind === 'system');
  return (
    <>
      <div style={{ position:'fixed', top: 56, right: 18, display:'flex', flexDirection:'column', gap: 8, zIndex: 200 }}>
        {info.map(t => <ObliqueToast key={t.id} t={t} onDismiss={() => onDismiss?.(t.id)}/>)}
      </div>
      <div style={{ position:'fixed', bottom: 130, left: '50%', transform:'translateX(-50%)', display:'flex', flexDirection:'column', gap: 10, zIndex: 200 }}>
        {sys.map(t => <TombstoneToast key={t.id} t={t} onDismiss={() => onDismiss?.(t.id)}/>)}
      </div>
    </>
  );
}

function ObliqueToast({ t, onDismiss }) {
  return (
    <div className="bevel" style={{
      width: 340, padding: '10px 16px',
      clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 100%, 14px 100%)',
      animation: 'toast-in-right .35s cubic-bezier(.2,.8,.2,1) both',
      display:'flex', alignItems:'center', gap: 12,
    }}>
      <span style={{
        width: 6, height: 28, background: t.color || 'var(--accent)',
        boxShadow: `0 0 10px ${t.color || 'var(--accent)'}`
      }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
          <span className="t-label" style={{ color: t.color || 'var(--accent)' }}>◇ {t.label || 'INFO'}</span>
          <span className="t-meta chrome">· {t.code || 'EW-2204'}</span>
        </div>
        <div className="t-data" style={{ color:'var(--ink-1)', marginTop: 2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {t.text}
        </div>
      </div>
      <span onClick={onDismiss} className="t-label" style={{ cursor:'pointer', color:'var(--ink-3)' }}>✕</span>
    </div>
  );
}

function TombstoneToast({ t, onDismiss }) {
  return (
    <div className="bevel-strong shard shard-tomb" style={{
      width: 460, padding: '14px 22px',
      background: 'var(--surface-2)',
      animation: 'toast-in-bottom .4s cubic-bezier(.2,.8,.2,1) both',
      display:'flex', alignItems:'center', gap: 14,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 4,
        display:'grid', placeItems:'center',
        background: 'linear-gradient(180deg, #2c3239 0%, #181c20 100%)',
        boxShadow:'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6)',
      }}>
        <span style={{ fontSize: 18, color: t.color || 'var(--warn)', textShadow: `0 0 8px ${t.color || 'var(--warn)'}` }}>⚠</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <span className="t-label" style={{ color: t.color || 'var(--warn)' }}>▲ {t.label || 'SYSTEM'}</span>
          <span className="t-meta chrome">PROTOCOL · {t.code || 'SR-4150'}</span>
        </div>
        <div className="t-data" style={{ color:'var(--ink-1)', marginTop: 3 }}>
          {t.text}
        </div>
      </div>
      <div className="chrome" style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 4 }}>
        <Barcode seed={t.id||1} width={70} height={12}/>
        <span className="t-meta">{t.serial || 'DS4-1774822-5'}</span>
      </div>
      <span onClick={onDismiss} className="t-label" style={{ cursor:'pointer', color:'var(--ink-3)', marginLeft: 4 }}>✕</span>
    </div>
  );
}

window.ToastStack = ToastStack;
