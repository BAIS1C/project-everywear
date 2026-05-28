import { useTheme, type Accent, type Theme, type WidgetSurface, type TrafficSide } from '@everywear/ewds';

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

const TRAFFIC_SIDES: { id: TrafficSide; name: string; desc: string }[] = [
  { id: 'left', name: 'Left', desc: 'Classic shell controls' },
  { id: 'right', name: 'Right', desc: 'Right-side window controls' },
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
    trafficSide,
    setTrafficSide,
    chromeDensity,
    setChromeDensity,
    wallpaperIntensity,
    setWallpaperIntensity,
    bevelDegree,
    setBevelDegree,
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
          <div className="ew-settings__chrome-sample" aria-hidden="true">
            <span className="ew-settings__barcode ew-chrome" />
            <span className="ew-settings__serial ew-chrome">EWDS-V2 · SR-4150 · 登録</span>
            <span className="ew-settings__pill ew-chrome">● LIVE</span>
          </div>
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
          <div className="ew-settings__slider-row">
            <span className="ew-settings__surface-desc">Bevel</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={bevelDegree}
              onChange={(event) => setBevelDegree(Number(event.target.value))}
            />
            <span className="ew-settings__surface-desc">{bevelDegree.toFixed(2)}</span>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label className="ew-field__label">Traffic lights</label>
          <div className="ew-settings__traffic-grid">
            {TRAFFIC_SIDES.map((side) => (
              <button
                key={side.id}
                type="button"
                className={`ew-settings__traffic-option ${trafficSide === side.id ? 'ew-settings__traffic-option--active' : ''}`}
                onClick={() => setTrafficSide(side.id)}
              >
                <span className="ew-settings__traffic-demo" data-side={side.id}>
                  <span className="ew-traffic-light ew-traffic-light--close" />
                  <span className="ew-traffic-light ew-traffic-light--minimize" />
                  <span className="ew-traffic-light ew-traffic-light--maximize" />
                </span>
                <span className="ew-settings__surface-name">{side.name}</span>
                <span className="ew-settings__surface-desc">{side.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="ew-field__label">Surface treatment</label>
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
