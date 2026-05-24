// @ts-nocheck
// ── Lemon Squeezy variant map + checkout helpers ───────────────────
//
// Per spec at docs/PRORATION_AND_SUB_HANDLING.md §2.1.
//
// Variant IDs are NOT secret — they appear in checkout URLs and LS
// public storefronts. Hardcoding them client-side is fine. The API key
// (LEMON_SQUEEZY_API_KEY) IS secret and lives in Supabase Edge Function
// secrets, called via a server-side Edge Function the SPA fetches from.
//
// 2026-05-18 SGT — HYBRID PRICING PIVOT
// Moved from subscription-only ($5/$12.99/$30) to hybrid ownership + sub:
//   - Gener8 4ever:     $20 ONE-TIME purchase (perpetual local gen)
//   - Gener8 Pro:       $13.37/mo subscription (includes 4ever features)
//   - Creator Studio:   $28.88/mo subscription (includes all lower tiers)
//
// TODO: Sean needs to create new LS products/variants in the dashboard
// to match these prices. The variant IDs below are STALE from the old
// subscription-only model and must be updated once new products are live.
//
// Steam integration: 4ever will also be sold on Steam ($20, Steam takes
// 30%). Pro/Studio subscriptions are direct-only via LS for now.
//
// Note on tier ID naming: subscriptions.tier in Supabase uses 'gener8'
// (not 'gener8_base'). The active_tier RPC returns 'gener8' for paid
// base-tier rows. The tier reconciler in s-gener8 accepts both
// 'gener8' and 'gener8_base' as aliases (parse_tier in mod.rs L300-308).

import { config } from '../../config';

export type TierId = 'gener8' | 'gener8_pro' | 'creator_studio';
export type PurchaseType = 'one-time' | 'subscription';

// TODO: replace with new LS variant IDs once dashboard products are updated
export const LEMON_SQUEEZY_VARIANT_MAP: Record<TierId, string> = {
  gener8:         '1605201',   // STALE — was $5/mo sub, now $20 one-time
  gener8_pro:     '1605106',   // STALE — was $12.99/mo, now $13.37/mo
  creator_studio: '1605230',   // STALE — was $30/mo, now $28.88/mo
};

export const LEMON_SQUEEZY_PRODUCT_MAP: Record<TierId, string> = {
  gener8:         '1023329',
  gener8_pro:     '1023251',
  creator_studio: '1023346',
};

/** Purchase type per tier. Gener8 4ever is a one-time purchase; Pro and
 *  Creator Studio are subscriptions that include all 4ever functionality. */
export const TIER_PURCHASE_TYPE: Record<TierId, PurchaseType> = {
  gener8:         'one-time',
  gener8_pro:     'subscription',
  creator_studio: 'subscription',
};

/** Canonical prices in USD. One-time tiers have a single price;
 *  subscription tiers are per-month. */
export const TIER_PRICE_USD: Record<TierId, number> = {
  gener8:         20.00,
  gener8_pro:     13.37,
  creator_studio: 28.88,
};

export const TIER_LABEL: Record<TierId, string> = {
  gener8:         'S³ Gener8 4ever',
  gener8_pro:     'S³ Gener8 Pro',
  creator_studio: 'S³ Creator Studio',
};

/**
 * Build a direct checkout URL for the given tier with the user's
 * identity baked into custom_data so the webhook can attribute the
 * subscription_created event to the right Supabase user.
 *
 * Per spec §2.2: the SPA hands the URL off to the LS-hosted checkout
 * via window.location.assign or a popup; LS handles the rest.
 *
 * Custom data carried into the checkout (and surfaced on the webhook
 * meta.custom_data):
 *   - user_id: auth.uid() — primary user resolution path in webhook
 *   - tier:    'gener8' | 'gener8_pro' | 'creator_studio'
 *   - source:  'spa_upgrade' (vs future 'gift', 'referral_invite', etc.)
 *
 * NOTE: this is the simpler "buy URL" pattern. The full LS Checkout API
 * (§2.2 alt) creates a server-side checkout session via API key for
 * advanced flows (custom branding, prefill, store-side validation).
 * We don't need that for v1; direct buy URLs are fine.
 */
export function buildCheckoutUrl(
  tier: TierId,
  userId: string,
  email?: string,
): string {
  const variantId = LEMON_SQUEEZY_VARIANT_MAP[tier];
  if (!variantId) {
    throw new Error(`Unknown tier for checkout: ${tier}`);
  }
  const purchaseType = TIER_PURCHASE_TYPE[tier];
  const params = new URLSearchParams({
    'checkout[custom][user_id]': userId,
    'checkout[custom][tier]':    tier,
    'checkout[custom][purchase_type]': purchaseType,
    'checkout[custom][source]':  'spa_upgrade',
  });
  if (email) {
    params.set('checkout[email]', email);
  }
  // LS direct buy URL pattern. The actual host for buy URLs is
  // <store-slug>.lemonsqueezy.com — using the variant_id path.
  const storeId = config.lemonSqueezyStoreId;
  if (!storeId) {
    throw new Error(
      'VITE_LEMON_SQUEEZY_STORE_ID is not configured. Set it in .env.local '
      + 'before invoking buildCheckoutUrl.'
    );
  }
  return `https://s3studio.lemonsqueezy.com/buy/${variantId}?${params.toString()}`;
}

/**
 * Trigger a fresh-signup checkout for `tier`. New subscription path
 * (spec §2.2). Caller is App-side: read user.id + user.email from
 * AuthContext, pass through. Hard-navigates the browser to LS.
 */
export function startCheckout(
  tier: TierId,
  userId: string,
  email?: string,
): void {
  const url = buildCheckoutUrl(tier, userId, email);
  // Hard navigation; LS-hosted checkout takes over the tab.
  window.location.assign(url);
}

/**
 * Upgrade an existing subscription mid-cycle (spec §2.3). Server-side
 * call via Edge Function `subscription-upgrade` (not yet built);
 * this stub throws so call-sites can be wired now and the Edge
 * Function can come online without re-touching SPA code.
 *
 * TODO: wire to /functions/v1/subscription-upgrade once the Edge
 *       Function lands. Body: { current_subscription_id, target_tier }.
 *       Function PATCHes LS subscription with new variant_id +
 *       invoice_immediately:true.
 */
export async function upgradeSubscription(
  _currentSubId: string,
  _targetTier: TierId,
): Promise<void> {
  throw new Error('upgradeSubscription not yet implemented (Edge Function pending)');
}

/**
 * Schedule a downgrade at next renewal (spec §2.4). Server-side
 * call via Edge Function. Same shape as upgrade but with
 * disable_prorations:true + invoice_immediately:false.
 */
export async function scheduleDowngrade(
  _currentSubId: string,
  _targetTier: TierId,
): Promise<void> {
  throw new Error('scheduleDowngrade not yet implemented (Edge Function pending)');
}

/**
 * Compare two tiers for direction. Used by UpgradeModal to decide
 * which CTA copy + flow to dispatch (new / upgrade / downgrade / same).
 *
 * In the hybrid model, 4ever is a one-time purchase and independent
 * of subscriptions. Pro and Creator Studio are the subscription ladder.
 * A user can own 4ever AND have a subscription simultaneously (safety-net).
 */
export function compareTiers(target: TierId, current: TierId | null): 'new' | 'upgrade' | 'downgrade' | 'same' {
  if (!current) return 'new';
  if (target === current) return 'same';
  // 4ever is always a 'new' purchase (one-time, independent path)
  if (TIER_PURCHASE_TYPE[target] === 'one-time') return 'new';
  const order: Record<TierId, number> = {
    gener8:         1,
    gener8_pro:     2,
    creator_studio: 3,
  };
  return order[target] > order[current] ? 'upgrade' : 'downgrade';
}
