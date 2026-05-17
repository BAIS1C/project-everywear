/**
 * ThemeContext — EWDS v1.0 skin + accent + mode engine.
 * Ported from s3studio-web for 1magen standalone use.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type SkinId = 'classic' | 'refined' | 'terminal';
export type AccentId = 'signal' | 'amber' | 'plasma';
export type ModeId = 'dark' | 'light';

export interface SkinPreset {
  id: SkinId;
  label: string;
  description: string;
  preview: { bg: string; accent: string; text: string; border: string };
}

export interface AccentPreset {
  id: AccentId;
  label: string;
  preview: string;
  overrides?: Record<string, string>;
}

export const SKINS: SkinPreset[] = [
  {
    id: 'classic', label: 'Classic',
    description: 'Cyberpunk glass, max saturation cyan.',
    preview: { bg: '#0A0B0D', accent: '#00C2FF', text: '#E2E8F0', border: 'rgba(255,255,255,0.14)' },
  },
  {
    id: 'refined', label: 'Refined',
    description: 'Calmer steel-blue, lower chroma.',
    preview: { bg: '#0B0C0F', accent: '#7FA6C9', text: '#E6E8EC', border: '#2C3040' },
  },
  {
    id: 'terminal', label: 'Terminal',
    description: 'Industrial studio, amber primary.',
    preview: { bg: '#0A0A0B', accent: '#E8A43B', text: '#E8E8EC', border: '#3A3A42' },
  },
];

export const ACCENTS: AccentPreset[] = [
  { id: 'signal', label: 'Signal', preview: 'var(--ew-primary)' },
  {
    id: 'amber', label: 'Amber', preview: 'oklch(0.78 0.14 70)',
    overrides: {
      '--ew-primary': 'oklch(0.78 0.14 70)',
      '--ew-primary-hover': 'oklch(0.84 0.15 70)',
      '--ew-primary-press': 'oklch(0.70 0.13 70)',
      '--ew-primary-soft': 'color-mix(in oklab, oklch(0.78 0.14 70) 12%, transparent)',
      '--ew-primary-fg': '#1A1108',
    },
  },
  {
    id: 'plasma', label: 'Plasma', preview: 'oklch(0.62 0.26 340)',
    overrides: {
      '--ew-primary': 'oklch(0.62 0.26 340)',
      '--ew-primary-hover': 'oklch(0.68 0.27 340)',
      '--ew-primary-press': 'oklch(0.54 0.24 340)',
      '--ew-primary-soft': 'color-mix(in oklab, oklch(0.62 0.26 340) 12%, transparent)',
      '--ew-primary-fg': '#0A0010',
    },
  },
];

const LS_SKIN = 'ew-skin';
const LS_ACCENT = 'ew-accent';

const VALID_SKINS = new Set<SkinId>(['classic', 'refined', 'terminal']);
const VALID_ACCENTS = new Set<AccentId>(['signal', 'amber', 'plasma']);

function readLS<T extends string>(key: string, valid: Set<T>, fallback: T): T {
  try { const v = localStorage.getItem(key); return v && valid.has(v as T) ? (v as T) : fallback; }
  catch { return fallback; }
}

interface ThemeContextValue {
  skin: SkinId;
  setSkin: (id: SkinId) => void;
  accent: AccentId;
  setAccent: (id: AccentId) => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  skin: 'classic', setSkin: () => {},
  accent: 'signal', setAccent: () => {},
});

export function useTheme() { return useContext(ThemeCtx); }

function applySkin(skin: SkinId) {
  document.body.dataset.skin = skin;
  document.body.dataset.mode = 'dark';
  if (!document.body.classList.contains('ew')) document.body.classList.add('ew');
}

function applyAccent(accent: AccentId) {
  const preset = ACCENTS.find(a => a.id === accent);
  const keys = ['--ew-primary','--ew-primary-hover','--ew-primary-press','--ew-primary-soft','--ew-primary-fg'];
  for (const k of keys) document.body.style.removeProperty(k);
  if (preset?.overrides) {
    for (const [k, v] of Object.entries(preset.overrides)) document.body.style.setProperty(k, v);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkinState] = useState<SkinId>(() => readLS(LS_SKIN, VALID_SKINS, 'classic'));
  const [accent, setAccentState] = useState<AccentId>(() => readLS(LS_ACCENT, VALID_ACCENTS, 'signal'));

  useEffect(() => { applySkin(skin); }, [skin]);
  useEffect(() => { applyAccent(accent); }, [accent]);

  const setSkin = useCallback((id: SkinId) => {
    if (!VALID_SKINS.has(id)) return;
    setSkinState(id);
    try { localStorage.setItem(LS_SKIN, id); } catch {}
    setAccentState('signal');
    try { localStorage.setItem(LS_ACCENT, 'signal'); } catch {}
  }, []);

  const setAccent = useCallback((id: AccentId) => {
    if (!VALID_ACCENTS.has(id)) return;
    setAccentState(id);
    try { localStorage.setItem(LS_ACCENT, id); } catch {}
  }, []);

  return (
    <ThemeCtx.Provider value={{ skin, setSkin, accent, setAccent }}>
      {children}
    </ThemeCtx.Provider>
  );
}
