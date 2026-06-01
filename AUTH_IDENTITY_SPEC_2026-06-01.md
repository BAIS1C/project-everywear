# Everywear Identity + Auth Spec (canonical)

Location: `C:\Users\MAG MSI\Project Everywear`
Created: 2026-06-01 SGT
Confidence: DERIVED, grounded on live DB inspection of project `ykqdsihnzroglepoxwcj`
Supersedes for identity/auth purposes: scattered per-surface auth notes. `Project Websites\Flarum Forum\AUTH_AND_SSO.md` is demoted to a relying-party appendix of this spec (see section 10).

This is the single contract every surface authenticates against. Edit here first, then code.

---

## 1. The three layers (never conflate)

1. Authentication: proving who you are. Interchangeable doors: email OTP (live), Google, Discord, Telegram (deferred). Add doors freely.
2. Identity: who you are. One canonical user = one `profiles` row + one `handle`. Durable. Doors link to it.
3. Authorization: what you can do. Entitlements, DB-backed. Never read from a provider, provider metadata, or a JWT claim.

A new door must never create a new identity, and must never grant authorization by itself.

---

## 2. Identity model

Canonical user key: `profiles.id` = `auth.users.id` (uuid).

`profiles` (exists): `id`, `handle` (NOT NULL, the `@name`), `handle_folded`, `display_name`, `role` (default `user`), `everywear_id` (text), `app_metadata` jsonb, `avatar_url`, `bio`, `locale`, `timezone`, `social_sharing_opt_in`.

Decision: `everywear_id` is the canonical public identity string, `@{handle}.everywear.id`. Populate it on handle claim (currently nullable + empty). `handle` remains the mutable display token; `everywear_id` is the stable address.

Provider identities: `external_identities` (exists, currently unused): `user_id`, `provider`, `provider_subject`, `provider_username`, `provider_email`, `status` (`linked` | `pending_claim` | `blocked_collision` | `revoked`), `linked_at`, `revoked_at`, `metadata`. One canonical user, many rows here. This is the spine of multi-provider identity.

Rule: every successful authentication resolves to exactly one `profiles` row, by matching an `external_identities` row on (`provider`, `provider_subject`). No match plus no safe link path means a new signup, not a duplicate.

---

## 3. Authentication doors

- Email + email OTP: live. Keep.
- Google: Supabase native OAuth provider. Needs a Google Cloud OAuth client (Sean action), redirect to Supabase callback, scopes openid/email/profile.
- Discord: Supabase native OAuth provider. Needs a Discord application (Sean action).
- Telegram: deferred. Not native. Telegram shipped OAuth/OIDC in 2026; integrate later as a Supabase custom OAuth/OIDC provider, or via Login Widget hash-verify in an Edge Function. Do not gate Google/Discord on this.

All providers are configured in the one project `ykqdsihnzroglepoxwcj`. Provider does the auth, Supabase issues the session, app code writes/updates the `external_identities` row.

---

## 4. Linking semantics (locked: auto-link if both verified)

On a social sign-in:

1. Match `external_identities` on (`provider`, `provider_subject`). If found and `status = linked`, sign in as that user. Done.
2. No provider match: look up the provider email against existing verified user emails.
   - No match: new signup. Create `auth.users` + `profiles`, run handle-claim (section 5), insert `external_identities` row `status = linked`, grant base tier (section 6).
   - Match, and both the provider email and the existing account email are Supabase-verified and identical: AUTO-LINK. Insert `external_identities` row `status = linked` under the existing `user_id`.
   - Match, but verification is incomplete or ambiguous: insert `status = pending_claim`. Block the merge. User must sign in with the original method once to confirm ownership, which promotes the row to `linked`.
3. Never silent-merge on raw email equality. Email is not identity.

`status = blocked_collision` is reserved for cases an admin must resolve. `revoked` for unlinked/banned provider identities.

---

## 5. Handle-claim flow

Email-OTP signup already reserves a handle. Social signup arrives with no handle, so:

1. On social-first signup, suggest a handle from `provider_username` / display name.
2. Validate against `reserved_handles`, `denied_handles`, `handle_substring_blocks` (all exist). Reuse the existing normalise/fold logic.
3. User confirms or edits. On commit: set `profiles.handle`, `handle_folded`, and `everywear_id = @{handle}.everywear.id`.
4. No session is considered fully provisioned until a handle exists. Gate first-run on it.

---

## 6. Tier / entitlement model (cutover ALREADY EXECUTED; finish punch-list)

Correction after live inspection: the cutover is not pending work, it shipped 2026-05-28/29. Migration `20260528140643_everywear_identity_entitlement_vault_contract.sql` repointed `active_tier()` and `entitlement_flags()` onto `user_entitlements`; `20260529232641_backfill_legacy_subscriptions_to_entitlements.sql` is live and verified (`seanie.sean@gmail.com` => creator_studio/12 keys, `kebabaik` => gener8_pro, `satsuma` => gener8). The neutral catalog (`products`/`plans`/`plan_entitlements`) is fully seeded. `free_everywear` already grants `everywear_base`, `loom`, `loom.teacher_agent`, `character_studio`, `mymaits_lite_runtime`.

So Sean's "full cutover" call is already satisfied. Do NOT re-run a migration. What remains is a cleanup punch-list (from the 2026-05-29 backfill-fix note):

1. `active_tier()` lost `SECURITY DEFINER` and gained a `p_user is distinct from auth.uid()` self-guard, so any server/RLS path calling `active_tier(other_user)` now returns null. Audit call sites.
2. `demo_active()` still reads legacy `public.subscriptions`; move it to the neutral model.
3. Remove the `AuthContext.tsx` owner bypass (`isAdminOrOwnerAccount`) before external release; real entitlements now resolve, making it a release-blocking backdoor.
4. New social signups must receive the `free_everywear` grants through the existing `plan_entitlements` expansion, not a hardcoded path.

Target authority (unchanged, already live): `products` -> `plans` -> `plan_entitlements`, granted per user into `user_entitlements`. `subscriptions.tier` is legacy audit only.

Existing tables (all present):
- `products`: `tier_floor` (default `free_everywear`), `runtime_class`, `sku_policy` (default `free_applet`), `is_free`, `catalog_status`, `family`, `product_type`.
- `plans`: `product_id`, `billing_model`, `provider_hint`, `active`.
- `plan_entitlements`: `entitlement_key`, `entitlement_type`, `grant_policy` (default `included`).
- `user_entitlements`: `entitlement_key`, `entitlement_type`, `source_plan_id`, `source_provider`, `source_ref`, `status`, `is_permanent`, `starts_at`, `ends_at`.
- `provider_subscriptions`: payment-provider records (Lemon Squeezy / Xendit).

Base tier: every new user gets the `free_everywear` baseline at signup, written as explicit `user_entitlements` rows (not an absence-of-row default), so authorization is always a positive lookup.

Cutover steps:
1. Confirm the `free_everywear` product/plan and its `plan_entitlements` rows exist and are correct.
2. Migrate the (effectively single) `subscriptions` row into `user_entitlements`.
3. Re-implement `active_tier(p_user)` as a thin read over `user_entitlements`, OR replace its call sites with a new entitlement check. Decide when shell/applet read sites are mapped (section 9). Keeping the `active_tier` signature as a compatibility shim is preferred if call sites are many.
4. Preserve `demo_start` / `demo_active` / `demo_tick` semantics by expressing the demo as a time-boxed `user_entitlements` grant (`is_permanent = false`, `ends_at`).
5. Drop reads of `subscriptions.tier` once nothing references it.

Authorization is always: does the user hold entitlement key X right now. Payment state (`provider_subscriptions`) feeds grants but is never read directly for gating.

---

## 7. Web auth surface (locked: shared login at everywear.id)

`everywear.id` hosts one web login page and one OAuth callback. Supabase remains the auth engine; everywear.id is a thin front-end, not a custom OIDC server. It sets the session for web properties on the shared domain and is the single `redirectTo` target in Supabase's allowlist and the single post-auth redirect registered per provider.

This is the web analog of what the OS shell already does natively (shell owns the Tauri session and brokers to applets via `get_auth_context`). Native shell path is unchanged. Web surfaces (Flarum, game web, marketing) stop each integrating Supabase independently and instead consume the everywear.id session.

---

## 8. Surface matrix

| Surface | Type | How it gets identity |
|---|---|---|
| Everywear OS shell | native (Tauri) | Owns Supabase session; signup entry; lands free tier |
| Applets (gener8, vid, 3nvizen, kasai, ...) | in-shell | Read shell session via `get_auth_context`. NOTE: gener8/vid carry own AuthContext.tsx, chain unverified (section 13) |
| s3studio.xyz | web | Migrate onto shared everywear.id login |
| everywear.id | web | The shared web login + callback |
| Flarum forum | web (relying party) | Consumes everywear.id session; links forum user to `profiles.id`; no local signup |

---

## 9. Open code-integration items (require wiki gate before edits)

Before any auth code change: read `WIKI.md` auth section, `platform/everywear-os` shell auth, and the `gener8` / `vid` applet `AuthContext.tsx`. Then map and write out the shell-to-applet auth call chain. One confirmed edit per step. No bulk edits.

---

## 10. Flarum relying-party contract (supersedes AUTH_AND_SSO.md)

Flarum is a pure relying party. It does not authenticate; it consumes the everywear.id web session and trusts the resolved identity.

- Link Flarum user to `profiles.id` (the canonical uuid). Store it as the Flarum-side external id.
- No Flarum-local signup for normal users.
- Read tier/role from the entitlement layer (section 6), never from a token claim or provider metadata.
- Apply the same linking states (section 4); never merge forum accounts on email.

`Project Websites\Flarum Forum\AUTH_AND_SSO.md` is now an appendix: its Option-A custom-extension framing is replaced by "Flarum consumes the everywear.id shared web session." Reconcile that doc before building `extensions/everywear-sso`.

---

## 11. Security rules

- Authorization never depends on user-editable Supabase `raw_user_meta_data`. Use `user_entitlements` (DB-backed) only.
- Do not store Google/Discord/Telegram provider tokens in Flarum or in any relying party. Identity and forum permissions only.
- Phase 2 JWT verification: JWKS-based ES256 against Supabase's well-known endpoint (already on the shell roadmap); apply the same to web surfaces.
- Provider email is trusted for auto-link only when Supabase-verified.

---

## 12. Execution plan

Sean actions (external accounts, cannot be done from here):
- Create Google Cloud OAuth client (redirect to Supabase callback), capture client id/secret.
- Create Discord application, capture client id/secret.
- Configure both providers in the Supabase dashboard for `ykqdsihnzroglepoxwcj`, plus the redirect allowlist entry for everywear.id.

Agent actions:
1. Wiki gate + map shell/applet auth call chain.
2. DB tier punch-list only (cutover already shipped): audit `active_tier(other_user)` call sites post self-guard; move `demo_active()` off legacy `subscriptions`; remove `AuthContext.tsx` owner bypass; ensure social signups get `free_everywear` via `plan_entitlements` expansion.
3. `external_identities` write path on social sign-in/link, with the section-4 state machine (table + commerce-provider rows already exist; add the social-login rows).
4. Handle-claim step for social-first signup.
5. Shell login UI: add Google + Discord buttons.
6. everywear.id shared web login page + callback (scope with Sean; lives in the everywear.id web project, not this repo).
7. Telegram fast-follow.
8. Unpark Flarum SSO against this contract.

Order: 1 -> 3 -> 4/5 in parallel -> 2 (cleanup) -> 6 -> 7 -> 8. The social doors (3/4/5) are the real remaining build; tier (2) is cleanup.

---

## 13. Unverified / to confirm

- gener8 and vid applets carry own `AuthContext.tsx`; relationship to shell session not yet mapped. Resolve before editing applet auth.
- `active_tier()` call sites confirmed: shell `AuthContext.tsx`, shell `auth.rs`, `crates/model-manager/manifest.rs`, gener8 `lemonSqueezy.ts`. Already repointed to entitlements; keep as compatibility shim, do not rip out.
- everywear.id web project location and stack (where the shared login page is built) not yet identified in a connected folder.
- `external_identities` may already hold commerce-provider rows (Steam/Lemon/Xendit); confirm before assuming the table is empty. Social-login providers (google/discord) are the new rows to add.
- Note: the current Cowork login `cryptolombok@gmail.com` is a placeholder-handle demo account in this DB, NOT Sean's canonical Everywear identity (`seanie.sean@gmail.com`, handle `seanie`, id `0a4423db-...`).
