/**
 * ThemeContext — EWDS v1.0 skin + accent + mode engine.
 *
 * The model:
 *   SKIN   — classic | refined | terminal
 *   ACCENT — signal  | amber   | plasma
 *   MODE   — dark | light (light is a stub for v1.1)
 *
 * Writes to document.body (NOT documentElement) so pre-paint boot
 * scripts and React use the same DOM node and attribute names.
 * Tokens cascade from body[data-skin][data-mode] per tokens.css.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Skin, Accent, Mode, SkinPreset, AccentPreset, ModePreset } from './types';

// ── Skin presets ──────────────────────────────────────────────────

export const SKINS: SkinPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Cyberpunk glass. Max saturation cyan, TR+BL 16px bevel. Default Strands voice.',
    preview: { bg: '#0A0B0D', accent: '#00C2FF', text: '#E2E8F0', border: 'rgba(255,255,255,0.14)' },
    shortcut: '1',
  },
  {
    id: 'refined',
    label: 'Refined',
    description: 'Calmer steel-blue. Lower chroma, Chakra Petch display, 12px bevel. Long-session pick.',
    preview: { bg: '#0B0C0F', accent: '#7FA6C9', text: '#E6E8EC', border: '#2C3040' },
    shortcut: '2',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Industrial studio. Amber primary, IBM Plex Mono, sharp 0px corners, 2px borders.',
    preview: { bg: '#0A0A0B', accent: '#E8A43B', text: '#E8E8EC', border: '#3A3A42' },
    shortcut: '3',
  },
];

// ── Accent presets ────────────────────────────────────────────────

export const ACCENTS: AccentPreset[] = [
  {
    id: 'signal',
    label: 'Signal',
    description: 'Skin default. Classic = cyan, Refined = steel-blue, Terminal = amber.',
    preview: 'var(--ew-primary)',
  },
  {
    id: 'amber',
    label: 'Amber',
    description: 'Warm resistance accent. Human / local / community.',
    preview: 'oklch(0.78 0.14 70)',
    overrides: {
      '--ew-primary':       'oklch(0.78 0.14 70)',
      '--ew-primary-hover': 'oklch(0.84 0.15 70)',
      '--ew-primary-press': 'oklch(0.70 0.13 70)',
      '--ew-primary-soft':  'color-mix(in oklab, oklch(0.78 0.14 70) 12%, transparent)',
      '--ew-primary-fg':    '#1A1108',
    },
  },
  {
    id: 'plasma',
    label: 'Plasma',
    description: 'Expressive magenta. Statement moments only.',
    preview: 'oklch(0.62 0.26 340)',
    overrides: {
      '--ew-primary':       'oklch(0.62 0.26 340)',
      '--ew-primary-hover': 'oklch(0.68 0.27 340)',
      '--ew-primary-press': 'oklch(0.54 0.24 340)',
      '--ew-primary-soft':  'color-mix(in oklab, oklch(0.62 0.26 340) 12%, transparent)',
      '--ew-primary-fg':    '#0A0010',
    },
  },
];

// ── Mode presets ──────────────────────────────────────────────────

export const MODES: ModePreset[] = [
  { id: 'dark',  label: 'Dark',  available: true  },
  { id: 'light', label: 'Light', available: false },
];

// ── Legacy export ────────────────────────────────────────────────

/** @deprecated Use SKINS. */
export const THEME_PRESETS: SkinPreset[] = SKINS;

// ── localStorage keys ─────────────────────────────────────────────

const LS_SKIN   = 'ew-skin';
const LS_ACCENT = 'ew-accent';
const LS_MODE   = 'ew-mode';

// ── Context shape ────────────────────────────────────────────────

interface ThemeContextValue {
  skin: Skin;
  setSkin: (id: Skin) => void;
  skins: SkinPreset[];

  accent: Accent;
  setAccent: (id: Accent) => void;
  accents: AccentPreset[];

  mode: Mode;
  setMode: (id: Mode) => void;
  modes: ModePreset[];

  /** @deprecated Use `skin`. */
  themeId: string;
  /** @deprecated Use `setSkin`. */
  setTheme: (id: string) => void;
  /** @deprecated Use `skins`. */
  presets: SkinPreset[];
}

const ThemeCtx = createContext<ThemeContextValue>({
  skin: 'classic', setSkin: () => {}, skins: SKINS,
  accent: 'signal', setAccent: () => {}, accents: ACCENTS,
  mode: 'dark', setMode: () => {}, modes: MODES,
  themeId: 'classic', setTheme: () => {}, presets: SKINS,
});

export function useTheme() {
  return useContext(ThemeCtx);
}

// ── DOM apply helpers ────────────────────────────────────────────

const VALID_SKINS = new Set<Skin>(['classic', 'refined', 'terminal']);
const VALID_ACCENTS = new Set<Accent>(['signal', 'amber', 'plasma']);
const VALID_MODES = new Set<Mode>(['dark', 'light']);

function readStorage<T extends string>(key: string, valid: Set<T>, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && valid.has(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function applySkin(skin: Skin) {
  if (typeof document === 'undefined') return;
  document.body.dataset.skin = skin;
  if (!document.body.classList.contains('ew')) {
    document.body.classList.add('ew');
  }
}

function applyMode(mode: Mode) {
  if (typeof document === 'undefined') return;
  document.body.dataset.mode = mode;
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.body.classList.toggle('dark', mode === 'dark');
}

function applyAccent(accent: Accent) {
  if (typeof document === 'undefined') return;
  const preset = ACCENTS.find((a) => a.id === accent);
  const body = document.body;
  const allKeys = ['--ew-primary', '--ew-primary-hover', '--ew-primary-press', '--ew-primary-soft', '--ew-primary-fg'];
  for (const k of allKeys) body.style.removeProperty(k);
  if (preset?.overrides) {
    for (const [k, v] of Object.entries(preset.overrides)) {
      body.style.setProperty(k, v);
    }
  }
}

// ── Provider ──────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkinState] = useState<Skin>(() =>
    readStorage<Skin>(LS_SKIN, VALID_SKINS, 'classic'),
  );
  const [accent, setAccentState] = useState<Accent>(() =>
    readStorage<Accent>(LS_ACCENT, VALID_ACCENTS, 'signal'),
  );
  const [mode, setModeState] = useState<Mode>(() =>
    readStorage<Mode>(LS_MODE, VALID_MODES, 'dark'),
  );

  useEffect(() => { applySkin(skin);     }, [skin]);
  useEffect(() => { applyMode(mode);     }, [mode]);
  useEffect(() => { applyAccent(accent); }, [accent]);

  const setSkin = useCallback((id: Skin) => {
    if (!VALID_SKINS.has(id)) return;
    setSkinState(id);
    try { localStorage.setItem(LS_SKIN, id); } catch { /* noop */ }
    // Reset accent to signal so the skin's natural primary wins.
    setAccentState('signal');
    try { localStorage.setItem(LS_ACCENT, 'signal'); } catch { /* noop */ }
  }, []);

  const setAccent = useCallback((id: Accent) => {
    if (!VALID_ACCENTS.has(id)) return;
    setAccentState(id);
    try { localStorage.setItem(LS_ACCENT, id); } catch { /* noop */ }
  }, []);

  const setMode = useCallback((id: Mode) => {
    if (!VALID_MODES.has(id)) return;
    const preset = MODES.find((m) => m.id === id);
    if (!preset?.available) return;
    setModeState(id);
    try { localStorage.setItem(LS_MODE, id); } catch { /* noop */ }
  }, []);

  const setTheme = useCallback((id: string) => {
    if (VALID_SKINS.has(id as Skin)) setSkin(id as Skin);
  }, [setSkin]);

  return (
    <ThemeCtx.Provider
      value={{
        skin, setSkin, skins: SKINS,
        accent, setAccent, accents: ACCENTS,
        mode, setMode, modes: MODES,
        themeId: skin,
        setTheme,
        presets: SKINS,
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}
