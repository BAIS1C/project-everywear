# Everywear OODA Audit - Pre-MyMory Plugin Clone

**Date:** 2026-05-28  
**Timestamp:** 2026-05-28T12:14+08:00 SGT  
**Auditor:** Codex CLI  
**Location:** C:\Users\MAG MSI\Project Everywear  
**Purpose:** Pre-flight before adding `packages/mymory-vault/` as the shippable MyMory Vault substrate.

## Worktree state

### Branch and history

- Current branch: `main`
- Upstream: `origin/main`
- Ahead/behind: no ahead or behind marker reported by `git branch -vv`.
- Current HEAD: `ee497bb fix`
- Recent commits:

```text
ee497bb fix
5649aa6 vault
8469000 fixes
65227d5 updates
e67602c auth
f68d4ff Update AuthGate.tsx
e6150da kas n supabase
f9dfe11 Update ProfilePanel.tsx
245d4be auth
35bc6af vault
9235120 integration of gener8
c477343 kas integration
f15a7fe gener8 integration
2832450 widgest and icons
c917445 design pass
5f5d5a2 modularisation
4e7507b modularisation pass
d38e293 Add EWDS desktop context docs
bd5de81 Lock desktop icon canon and inference HUD
da7b343 Canonize desktop icon system
```

### Dirty files

No staged files were reported.

Unstaged tracked changes:

| Status | Path | Cleanup recommendation |
|---|---|---|
| Modified | `WIKI.md` | Commit with current context/doc drift fixes before task 30. |
| Modified | `applets/gener8/web/src/components/ConfirmDialog.tsx` | Commit as Track C Gener8 ts-nocheck migration WIP if verified. |
| Modified | `applets/gener8/web/src/components/EmptyState.tsx` | Commit as Track C seed migration. |
| Modified | `applets/gener8/web/src/components/LibraryView.tsx` | Commit as Track C migration WIP if verified. |
| Modified | `applets/gener8/web/src/components/LoadingSpinner.tsx` | Commit as Track C seed migration. |
| Modified | `applets/gener8/web/src/components/LrcExport.tsx` | Commit as Track C migration WIP if verified. |
| Modified | `applets/gener8/web/src/components/Toast.tsx` | Commit as Track C migration WIP if verified. |
| Modified | `docs/wiki/README.md` | Commit with docs/wiki contract update. |
| Modified | `docs/wiki/gener8/vault-library.md` | Commit with Gener8 Vault docs update. |
| Modified | `ooda-codebase.skill` | Commit separately as local tooling package repair, or move out of product commit. |
| Modified | `package.json` | Commit with lint/build hygiene dependency script changes after install verification. |
| Modified | `packages/ewds/package.json` | Commit with EWDS tailwind preset export map change. |
| Deleted | `packages/ewds/tailwind-preset.js` | Commit together with `.mjs` replacement. |
| Modified | `packages/shared/tsconfig.json` | Commit with DOM lib build hygiene fix. |
| Modified | `skills/ooda-codebase/scripts/measure_codebase.py` | Commit separately with `ooda-codebase.skill`, not with product feature changes. |

Untracked files:

| Path | Cleanup recommendation |
|---|---|
| `AGENTS.md` | Commit if this is the portable operating prompt now canonical for Everywear. |
| `eslint.config.mjs` | Commit with Track A lint scaffold after dependency/install verification. |
| `packages/ewds/tailwind-preset.mjs` | Commit with removal of `tailwind-preset.js`. |
| `platform/everywear-os/src-tauri/examples/vault_register_audio_files.rs` | Commit if this remains the accepted local Vault registration utility; otherwise move to docs/examples later. |
| `vault/2026-05-27_gener8-overnight-acceptance.md` | Migrate to `docs/vault/` before task 30 or commit in place with explicit follow-up. |
| `vault/2026-05-27_kasai-keyword-short-and-ewds-provider-migration.md` | Migrate to `docs/vault/` before task 30 or commit in place with explicit follow-up. |
| `vault/2026-05-27_kasai-sports-picks-browser-mcp.md` | Migrate to `docs/vault/` before task 30 or commit in place with explicit follow-up. |

### Stashes and in-flight ops

- `git stash list`: no stashes reported.
- Merge, rebase, cherry-pick, bisect state: none detected.

## Top-level structure

| Directory | Purpose from disk | Classification | Notes |
|---|---|---|---|
| `.codex/` | Local run logs for applets and shell. | Scratch/tooling artefacts | Should stay ignored or outside product docs. |
| `.codex-runlogs/` | More local dev server and Tauri run logs. | Scratch/tooling artefacts | Not a task 30 blocker, but keep out of docs/source commits. |
| `.github/` | CI workflow. | Config | `ci.yml` present. |
| `applets/` | Applet frontends/backends. | Source packages | 188 source files excluding generated outputs. |
| `crates/` | Shared Rust crates. | Source packages | 8 workspace crates on disk. |
| `docs/` | Product, developer, wiki, architecture docs. | Documentation | Correct canonical home for future docs. |
| `engines/` | Native engine README placeholders. | Runtime docs/placeholders | No engine binaries in this scan. |
| `marketing/` | Capture harness and screenshot assets. | Marketing artefacts | Not part of task 30 package. |
| `node_modules/` | npm dependencies. | Vendored/build dependency | Excluded from scan. |
| `packages/` | Shared npm packages. | Source packages | Actual package convention is `packages/`, not `pckgs/`. |
| `platform/` | Everywear OS shell. | Source package | Tauri shell package. |
| `skills/` | Context and OODA skill source plus IGCSE skill. | Tooling/source | Product-facing skill source needs a clearer boundary before `mymory-vault`. |
| `target/` | Rust build output. | Build artefact | Excluded from scan. |
| `vault/` | Markdown decision/audit/product notes about Everywear Vault and adjacent work. | Documentation currently in wrong namespace | Should migrate to `docs/vault/`; reserve root `vault/` for runtime/data substrate only if needed. |

Naming inconsistencies:

- User prompt mentioned `pckgs/ewds`, but disk has `packages/ewds`. There is no `pckgs/` directory. Treat `pckgs` as stale wording unless Sean explicitly wants a new convention.
- Root `vault/` is documentation, not runtime substrate. This conflicts with the locked direction reserving Vault namespace for actual data/runtime substrate.
- `skills/` and root `ooda-codebase.skill` are tooling source/package artefacts inside the product repo. That is acceptable if deliberate, but it should not be confused with the future shippable `packages/mymory-vault/` package.

## Module fitness

Scan scope: `.ts`, `.tsx`, `.js`, `.mjs`, `.rs`, and `.md`, excluding `node_modules`, `target`, `dist`, `.next`, `build`, `.git`, and `__pycache__`.

- Total scanned files: 400
- Estimated total tokens by chars/4: 1,085,991
- Bucket distribution:

| Bucket | Count |
|---|---:|
| `<= 2k tokens` | 253 |
| `2k to 8k tokens` | 117 |
| `8k to 16k tokens` | 22 |
| `16k to 28k tokens` | 4 |
| `28k to 65k tokens` | 4 |
| `> 65k tokens` | 0 |

### Oversize files

Oversize means `> 16,000` estimated tokens or `> 4,000` lines.

| Path | Lines | Tokens | Split recommendation |
|---|---:|---:|---|
| `applets/gener8/web/src/components/VideoGeneratorModal.tsx` | 4,372 | 51,443 | Stop adding features here. Replace with thin wrapper around `packages/video-modal`, then delete duplicated render/audio/Pexels/FFmpeg/slideshow code from the applet copy. |
| `packages/video-modal/src/components/VideoGeneratorModal.tsx` | 3,643 | 42,863 | Split into modal shell, render settings, background media controls, text/subtitle controls, FFmpeg/export orchestration, audio analyser hook, and preset definitions. |
| `applets/gener8/web/src/components/CreatePanel.tsx` | 3,449 | 41,375 | Split model selection, reference/cover upload, advanced generation controls, lyric editor, preset calculation, and submit payload assembly. |
| `WIKI.md` | 3,044 | 33,302 | Keep as legacy onboarding index. Move current module contracts into `docs/wiki/` and current decision receipts into `docs/vault/`. |
| `applets/gener8/web/src/components/studio/StemStudio.tsx` | 2,090 | 19,269 | Split stem validation, waveform/transport UI, repaint overlay, track row, extraction orchestration, and pro model download/status logic. |
| `MIGRATION_ARCHITECTURE.md` | 1,701 | 18,122 | Archive under `docs/migration/` or `docs/gener8/` and link from a short current-state index. |
| `applets/gener8/src-tauri/src/shim.rs` | 1,985 | 16,782 | Continue existing route split: move model inventory, generation request mapping, library/playlists, Vault import/register, and DAW endpoints into dedicated modules. |
| `applets/gener8/web/src/services/api.ts` | 1,805 | 16,313 | Split generated song APIs, engine APIs, library/Vault APIs, payments/social APIs, and shared request/auth helpers. |

### Approaching-ceiling files

Approaching means `> 8,000` estimated tokens or `> 2,000` lines.

| Path | Lines | Tokens | Split recommendation |
|---|---:|---:|---|
| `CONTEXT.md` | 1,039 | 15,910 | Convert old narrative blocks into link stubs that point to dated docs under `docs/` and `docs/vault/`. |
| `platform/everywear-os/src-tauri/src/lib.rs` | 1,513 | 13,749 | Keep bootstrap thin. Move command registration groups and AppState builders into `commands/*` and state modules. |
| `platform/everywear-os/src-tauri/src/migration.rs` | 1,536 | 12,847 | Split import discovery, receipt writing, legacy path mapping, and Vault registration helpers. |
| `platform/everywear-os/src/shell/ShellLayout.tsx` | 1,420 | 12,724 | Split titlebar, sidebar, applet content router, taskbar/window state, and shell-level dialogs. |
| `ARCHITECTURE_MODULES_2026-05-21.md` | 832 | 12,293 | Archive as historical OODA artefact under `docs/_archive/` or link from `docs/wiki/README.md`. |
| `applets/gener8/web/src/components/UserProfile.tsx` | 729 | 12,280 | Split profile header, edit form, stats/social tabs, and API mutation hooks. |
| `applets/gener8/web/src/components/studio/StudioTab.tsx` | 1,174 | 12,251 | Split tab orchestration, mode panels, shared studio state, and render selection controls. |
| `applets/gener8/web/src/components/SongList.tsx` | 937 | 12,156 | Split list row/card, sorting/filtering, empty/loading states, and drag/drop or playback integration. |
| `applets/gener8/web/src/components/RightSidebar.tsx` | 839 | 12,047 | Split now-playing, queue/playlist, metadata, and action panels. |
| `applets/gener8/web/src/shell/applets/Gener8Core.tsx` | 1,081 | 11,063 | Split app shell, route/view selection, song store wiring, and command bus bindings. |
| `applets/gener8/web/src/components/Player.tsx` | 780 | 10,958 | Split transport controls, waveform/progress, metadata/actions, queue integration, and hotkeys. |
| `applets/gener8/web/src/workers/videoRenderWorker.ts` | 1,061 | 10,338 | Remove applet duplicate after shared worker adoption, or split render protocol, frame compositor, codec muxing, and progress reporting. |
| `packages/video-modal/src/workers/videoRenderWorker.ts` | 1,060 | 10,334 | Split worker message protocol, frame render loop, encoder bridge, and compositor helpers. |
| `applets/gener8/web/src/components/StyleForge.tsx` | 896 | 9,601 | Split style patch form, gallery/list, preview, and persistence/API hooks. |
| `applets/gener8/web/src/components/studio/DawPage.tsx` | 967 | 9,240 | Split DAW timeline, mixer, transport, riff bank, and API polling state. |
| `applets/gener8/web/src/components/UpgradeModal.tsx` | 933 | 9,064 | Split plan cards, billing actions, model download matrix, and shared pricing constants. |
| `applets/gener8/web/src/components/SongProfile.tsx` | 634 | 8,794 | Split profile fetch/mutation hook, meta tag management, edit controls, and playback/share panels. |
| `crates/model-manager/src/local_discovery.rs` | 1,114 | 8,688 | Split scan targets, file classification, GGUF metadata parser, safetensors parser, and compatibility checks. |
| `platform/everywear-os/src-tauri/src/launcher.rs` | 979 | 8,581 | Split requirement check, purge execution, model provisioning, sidecar provisioning, binary resolution, and process launch. |
| `applets/kasai/src-tauri/src/slot_manager.rs` | 1,020 | 8,427 | Split model slot state, tool executors, turn loop, audit conversion, and tests. |
| `packages/video-modal/src/render/canvasVisualizers.ts` | 815 | 8,037 | Split visualizer families into individual modules and export a registry. |
| `applets/gener8/web/src/views/DawView.tsx` | 883 | 8,002 | Split DAW view into transport bar, timeline lane, riff bank panel, inspector, and API hook. |

## Documentation coverage

### Workspace coverage

Root `package.json` lists 15 npm workspaces or workspace patterns. Expanded disk coverage:

| Workspace | package.json | Description | README | WIKI | ARCHITECTURE |
|---|---:|---:|---:|---:|---:|
| `packages/ewds` | yes | yes | no | no | no |
| `packages/shared` | yes | yes | no | no | no |
| `packages/transport` | yes | yes | no | no | no |
| `packages/video-modal` | yes | yes | no | no | no |
| `platform/everywear-os` | yes | no | no | no | no |
| `applets/1magen` | yes | yes | no | no | no |
| `applets/s3studio` | no | no | no | no | no |
| `applets/3nvizen` | no | no | yes | no | no |
| `applets/kasai` | yes | yes | no | no | no |
| `applets/character-studio` | yes | no | no | no | no |
| `applets/gener8/web` | yes | yes | no | no | no |
| `applets/vid/web` | yes | yes | no | no | no |
| `applets/loom` | yes | yes | no | no | no |
| `applets/mymories` | no | no | no | no | no |
| `applets/strands-game` | no | no | no | no | no |

Module contract pages exist under `docs/wiki/`, but package-local README/WIKI coverage is thin. That is acceptable if `docs/wiki/` is canonical, but the root package descriptions alone are not enough for fresh-agent maintenance.

### Large-module coverage ratio

Source modules over 500 lines: 52.

- Strict coverage, defined as root `WIKI.md` hit or sibling markdown: 25/52.
- Broad coverage, defined as any repo markdown mentioning the path, filename, or stem: 44/52.
- Strict coverage ratio: 48.1 percent.
- Broad coverage ratio: 84.6 percent.

Broad gaps that need module docs:

| Module | Lines | Proposed doc scope |
|---|---:|---|
| `applets/gener8/web/src/components/studio/StudioTab.tsx` | 1,174 | Document the Studio tab state machine, mode panels, and handoff between Create, DAW, stems, and complete flows. |
| `applets/gener8/web/src/components/SongList.tsx` | 937 | Document song list data source, sorting/filtering, playback hooks, and Vault-backed library expectations. |
| `applets/gener8/web/src/components/UpgradeModal.tsx` | 933 | Document plan/tier semantics, model download UI, and billing boundary. |
| `applets/gener8/web/src/components/StyleForge.tsx` | 896 | Document Style Forge assets, patch taxonomy, persistence contract, and relationship to Vault style patches. |
| `applets/gener8/web/src/components/RightSidebar.tsx` | 839 | Document sidebar responsibilities and its coupling to player, queue, and metadata state. |
| `applets/gener8/web/src/components/SongProfile.tsx` | 634 | Document profile route, metadata editing, share/social behavior, and ownership mutation flow. |
| `applets/gener8/web/src/components/SettingsModal.tsx` | 587 | Document user settings, app-level preferences, and what remains local versus shell-owned. |
| `applets/gener8/web/src/components/BetterModelsBanner.tsx` | 528 | Document pro model pack call-to-action, feature flags, and display conditions. |

## Wiki/Context drift

### Current docs checked

- `WIKI.md`: last updated 2026-05-27, current enough but overloaded and internally contradictory.
- `ARCHITECTURE.md`: last updated 2026-05-27, current enough but still contains layout drift in its main body.
- `CONTEXT.md`: last updated 2026-05-27, current enough but near the 16k token ceiling.
- `docs/wiki/README.md`: refreshed 2026-05-27, lists current module contract pages.

### Drift findings

| Area | Evidence | Impact | Recommendation |
|---|---|---|---|
| `CONTEXT.md` references missing Track A receipt | `CONTEXT.md` points to `vault/2026-05-27_track-a-hygiene-and-gener8-ts-nocheck-migration.md`, but no matching file exists on disk. | High | Recover or recreate that receipt before moving `vault/` docs, or update the context pointer to the real note if renamed. |
| Root `WIKI.md` says shell and 1magen still have local `ThemeContext.tsx` forks | `WIKI.md` file map lines still list local `ThemeContext.tsx`; current addenda say EWDS owns `ThemeProvider` and local forks were removed. | Medium | Update old body sections or mark them historical. |
| Root `WIKI.md` still lists Vid and Kasai build failures | Older body says Vid malformed JSX and Kasai missing `ToolCallCard`; `CONTEXT.md` 2026-05-26 says Vid, Gener8 web, and Kasai frontend were green. | Medium | Replace stale implementation status table with "last verified" links to current context. |
| `ARCHITECTURE.md` main layout still describes `applets/s3studio/engines/*` | Disk has `applets/s3studio` as placeholder only; Gener8 lives at `applets/gener8`. | Medium | Add a current-state correction near the monorepo layout or move old S3 structure to historical migration notes. |
| Cargo dependency alias still says `ew-vault` | `Cargo.toml` workspace dependency maps `ew-vault = { path = "crates/vault" }` while docs say canonical crate name is `vault`. | Medium | Decide whether alias is intentional compatibility or rename dependency to `vault` in code/docs together. Not a package-clone blocker. |
| `docs/wiki/README.md` lists only modularisation-era module contracts | Many >500 line modules, especially Gener8 UI surfaces, have no contract page. | Medium | Add targeted docs before touching those modules again. |
| Root `vault/` holds docs | Locked direction says `docs/vault/` should hold docs about the Vault subsystem. | High | Migrate docs before adding `packages/mymory-vault/` to avoid namespace collision. |

## In-flight workstream state

### Track A, build hygiene

`CONTEXT.md` records the following landed or intended changes:

- `packages/shared/tsconfig.json` gained `DOM` and `DOM.Iterable`.
- `packages/ewds/tailwind-preset.js` was renamed to `tailwind-preset.mjs`.
- `eslint.config.mjs` was scaffolded.
- `package.json` lint script was updated.
- Verification was deferred to Windows because workspace symlinks were unreliable in the previous sandbox.

The detailed receipt referenced by `CONTEXT.md` is missing from `vault/`.

### Track B, EWDS provider migration and Kasai short planner

`vault/2026-05-27_kasai-keyword-short-and-ewds-provider-migration.md` records:

- Kasai short planning is deterministic and lives in `applets/kasai/src-tauri/src/short_creator.rs`.
- Compatible aliases include `keyword_short_creation`, `keyword_short_plan`, `short_creation`, `narrated_short`, and `kasai.short.create`.
- Shell and 1magen now import `ThemeProvider` and `useTheme` from `@everywear/ewds`.
- Verification passed for Kasai tests/checks, EWDS build, shell build, 1magen build, and shell HTTP smoke.

This work touches `applets/kasai`, `packages/ewds`, `platform/everywear-os`, and `applets/1magen`. Adding `packages/mymory-vault/` will not directly conflict, but the dirty EWDS/package metadata should be landed first.

### Track C, Gener8 ts-nocheck migration

`CONTEXT.md` records:

- 70 Gener8 web components carried blanket `@ts-nocheck` pragmas.
- Seed removals were `LoadingSpinner.tsx` and `EmptyState.tsx`.
- Current disk shows additional migrated headers in `ConfirmDialog.tsx`, `LibraryView.tsx`, `LrcExport.tsx`, and `Toast.tsx`.
- Current disk still has many `@ts-nocheck` files, including major files such as `CreatePanel.tsx`, `VideoGeneratorModal.tsx`, `api.ts`, `Player.tsx`, `SongList.tsx`, `StudioTab.tsx`, and `StemStudio.tsx`.

Adding a new package does not disrupt this work mechanically, but running lint after adding the package will be noisy until the Track C baseline is intentionally managed.

### Gener8 overnight acceptance

`vault/2026-05-27_gener8-overnight-acceptance.md` records:

- Debug app path: `target/debug/everywear-os.exe`.
- Plain, Reference, and Cover jobs completed.
- A new local example was added at `platform/everywear-os/src-tauri/examples/vault_register_audio_files.rs`.
- Shell navigation became blocked between Vault, Gener8, and Vid Studio.
- Follow-ups include shell/window navigation repair and immediate typed Vault registration for Gener8 outputs.

This is relevant to task 30 because the future `packages/mymory-vault/` should not inherit ambiguous "manual registration example as product path" semantics.

## Proposed folder taxonomy

Recommended canonical structure from disk reality and Sean's locked decisions:

```text
Project Everywear/
  applets/
    1magen/
    3nvizen/
    character-studio/
    gener8/
    kasai/
    loom/
    mymories/
    s3studio/
    strands-game/
    vid/
  crates/
    applet-ipc/
    beats-engine/
    data-migration/
    everywear-paths/
    mait/
    model-manager/
    vault/
    video-encoder/
  packages/
    ewds/
    mymory-vault/        # NEW after this audit, source package not docs
    shared/
    transport/
    video-modal/
  platform/
    everywear-os/
  docs/
    _archive/            # historical root docs that are no longer current state
    _ooda/               # OODA reports, including this report
    applets/
      1magen/
      3nvizen/
      character-studio/
      gener8/
      kasai/
      loom/
      vid/
    developers/
    ewds/
    gener8/              # current Gener8 migration/product notes
    migration/
    vault/               # docs about Everywear Vault product/substrate
    wiki/                # module contract pages
  engines/
  marketing/
  skills/                # local agent/tooling skills only if intentionally repo-owned
  vault/                 # reserve for runtime/data substrate only, or remove after doc migration
```

Decision on `pckgs`:

- Disk uses `packages/`.
- `pckgs/` does not exist.
- Do not introduce `pckgs/` for task 30. Add `packages/mymory-vault/`.

## Migration plan

No migrations were executed in this audit.

### Root `vault/` documentation moves

Move these files one-for-one into `docs/vault/` unless a per-applet location is called out below. Reversible by moving them back to `vault/`.

| Current path | Proposed path | Notes |
|---|---|---|
| `vault/2026-05-17_kasai-model-inventory-first.md` | `docs/applets/kasai/2026-05-17_kasai-model-inventory-first.md` | Kasai applet note. |
| `vault/2026-05-18_3nvizen-ltx-design-architecture.md` | `docs/applets/3nvizen/2026-05-18_3nvizen-ltx-design-architecture.md` | 3nvizen architecture note. |
| `vault/2026-05-18_auth-tier-gating-audit-hybrid-pricing.md` | `docs/vault/2026-05-18_auth-tier-gating-audit-hybrid-pricing.md` | Cross-product entitlement and Vault-related gating. |
| `vault/2026-05-18_ooda-project-state.md` | `docs/_ooda/2026-05-18_ooda-project-state.md` | Historical OODA note. |
| `vault/2026-05-19_shell-desktop-frontend-pass.md` | `docs/ewds/2026-05-19_shell-desktop-frontend-pass.md` | Shell/EWDS canon. |
| `vault/2026-05-22_context-bounded-migration-modularisation.md` | `docs/migration/2026-05-22_context-bounded-migration-modularisation.md` | Modularisation receipt. |
| `vault/2026-05-22_gener8-riff-daw-add-layer.md` | `docs/applets/gener8/2026-05-22_gener8-riff-daw-add-layer.md` | Gener8 DAW note. |
| `vault/2026-05-22_post-modularisation-ooda-audit.md` | `docs/_ooda/2026-05-22_post-modularisation-ooda-audit.md` | Historical OODA report. |
| `vault/2026-05-23_gener8-riff-daw-s3-test-sync.md` | `docs/applets/gener8/2026-05-23_gener8-riff-daw-s3-test-sync.md` | Gener8 S3 sync note. |
| `vault/2026-05-23_gener8-s3-sync-before-riff-daw.md` | `docs/applets/gener8/2026-05-23_gener8-s3-sync-before-riff-daw.md` | Gener8 migration note. |
| `vault/2026-05-23_layer-u-osint-widgetization-canon.md` | `docs/applets/kasai/2026-05-23_layer-u-osint-widgetization-canon.md` | Kasai/Layer U product direction. |
| `vault/2026-05-23_loom-nomad-migration-started.md` | `docs/applets/loom/2026-05-23_loom-nomad-migration-started.md` | Loom note. |
| `vault/2026-05-24_everywear-vault-cross-applet-ai-repository-canon.md` | `docs/vault/2026-05-24_everywear-vault-cross-applet-ai-repository-canon.md` | Core Vault product canon. |
| `vault/2026-05-24_gener8-vault-typed-section-fixes.md` | `docs/vault/2026-05-24_gener8-vault-typed-section-fixes.md` | Vault taxonomy and Gener8 sections. |
| `vault/2026-05-24_mymory-kasai-compatibility.md` | `docs/vault/2026-05-24_mymory-kasai-compatibility.md` | MyMory/Kasai compatibility and namespace distinction. |
| `vault/2026-05-26_full-codebase-review.md` | `docs/_ooda/2026-05-26_full-codebase-review.md` | Historical codebase review. |
| `vault/2026-05-26_gener8-vault-library-repair.md` | `docs/vault/2026-05-26_gener8-vault-library-repair.md` | Vault library repair receipt. |
| `vault/2026-05-26_kasai-1magen-local-image-generation-skill.md` | `docs/applets/kasai/2026-05-26_kasai-1magen-local-image-generation-skill.md` | Kasai skill design. |
| `vault/2026-05-26_kasai-chrome-companion-extension-manager.md` | `docs/applets/kasai/2026-05-26_kasai-chrome-companion-extension-manager.md` | Kasai Chrome companion direction. |
| `vault/2026-05-26_kasai-live-meeting-transcriber-skill.md` | `docs/applets/kasai/2026-05-26_kasai-live-meeting-transcriber-skill.md` | Kasai skill design. |
| `vault/2026-05-26_kasai-local-live-transcription-skill.md` | `docs/applets/kasai/2026-05-26_kasai-local-live-transcription-skill.md` | Kasai skill design. |
| `vault/2026-05-26_kasai-youtube-ingest-content-skill.md` | `docs/applets/kasai/2026-05-26_kasai-youtube-ingest-content-skill.md` | Kasai skill design. |
| `vault/2026-05-27_gener8-overnight-acceptance.md` | `docs/applets/gener8/2026-05-27_gener8-overnight-acceptance.md` | Gener8 acceptance receipt. |
| `vault/2026-05-27_kasai-keyword-short-and-ewds-provider-migration.md` | `docs/applets/kasai/2026-05-27_kasai-keyword-short-and-ewds-provider-migration.md` | Kasai plus EWDS receipt; cross-link from `docs/ewds/`. |
| `vault/2026-05-27_kasai-sports-picks-browser-mcp.md` | `docs/applets/kasai/2026-05-27_kasai-sports-picks-browser-mcp.md` | Kasai skill/product direction. |

### Other reshuffles

| Current path | Proposed path | Notes |
|---|---|---|
| `OODA_AUDIT_2026-05-18.md` | `docs/_ooda/OODA_AUDIT_2026-05-18.md` | Root historical report. |
| `OODA_AUDIT_2026-05-19.md` | `docs/_ooda/OODA_AUDIT_2026-05-19.md` | Root historical report. |
| `OODA_AUDIT_2026-05-23.md` | `docs/_ooda/OODA_AUDIT_2026-05-23.md` | Root historical report. |
| `MIGRATION_ARCHITECTURE.md` | `docs/migration/MIGRATION_ARCHITECTURE.md` | Large historical migration doc. |
| `ARCHITECTURE_MODULES_2026-05-21.md` | `docs/migration/ARCHITECTURE_MODULES_2026-05-21.md` | Module migration artifact. |
| `EVERYWEAR_ARCHITECTURE_2026-05-15.md` | `docs/migration/EVERYWEAR_ARCHITECTURE_2026-05-15.md` | Historical architecture snapshot. |
| `HANDOFF_GENER8_VAULT_LIBRARY_FIXES_2026-05-24.md` | `docs/applets/gener8/HANDOFF_GENER8_VAULT_LIBRARY_FIXES_2026-05-24.md` | Gener8/Vault handoff. |
| `HANDOVER_2026-05-17.md` | `docs/migration/HANDOVER_2026-05-17.md` | Historical handover. |
| `HANDOVER_2026-05-23_GENER8_RIFF_DAW.md` | `docs/applets/gener8/HANDOVER_2026-05-23_GENER8_RIFF_DAW.md` | Gener8 handover. |

## Punch list

| Priority | Finding | Recommendation | Owner | Effort | Blocking task 30 |
|---|---|---|---|---:|---|
| Critical | No source-level corruption blocker found for adding a new package. | Proceed only after high-priority repo hygiene below is handled. | Codex | S | no |
| High | Dirty worktree spans docs, package metadata, Gener8 WIP, EWDS rename, tooling, and new vault notes. | Land or explicitly stash/shelve WIP before cloning `packages/mymory-vault/`. | Sean + Codex | M | yes |
| High | Root `vault/` docs collide with locked Vault namespace direction. | Migrate docs to `docs/vault/`, `docs/applets/*`, and `docs/_ooda/` before adding Vault package source. | Codex | M | yes |
| High | `CONTEXT.md` points to missing Track A receipt. | Recover/recreate `2026-05-27_track-a-hygiene-and-gener8-ts-nocheck-migration.md` or fix the pointer. | Codex | S | yes |
| High | Actual package convention is `packages/`, while prompt uses both `packages` and `pckgs`. | Lock `packages/mymory-vault/` as the target. Do not introduce `pckgs/`. | Sean | S | yes |
| Medium | 8 files exceed 16k tokens, led by Gener8 modal, video modal, CreatePanel, root WIKI, StemStudio, shim, and API service. | Schedule split passes before more feature work in those modules. | Codex | L | no |
| Medium | 22 more files are over 8k tokens. | Add module-contract docs and split when touched. | Codex | L | no |
| Medium | Broad docs coverage is 44/52 for >500-line modules, but strict wiki/sibling coverage is 25/52. | Add targeted docs for the eight broad gaps and move module contracts into `docs/wiki/`. | Codex | M | no |
| Medium | Root `WIKI.md` still contains stale body sections despite fresh addenda. | Convert root WIKI into concise index plus current-state pointers. | Codex | M | no |
| Medium | `Cargo.toml` keeps `ew-vault` dependency alias while docs say canonical name is `vault`. | Decide whether the alias is compatibility or drift, then update code/docs together. | Sean + Codex | S | no |
| Medium | Track C lint baseline remains noisy because many Gener8 files still carry `@ts-nocheck`. | Continue file-by-file Track C migration after task 30 pre-flight. | Codex | L | no |
| Low | `.codex`, `.codex-runlogs`, root screenshots/logs/html/docx create visual noise. | Keep ignored; optionally move durable screenshots to `marketing/` or docs references. | Codex | S | no |
| Low | `skills/` and root `.skill` artefacts sit beside product source. | Decide whether Everywear owns agent skills or whether these should move to Codex/Mymory tooling repos. | Sean | M | no |

## Next actions

1. Commit or park the existing dirty WIP before task 30. At minimum, separate product WIP from local tooling changes.
2. Recover or recreate the missing Track A receipt referenced by `CONTEXT.md`.
3. Migrate root `vault/*.md` documentation into `docs/vault/`, `docs/applets/*`, and `docs/_ooda/` using the plan above.
4. Add `packages/mymory-vault/`, not `pckgs/mymory-vault/`.
5. After the clone, add a package-local README or module contract immediately so the new package does not enter the repo undocumented.
6. Schedule later split passes for `VideoGeneratorModal.tsx`, `CreatePanel.tsx`, `StemStudio.tsx`, `shim.rs`, and `api.ts`.

Task 30 can proceed after items 1 to 4. The module splits are important, but they do not block the package clone unless task 30 edits those oversized modules directly.
