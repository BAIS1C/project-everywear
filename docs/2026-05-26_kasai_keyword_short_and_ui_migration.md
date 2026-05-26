# Kasai Keyword Short + EWDS UI Migration

Date: 2026-05-26

## Intent

Kasai should live inside Project Everywear as the planning/orchestration brain, not as a separate MoneyPrinterTurbo clone. The Everywear-native short creation path is:

1. Kasai turns a topic plus keywords into a narrated short plan.
2. Kasai emits search queries and evidence notes for research-safe retrieval.
3. Kasai emits per-shot narration, keyframe prompts, video prompts, and continuity notes.
4. `1magen` receives keyframe prompts.
5. `3nvizen` receives video segment prompts plus frame references.
6. Existing Everywear video assembly/export surfaces handle final muxing, captions, and review.

This keeps the MoneyPrinterTurbo capability shape while avoiding duplicated renderer, stock-media, and app UI layers.

## Implemented Slice

- Added `applets/kasai/src-tauri/src/short_creator.rs`.
- Added `keyword_short_creation` and alias detection for Kasai IPC jobs.
- `KasaiRuntime::execute_job` now returns a structured plan for short-creation jobs before requiring an LLM model handoff.
- Kasai advertises `keyword_short_creation` and `narrated_short_plan` capabilities over applet IPC.
- The plan includes:
  - narrator hook/script/subtitle mode;
  - keyword search queries and evidence notes;
  - shot timing, narration, visual prompts, keyframe prompts, continuity notes;
  - render handoff steps for search, narration, `1magen`, and `3nvizen`.

## UI Migration Architecture

Before this pass, Everywear UI theme state had drifted:

- `packages/ewds` owned the canonical EWDS provider.
- `platform/everywear-os` had a local `ThemeContext`.
- `applets/1magen` had another local `ThemeContext`.

The migration target is one shared provider:

- `@everywear/ewds` owns skin, accent, mode, theme alias, and widget surface state.
- Platform shell imports `ThemeProvider` and `useTheme` from `@everywear/ewds`.
- Standalone applets import the same provider.
- Shell-only needs that are already product UI, such as light mode and widget surface, are promoted into EWDS instead of kept as shell forks.

## Implemented UI Migration

- Extended `packages/ewds/src/ThemeContext.tsx` with:
  - `theme`;
  - `widgetSurface`;
  - `setTheme`;
  - `setWidgetSurface`;
  - `toggleMode`;
  - light mode availability.
- Extended `packages/ewds/src/types.ts` and `packages/ewds/src/index.ts`.
- Migrated `platform/everywear-os` to import EWDS theme APIs directly.
- Migrated standalone `1magen` to import EWDS `ThemeProvider`.
- Removed obsolete local theme providers from:
  - `platform/everywear-os/src/shell/ThemeContext.tsx`;
  - `applets/1magen/src/shell/ThemeContext.tsx`.

## Verification

- `cargo test -p everywear-kasai short_creator -- --nocapture`
- `cargo check -p everywear-kasai`
- `npm run build:ewds`
- `npm run build` in `platform/everywear-os`
- `npm run build` in `applets/1magen`
- Vite shell smoke: `http://127.0.0.1:5173/` returned HTTP 200.

Known existing warnings remain:

- Cargo dead-code warnings in Kasai slot orchestration.
- Vite dynamic/static import chunk warning for `@tauri-apps/api/core.js`.
- Vite module type warning for `packages/ewds/tailwind-preset.js`.
