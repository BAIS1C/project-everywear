# 2026-05-26 Full Codebase Review

## Summary

The repository is substantially healthier than the 2026-05-24 context note
claimed. The main Rust workspace checks and tests now pass, and the primary
frontend applets build. The remaining problems are concentrated in standalone
shared-package typing, lint tooling, and product/runtime surfaces that compile
but are intentionally stubbed or fallback-driven.

## Verified Commands

Passed:

- `cargo check --workspace --all-targets`
- `cargo test --workspace`
- `npm run build --workspace everywear-os`
- `npm run build --workspace onemagen`
- `npm run build --workspace kasai-applet`
- `npm run build --workspace @everywear/gener8-web`
- `npm run build --workspace @everywear/vid-web`
- `npm run build --workspace @everywear/loom`
- `npm run build --workspace @everywear/character-studio`
- `npm run build --workspace @everywear/ewds`
- `npm run build --workspace @everywear/transport`
- `npm run build --workspace @everywear/video-modal`

Failed:

- `npm run build --workspace @everywear/shared`
- `npm run lint`

## Build Failures

### Shared Package

`@everywear/shared` fails because `packages/shared/tsconfig.json` only includes
`ES2021` in `compilerOptions.lib`, while `packages/shared/src/lib/logger.ts`
uses browser/Web APIs:

- `setInterval`
- `clearInterval`
- `crypto`
- `performance`

The shared logger also imports types from `@everywear/transport`. Since the
transport package source uses DOM APIs, the shared package build reports missing
names for:

- `window`
- `fetch`
- `WebSocket`
- `File`
- `btoa`

Likely fix: add DOM libs to the shared package TS config, or split logger and
transport-facing exports so the shared package can remain non-DOM.

### Lint

The root lint script runs ESLint 9:

`eslint . --ext .ts,.tsx`

ESLint 9 requires a flat config file named `eslint.config.js`,
`eslint.config.mjs`, or `eslint.config.cjs`. The repo currently has no such
config, so lint fails before examining source files.

## What Is In The Codebase

- Rust/Tauri shell under `platform/everywear-os`.
- React/Vite frontend shell with desktop launcher, applet windows, settings,
  profile, wallet, logs, auth gate, Layer U OSINT, and inline applet routing.
- Rust applet backends for 1magen, 3nvizen, Kasai, and Gener8.
- React applet/frontends for 1magen, Kasai, Gener8 web, Vid web, Loom,
  Character Studio, and 3nvizen source embedded through the shell build.
- Shared Rust crates:
  - `applet-ipc`
  - `beats-engine`
  - `data-migration`
  - `everywear-paths`
  - `mait`
  - `model-manager`
  - `vault`
  - `video-encoder`
- Shared TypeScript packages:
  - `@everywear/ewds`
  - `@everywear/shared`
  - `@everywear/transport`
  - `@everywear/video-modal`

## What Should Work

Based on builds/tests, these should be expected to compile and be usable at
their current level of implementation:

- Shell frontend production build.
- 1magen frontend production build.
- Kasai frontend production build.
- Gener8 web frontend production build.
- Vid web frontend production build.
- Loom frontend package build.
- Character Studio frontend package build.
- EWDS, transport, and video-modal packages.
- Rust workspace compile checks.
- Rust test coverage around model manager, applet manifests, vault indexing,
  data migration, path resolution, beats, MAIT store, Kasai tool/audit parsing,
  shell registry/router/scheduler/model setup, and related units.

## What Is Still Bugged Or Incomplete

- `@everywear/shared` standalone build is red.
- Root lint command is red until ESLint flat config is added or ESLint is pinned
  back to a config-compatible version.
- Gener8 ACE sidecar fallback can silently serve empty audio through the
  installed "silence stub" when the real ACE server binary is missing.
- Shell sidecar archive download/extract/verification is still not implemented.
- Kasai `web_fetch` is a stub. It logs and returns `"status": "stubbed"`.
- Gener8 generic studio IPC endpoint throws "not wired yet".
- Gener8 comments throw `501`, while cross-user profile/social/featured
  surfaces are intentionally stubbed to empty for the current ship scope.
- Lemon Squeezy variant IDs are marked stale, and upgrade/downgrade helpers are
  pending Edge Functions.
- `3nvizen` is included in the shell build and has Rust/React source, but lacks
  a root `applets/3nvizen/package.json`, so it is not independently buildable as
  a workspace package.
- `s3studio`, `mymories`, and `strands-game` applet folders have no package
  manifests in this repo.
- `mymories` remains `NotBuilt`/`Placeholder` in the shell registry.

## Architectural Notes

- The shell registry marks active or near-active surfaces for `1magen`,
  `gener8`, `vid`, `ai-director`, `kasai`/My Mait, `layeru-osint`, `3nvizen`,
  `character-studio`, and `loom`.
- `crates/vault` now has real Tantivy-backed indexing and tests for image/audio/
  video search, favorites, tags, applet filtering, and stats. LanceDB/vector
  search is still absent.
- `crates/mait` has real Strands Avatar v1 import and manifest store CRUD.
- The inspected shell state now uses `applet_processes` as a
  `HashMap<String, AppletProcess>`, so older notes about a single
  `applet_process` owner are stale for the current tree.

## Dirty Worktree During Audit

Existing user edits were present and were not reverted:

- `applets/gener8/web/src/services/api.ts`
- `applets/gener8/web/src/shell/applets/Gener8Core.tsx`
- `crates/vault/src/index.rs`
- `platform/everywear-os/src-tauri/src/migration.rs`
- `platform/everywear-os/src/shell/ShellLayout.tsx`

## Recommended Next Pass

1. Fix `@everywear/shared` typings.
2. Add or migrate ESLint flat config.
3. Make the ACE silence-stub state highly visible in the UI/API so empty
   generation cannot masquerade as real output.
4. Decide whether `3nvizen` should become an independent npm workspace or remain
   shell-embedded only.
5. Replace intentionally stubbed social/payment/web-fetch surfaces in priority
   order before calling those app areas production-ready.
