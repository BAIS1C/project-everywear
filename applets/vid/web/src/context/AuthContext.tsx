/**
 * Minimal auth context for Vid Studio.
 * Vid is a frontend-only applet; auth state comes from the shell
 * via Tauri IPC (get_auth_context). This stub provides the same
 * interface that VideoGeneratorModal expects.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type Tier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  tier: Tier;
}

const AuthCtx = createContext<AuthContextValue>({ user: null, tier: 'demo' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tier, setTier] = useState<Tier>('demo');

  useEffect(() => {
    invoke<{ id: string; email: string | null; tier: Tier } | null>('get_auth_context')
      .then((ctx) => {
        if (ctx) {
          setUser({ id: ctx.id, email: ctx.email });
          setTier(ctx.tier);
        }
      })
      .catch(() => {});
  }, []);

  return <AuthCtx.Provider value={{ user, tier }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
