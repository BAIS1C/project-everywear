# 2026-05-22 Context-Bounded Migration Modularisation

## Pass 1 — Gate Recorded

Decision: further S3 Studio / Gener8 / Studio Pro applet migration is blocked on a targeted modularisation gate, not a whole-repo freeze.

Current active order:

1. Hoist the shared Gener8/Vid/S3 video worker and package scaffold.
2. Split the shared video modal into a context-sized `packages/video-modal/` surface before applying more upstream S3 deltas.
3. Split shell `platform/everywear-os/src-tauri/src/lib.rs` before adding shell migration commands.
4. Split Gener8 `applets/gener8/src-tauri/src/shim.rs` before adding S3 shim endpoints.
5. Continue remaining applet migration only after touched surfaces fit the context budget.

Context rule: S3 Studio web informs S3-derived applet behaviour. Everywear OS may borrow S3 desktop visual language, but shell lifecycle, routing, auth, entitlement, hardware ownership, and applet boundaries remain Everywear-owned.

Touched docs:

- `ARCHITECTURE_MODULES_2026-05-21.md`
- `MIGRATION_ARCHITECTURE.md`
- `WIKI.md`
- `ARCHITECTURE.md`
- `EVERYWEAR_ARCHITECTURE_2026-05-15.md`

## Pass 2 — Shared Video Package Scaffold

Created `packages/video-modal/` as `@everywear/video-modal`.

Files added:

- `packages/video-modal/package.json`
- `packages/video-modal/tsconfig.json`
- `packages/video-modal/src/index.ts`
- `packages/video-modal/src/workers/videoRenderWorker.ts`
- `packages/video-modal/src/lib/silhouetteEngine.ts`
- `packages/video-modal/src/lib/lrcParser.ts`

Verification:

- `packages/video-modal/src/workers/videoRenderWorker.ts` SHA256 matches both existing applet copies:
  - `applets/gener8/web/src/workers/videoRenderWorker.ts`
  - `applets/vid/web/src/workers/videoRenderWorker.ts`
- `packages/video-modal/src/lib/silhouetteEngine.ts` SHA256 matches the current Gener8 copy.
- `npm run build --workspace @everywear/video-modal` passed.

Note: consumers still point at their applet-local worker copies. This pass only
created a buildable shared package so the next pass can switch consumers and
remove duplicate local worker files.

## Pass 3 — Shared Worker Consumers Swapped

Changed Gener8 and Vid to consume the shared worker through
`@everywear/video-modal`.

Files changed:

- `applets/gener8/web/package.json`
- `applets/vid/web/package.json`
- `applets/gener8/web/src/components/VideoGeneratorModal.tsx`
- `applets/vid/web/src/components/VideoGeneratorModal.tsx`
- `package-lock.json`

Files removed:

- `applets/gener8/web/src/workers/videoRenderWorker.ts`
- `applets/vid/web/src/workers/videoRenderWorker.ts`

Verification:

- `npm install` linked the new workspace package.
- `npm run build --workspace @everywear/video-modal` passed.
- `npm run build --workspace @everywear/vid-web` passed.
- `npm run build --workspace @everywear/gener8-web` passed.

Implementation note: Vite package workers must be imported with `?worker`.
Using `new URL('@everywear/video-modal/...', import.meta.url)` resolved
incorrectly in Vid.

## Pass 4 — Shell `lib.rs` Command Split

Moved shell state, crash handling, and command groups out of `lib.rs`:

- `state.rs`: shared `AppState`
- `crash.rs`: pending crash report type, panic hook, `take_pending_crash_report`
- `commands/system.rs`: `get_system_info`
- `commands/gpu.rs`: GPU status, VRAM poll, backend, tier, model assessments
- `commands/profile.rs`: profile/preference commands
- `commands/wallet.rs`: wallet commands
- `commands/kasai.rs`: Kasai chat/status/tool-call commands
- `commands/discourse.rs`: native Discourse commands behind `discourse-native`
- `commands/registry.rs`: applet registry/window lookup commands
- `commands/video_encoder.rs`: shared video encoder sidecar commands
- `commands/platform.rs`: platform status report command
- `commands/migration.rs`: phase 5 migration plan/run commands

Verification:

- `cargo check -p everywear-os` passed.

Size after pass:

- `platform/everywear-os/src-tauri/src/lib.rs`: 1,359 lines, ~9.9k approximate regex tokens.

Result: the shell entry module is now under the hard 16k-token context ceiling.
Further shell migration can continue without first doing a broader shell pass.

## Pass 5 — Gener8 Shim DAW Route Split

Moved the DAW HTTP route group out of the Gener8 shim parent file.

Files changed:

- `applets/gener8/src-tauri/src/shim.rs`
- `applets/gener8/src-tauri/src/shim/daw.rs`

Implementation notes:

- `shim.rs` now merges `daw::routes()` instead of registering each DAW
  endpoint inline.
- The DAW module owns its private request structs and Axum handlers, preserving
  route URLs and JSON contracts while keeping new S3 DAW/studio endpoints out of
  the parent shim.

Verification:

- `cargo check -p gener8` passed.

Size after pass:

- `applets/gener8/src-tauri/src/shim.rs`: 1,010 lines, ~9.7k approximate regex tokens.
- `applets/gener8/src-tauri/src/shim/daw.rs`: 755 lines, ~6.8k approximate regex tokens.

Result: Gener8's parent shim is now below the hard 16k-token context ceiling
before further S3 shim endpoint migration.

## Pass 6 — Shared Video Modal Ownership Consolidation

Moved the duplicated Gener8/Vid video modal implementation into
`@everywear/video-modal` and left applet-local wrappers for app-specific context.

Files changed:

- `packages/video-modal/src/components/VideoGeneratorModal.tsx`
- `packages/video-modal/src/render/canvasVisualizers.ts`
- `packages/video-modal/src/vite-worker.d.ts`
- `packages/video-modal/src/index.ts`
- `applets/gener8/web/src/components/VideoGeneratorModal.tsx`
- `applets/vid/web/src/components/VideoGeneratorModal.tsx`

Implementation notes:

- Gener8 and Vid now consume the same shared `VideoGeneratorModal` component.
- Applet wrappers inject auth tier; Gener8 also injects Everywear Vault video
  registration while Vid leaves it unset.
- The shared canvas visualizer primitives moved into
  `packages/video-modal/src/render/canvasVisualizers.ts`.
- The render worker remains shared through
  `@everywear/video-modal/workers/videoRenderWorker.ts?worker`.

Verification:

- `npm run build --workspace @everywear/video-modal` passed.
- `npm run build --workspace @everywear/vid-web` passed.
- `npm run build --workspace @everywear/gener8-web` passed.

Size after pass:

- `applets/gener8/web/src/components/VideoGeneratorModal.tsx`: 26 lines, ~166 approximate regex tokens.
- `applets/vid/web/src/components/VideoGeneratorModal.tsx`: 24 lines, ~149 approximate regex tokens.
- `packages/video-modal/src/render/canvasVisualizers.ts`: 815 lines, ~11.3k approximate regex tokens.
- `packages/video-modal/src/components/VideoGeneratorModal.tsx`: 3,643 lines, ~36.3k approximate regex tokens.

Result: duplicated applet surfaces are now context-sized and the first shared
renderer split is complete. The shared component itself remains above the hard
16k-token ceiling, so no further video-modal feature migration should land until
it is split into controller/export/view modules.
