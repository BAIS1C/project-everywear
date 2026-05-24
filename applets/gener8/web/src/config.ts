// ── S3 Studio Web — Runtime Configuration ─────────────────────
// All values from Vite env (VITE_ prefix), with sensible dev defaults.
// Post-hub-pivot (2026-04-22): VITE_HUB_URL removed. Auth + subscriptions
// now live in Supabase; songs/playlists/social will migrate through RLS
// on the same project. `apiUrl` still points at the local Tauri shim for
// generation calls (distinct concern from auth).

export const config = {
  /** Local engine / Tauri shim base URL. Empty string = relative (Vite proxy handles it). */
  apiUrl: import.meta.env.VITE_API_URL || '',

  /**
   * Supabase project URL. Required in all environments; no dev default
   * because pointing at the wrong project silently is a security bug.
   */
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',

  /**
   * Supabase publishable key (client-safe, gated by RLS). Replaces the
   * legacy anon JWT. Format: `sb_publishable_...`.
   */
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',

  /** R2 CDN public URL for media assets */
  cdnUrl: import.meta.env.VITE_CDN_URL || '',

  /** Lemon Squeezy (global MoR, non-SEA) */
  lemonSqueezyStoreId: import.meta.env.VITE_LEMON_SQUEEZY_STORE_ID || '',

  /** Xendit public key (SEA local rails: QRIS, PromptPay, DuitNow) */
  xenditPublicKey: import.meta.env.VITE_XENDIT_PUBLIC_KEY || '',

  /** Public-facing app URL (for share links, OG tags) */
  appUrl: import.meta.env.VITE_APP_URL || 'https://s3studio.xyz',

  /** True when running in production build */
  isProd: import.meta.env.PROD,
} as const;
