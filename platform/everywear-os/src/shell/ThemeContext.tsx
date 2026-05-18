import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type Skin = 'classic' | 'refined' | 'terminal';
export type Mode = 'dark' | 'light';
export type Accent = 'signal' | 'amber' | 'plasma';
export type Theme = 'light' | Skin;

interface ThemeState {
  skin: Skin;
  mode: Mode;
  theme: Theme;
  accent: Accent;
  setSkin: (s: Skin) => void;
  setMode: (m: Mode) => void;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  toggleMode: () => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

function apply(skin: Skin, mode: Mode, accent: Accent) {
  const el = document.documentElement;
  const effectiveSkin = mode === 'light' ? 'classic' : skin;
  el.setAttribute('data-skin', effectiveSkin);
  el.setAttribute('data-mode', mode);
  el.setAttribute('data-accent', accent);
  document.body.setAttribute('data-skin', effectiveSkin);
  document.body.setAttribute('data-mode', mode);
  document.body.setAttribute('data-accent', accent);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [skin, _setSkin] = useState<Skin>(
    () => (localStorage.getItem('ew-skin') as Skin) || 'classic'
  );
  const [mode, _setMode] = useState<Mode>(
    () => (localStorage.getItem('ew-mode') as Mode) || 'dark'
  );
  const [accent, _setAccent] = useState<Accent>(
    () => (localStorage.getItem('ew-accent') as Accent) || 'signal'
  );

  const setSkin = useCallback((s: Skin) => {
    _setSkin(s);
    _setMode('dark');
    localStorage.setItem('ew-skin', s);
    localStorage.setItem('ew-mode', 'dark');
  }, []);
  const setMode = useCallback((m: Mode) => {
    _setMode(m);
    localStorage.setItem('ew-mode', m);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    if (t === 'light') {
      _setMode('light');
      localStorage.setItem('ew-mode', 'light');
      return;
    }
    _setSkin(t);
    _setMode('dark');
    localStorage.setItem('ew-skin', t);
    localStorage.setItem('ew-mode', 'dark');
  }, []);
  const setAccent = useCallback((a: Accent) => {
    _setAccent(a);
    localStorage.setItem('ew-accent', a);
  }, []);
  const toggleMode = useCallback(() => {
    setTheme(mode === 'dark' ? 'light' : skin);
  }, [mode, skin, setTheme]);

  useEffect(() => apply(skin, mode, accent), [skin, mode, accent]);
  const theme: Theme = mode === 'light' ? 'light' : skin;

  return (
    <ThemeCtx.Provider value={{ skin, mode, theme, accent, setSkin, setMode, setTheme, setAccent, toggleMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}
