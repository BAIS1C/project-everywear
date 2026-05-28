# Kasai Keyword Short + EWDS Provider Migration

Date: 2026-05-27

## Summary

Kasai should live inside Project Everywear as the planning/orchestration brain, not as a separate MoneyPrinterTurbo clone. The useful MoneyPrinterTurbo-shaped capability is the topic-to-short orchestration layer: narration, search terms, per-shot prompts, and handoff into the existing Everywear visual engines.

## Canon Direction

- Kasai plans and narrates.
- AI Director owns deeper shot and continuity planning when beat/music-aware direction is needed.
- `1magen` creates anchor keyframes.
- `3nvizen` creates local video segments.
- Shared Everywear video/export surfaces handle final assembly, captions, and review.

## Implemented Backend Slice

- Added `applets/kasai/src-tauri/src/short_creator.rs`.
- Added `keyword_short_creation` and compatible aliases:
  - `keyword_short_plan`
  - `short_creation`
  - `narrated_short`
  - `kasai.short.create`
- `KasaiRuntime::execute_job` detects short-creation jobs before the normal inference-ready check.
- The deterministic short plan includes:
  - narrator hook/script/subtitle mode;
  - keyword search queries and evidence notes;
  - shot timing, narration, search query, visual prompt, keyframe prompt, continuity notes;
  - render handoff steps for search, narration, `1magen`, and `3nvizen`.
- Kasai applet IPC advertises:
  - `keyword_short_creation`
  - `narrated_short_plan`

## EWDS Migration

Before this pass, theme state was forked between:

- `packages/ewds/src/ThemeContext.tsx`;
- `platform/everywear-os/src/shell/ThemeContext.tsx`;
- `applets/1magen/src/shell/ThemeContext.tsx`.

After this pass:

- `@everywear/ewds` owns the theme provider.
- Shell imports `ThemeProvider` / `useTheme` from `@everywear/ewds`.
- Standalone `1magen` imports `ThemeProvider` from `@everywear/ewds`.
- Local shell and 1magen `ThemeContext` forks were removed.
- EWDS now owns shell-needed state:
  - `theme`;
  - light mode;
  - `widgetSurface`;
  - `setTheme`;
  - `setWidgetSurface`;
  - `toggleMode`.

## Verification

- `cargo test -p everywear-kasai short_creator -- --nocapture` passed.
- `cargo check -p everywear-kasai` passed.
- `npm run build:ewds` passed.
- `npm run build` in `platform/everywear-os` passed.
- `npm run build` in `applets/1magen` passed.
- Vite shell smoke on `http://127.0.0.1:5173/` returned HTTP 200.

## Known Warnings

- Existing Kasai dead-code warnings remain in slot orchestration.
- Existing Vite dynamic/static import warning for `@tauri-apps/api/core.js` remains.
- Existing Vite module type warning for `packages/ewds/tailwind-preset.js` remains.

## Next

- Upgrade deterministic short planning into live retrieval plus Director LM planning.
- Route generated handoff steps into shell job submission for `1magen` and `3nvizen`.
- Keep all media provenance/evidence attached to the short project record.
