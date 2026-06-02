# CONTEXT APPEND: Everywear Auth + Identity Refactor

Location: `C:\Users\MAG MSI\Project Everywear`
Created: 2026-06-01 SGT
Status: FORKS LOCKED 2026-06-01 SGT. No code touched yet. Wiki gate not yet cleared for edits.
Supabase identity root: project `ykqdsihnzroglepoxwcj` (Everywear, ap-northeast-1)

This is an append. It does not overwrite `CONTEXT.md`, `WIKI.md`, or `PROJECT_STATE.md`. Promote a link-stub into `CONTEXT.md` at filing time.

---

## Trigger

Adding login methods beyond email + email OTP. Users must be able to sign up / sign in with Google, Discord, and Telegram. Signup now also originates in Everywear OS itself (not only s3studio), landing immediately on the base free tier. The whole identity + auth + tier system gets one deliberate pass now, before social providers multiply the surface area.

---

## Current State (verified 2026-06-01 against live DB)

One Supabase project, hosted, is the single identity root. No second project. Shared across Everywear and S3 (songs/playlists tables present in the same DB). There is no local Supabase.

Auth today: 8 users, 8 identities, provider = `email` only. Email + email OTP. Zero social identities live.

Identity tables already exist and are partially unused:
- `profiles`: `id` (= `auth.users.id`), `handle` (NOT NULL), `handle_folded`, `display_name`, `role` (default `user`), `everywear_id` (text, nullable), `app_metadata` jsonb, `avatar_url`, `bio`, `locale`, `timezone`, `social_sharing_opt_in`.
- `external_identities`: `user_id`, `provider`, `provider_subject`, `provider_username`, `provider_email`, `status` (default `linked`), `linked_at`, `revoked_at`, `metadata`. The one-user-many-identities linking table already exists. It is currently unused.
- `reserved_handles`, `denied_handles`, `handle_substring_blocks`: handle validation lists exist.

Tier / entitlement: TWO models coexist in the DB.
- Legacy: `subscriptions` (`tier`, `status`, `provider`, `demo_started_at`, `demo_day_start`, `demo_day_used_seconds`) read via `active_tier(p_user) -> text`, plus `demo_start` / `demo_active` / `demo_tick` RPCs.
- New catalog: `products` (`tier_floor` default `free_everywear`, `runtime_class` `platform`, `sku_policy` `free_applet`, `is_free`, `catalog_status`), `plans` (`product_id`, `billing_model`, `provider_hint`), `plan_entitlements` (`entitlement_key`, `entitlement_type`, `grant_policy`), `user_entitlements` (`entitlement_key`, `source_plan_id`, `is_permanent`, `status`), `provider_subscriptions` (Lemon Squeezy / Xendit records).

The `free_everywear` default on `products.tier_floor` already encodes the everywear.id base-tier direction.

Auth code (to read before editing, wiki gate):
- Shell session owner: `platform/everywear-os` (shell `AuthContext.tsx`; pushes state to Tauri; applets read via `get_auth_context`).
- Applets `gener8` and `vid` ALSO carry their own `AuthContext.tsx` (`applets/*/web/src/context/AuthContext.tsx`). The relationship between applet auth context and shell session is NOT yet mapped this session. Map the call chain before any edit.

---

## Locked (pending Sean confirm on forks below)

- One Supabase project is the identity root. No second project.
- Canonical user = `profiles.id` (= `auth.users.id`) + `handle`. Every provider is a linked row in `external_identities`, never a new user.
- Three layers kept separate: authentication (doors) / identity (`profiles` + handle) / authorization (entitlements). Provider metadata and JWT claims never grant authorization.
- Base tier on signup = `free_everywear` (matches `products.tier_floor` default).
- Tier / entitlement is DB-backed. JWT carries identity only.

---

## Decisions Locked [2026-06-01 SGT]

- A. Tier model: FULL CUTOVER to `products` / `plans` / `plan_entitlements` / `user_entitlements`. Retire `subscriptions.tier`. Rationale: effectively one user in the DB, migration cost is trivial, cleaner end state. `active_tier()` may be retained only as a thin compatibility read re-backed by entitlements, to be decided when shell read sites are mapped.
- B. Web auth surface: SHARED LOGIN at `everywear.id`. Supabase stays the engine; everywear.id hosts login page + callback + cross-property session. One provider redirect allowlist.
- C. Email-collision linking: AUTO-LINK only when both emails Supabase-verified and identical; else `external_identities.status = pending_claim`, confirm via original method. Never silent merge.
- D. Telegram: DEFERRED. Ship Google + Discord (native) first; Telegram fast-follow as custom OAuth/OIDC.

## Open Decisions (original, now resolved above)

A. Tier model. Fully migrate to `products` / `plans` / `user_entitlements` and retire `subscriptions.tier`? Or keep `active_tier(p_user)` as the stable read API but re-back it with the new entitlement tables?
   Recommend: keep the `active_tier` signature (minimises shell + applet churn), re-implement it on top of `user_entitlements`, migrate `subscriptions` rows into `user_entitlements`.

B. Web auth surface. Shared login at `everywear.id` for all web properties (Flarum, game web, marketing), or each web surface talks to Supabase directly?
   Recommend: shared web login at `everywear.id`. Supabase remains the auth engine; everywear.id hosts login page + callback and sets the cross-property session. One provider redirect allowlist instead of N.

C. Email-collision linking policy. When a social email matches an existing account: auto-link or require an explicit claim step?
   Recommend: auto-link only when both emails are Supabase-verified and identical; otherwise set `external_identities.status = pending_claim` and require sign-in with the original method to confirm. Never silently merge.

D. Telegram path. Telegram's 2026 OAuth/OIDC as a Supabase custom provider, or the Login Widget hash-verification flow via Edge Function?
   Recommend: decide after Google + Discord ship. Telegram is a separate, heavier track and must not gate the native providers.

---

## Active Tasks (today)

1. Confirm forks A through D.
2. Clear wiki gate: read `WIKI.md` auth section, `platform/everywear-os` shell auth, and the `gener8` / `vid` applet AuthContexts.
3. Map and write out the shell <-> applet auth call chain before editing any link.
4. Supabase: configure Google + Discord providers (native), scopes, redirect allowlist.
5. Wire `external_identities` population on social link/sign-in.
6. Add handle-claim step for social-first signup (no handle arrives from provider).
7. Reconcile tier model per decision A.
8. Telegram as fast-follow per decision D.

## Blockers

- Forks A through D unconfirmed.
- Shell <-> applet auth call chain not yet mapped (applets carry own AuthContext; relationship unverified).

## Next Priorities

- Lock forks, ship Google + Discord first, Telegram fast-follow.
- Then unpark Flarum SSO (`C:\Users\MAG MSI\Project Websites\Flarum Forum`) against the finalised identity contract.

## Cross-refs

- Flarum park note: `C:\Users\MAG MSI\Project Websites\Flarum Forum\PARKED_2026-06-01_flarum_sso_paused_for_auth_refactor.md`
- Prior auth audit: `C:\Users\MAG MSI\Project Everywear\docs\vault\2026-05-18_auth-tier-gating-audit-hybrid-pricing.md`
- Vault wing: `C:\Users\MAG MSI\Project Mymory\everywear\`
