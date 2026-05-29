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
import { getAuthContext } from '@everywear/transport';

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
  token: string | null;
  tier: Tier;
  isAuthenticated: boolean;
  isLoading: boolean;
  entitlementResolved: boolean;
  isTrialActive: boolean;
  hasTier: (tier: 'gener8' | 'gener8_base' | 'gener8_pro' | 'creator_studio' | 'vid_pro' | 'daw_pro') => boolean;
  setupUser: () => Promise<void>;
  logout: () => Promise<void>;
  /** Request fresh auth state from shell. */
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  token: null,
  tier: 'demo',
  isAuthenticated: false,
  isLoading: true,
  entitlementResolved: false,
  isTrialActive: true,
  hasTier: () => false,
  setupUser: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

// ── Provider ──────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [entitlementResolved, setEntitlementResolved] = useState(false);

  const refresh = async () => {
    try {
      const result = await getAuthContext();
      setUser(result ? {
        id: result.id,
        email: result.email || '',
        username: result.username || result.email || 'Everywear user',
        tier: result.tier,
      } : null);
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
      setEntitlementResolved(true);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const tier = user?.tier ?? 'demo';
  const token = user ? 'everywear-shell-session' : null;
  const hasTier: AuthContextValue['hasTier'] = (required) => {
    if (required === 'vid_pro' || required === 'daw_pro') {
      return tier === 'creator_studio';
    }
    const normalized = required === 'gener8_base' ? 'gener8' : required;
    const rank: Record<Tier, number> = {
      demo: 0,
      gener8: 1,
      gener8_pro: 2,
      creator_studio: 3,
    };
    return rank[tier] >= rank[normalized as Tier];
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        token,
        tier,
        isAuthenticated: !!user,
        isLoading,
        entitlementResolved,
        isTrialActive: tier === 'demo',
        hasTier,
        setupUser: refresh,
        logout: async () => setUser(null),
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
