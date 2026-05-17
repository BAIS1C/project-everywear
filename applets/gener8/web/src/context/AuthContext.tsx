/**
 * AuthContext — Tauri invoke stub for Gener8 applet.
 *
 * In S3 Studio standalone, auth hit Supabase directly. Inside the
 * Everywear shell, auth state is pushed from the shell via IPC
 * TierSync + AuthContext commands. This context reads that state
 * via Tauri invoke and provides the same surface to all consumers.
 *
 * Phase 3.3: stubbed. Full implementation wires up in Phase 4.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────

export type Tier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  tier: Tier;
  avatarUrl?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  tier: Tier;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Request fresh auth state from shell. */
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  tier: 'demo',
  isAuthenticated: false,
  isLoading: true,
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

// ── Provider ──────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      // Phase 4 implementation: invoke('get_auth_context')
      // For now, stub with a local dev profile so the UI renders.
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<UserProfile | null>('get_auth_context');
      setUser(result);
    } catch {
      // Standalone dev mode or shell not connected yet.
      // Provide a dev stub so the UI is usable.
      setUser({
        id: 'dev-local',
        email: 'dev@everywear.id',
        username: 'Developer',
        tier: 'creator_studio',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        tier: user?.tier ?? 'demo',
        isAuthenticated: !!user,
        isLoading,
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
