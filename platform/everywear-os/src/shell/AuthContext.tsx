/**
 * AuthContext — Supabase auth + licence tier for Everywear OS shell.
 *
 * The shell owns the user session. Auth flow:
 *   1. User signs in via email + password (Supabase Auth)
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
import { createClient, type Session } from '@supabase/supabase-js';
import { pushAuthState, clearAuth, type LicenceTier, type AuthReport } from '../lib/transport';

// ── Supabase client (singleton) ──────────────────────────────────

const SUPABASE_URL = 'https://ykqdsihnzroglepoxwcj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_uDAHS1s4gvl8hr9b1G-_yA_I7TY1RTE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'ew_supabase_auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const hasTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const isLocalPreviewBypass = () => {
  if (hasTauriRuntime()) return false;
  if (typeof window === 'undefined') return false;
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
  return localHost && new URLSearchParams(window.location.search).get('preview') === '1';
};

// ── Types ────────────────────────────────────────────────────────

export interface EverywearUser {
  id: string;
  email: string;
  handle: string;
  tier: LicenceTier;
  isPaid: boolean;
  isPro: boolean;
}

interface AuthContextValue {
  user: EverywearUser | null;
  tier: LicenceTier;
  isAuthenticated: boolean;
  isLoading: boolean;
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
  try {
    const result = await Promise.race([
      supabase.rpc('active_tier', { p_user: userId }),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({
          data: null,
          error: { message: 'active_tier() timed out after 5s' },
        }), 5000),
      ),
    ]);
    const { data, error } = result;
    if (error) {
      console.warn('active_tier() RPC failed, defaulting to demo:', error.message);
      return 'demo';
    }
    return (data as string) || 'demo';
  } catch (e) {
    console.warn('active_tier() RPC failed, defaulting to demo:', e);
    return 'demo';
  }
}

/**
 * Push the current Supabase session + tier to the Tauri shell backend.
 * The shell stores this in AppState for upgrade pack gating and
 * applet auth context queries.
 */
async function syncToShell(session: Session | null, tier: string): Promise<AuthReport | null> {
  if (!session) return null;
  try {
    return await Promise.race([
      pushAuthState({
        access_token: session.access_token,
        tier,
        exp: session.expires_at,
      }),
      new Promise<null>((resolve) => setTimeout(() => {
        console.warn('push_auth_state timed out after 3s; continuing with Supabase session.');
        resolve(null);
      }, 3000)),
    ]);
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

    const supaUser = session.user;
    const handle =
      (supaUser.user_metadata?.handle as string) ||
      (supaUser.user_metadata?.username as string) ||
      supaUser.email?.split('@')[0] ||
      'user';

    // Login gate must depend on the Supabase session, not on slower
    // entitlement/shell-sync side effects. Set a valid user immediately,
    // then refine tier/payment fields once the async checks return.
    setUser({
      id: supaUser.id,
      email: supaUser.email || '',
      handle,
      tier: 'demo',
      isPaid: false,
      isPro: false,
    });

    const tierStr = await fetchActiveTier(session.user.id);
    const report = await syncToShell(session, tierStr);

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

    if (isLocalPreviewBypass()) {
      setUser({
        id: 'browser-preview',
        email: 'preview@everywear.local',
        handle: 'preview',
        tier: 'creator_studio',
        isPaid: true,
        isPro: true,
      });
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    // Hard safety net: no matter what happens in the async chain,
    // the spinner WILL clear after 6 seconds. This is independent of
    // the try/catch/finally below — belt and suspenders.
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn('Auth init safety timeout fired (6s). Forcing isLoading=false.');
        setIsLoading(false);
      }
    }, 6000);

    const init = async () => {
      try {
        // getSession() reads from localStorage; if a stale session is cached
        // it tries to refresh the token (network call). Race it so we don't
        // hang forever if the refresh is blocked.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((resolve) =>
            setTimeout(() => {
              console.warn('getSession() took >4s, assuming no valid session.');
              resolve({ data: { session: null } });
            }, 4000)
          ),
        ]);
        if (mounted) {
          await hydrateSession(result.data.session);
        }
      } catch (err) {
        console.error('Auth init failed:', err);
      } finally {
        clearTimeout(safetyTimer);
        if (mounted) setIsLoading(false);
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

  const signInWithPassword = async (email: string, password: string) => {
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (err) {
      setError(err.message);
      throw err;
    }
    if (!data.session) {
      const message = 'Sign in succeeded but Supabase did not return a session.';
      setError(message);
      throw new Error(message);
    }
    await hydrateSession(data.session);
  };

  const signUp = async (email: string, password: string) => {
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
      throw err;
    }
    if (data.session) {
      await hydrateSession(data.session);
    }
  };

  const verifyOtp = async (email: string, token: string) => {
    setError(null);
    let { data, error: err } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (err) {
      const retry = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'signup',
      });
      data = retry.data;
      err = retry.error;
    }
    if (err) {
      setError(err.message);
      throw err;
    }
    if (!data.session) {
      const message = 'Verification succeeded but Supabase did not return a session.';
      setError(message);
      throw new Error(message);
    }
    await hydrateSession(data.session);
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
