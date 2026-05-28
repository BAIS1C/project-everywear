/**
 * @everywear/ewds — Type definitions
 */

// ── Core IDs ──────────────────────────────────────────────────────

export type Skin = 'classic' | 'refined' | 'terminal' | 'graphite' | 'anodized' | 'carbon';
export type Accent = 'signal' | 'cyan' | 'amber' | 'acid' | 'crimson' | 'bone' | 'plasma';
export type Mode = 'dark' | 'light';
export type Theme = 'light' | Skin;
export type WidgetSurface = 'cut' | 'rounded' | 'square';
export type TrafficSide = 'left' | 'right';

// ── Preset shapes ─────────────────────────────────────────────────

export interface SkinPreset {
  id: Skin;
  label: string;
  description: string;
  preview: { bg: string; accent: string; text: string; border: string };
  shortcut?: string;
}

export interface AccentPreset {
  id: Accent;
  label: string;
  description: string;
  preview: string;
  overrides?: Record<string, string>;
}

export interface ModePreset {
  id: Mode;
  label: string;
  available: boolean;
}

// ── Theme state ───────────────────────────────────────────────────

export interface ThemeState {
  skin: Skin;
  accent: Accent;
  mode: Mode;
  theme: Theme;
  widgetSurface: WidgetSurface;
  trafficSide: TrafficSide;
  chromeDensity: number;
  wallpaperIntensity: number;
  bevelDegree: number;
  setSkin: (id: Skin) => void;
  setAccent: (id: Accent) => void;
  setMode: (id: Mode) => void;
  setTheme: (id: Theme) => void;
  setWidgetSurface: (surface: WidgetSurface) => void;
  setTrafficSide: (side: TrafficSide) => void;
  setChromeDensity: (density: number) => void;
  setWallpaperIntensity: (intensity: number) => void;
  setBevelDegree: (degree: number) => void;
  toggleMode: () => void;
}

// ── Legacy aliases ────────────────────────────────────────────────

/** @deprecated Use SkinPreset. */
export type ThemePreset = SkinPreset;
/** @deprecated Tokens are managed via CSS custom properties. */
export type ThemeTokens = Record<string, string>;
