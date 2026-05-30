# Everywear Launcher Badge Entitlement Gating Fix

Timestamp: 2026-05-30 00:10 SGT
Location: C:\Users\MAG MSI\Project Everywear
Wing: everywear
Confidence: DERIVED
Filing mode: degraded (canonical Project Mymory vault + vault MCP not reachable
this session; only Project Everywear mounted). SYNC REQUIRED to
C:\Users\MAG MSI\Project Mymory\everywear at next Cowork session with vault access.

## Required Sources Read

- `WIKI.md` v1.1.16 launcher gating note (lines ~154-158)
- `docs/vault/2026-05-29_everywear-legacy-entitlement-backfill-fix.md`
- `platform/everywear-os/src/lib/transport.ts`
- `platform/everywear-os/src/shell/ShellLayout.tsx`
- `platform/everywear-os/src/panels/LauncherGrid.tsx`
- `platform/everywear-os/src/components/AppletIcon.tsx`
- `platform/everywear-os/src-tauri/src/registry.rs`

## Context

After the legacy entitlement backfill, the Profile screen correctly showed
Creator Studio / active / admin_override for `seanie.sean@gmail.com`, but the
launcher still rendered the S3 family as LOCKED. Sign-out/in did not clear it.
Second layer of the bug, distinct from the DB entitlement break.

## Root Cause

The launcher LOCKED badge was driven solely by the static `applet.status`
field (`AppletIcon.tsx:464`, `LauncherGrid.tsx:94/97`). That field's sources:
- Tauri path `invoke('list_applets')` -> `registry.rs`, which only ever emits
  `Active` or `NotBuilt`; `refresh_status()` only flips Active<->NotBuilt by
  binary presence on disk. It never reads entitlements and never emits Locked.
- Browser fallback `BROWSER_APPLET_REGISTRY` in `transport.ts`, which hardcoded
  `status: 'Locked'` for the S3 family.

The running 1.0.0 binary showed Locked, which the Rust registry cannot produce,
so the build was rendering the static hardcoded list / a stale bundle. Either
way the badge was disconnected from live entitlements. The entitlement-aware
gate `appletLaunchBlocked()` (ShellLayout.tsx:100) was already correct, but the
display badge never consulted it.

## Decisions

- Lock state must derive from the owner's live entitlement flags, mirroring
  `appletLaunchBlocked()`, not from the static presentation `status`.
- Centralise the resolution at the data layer so the icon/grid components need
  no contract change.
- Remove the lone hardcoded `Locked` from the browser fallback; the static list
  asserts build availability only.

## Architecture / Code Changes (source patch, 3 files, +62/-8)

- `transport.ts`: added `resolveAppletStatus(applet, entitlements)`. Rules:
  `NotBuilt` always wins; no `required_entitlements` => never a hard Locked;
  has `required_entitlements` => Active if user holds any, else Locked. Flipped
  the static 3nvizen fallback `Locked` -> `Active` (lock now entitlement-derived).
- `ShellLayout.tsx`: imported `resolveAppletStatus`; added `gatedApplets` memo
  mapping `registryApplets` through the resolver with `authUser.entitlements`;
  repointed `s3FolderApplets` and `visibleApplets` at `gatedApplets`.
- `LauncherGrid.tsx`: pulled `useAuth()`; added `gatedApplets` memo; fed it to
  `buildDesktopLayout()`.

## Completed Work

- Source patch applied and TYPECHECKED clean: `tsc --noEmit -p tsconfig.json`
  returns 0 errors across the workspace; 0 errors in the 3 changed files.
- Did NOT run `vite build` or `cargo build` (Windows/cargo toolchain not present
  in this session). Binary rebuild is the morning validation step.

## Incident Note (carry)

During the edit, an external write (running Vite dev server / editor autosave /
linter on the host) raced and TRUNCATED all three files mid-token. Recovered by
restoring the pristine committed versions from `git HEAD` and re-applying the
edits deterministically. Verified final line counts: transport.ts 561,
ShellLayout.tsx 1559, LauncherGrid.tsx 232, all with valid tails.
BEFORE REBUILD: stop any running `everywear-os` Vite dev server so it cannot
re-truncate on save, and confirm those three line counts are intact.

## Open Items / Morning Test

1. Rebuild from current source with the dev server stopped:
   `npm run build --workspace everywear-os` then
   `cargo build --release -p everywear-os -p gener8 -p onemagen -p everywear-3nvizen -p everywear-kasai`.
2. Cold relaunch (full quit, not in-app sign out/in).
3. Expected: gener8 (S3 Studio), 1magen, vid, ai-director show Active and launch
   for `seanie.sean@gmail.com`. 3nvizen will show NotBuilt (not Locked) unless
   its binary is built, because the Rust registry marks it NotBuilt and the
   resolver preserves NotBuilt over entitlements. This is correct behaviour.
4. Non-entitled accounts (e.g. the placeholder cryptolombok handle) will now
   correctly show a real entitlement-derived Locked badge.
5. Follow-up (separate): registry.rs `refresh_status()` runs once at construction
   and is only re-invoked frontend-side via the listApplets refetch on auth
   change. The badge fix lives entirely frontend-side, so this is fine, but the
   Rust-side TierSync to applets (auth.rs) remains the durable enforcement path.
6. SYNC this note to canonical Project Mymory\everywear next session.

## Entity Bridges

- everywear shell / launcher / AppletIcon / LauncherGrid / registry.rs
- resolveAppletStatus (new transport helper) <-> appletLaunchBlocked (ShellLayout)
- Continues: 2026-05-29 legacy entitlement backfill fix
- Sean Uddin: Everywear login seanie.sean@gmail.com / handle seanie / Somo Kasane
