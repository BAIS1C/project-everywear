# Everywear Auth + Tier Gating Audit: Hybrid Gener8 Pricing

Date: 2026-05-18
Scope: Everywear OS shell, Supabase auth sync, Lemon Squeezy tier assumptions, Gener8 4ever, Vid surfaces, Creator Studio gates, Kasai applet status.
Pricing context source: user brief for the 2026-05-19 sprint, aligned to the current S3 Studio marketing direction at https://s3studio.xyz.

## New Commercial Model To Encode

- Gener8 4ever, formerly just Gener8: USD 20 one-off purchase, lifetime access. Owns basic local generation permanently. This is the safety net.
- Gener8 Pro: USD 13.37/month, includes all 4ever functionality while active plus premium features. If cancelled, access is lost unless the user separately owns 4ever.
- Creator Studio: USD 28.88/month, full workstation. Same cancel logic as Pro.
- Kasai / canon My Mait: standalone product/project, not yet priced and should not inherit Gener8 or Creator Studio gating by accident.

Important implementation implication: this is no longer a simple linear ladder. The code currently models access as `demo < gener8 < gener8_pro < creator_studio`. The new model needs both a durable ownership entitlement and a subscription entitlement.

Suggested internal entitlement shape:

- `owns_gener8_4ever`: permanent entitlement from one-off Lemon Squeezy order.
- `subscription_tier`: `none | gener8_pro | creator_studio`.
- `effective_gener8_access`: true if `owns_gener8_4ever` or active `gener8_pro` or active `creator_studio`.
- `effective_gener8_premium`: true if active `gener8_pro` or active `creator_studio`.
- `effective_creator_studio`: true only if active `creator_studio`.
- `effective_kasai_access`: separate, TBD, do not infer from Gener8.

## Executive Findings

P0: The auth and entitlement model is still a pure tier ladder.

- `crates/model-manager/src/manifest.rs` defines `LicenceTier` as `Demo, Gener8, Gener8Pro, CreatorStudio` and uses ordering for `satisfies()`.
- `crates/model-manager/src/manifest.rs` comments still describe old prices: demo, Gener8 USD 5/month, Gener8Pro USD 12.99/month, CreatorStudio USD 30/month.
- `platform/everywear-os/src/lib/transport.ts`, `platform/everywear-os/src/shell/AuthContext.tsx`, and `applets/gener8/web/src/context/AuthContext.tsx` all expose only a single `tier` string.
- Hybrid cancellation cannot be represented correctly with only one tier. A cancelled Pro user who owns 4ever must become "4ever/basic", while a cancelled Pro user without 4ever must lose Gener8 access.

P0: Lemon Squeezy has no local integration surface in this repo yet.

- Searches found no Lemon Squeezy webhook handlers, checkout variant IDs, subscription tables, product mapping, or license reconciliation code in Everywear.
- The current app assumes Supabase RPC `active_tier(p_user)` is canonical.
- Tomorrow's sprint needs a backend/source-of-truth amendment outside this repo or a new local integration contract documented here.

P0: `active_tier()`/`public.subscriptions.tier` is too small for the hybrid model.

- `platform/everywear-os/src/shell/AuthContext.tsx` calls `active_tier(p_user)` and expects one of `demo | gener8 | gener8_pro | creator_studio`.
- `platform/everywear-os/src-tauri/src/auth.rs` accepts the same single tier via `push_auth_state`.
- Required change: Supabase should return a richer entitlement object or a backwards-compatible tier plus durable ownership flags.

P0: Applet launch gating does not currently gate by paid tier, only by built/locked status.

- `platform/everywear-os/src-tauri/src/registry.rs` has `AppletStatus::Locked`, but built-in applets are hardcoded mostly `Active`.
- Gener8, Kasai, 1magen, Vid, S3 Studio, Strands Nation, and Avatar Studio are active at registry level; 3nvizen and Mymories are not built.
- `refresh_status()` only checks whether binaries exist; it does not apply account entitlements.
- `request_applet_switch()` blocks `Locked` and `NotBuilt`, but no current code marks applets locked based on user entitlement.

P0: My Maits is active in the Everywear launcher even though the new brief says it is standalone and not yet priced/gated.

- `platform/everywear-os/src-tauri/src/registry.rs` registers `kasai` as `AppletStatus::Active`.
- `applets/kasai/applet.toml` describes My Maits / My Maits Lite model groups, but no product-tier gate exists.
- Sprint decision needed: hide My Maits, mark locked/TBD, or keep dev-only while pricing is unresolved.

## Auth Surfaces Touched

`platform/everywear-os/src/shell/AuthContext.tsx`

- Current flow: Supabase session -> `active_tier(p_user)` -> `push_auth_state`.
- Current fields: `tier`, `isPaid`, `isPro`.
- Old trial model remains: `startTrial()` calls `demo_start`; docs say 7-day demo row.
- Amendment: replace or extend `active_tier` with an entitlement RPC, for example `active_entitlements(p_user)` returning ownership, subscription tier, Lemon Squeezy status, and computed access booleans.

`platform/everywear-os/src-tauri/src/auth.rs`

- Current `AuthStateUpdate` only accepts `tier`.
- `AuthReport` only returns `tier`, `is_paid`, `is_pro`.
- Amendment: add fields for `owns_gener8_4ever`, `subscription_tier`, `has_gener8_access`, `has_gener8_premium`, `has_creator_studio`, and eventually `has_kasai_access`.

`platform/everywear-os/src/lib/transport.ts`

- Current TS type is `LicenceTier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio'`.
- Amendment: avoid renaming the wire tier too early if this would churn. Add entitlement fields first, then migrate UI labels from raw tier strings to display names.

`platform/everywear-os/src-tauri/src/lib.rs`

- `platform_status()` exposes auth as tier/is_paid/is_pro.
- Applet launch provisioning reads `state.licence_tier` for upgrade packs.
- Amendment: provisioning should use effective entitlements, not raw tier rank.

## Lemon Squeezy Impact

Required product mapping for tomorrow:

- One-off product/variant: Gener8 4ever, USD 20.
- Subscription product/variant: Gener8 Pro, USD 13.37/month.
- Subscription product/variant: Creator Studio, USD 28.88/month.
- Optional future product/variant: Kasai / My Mait, TBD.

Required webhook/state model:

- One-off order paid/refunded/chargeback must set or revoke `owns_gener8_4ever`.
- Subscription created/resumed/paid/updated should set `subscription_tier`.
- Subscription cancelled/expired/past_due should remove Pro/Creator benefits, but preserve `owns_gener8_4ever`.
- Creator Studio active should imply Pro premium while active.
- Pro active should imply basic generation while active, even if 4ever is not owned.
- Refund/chargeback of 4ever should remove the safety net.

Current gap:

- No Lemon Squeezy code exists here. The source of truth is assumed to be Supabase `public.subscriptions` plus `active_tier()`.

## Runtime Gating Surfaces

### Shell applet launcher

Files:

- `platform/everywear-os/src-tauri/src/registry.rs`
- `platform/everywear-os/src-tauri/src/lib.rs`
- `platform/everywear-os/src/panels/LauncherGrid.tsx`

Current UX impact:

- Locked applet cards show a lock icon and ignore clicks.
- Launch commands reject `Locked` with "Applet is locked. Purchase or subscribe to unlock."
- Because registry statuses are not entitlement-derived, users currently do not see accurate paid gates.

Required amendments:

- Gener8 4ever should be launchable if `has_gener8_access`.
- Gener8 Pro/Creator Studio features should be gated inside Gener8, not by blocking the whole applet when the user owns 4ever.
- Kasai should not appear as a normal active product until its own pricing/gate is decided.
- 1magen/3nvizen need explicit placement: if they are Creator Studio components, lock or hide based on `has_creator_studio`; if standalone, do not bury them under Creator Studio naming.

### Model provisioning and upgrade packs

Files:

- `applets/gener8/applet.toml`
- `crates/model-manager/src/manifest.rs`
- `platform/everywear-os/src-tauri/src/launcher.rs`

Current behavior:

- Base Gener8 model groups are treated as base install.
- `better_models` has `min_tier = "gener8_pro"`.
- `creator_studio_bundle` has `min_tier = "creator_studio"` and is placeholder.
- `entitled_packs()` uses `tier.satisfies(pack.min_tier)`.

Required amendments:

- Base model provisioning should be allowed for `owns_gener8_4ever` or active Pro/Creator subscription.
- `better_models` should require active Pro or active Creator Studio, not 4ever ownership.
- Creator Studio bundle should require active Creator Studio only.
- Do not represent 4ever as a higher subscription tier; it is a durable base entitlement.

### Gener8 applet tier sync and reconciliation

Files:

- `applets/gener8/src-tauri/src/main.rs`
- `applets/gener8/src-tauri/src/ipc_handler.rs`
- `applets/gener8/src-tauri/src/tier_reconciler/state.rs`
- `applets/gener8/src-tauri/src/tier_reconciler/entitlement.rs`

Current behavior:

- Applet receives one HMAC-verified `TierSync` tier string.
- Reconciler maps `Demo | Gener8` to `gener8_base`, `Gener8Pro` to `gener8_pro`, and `CreatorStudio` to `creator_studio`.
- Downgrade grace is hardcoded to 30 days. Old comments say unentitled files move immediately to `.disabled`, then are swept after grace.

Hybrid risk:

- A cancelled Pro user with no 4ever should lose everything. Current grace behavior may preserve disabled model files for 30 days, which conflicts with "cancel = lose everything" unless grace is intentionally retained only for local files and not runnable access.
- A cancelled Pro user with 4ever should downgrade to basic base generation, not demo.
- A cancelled Creator Studio user with 4ever should retain basic generation, lose Pro/Creator packs.

Required amendments:

- Replace `TierSync` with `EntitlementSync` or add fields while preserving HMAC signing.
- Reconciler should compute active files from durable base ownership plus active subscription entitlements.
- Decide whether the 30-day disabled-file grace remains operational storage only or must be removed to satisfy "lose everything."

### Gener8 HTTP API / Creator Studio gates

Files:

- `applets/gener8/src-tauri/src/shim.rs`
- `applets/gener8/src-tauri/src/ai_director/mod.rs`

Current UX impact:

- `/api/lora/*`, `/api/training/*`, and `/api/patches*` return a Creator Studio required payload, but they are stubs returning 501.
- AI Director functions require `CreatorStudio`, though several shim director endpoints currently return not implemented rather than checking entitlement.

Required amendments:

- Keep LoRA/training/style patch/AI Director under active Creator Studio.
- Make errors use the new product label and price where appropriate: "Creator Studio" at USD 28.88/month.
- When implementation becomes real, entitlement checks should use `has_creator_studio`, not raw tier string.

## User-Facing Gating Surfaces

### Shell sidebar/account tier badge

File: `platform/everywear-os/src/shell/ShellLayout.tsx`

Current UX:

- Displays raw tier string with underscore replacement, e.g. `gener8 pro`.

Required change:

- Display friendly entitlement state:
  - `Gener8 4ever`
  - `Gener8 Pro`
  - `Creator Studio`
  - `Gener8 Pro + 4ever` if both active subscription and permanent base are present.

### Shared locked feature card

File: `packages/shared/src/components/LockedFeatureCard.tsx`

Current UX:

- `FeatureTier = 'pro' | 'creator-studio' | 'free'`.
- Labels are "Requires Pro", "Requires Creator Studio", "Free Tier".

Required change:

- Rename "Pro" to "Gener8 Pro" where user-facing.
- Do not call 4ever "Free Tier"; use "Included in Gener8 4ever".

### Gener8 web auth context

File: `applets/gener8/web/src/context/AuthContext.tsx`

Current UX/risk:

- In standalone/dev failure mode, it stubs the user as `creator_studio`.
- This makes every premium/Creator surface appear unlocked during dev and could mask gating bugs.

Required change:

- Dev stub should be explicit and controlled by env/config.
- Add entitlement booleans, not just `tier`.

### Gener8 Settings

File: `applets/gener8/web/src/views/SettingsView.tsx`

Current UX:

- Shows `tier.toUpperCase().replace('_', ' ')`.

Required change:

- Display new naming and ownership/subscription split.

### Gener8 / Vid visualizer gating

File: `applets/gener8/web/src/components/VideoGeneratorModal.tsx`

Current UX impact:

- `hasTier()` uses the linear order `demo, gener8, gener8_pro, creator_studio`.
- `isGener8Pro` unlocks Pro UI.
- `canRemoveWatermark` is equivalent to `hasTier('gener8_pro')`.
- Pro-gated features include export formats beyond base 540p, particle transform controls, center image toggle, watermark removal, and multiple render preset choices.
- Copy says "Upgrade to Gener8 Pro", "Enabled in Gener8 Pro", "PRO".

Bug/risk:

- `tierKey` derives from `user?.tiers`, but the local `UserProfile` type has `tier`, not `tiers`. Watermark reset on tier change may not fire correctly.

Required change:

- Pro-gated visualizer features should use `has_gener8_premium`.
- Watermark removal should use active Pro or active Creator Studio, not 4ever.
- Base export should be available to 4ever owners and active subscribers.
- Copy should say "Gener8 Pro" and can optionally show USD 13.37/month in upgrade CTA.

### Gener8 Vid tab and standalone Vid applet

Files:

- `applets/gener8/web/src/views/VidView.tsx`
- `applets/vid/web/src/views/VidView.tsx`

Current UX:

- Gener8 Vid uses `LockedFeatureCard` for AI Video and Storyboard with `creator-studio`.
- Standalone Vid copy still says "Coming with S3 Vid Pro."

Required change:

- AI Video, stem-reactive visuals, storyboarding, Remotion export should likely map to Creator Studio at USD 28.88/month unless product strategy splits Vid separately.
- Remove "S3 Vid Pro" unless that remains a separate commercial tier.

### 1magen and 3nvizen

Files:

- `applets/1magen/applet.toml`
- `applets/3nvizen/applet.toml`
- `platform/everywear-os/src/panels/LauncherGrid.tsx`

Current UX:

- Launcher nests 1magen and 3nvizen under a "Creator Studio" folder.
- 1magen is active if binary exists.
- 3nvizen is NotBuilt by default.
- No entitlement gate says Creator Studio is required.

Required change:

- If these are Creator Studio components, add an entitlement gate and user-facing lock copy.
- If 1magen is intended to be standalone, the folder grouping is misleading.

### Kasai / My Mait

Files:

- `applets/kasai/applet.toml`
- `platform/everywear-os/src-tauri/src/registry.rs`
- `applets/kasai/src/*`

Current UX:

- My Maits appears as a built active applet when its binary is present.
- Model groups are branded My Maits / My Maits Lite, but no paid tier/product gate exists.

Required change:

- Mark as standalone TBD. Do not include in Gener8 4ever, Gener8 Pro, or Creator Studio entitlement checks.
- Suggested temporary launcher state: hidden or locked with "My Maits pricing TBD" until priced.

## Old Structure To Remove Or Quarantine

Known old structure references:

- `crates/model-manager/src/manifest.rs`: old prices and old demo/trial assumptions.
- `platform/everywear-os/src/shell/AuthContext.tsx`: demo trial start and `active_tier()` single-tier assumptions.
- `applets/gener8/applet.toml`: comments say base tier is "Gener8 tier"; rename to Gener8 4ever / Local base entitlement.
- `applets/gener8/web/src/components/VideoGeneratorModal.tsx`: "Pro" labels and trial/subscription comments.
- `applets/vid/web/src/views/VidView.tsx`: "S3 Vid Pro" copy.
- `packages/shared/src/components/LockedFeatureCard.tsx`: generic "Requires Pro" and "Free Tier" labels.

## Sprint Amendment Checklist

1. Define Supabase entitlement schema/RPC.
   - Replace single `active_tier()` semantics with ownership + subscription state.
   - Keep old `tier` string only as a compatibility display field if needed.

2. Map Lemon Squeezy variants.
   - Add variant IDs for Gener8 4ever, Gener8 Pro, Creator Studio.
   - Add lifecycle handling for paid, refunded, chargeback, subscription active, cancelled, expired, paused/past_due.

3. Update shared auth types.
   - Rust `AuthStateUpdate` / `AuthReport`.
   - TS `AuthContext`, `EverywearUser`, `UserProfile`.
   - IPC `TierSync` payload or replacement.

4. Update entitlement computation.
   - Base Gener8 access: `owns_gener8_4ever || active_pro || active_creator_studio`.
   - Premium Gener8 access: `active_pro || active_creator_studio`.
   - Creator Studio access: `active_creator_studio`.
   - Kasai access: standalone TBD.

5. Update launcher statuses.
   - Mark Gener8 active only when effective base access is true, or allow launch with in-app purchase prompt if desired.
   - Lock/hide 1magen/3nvizen based on Creator Studio decision.
   - Lock/hide Kasai until product strategy lands.

6. Update Gener8 UI gates.
   - Replace `hasTier()` ladder with entitlement booleans.
   - Fix `user?.tiers` watermark reset bug.
   - Rename Pro copy to Gener8 Pro.
   - Rename base/basic copy to Gener8 4ever.

7. Update backend route gates.
   - Use `has_creator_studio` for LoRA/training/patches/director.
   - Ensure cancelled Pro/Creator without 4ever cannot run base generation.
   - Ensure cancelled Pro/Creator with 4ever can still run base generation.

8. Update copy/docs.
   - Remove old USD 5 / USD 12.99 / USD 30 references.
   - Document USD 20 one-off, USD 13.37/month, USD 28.88/month.
   - Quarantine old demo/trial assumptions unless a trial still exists.

## Recommended Naming For Code

Avoid making `gener8_4ever` a rank above demo in the same enum if possible. It behaves differently from a subscription.

Recommended:

```text
EntitlementSnapshot
  owns_gener8_4ever: bool
  subscription_tier: none | gener8_pro | creator_studio
  has_gener8_access: bool
  has_gener8_premium: bool
  has_creator_studio: bool
  has_kasai_access: bool | null
  source: lemon_squeezy | dev | manual | unknown
```

Legacy tier compatibility:

```text
demo              -> no access / signed-in unpaid
gener8            -> has_gener8_access only
gener8_pro        -> has_gener8_access + has_gener8_premium
creator_studio    -> has_gener8_access + has_gener8_premium + has_creator_studio
```

Display names:

```text
gener8            -> Gener8 4ever
gener8_pro        -> Gener8 Pro
creator_studio    -> Creator Studio
```

## Sprint Risk Notes

- The biggest risk is treating Creator Studio cancellation as a downgrade to Gener8 by rank. That is only true if the user owns 4ever.
- The second biggest risk is putting Kasai under Creator Studio because of folder or applet convenience. The brief says it is standalone.
- The third risk is updating marketing names but leaving model provisioning as rank-based; that will make refunds/cancellations wrong even if UI text looks correct.
