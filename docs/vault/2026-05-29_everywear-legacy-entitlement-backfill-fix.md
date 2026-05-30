# Everywear Legacy Entitlement Backfill Fix

Timestamp: 2026-05-29 23:35 SGT
Location: C:\Users\MAG MSI\Project Everywear
Wing: everywear
Confidence: DERIVED
Filing mode: degraded (canonical Project Mymory vault + vault MCP not reachable
this session; only Project Everywear mounted). SYNC REQUIRED to
C:\Users\MAG MSI\Project Mymory\everywear at next Cowork session with vault access.

## Required Sources Read

- `C:\Users\MAG MSI\Project Everywear\CONTEXT.md` (2026-05-28 Live QA Auth Bypass addendum)
- `C:\Users\MAG MSI\Project Everywear\docs\vault\2026-05-28_everywear-identity-vault-entitlement-migration-map.md`
- `C:\Users\MAG MSI\Project Everywear\docs\_ooda\2026-05-28_everywear_pre_mymory_audit.md`
- `C:\Users\MAG MSI\Project Everywear\supabase\migrations\20260528140643_everywear_identity_entitlement_vault_contract.sql`
- `C:\Users\MAG MSI\Project Everywear\supabase\migrations\0002_subscriptions.sql`
- `C:\Users\MAG MSI\Project Everywear\supabase\migrations\0015_admin_override_provider.sql`
- `C:\Users\MAG MSI\Project Everywear\platform\everywear-os\src\shell\AuthContext.tsx`
- Live remote project `ykqdsihnzroglepoxwcj` (Everywear, ap-northeast-1)

## Context

S3 Studio (the gener8 applet) and the rest of the S3 family were locked/gated
for Sean despite valid credentials. OODA pass on the auth chain confirmed the
break and applied a fix.

## Root Cause

Migration `20260528140643_everywear_identity_entitlement_vault_contract.sql`
(Codex) repointed `active_tier()` and `entitlement_flags()` at the new
`public.user_entitlements` table and abandoned the legacy `public.subscriptions`
read path, but shipped the schema with NO data backfill.

Live state before fix: `user_entitlements` = 0 rows, `provider_subscriptions` =
0 rows, across all users; `public.subscriptions` held 4 active rows including
Sean's `admin_override:creator_studio`. Result: `active_tier()` resolved `demo`
platform-wide; every S3-family applet (gener8, 1magen, 3nvizen, vid,
ai_director) locked for everyone.

Secondary: the frontend owner bypass in `AuthContext.tsx`
(`isAdminOrOwnerAccount`) only matched handle 'seanie' / a fixed email set,
never Sean's `cryptolombok@gmail.com` login, so it did not mask the break for
him. Sean confirmed his Everywear login is `seanie.sean@gmail.com` (handle
`seanie`, id `0a4423db-4a59-43b3-9008-676bc49092d2`).

## Decisions

- Fix the break at the data layer (backfill the contract Codex skipped), not by
  extending the frontend bypass. The bypass is a release blocker, not a fix.
- Backfill expands legacy tiers through the seeded `plan_entitlements` catalog
  so the catalog stays the single source of truth, rather than hardcoding keys.
- demo-tier legacy rows excluded from backfill; demo grants come free via the
  `free_everywear` union in `entitlement_flags()`.

## Architecture / Schema

- Legacy tier -> neutral plan mapping locked: `creator_studio`->`creator_studio`,
  `gener8_pro`->`gener8_pro`, `gener8`->`gener8_4ever` (one_time => permanent grants).
- New audit/grant flow: `subscriptions` (legacy) -> `provider_subscriptions`
  (audit) + `user_entitlements` (resolved grants, expanded from
  `plan_entitlements`) -> `active_tier()` / `entitlement_flags()` RPC ->
  `AuthContext.tsx` -> S3-family gate.

## Completed Work

- Authored + applied `supabase/migrations/20260529232641_backfill_legacy_subscriptions_to_entitlements.sql`
  to live project `ykqdsihnzroglepoxwcj`. Idempotent: provider_subscriptions
  keyed on `metadata.legacy_subscription_id`; user_entitlements on
  `source_ref = legacy_backfill:<id>`. Safe to `supabase db push`.
- Verified live: `seanie.sean@gmail.com` => creator_studio, 12 active keys;
  `kebabaik` => gener8_pro (7 keys); `satsuma` => gener8 (4 keys).
- Appended fix addendum to `CONTEXT.md` (2026-05-29 23:30 SGT).

## Open Items / Punch List

1. `active_tier()` lost `SECURITY DEFINER` and gained a `p_user is distinct from
   auth.uid()` self-guard in the neutral migration. Audit any RLS/server path
   calling `active_tier(other_user)` - now returns null. (Next task candidate.)
2. `demo_active()` (0002) still reads legacy `public.subscriptions`; diverges
   from the neutral model.
3. Remove the `AuthContext.tsx` owner bypass before external release; real
   entitlements now resolve, making it redundant.
4. `cryptolombok@gmail.com` (placeholder handle `u253d...`, no sub) still
   resolves demo. Not Sean's Everywear login; left as-is.
5. SYNC this note to canonical `C:\Users\MAG MSI\Project Mymory\everywear` next
   session with vault access.

## Entity Bridges

- everywear / S3 Studio / gener8 applet
- Supabase project `ykqdsihnzroglepoxwcj`
- Codex (author of the breaking 20260528140643 migration)
- Sean Uddin: Everywear login `seanie.sean@gmail.com` / handle `seanie` / Somo Kasane
