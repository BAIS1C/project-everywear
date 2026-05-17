/**
 * AuthContext — Supabase auth + licence tier for Everywear OS shell.
 *
 * The shell owns the user session. Auth flow:
 *   1. User signs in via email OTP or password (Supabase Auth)
 *   2. On session, frontend calls `active_tier()` RPC for canonical tier
 *   3. Frontend invokes `push_auth_state` Tauri command with JWT + tier
 *   4. Shell Rust side stores user_session + licence_tier in AppState
 *   5. On applet launch, shell reads licence_tier for upgrade pack gating
 *
 * Supabase project: ykqdsihnzroglepoxwcj (Everywear, Tokyo region)
 *
 * Auth gate: user MUST sign in to use Everywear OS. The shell renders
 * a login screen until isAuthenticated is true.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import { pushAuthState, clearAuth, type LicenceTier, type AuthReport } from '../lib/transport';

// ── Supabase client (singleton) ──────────────────────────────────

const SUPABASE_URL = 'https://ykqdsihnzroglepoxwcj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcWRzaWhuenJvZ2xlcG94d2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjc1MDUsImV4cCI6MjA1Mzk0MzUwNX0.fJAsKs-VZFEaDqEJrJiPIvfyIT1s7KXI2FW8CLXGJ6A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Types ────────────────────────────────────────────────────────

export interface EverywearUser {
  id: string;
  email: string;
  handle: string;
  tier: LicenceTier;
  isPaid: boolean;
  isPro: boolean;
}

type AuthMode = 'login' | 'signup' | 'otp-verify';

interface AuthContextValue {
  user: EverywearUser | null;
  tier: LicenceTier;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in with email OTP (sends magic link). */
  signInWithOtp: (email: string) => Promise<void>;
  /** Sign in with email + password. */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Sign up with email + password. */
  signUp: (email: string, password: string) => Promise<void>;
  /** Verify OTP code from email. */
  verifyOtp: (email: string, token: string) => Promise<void>;
  /** Sign out and reset to Demo. */
  signOut: () => Promise<void>;
  /** Force refresh auth state from Supabase. */
  refresh: () => Promise<void>;
  /** Start the 7-day demo trial (idempotent). */
  startTrial: () => Promise<void>;
  /** Last auth error message (cleared on next attempt). */
  error: string | null;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  tier: 'demo',
  isAuthenticated: false,
  isLoading: true,
  signInWithOtp: async () => {},
  signInWithPassword: async () => {},
  signUp: async () => {},
  verifyOtp: async () => {},
  signOut: async () => {},
  refresh: async () => {},
  startTrial: async () => {},
  error: null,
});

export function useAuth() {
  return useContext(AuthCtx);
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Call Supabase active_tier(p_user) RPC to get the canonical tier string.
 * This is the single source of truth for what the user is entitled to.
 * The function is SECURITY DEFINER; it reads public.subscriptions
 * for the given user_id and returns 'demo'|'gener8'|'gener8_pro'|'creator_studio'.
 */
async function fetchActiveTier(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('active_tier', { p_user: userId });
  if (error) {
    console.warn('active_tier() RPC failed, defaulting to demo:', error.message);
    return 'demo';
  }
  return (data as string) || 'demo';
}

/**
 * Push the current Supabase session + tier to the Tauri shell backend.
 * The shell stores this in AppState for upgrade pack gating and
 * applet auth context queries.
 */
async function syncToShell(session: Session | null, tier: string): Promise<AuthReport | null> {
  if (!session) return null;
  try {
    return await pushAuthState({
      access_token: session.access_token,
      tier,
      exp: session.expires_at,
    });
  } catch (e) {
    console.warn('push_auth_state failed:', e);
    return null;
  }
}

// ── Provider ─────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<EverywearUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Hydrate user state from a Supabase session. */
  const hydrateSession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setUser(null);
      await clearAuth().catch(() => {});
      return;
    }

    const tierStr = await fetchActiveTier(session.user.id);
    const report = await syncToShell(session, tierStr);

    const supaUser = session.user;
    const handle =
      (supaUser.user_metadata?.handle as string) ||
      (supaUser.user_metadata?.username as string) ||
      supaUser.email?.split('@')[0] ||
      'user';

    setUser({
      id: supaUser.id,
      email: supaUser.email || '',
      handle,
      tier: (report?.tier as LicenceTier) || (tierStr as LicenceTier) || 'demo',
      isPaid: report?.is_paid ?? false,
      isPro: report?.is_pro ?? false,
    });
  }, []);

  // Initial session check + auth state listener
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        await hydrateSession(session);
        setIsLoading(false);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (mounted) {
          await hydrateSession(session);
        }
      },
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [hydrateSession]);

  // ── Auth methods ────────────────────────────────────────────────

  const signInWithOtp = async (email: string) => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email });
    if (err) setError(err.message);
  };

  const signInWithPassword = async (email: string, password: string) => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (err) setError(err.message);
  };

  const signUp = async (email: string, password: string) => {
    setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) setError(err.message);
  };

  const verifyOtp = async (email: string, token: string) => {
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (err) setError(err.message);
  };

  const signOut = async () => {
    setError(null);
    await supabase.auth.signOut();
    setUser(null);
    await clearAuth().catch(() => {});
  };

  const refresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await hydrateSession(session);
  };

  /**
   * Start the 7-day demo trial. Calls the demo_start RPC which inserts
   * a demo subscription row (demo_started_at=now(), tier='demo', status='active').
   * Idempotent: returns existing row if one already exists.
   * After insertion, re-hydrates so active_tier picks up 'demo' and the
   * shell tier state is updated.
   */
  const startTrial = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.user) {
      setError('Must be signed in to start a trial.');
      return;
    }
    const { error: rpcErr } = await supabase.rpc('demo_start');
    if (rpcErr) {
      console.error('demo_start RPC failed:', rpcErr.message);
      setError(rpcErr.message);
      return;
    }
    // Re-hydrate so active_tier returns 'demo' and shell state updates.
    await hydrateSession(currentSession);
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        tier: user?.tier ?? 'demo',
        isAuthenticated: !!user,
        isLoading,
        signInWithOtp,
        signInWithPassword,
        signUp,
        verifyOtp,
        signOut,
        refresh,
        startTrial,
        error,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
