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
const REMEMBER_AUTH_KEY = 'ew_auth_remember_until';
const REMEMBER_AUTH_DAYS = 30;

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
  /** Raw immutable handle from public.profiles.handle, e.g. "seanie". */
  handle: string;
  /** Same handle in Everywear ID form, e.g. "seanie@everywear.id". */
  everywearId: string;
  /** Alias for S3/Gener8 applet compatibility. */
  rawUsername: string;
  displayName?: string;
  role?: string;
  tier: LicenceTier;
  isPaid: boolean;
  isPro: boolean;
  tiers: Record<string, boolean>;
  entitlements: Record<string, boolean>;
  subscription?: SubscriptionSummary | null;
}

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  role?: string | null;
  bio?: string | null;
  created_at?: string | null;
}

export interface SubscriptionSummary {
  tier: LicenceTier | string;
  status: string;
  provider: string;
  current_period_end: string | null;
  cancelled_at?: string | null;
  started_at?: string | null;
  demo_started_at?: string | null;
}

interface AccountIdentity {
  profile: ProfileRow | null;
  subscription: SubscriptionSummary | null;
  activeTier: LicenceTier | null;
  entitlementFlags: Record<string, boolean>;
}

interface AuthContextValue {
  user: EverywearUser | null;
  tier: LicenceTier;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in with email + password. */
  signInWithPassword: (email: string, password: string, rememberProfile?: boolean) => Promise<void>;
  /** Sign up with email + password. */
  signUp: (email: string, password: string, handle: string, displayName?: string) => Promise<void>;
  /** Verify OTP code from email. */
  verifyOtp: (email: string, token: string, handle?: string, displayName?: string) => Promise<void>;
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
const LICENCE_TIERS = new Set<LicenceTier>(['demo', 'gener8', 'gener8_pro', 'creator_studio']);

function normalizeTier(tier: unknown): LicenceTier | null {
  return typeof tier === 'string' && LICENCE_TIERS.has(tier as LicenceTier)
    ? tier as LicenceTier
    : null;
}

function expandTierToFlags(tier: LicenceTier | null): Record<string, boolean> {
  const flags: Record<string, boolean> = {
    gener8_base: false,
    gener8: false,
    'gener8.audio': false,
    '1magen': false,
    '1magen.image': false,
    '3nvizen': false,
    '3nvizen.video': false,
    gener8_pro: false,
    creator_studio: false,
    vid_pro: false,
    daw_pro: false,
    ai_director: false,
    'ai_director.planner': false,
    creator_pro: false,
    loom: true,
    'loom.teacher_agent': true,
    character_studio: true,
    mymaits_lite_runtime: true,
    mymaits_full: false,
    'mymaits.microtransactions': false,
  };
  if (tier === 'demo' || tier === 'gener8') {
    flags.gener8_base = true;
  }
  if (tier === 'gener8') {
    flags.gener8 = true;
    flags['gener8.audio'] = true;
    flags['1magen'] = true;
    flags['1magen.image'] = true;
  }
  if (tier === 'gener8_pro') {
    flags.gener8_base = true;
    flags.gener8 = true;
    flags['gener8.audio'] = true;
    flags['1magen'] = true;
    flags['1magen.image'] = true;
    flags['3nvizen'] = true;
    flags['3nvizen.video'] = true;
    flags.gener8_pro = true;
  }
  if (tier === 'creator_studio') {
    flags.gener8_base = true;
    flags.gener8 = true;
    flags['gener8.audio'] = true;
    flags['1magen'] = true;
    flags['1magen.image'] = true;
    flags['3nvizen'] = true;
    flags['3nvizen.video'] = true;
    flags.gener8_pro = true;
    flags.creator_studio = true;
    flags.vid_pro = true;
    flags.daw_pro = true;
    flags.ai_director = true;
    flags['ai_director.planner'] = true;
    flags.creator_pro = true;
  }
  return flags;
}

function mergeEntitlementFlags(
  tier: LicenceTier | null,
  serverFlags?: Record<string, boolean> | null,
): Record<string, boolean> {
  return {
    ...expandTierToFlags(tier),
    ...(serverFlags ?? {}),
  };
}

function isAdminOrOwnerAccount(
  profile: ProfileRow | null,
  authEmail: string | undefined,
  fallbackHandle: string,
): boolean {
  const role = profile?.role?.toLowerCase();
  if (role === 'admin' || role === 'support') return true;

  const handle = (profile?.handle || fallbackHandle || '').trim().toLowerCase();
  const email = (authEmail || '').trim().toLowerCase();
  return handle === 'seanie'
    || handle === 'somo'
    || handle === 'somokasane'
    || email === 'seanie@everywear.id'
    || email === 'somo@metafintek.xyz';
}

function applyAdminTestBypass(
  tier: LicenceTier,
  flags: Record<string, boolean>,
): { tier: LicenceTier; flags: Record<string, boolean> } {
  return {
    tier: 'creator_studio',
    flags: {
      ...flags,
      ...expandTierToFlags('creator_studio'),
      admin_override: true,
    },
  };
}

async function fetchActiveTier(userId: string): Promise<LicenceTier | null> {
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
      console.warn('active_tier() RPC failed:', error.message);
      return null;
    }
    return normalizeTier(data);
  } catch (e) {
    console.warn('active_tier() RPC failed:', e);
    return null;
  }
}

async function fetchEntitlementFlags(userId: string): Promise<Record<string, boolean>> {
  try {
    const result = await Promise.race([
      supabase.rpc('entitlement_flags', { p_user: userId }),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({
          data: null,
          error: { message: 'entitlement_flags() timed out after 5s' },
        }), 5000),
      ),
    ]);
    const { data, error } = result;
    if (error) {
      console.warn('entitlement_flags() RPC failed:', error.message);
      return {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => value === true)
        .map(([key]) => [key, true]),
    );
  } catch (e) {
    console.warn('entitlement_flags() RPC failed:', e);
    return {};
  }
}

async function fetchAccountIdentity(userId: string): Promise<AccountIdentity> {
  try {
    const [profileResult, tierResult, subscriptionResult, entitlementResult] = await Promise.all([
      Promise.race([
        supabase
          .from('profiles')
          .select('id, handle, display_name, role, bio, created_at')
          .eq('id', userId)
          .maybeSingle(),
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({
            data: null,
            error: { message: 'profiles identity lookup timed out after 3s' },
          }), 3000),
        ),
      ]),
      fetchActiveTier(userId),
      Promise.race([
        supabase
          .from('subscriptions')
          .select('tier, status, provider, current_period_end, cancelled_at, started_at, demo_started_at')
          .eq('user_id', userId)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({
            data: null,
            error: { message: 'subscriptions lookup timed out after 3s' },
          }), 3000),
        ),
      ]),
      fetchEntitlementFlags(userId),
    ]);

    if ('error' in profileResult && profileResult.error) {
      console.warn('profiles lookup failed:', profileResult.error.message);
    }
    if ('error' in subscriptionResult && subscriptionResult.error) {
      console.warn('subscriptions lookup failed:', subscriptionResult.error.message);
    }

    return {
      profile: (profileResult.data as ProfileRow | null) ?? null,
      subscription: (subscriptionResult.data as SubscriptionSummary | null) ?? null,
      activeTier: tierResult,
      entitlementFlags: entitlementResult,
    };
  } catch {
    return { profile: null, subscription: null, activeTier: null, entitlementFlags: {} };
  }
}

/**
 * Push the current Supabase session + tier to the Tauri shell backend.
 * The shell stores this in AppState for upgrade pack gating and
 * applet auth context queries.
 */
async function syncToShell(
  session: Session | null,
  tier: string,
  identity?: { handle?: string; displayName?: string; email?: string },
  entitlements?: Record<string, boolean>,
): Promise<AuthReport | null> {
  if (!session) return null;
  try {
    return await Promise.race([
      pushAuthState({
        access_token: session.access_token,
        tier,
        exp: session.expires_at,
        handle: identity?.handle,
        display_name: identity?.displayName,
        email: identity?.email,
        entitlements,
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

function rememberUntilTimestamp() {
  return Date.now() + REMEMBER_AUTH_DAYS * 24 * 60 * 60 * 1000;
}

function setRememberedAuth(rememberProfile: boolean) {
  if (typeof window === 'undefined') return;
  if (rememberProfile) {
    window.localStorage.setItem(REMEMBER_AUTH_KEY, String(rememberUntilTimestamp()));
  } else {
    window.localStorage.setItem(REMEMBER_AUTH_KEY, '0');
  }
}

function clearRememberedAuth() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(REMEMBER_AUTH_KEY);
}

function rememberedAuthIsValid() {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(REMEMBER_AUTH_KEY);
  if (raw === null) {
    window.localStorage.setItem(REMEMBER_AUTH_KEY, String(rememberUntilTimestamp()));
    return true;
  }
  const expiry = Number(raw);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function normalizeEverywearHandle(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/@everywear\.id$/i, '')
    .replace(/^@/, '');
}

function assertValidEverywearHandle(handle: string): string {
  const normalized = normalizeEverywearHandle(handle);
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) {
    throw new Error('Everywear ID must be 3-32 characters: letters, numbers, _ or -, starting with a letter or number.');
  }
  return normalized;
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
    const metadataDisplayName =
      (supaUser.user_metadata?.display_name as string) ||
      (supaUser.user_metadata?.name as string) ||
      (supaUser.user_metadata?.full_name as string) ||
      undefined;
    const fallbackHandle =
      (supaUser.user_metadata?.handle as string) ||
      (supaUser.user_metadata?.username as string) ||
      supaUser.email?.split('@')[0] ||
      'user';
    const fallbackEverywearId = fallbackHandle.includes('@')
      ? fallbackHandle
      : `${fallbackHandle}@everywear.id`;

    // Login gate must depend on the Supabase session, not on slower
    // entitlement/shell-sync side effects. Set a valid user immediately,
    // then refine tier/payment fields once the async checks return.
    setUser({
      id: supaUser.id,
      email: supaUser.email || '',
      handle: fallbackHandle,
      everywearId: fallbackEverywearId,
      rawUsername: fallbackHandle,
      displayName: metadataDisplayName,
      tier: 'demo',
      isPaid: false,
      isPro: false,
      tiers: expandTierToFlags('demo'),
      entitlements: mergeEntitlementFlags('demo'),
      subscription: null,
    });

    const account = await fetchAccountIdentity(session.user.id);
    const subscriptionTier = normalizeTier(account.subscription?.tier);
    let tierStr = account.activeTier || subscriptionTier || 'demo';
    const profileHandle = account.profile?.handle?.trim() || fallbackHandle;
    const handle = profileHandle.includes('@')
      ? profileHandle.split('@')[0]
      : profileHandle;
    const everywearId = handle ? `${handle}@everywear.id` : fallbackEverywearId;
    const displayName = account.profile?.display_name?.trim()
      || metadataDisplayName
      || handle
      || supaUser.email?.split('@')[0]
      || 'Everywear User';
    let shellEntitlements = mergeEntitlementFlags(tierStr, account.entitlementFlags);
    if (isAdminOrOwnerAccount(account.profile, supaUser.email || undefined, fallbackHandle)) {
      const bypass = applyAdminTestBypass(tierStr, shellEntitlements);
      tierStr = bypass.tier;
      shellEntitlements = bypass.flags;
    }
    const report = await syncToShell(session, tierStr, {
      handle,
      displayName,
      email: supaUser.email || undefined,
    }, shellEntitlements);
    const effectiveTier = (report?.tier as LicenceTier) || tierStr;
    let effectiveEntitlements = mergeEntitlementFlags(effectiveTier, account.entitlementFlags);
    if (isAdminOrOwnerAccount(account.profile, supaUser.email || undefined, fallbackHandle)) {
      effectiveEntitlements = {
        ...effectiveEntitlements,
        ...shellEntitlements,
      };
    }

    setUser({
      id: supaUser.id,
      email: supaUser.email || '',
      handle,
      everywearId,
      rawUsername: handle,
      displayName,
      role: account.profile?.role || undefined,
      tier: effectiveTier,
      isPaid: report?.is_paid ?? (effectiveTier !== 'demo'),
      isPro: report?.is_pro ?? (effectiveTier === 'gener8_pro' || effectiveTier === 'creator_studio'),
      tiers: effectiveEntitlements,
      entitlements: effectiveEntitlements,
      subscription: account.subscription,
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
        everywearId: 'preview@everywear.id',
        rawUsername: 'preview',
        displayName: 'Preview User',
        tier: 'creator_studio',
        isPaid: true,
        isPro: true,
        tiers: expandTierToFlags('creator_studio'),
        entitlements: mergeEntitlementFlags('creator_studio'),
        subscription: {
          tier: 'creator_studio',
          status: 'active',
          provider: 'preview',
          current_period_end: null,
        },
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
        if (result.data.session && !rememberedAuthIsValid()) {
          await supabase.auth.signOut();
          await hydrateSession(null);
          return;
        }
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

  const signInWithPassword = async (email: string, password: string, rememberProfile = true) => {
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
    setRememberedAuth(rememberProfile);
    await hydrateSession(data.session);
  };

  const writeSignupProfile = async (
    session: Session,
    rawHandle: string,
    displayName?: string,
  ) => {
    const handle = assertValidEverywearHandle(rawHandle);
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        handle,
        display_name: displayName?.trim() || handle,
      })
      .eq('id', session.user.id);
    if (profileErr) {
      setError(profileErr.message);
      throw profileErr;
    }
  };

  const signUp = async (email: string, password: string, rawHandle: string, displayName?: string) => {
    setError(null);
    const handle = assertValidEverywearHandle(rawHandle);
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error: err } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          handle,
          username: handle,
          display_name: displayName?.trim() || handle,
        },
      },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
    if (data.session) {
      setRememberedAuth(true);
      await writeSignupProfile(data.session, handle, displayName);
      await hydrateSession(data.session);
    }
  };

  const verifyOtp = async (email: string, token: string, rawHandle?: string, displayName?: string) => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    let { data, error: err } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: 'email',
    });
    if (err) {
      const retry = await supabase.auth.verifyOtp({
        email: normalizedEmail,
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
    setRememberedAuth(true);
    if (rawHandle) {
      await writeSignupProfile(data.session, rawHandle, displayName);
    }
    await hydrateSession(data.session);
  };

  const signOut = async () => {
    setError(null);
    await supabase.auth.signOut();
    setUser(null);
    clearRememberedAuth();
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
