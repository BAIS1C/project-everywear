import { useTheme, type Theme } from '../shell/ThemeContext';

const THEMES: { id: Theme; name: string; desc: string }[] = [
  { id: 'light', name: 'Light', desc: 'Off-cream daytime desktop' },
  { id: 'classic', name: 'Classic', desc: 'Default cyan dark desktop' },
  { id: 'refined', name: 'Refined', desc: 'Calmer steel-blue geometry' },
  { id: 'terminal', name: 'Terminal', desc: 'Monospace industrial console' },
];

export function SettingsPanel() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="ew-settings">
      <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
        Settings
      </h2>

      <div className="ew-section">
        <div className="ew-section__title">Appearance</div>

        <div style={{ marginBottom: 20 }}>
          <label className="ew-field__label">Theme</label>
          <div className="ew-settings__skin-grid">
            {THEMES.map((s) => (
              <div
                key={s.id}
                className={`ew-settings__skin-option ${theme === s.id ? 'ew-settings__skin-option--active' : ''}`}
                onClick={() => setTheme(s.id)}
              >
                <div className="ew-settings__skin-name">{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ew-text-faint)', marginTop: 4 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
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
