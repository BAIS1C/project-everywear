import { useTheme, type Skin } from '../shell/ThemeContext';

const SKINS: { id: Skin; name: string; desc: string }[] = [
  { id: 'classic', name: 'Classic', desc: 'Clean modern aesthetic' },
  { id: 'refined', name: 'Refined', desc: 'Bevelled, angular geometry' },
  { id: 'terminal', name: 'Terminal', desc: 'Monospace, warm amber' },
];

export function SettingsPanel() {
  const { skin, setSkin, mode, toggleMode } = useTheme();

  return (
    <div className="ew-settings">
      <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
        Settings
      </h2>

      <div className="ew-section">
        <div className="ew-section__title">Appearance</div>

        <div style={{ marginBottom: 20 }}>
          <label className="ew-field__label">Skin</label>
          <div className="ew-settings__skin-grid">
            {SKINS.map((s) => (
              <div
                key={s.id}
                className={`ew-settings__skin-option ${skin === s.id ? 'ew-settings__skin-option--active' : ''}`}
                onClick={() => setSkin(s.id)}
              >
                <div className="ew-settings__skin-name">{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ew-text-faint)', marginTop: 4 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ew-field">
          <label className="ew-field__label">Mode</label>
          <button className="ew-btn ew-btn--ghost" onClick={toggleMode}>
            {mode === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </button>
        </div>
      </div>

      <div className="ew-section">
        <div className="ew-section__title">About</div>
        <div style={{ fontSize: 14, color: 'var(--ew-text-muted)', lineHeight: 1.8 }}>
          <div><strong style={{ color: 'var(--ew-text)' }}>Everywear OS</strong> v0.1.0</div>
          <div>PT Metafintek AI Studios</div>
          <div>Lombok, Indonesia</div>
          <div style={{ marginTop: 8 }}>
            <a
              href="https://everywear.id"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--ew-primary)', textDecoration: 'none' }}
            >
              everywear.id
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
