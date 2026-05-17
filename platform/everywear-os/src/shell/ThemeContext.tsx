import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type Skin = 'classic' | 'refined' | 'terminal';
export type Mode = 'dark' | 'light';
export type Accent = 'signal' | 'amber' | 'plasma';

interface ThemeState {
  skin: Skin;
  mode: Mode;
  accent: Accent;
  setSkin: (s: Skin) => void;
  setMode: (m: Mode) => void;
  setAccent: (a: Accent) => void;
  toggleMode: () => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

function apply(skin: Skin, mode: Mode, accent: Accent) {
  const el = document.documentElement;
  el.setAttribute('data-skin', skin);
  el.setAttribute('data-mode', mode);
  el.setAttribute('data-accent', accent);
  document.body.setAttribute('data-skin', skin);
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
    localStorage.setItem('ew-skin', s);
  }, []);
  const setMode = useCallback((m: Mode) => {
    _setMode(m);
    localStorage.setItem('ew-mode', m);
  }, []);
  const setAccent = useCallback((a: Accent) => {
    _setAccent(a);
    localStorage.setItem('ew-accent', a);
  }, []);
  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  useEffect(() => apply(skin, mode, accent), [skin, mode, accent]);

  return (
    <ThemeCtx.Provider value={{ skin, mode, accent, setSkin, setMode, setAccent, toggleMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}
