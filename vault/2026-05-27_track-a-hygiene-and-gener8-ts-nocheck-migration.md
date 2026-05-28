# Track A Hygiene + Gener8 Web ts-nocheck Migration Begun

Date: 2026-05-27
Recovered: 2026-05-28
Location: C:\Users\MAG MSI\Project Everywear
Owner: Sean / Codex / Claude Cowork

## Recovery Note

`CONTEXT.md` referenced this receipt at:

`vault/2026-05-27_track-a-hygiene-and-gener8-ts-nocheck-migration.md`

The file was not present in the Everywear repo when Task 36 started on
2026-05-28. Repo search, `git log --all --name-only`, and current disk search
found no committed or untracked copy under this exact name.

The receipt was recoverable from:

- `C:\Users\MAG MSI\Project Mymory\everywear\port\2026-05-27_track_a_hygiene_gener8_web_ts_nocheck_migration_begun.md`
- `C:\Users\MAG MSI\Project Mymory\CONTEXT.md` lines 1236-1239
- Codex commit `b22e86e` (`chore: seed Gener8 type hygiene migration`)
- Current Everywear `CONTEXT.md` lines 5-64

This file is therefore a reconstructed project-local receipt, not the original
missing file bytes.

## Scope

Track A was a build-hygiene pass for Everywear's shared packages and repo lint
surface. It also kicked off Track C, the Gener8 web `@ts-nocheck` migration.

## Landed

- `packages/shared/tsconfig.json` added `DOM` and `DOM.Iterable` to `lib`.
- `packages/ewds/tailwind-preset.js` was renamed to `tailwind-preset.mjs`.
- `packages/ewds/package.json` updated the `./tailwind-preset` export to the
  `.mjs` file.
- `eslint.config.mjs` was scaffolded at repo root for ESLint 9 flat config.
- Root `package.json` changed `lint` from `eslint . --ext .ts,.tsx` to
  `eslint .`.
- Root `package.json` added:
  - `@typescript-eslint/parser ^8.0.0`
  - `@typescript-eslint/eslint-plugin ^8.0.0`
- `applets/gener8/web/src/components/LoadingSpinner.tsx` had
  `// @ts-nocheck` removed and a migration note added.
- `applets/gener8/web/src/components/EmptyState.tsx` had `// @ts-nocheck`
  removed and a migration note added.
- `CONTEXT.md` received the Track A / Track C addendum.
- `WIKI.md` received and then folded the Track A addendum into current body
  sections per the wiki maintenance protocol.

## Decisions

- Shared package DOM usage is legitimate today. Adding DOM libs to
  `packages/shared/tsconfig.json` is the pragmatic fix.
- The alternative, splitting browser-dependent logger/component surfaces away
  from non-DOM shared exports, is deferred until a real non-DOM consumer needs
  it.
- EWDS Tailwind preset becomes `.mjs` instead of flipping the whole EWDS package
  to `"type": "module"`. This localizes blast radius.
- ESLint 9 flat config is the repo lint entrypoint.
- `@typescript-eslint/ban-ts-comment` is `error`.
- There is no carve-out for Gener8's file-wide `@ts-nocheck` port debt.
- `@typescript-eslint/no-explicit-any` is `warn`, not `error`, while the port
  is being stabilized.
- The red lint count from remaining `@ts-nocheck` files is intentional. It is
  the migration tracker, not noise to hide.
- Track C proceeds file-by-file:
  1. Remove pragma.
  2. Run targeted TypeScript verification.
  3. If clean, keep the pragma removed and add a migration note.
  4. If errors appear, stop and do deliberate type-bridge work.

## Verification State At Original Filing

Verification was deferred to Windows because the earlier Cowork/sandbox path
could not reliably follow workspace symlinks in `node_modules`.

Required local checks:

- `npm install`
- `npm run build --workspace @everywear/shared`
- `npm run build --workspace everywear-os`
- `npm run build --workspace @everywear/gener8-web`
- `npm run lint`

Expected lint result at that point:

- Red on remaining Gener8 `@ts-nocheck` files.
- Roughly 68 remaining `ban-ts-comment` errors after the two seed removals.
- Roughly 24 `no-explicit-any` warnings.

## Follow-up Evidence

Task 35 later committed the product-side work as:

`b22e86e chore: seed Gener8 type hygiene migration`

That commit includes the Track A hygiene files and an expanded Track C batch:

- `ConfirmDialog.tsx`
- `EmptyState.tsx`
- `LibraryView.tsx`
- `LoadingSpinner.tsx`
- `LrcExport.tsx`
- `Toast.tsx`
- `eslint.config.mjs`
- `package.json`
- `packages/ewds/package.json`
- `packages/ewds/tailwind-preset.mjs`
- `packages/shared/tsconfig.json`

The separate MyMory batch note
`C:\Users\MAG MSI\Project Mymory\everywear\port\2026-05-27_track-c-gener8-ts-nocheck-batch-1.md`
records five attempted small-file migrations:

- `LrcExport.tsx`: clean
- `Toast.tsx`: clean
- `ConfirmDialog.tsx`: clean
- `LibraryView.tsx`: clean
- `TauriOnly.tsx`: skipped before mutation because note-placement preconditions
  did not match the file's decorative comment header

## Open Items

- Run the required local npm verification commands after dependency install.
- Continue Track C in small batches.
- Keep `@ts-nocheck` red in lint until each file has been deliberately
  triaged.
- Do not bulk-remove pragmas from oversized Gener8 modules such as
  `CreatePanel.tsx`, `VideoGeneratorModal.tsx`, `StemStudio.tsx`, or
  `api.ts` without a focused type-bridge pass.

## Related Notes

- `CONTEXT.md`
- `WIKI.md`
- `docs/_ooda/2026-05-28_everywear_pre_mymory_audit.md`
- `C:\Users\MAG MSI\Project Mymory\everywear\port\2026-05-27_track_a_hygiene_gener8_web_ts_nocheck_migration_begun.md`
