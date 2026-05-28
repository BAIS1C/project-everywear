import { useTheme, type Accent, type Theme, type WidgetSurface } from '@everywear/ewds';

const LIGHT_THEME: { id: Theme; name: string; desc: string } = {
  id: 'light',
  name: 'Light',
  desc: 'Off-cream daytime desktop',
};

const WIDGET_SURFACES: { id: WidgetSurface; name: string; desc: string }[] = [
  { id: 'cut', name: 'Cut', desc: 'EWDS angled corners' },
  { id: 'rounded', name: 'Rounded', desc: 'Soft corners and shadow' },
  { id: 'square', name: 'Square', desc: 'Flat boxed panels' },
];

export function SettingsPanel() {
  const {
    theme,
    setTheme,
    skins,
    accent,
    setAccent,
    accents,
    widgetSurface,
    setWidgetSurface,
    chromeDensity,
    setChromeDensity,
    wallpaperIntensity,
    setWallpaperIntensity,
  } = useTheme();
  const themes = [
    LIGHT_THEME,
    ...skins.map((skin) => ({ id: skin.id as Theme, name: skin.label, desc: skin.description })),
  ];
  const visibleAccents = accents.filter((item) => item.id !== 'signal' && item.id !== 'plasma');

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
            {themes.map((s) => (
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

        <div style={{ marginBottom: 20 }}>
          <label className="ew-field__label">Accent</label>
          <div className="ew-settings__accent-grid">
            {visibleAccents.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ew-settings__accent-option ${accent === item.id ? 'ew-settings__accent-option--active' : ''}`}
                onClick={() => setAccent(item.id as Accent)}
              >
                <span className="ew-settings__accent-swatch" style={{ background: item.preview }} />
                <span className="ew-settings__surface-name">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label className="ew-field__label">EWDS-v2 density</label>
          <div className="ew-settings__slider-row">
            <span className="ew-settings__surface-desc">Chrome</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={chromeDensity}
              onChange={(event) => setChromeDensity(Number(event.target.value))}
            />
            <span className="ew-settings__surface-desc">{chromeDensity.toFixed(2)}</span>
          </div>
          <div className="ew-settings__slider-row">
            <span className="ew-settings__surface-desc">Wallpaper</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={wallpaperIntensity}
              onChange={(event) => setWallpaperIntensity(Number(event.target.value))}
            />
            <span className="ew-settings__surface-desc">{wallpaperIntensity.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <label className="ew-field__label">Desktop widgets</label>
          <div className="ew-settings__surface-grid">
            {WIDGET_SURFACES.map((surface) => (
              <button
                key={surface.id}
                type="button"
                className={`ew-settings__surface-option ${widgetSurface === surface.id ? 'ew-settings__surface-option--active' : ''}`}
                onClick={() => setWidgetSurface(surface.id)}
              >
                <span className="ew-settings__surface-name">{surface.name}</span>
                <span className="ew-settings__surface-desc">{surface.desc}</span>
              </button>
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
