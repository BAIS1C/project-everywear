# Project Everywear: Corrected OODA Audit
**Date:** 2026-05-23 SGT / Asia-Makassar
**Pass type:** Corrective OODA after stale audit review
**Scope:** Everywear monorepo source census, applet inventory, manifest/load paths, shell launcher behavior, npm/Cargo workspace shape, current dirty diff, and targeted build checks.
**Supersedes:** `OODA_AUDIT_2026-05-19.md` and the earlier incorrect draft of `OODA_AUDIT_2026-05-23.md`.

---

## 2026-05-24 ADDENDUM

This addendum records the follow-up implementation work after the corrected audit.

- **Layer U OSINT:** Added as a free `FrontendInline` platform surface backed by Project SON. The shell registry contains `layeru-osint`, and the React applet lives under `platform/everywear-os/src/son/`.
- **Project SON bridge:** Everywear now has `sonBridge.ts`, `useLayerUOsint.ts`, and a compact `LayerUOsintApplet.tsx` that hosts `http://127.0.0.1:3117/worldview` while exposing posture, feeds, source health, refresh, pull live, and reload controls. Project SON `server.mjs` was patched with local CORS headers for `/api/health`, `/api/data`, and `/api/sweep`.
- **Naming canon:** User-facing Kasai labels are superseded by **My Mait**. `kasai` remains the internal runtime/app id and Sean's personal/in-game name.
- **Weather:** Desktop weather is metric-first: Celsius, km/h, and mm. Fahrenheit in screenshots is now a stale-runtime indicator.
- **Widget surface setting:** The shell setting is **Cut / Rounded / Square** and must apply to widget boxes/panels, not only buttons. Legacy stored `soft` maps to `rounded`; legacy `glass` maps to `square`.
- **Icon polish:** EWDS desktop icons moved toward lower glow and glassier surfaces. Classic canvas icons should read as glass desktop objects. Refined/Terminal projected icons retain their plinth/beam/glyph anatomy with restrained halo.
- **Stale runtime diagnostic:** If a live desktop misses Layer U OSINT and still shows old cues such as `Kasai` or Fahrenheit weather, do not add fallback applet injection. Rebuild frontend, run `cargo build -p everywear-os`, and restart the native shell.

Verification performed during the follow-up:

- `npm -w everywear-os run build`
- `npm -w @everywear/ewds run build`
- `cargo build -p everywear-os`

---

## EXECUTIVE SUMMARY

The codebase is healthier than the prior draft claimed. The size census is stable, the shell frontend builds, Loom's new frontend builds, and `cargo check -p everywear-os` passes. The highest-risk issue is not "Loom click fails immediately"; current shell UI opens registered frontend-only applets inline before the Tauri launch bridge runs.

The real next areas of importance are:

1. **Manifest schema drift for frontend-only applets and platform scans.** `loom`, `character-studio`, and `vid` are frontend-only enough to launch through the UI, but their `applet.toml` files are not valid for the canonical `model_manager::AppletManifest` schema. That means model assessment and requirement discovery skip or cannot represent them cleanly. This is the best next fix.
2. **Registry/workspace truth split.** Applets are declared in at least four places: `registry.rs`, root npm workspaces, Cargo workspace, and `applet.toml`. Some entries are legitimate external links, some are placeholders, and some are half-wired. This should be made explicit.
3. **3nvizen frontend orphan.** `3nvizen` has real TS/React source and a Rust backend, and is listed in root npm workspaces, but has no `package.json`, `vite.config.ts`, or `tsconfig.json`. It is not a usable frontend workspace yet.
4. **Dead manifest parser cleanup.** `platform/everywear-os/src-tauri/src/manifest_parser.rs` is unused and now also reported by `cargo check` as dead code. Keep one manifest schema surface.
5. **Documentation/runtime flow diagrams.** The wiki has useful prose and some diagrams in `docs/wiki`, but the manifest pipeline, registry, frontend-only route, and binary applet launch route are not documented as one authoritative flow.

Corrections versus the earlier draft:

- **VideoGeneratorModal Phase B has landed.** The applet copies are now thin wrappers around `@everywear/video-modal`.
- **Rich model fields are not silently lost.** `key`, `required`, `hf_repo`, and `hf_file` exist on `ModelRequirement` and are consumed by launcher conversion.
- **Loom/character-studio manifests are invalid for `AppletManifest::load`, but this does not currently block normal inline launching.** It affects scans and any path that asks the backend to load those manifests.

---

## O: OBSERVE

### Source Census

Measured with `rg --files -g '*.rs' -g '*.ts' -g '*.tsx' -g '*.css'`, excluding `node_modules` and `target`.

| Metric | Value |
|---|---:|
| Source files | 239 |
| Source lines | 59,911 |
| Approx tokens | 239,644 |

| Token bucket | Files | Percent |
|---|---:|---:|
| <=2k | 207 | 86.6% |
| 2k-8k | 31 | 13.0% |
| 8k-16k | 1 | 0.4% |
| 16k-28k | 0 | 0.0% |
| 28k-65k | 0 | 0.0% |
| >65k | 0 | 0.0% |

Largest source files:

| File | Lines | Approx tokens |
|---|---:|---:|
| `packages/video-modal/src/components/VideoGeneratorModal.tsx` | 3,642 | 14,568 |
| `platform/everywear-os/src/styles/shell.css` | 1,796 | 7,184 |
| `platform/everywear-os/src-tauri/src/lib.rs` | 1,358 | 5,432 |
| `applets/kasai/src/styles/kasai.css` | 1,113 | 4,452 |
| `crates/model-manager/src/local_discovery.rs` | 1,092 | 4,368 |
| `packages/video-modal/src/workers/videoRenderWorker.ts` | 1,059 | 4,236 |
| `platform/everywear-os/src/shell/ShellLayout.tsx` | 1,020 | 4,080 |
| `applets/kasai/src-tauri/src/slot_manager.rs` | 1,019 | 4,076 |
| `applets/gener8/src-tauri/src/shim.rs` | 1,009 | 4,036 |
| `platform/everywear-os/src-tauri/src/launcher.rs` | 925 | 3,700 |

No file crosses the 16k-token hard split threshold. `VideoGeneratorModal.tsx` remains the only 8k-16k watch-list file.

### Applet Inventory

| Applet | Source files | Manifest | npm package | Cargo package | Notes |
|---|---:|---|---|---|---|
| `1magen` | 19 | yes | yes | yes | Canonical binary applet. |
| `gener8` | 53 | yes | yes (`web/`) | yes | Canonical binary plus web applet. |
| `kasai` | 16 | yes | yes | yes | Canonical binary applet. |
| `3nvizen` | 16 | yes | no | yes | Frontend source exists but no frontend package metadata. |
| `vid` | 10 | yes | yes (`web/`) | no | Frontend-only, uses shell video encoder. Manifest lacks `model_groups`. |
| `loom` | 6 | yes | yes | no | Frontend-only inline applet. Manifest is primitive schema. |
| `character-studio` | 5 | yes | yes | no | Frontend-only inline applet. Manifest is primitive schema and missing `icon`. |
| `mymories` | 0 | no | no | no | Placeholder directory only. |
| `s3studio` | 0 | no | no | no | External URL registry entry plus placeholder directory. |
| `strands-game` | 0 | no | no | no | External URL registry entry plus placeholder directory. |

### Current Working Tree

Dirty tracked files:

```text
applets/gener8/web/src/App.tsx
applets/gener8/web/src/components/Sidebar.tsx
applets/kasai/src/lib/transport.ts
package.json
platform/everywear-os/src-tauri/src/registry.rs
platform/everywear-os/src/components/AppletIcon.tsx
platform/everywear-os/src/components/AppletViewRouter.tsx
platform/everywear-os/src/lib/transport.ts
```

Untracked areas include the new Loom applet, Gener8 DAW files, docs, vault notes, and this audit. Any implementation pass should avoid unrelated cleanup unless it is deliberately scoped.

### Verification Results

| Command | Result |
|---|---|
| `npm -w @everywear/loom run build` | PASS |
| `npm -w everywear-os run build` | PASS, with a Vite dynamic/static import warning for `@tauri-apps/api/core.js` |
| `cargo check -p everywear-os` | PASS, with warnings |

Important Rust warnings:

- `manifest_parser.rs` structs and functions are unused.
- `applet_resolver::resolve_applet_manifest` and `resolve_applet_binary` are unused.
- Many architecture/plumbing types are present but not yet connected.

---

## O: ORIENT

### 1. Manifest Schema Drift Is Real, But The Launch Impact Was Misstated

Canonical live schema:

- `model_manager::AppletManifest` in `crates/model-manager/src/manifest.rs`
- Required fields include:
  - `[applet] id/name/version/description/icon/transport`
  - `[engine] type/backend/server_binary`
  - `model_groups: Vec<ModelGroup>`

Current invalid or incomplete manifests:

| Manifest | Problem |
|---|---|
| `applets/loom/applet.toml` | Has top-level `engine_type`, `min_vram_mb`, `tags` inside `[applet]`; lacks `transport`, `[engine]`, and `model_groups`. |
| `applets/character-studio/applet.toml` | Same primitive schema as Loom, plus missing required `icon`. |
| `applets/vid/applet.toml` | Has `[engine]`, `icon`, `transport`, but lacks required `model_groups`. |

Why this matters:

- `assessment.rs::list_model_assessments()` scans `applets/*/applet.toml` and skips invalid manifests.
- `lib.rs::load_model_requirements_from_applets()` also scans manifests and skips invalid ones.
- `check_applet_requirements()` loads `model_manager::AppletManifest` and will return a failed requirements check for these applets.

Why this is not the immediate Loom click blocker:

- `ShellLayout.tsx` opens registered frontend-only applets inline when `isRegisteredApplet(applet.id) && !applet.launch_binary`.
- `request_applet_switch()` also returns before manifest load when `launch_binary` is absent and `frontend_port` exists.
- Therefore a normal shell click on Loom/Character Studio should not hit `lib.rs:192`.

Correct conclusion:

The manifest issue should still be fixed next, but because it corrupts platform scans and schema truth, not because Loom's normal inline launch is necessarily blocked.

### 2. Registry Is Hardcoded And Carries Mixed Semantics

`registry::builtin_applets()` is the icon grid source of truth. It does not derive from manifests.

It currently mixes:

- Built binary applets: `1magen`, `gener8`, `kasai`.
- Not-built binary applet: `3nvizen`.
- Frontend-only inline applets: `vid`, `character-studio`, `loom`.
- External URL applets: `s3studio`, `strands-game`.
- Placeholder binary-ish applet: `mymories`.

This is not inherently wrong, but the statuses and filesystem/docs need to say which category an applet belongs to. Without that, future agents keep interpreting placeholder directories as broken local applets or interpreting external URL entries as phantom bugs.

### 3. npm Workspace State Has Drift

Root `package.json` lists:

```text
packages/*
platform/everywear-os
applets/1magen
applets/s3studio
applets/3nvizen
applets/kasai
applets/character-studio
applets/gener8/web
applets/vid/web
applets/loom
applets/mymories
applets/strands-game
```

Observed behavior:

- `npm -w @everywear/loom run build` works.
- `npm -w applets/3nvizen ...` fails because `3nvizen` has no `package.json`.
- `npm ls --workspaces --depth=0` lists the install/lock-linked workspaces but does not include Loom yet, which indicates the lock/install graph has not been refreshed after adding Loom.

Correct conclusion:

The root workspace declaration is ahead of some applet folders and the lock/install graph. Decide whether each applet is a real package, external URL, or placeholder, then make root workspaces match that decision.

### 4. VideoGeneratorModal De-Dup Is Done

Earlier draft claim was stale.

Current applet files:

- `applets/gener8/web/src/components/VideoGeneratorModal.tsx`: 26 lines, wrapper around `@everywear/video-modal`.
- `applets/vid/web/src/components/VideoGeneratorModal.tsx`: 24 lines, wrapper around `@everywear/video-modal`.
- `packages/video-modal/src/components/VideoGeneratorModal.tsx`: the real 3,642-line implementation.

Correct conclusion:

Do not queue "Phase B hoist" as next work. It is already done. Future work should be package hardening, tests, or splitting only if this file grows beyond threshold or becomes hard to maintain.

### 5. Rich Manifest Fields Are Used

Earlier draft claim was stale/wrong.

`ModelRequirement` includes:

- `key`
- `required`
- `filename`
- `hf_repo`
- `hf_file`
- `size_bytes`

`launcher::manifest_info_from_groups()` converts requirements with `hf_repo + hf_file` into `ModelInfo`, so HF routing metadata is not silently lost.

Correct conclusion:

The manifest model path is healthier than the earlier draft said. The issue is duplicate schema surfaces and frontend-only manifest defaults, not missing rich fields.

### 6. Documentation Coverage Is Useful But Runtime Flow Still Needs One Canonical Diagram

There are Mermaid diagrams in `ARCHITECTURE_MODULES_2026-05-21.md` and `docs/wiki/*`, plus substantial IPC prose in `WIKI.md`.

Still missing as a single authoritative diagram:

- Registry entry category -> shell click behavior.
- Frontend-only applet path vs binary applet path.
- Manifest scan path vs launch path.
- Model assessment and requirement discovery path.

This gap directly contributed to the bad earlier audit.

---

## D: DECIDE

### Critical Next

1. **Normalize frontend-only manifests and loader defaults.**

Best small fix:

- Add valid canonical manifests for `loom`, `character-studio`, and `vid`.
- Add `model_groups = []` for frontend-only applets, because `model_groups` is required.
- Add missing `transport` and `[engine]`.
- Add missing `icon` to Character Studio.

Expected impact:

- `list_model_assessments()` stops warning/skipping these applets.
- `load_model_requirements_from_applets()` no longer treats frontend-only manifests as invalid.
- `check_applet_requirements()` has a sane zero-model path if called by future UI.
- Future audits stop misclassifying frontend-only applets as broken binary applets.

2. **Define applet categories in registry and docs.**

At minimum, document the categories next to `builtin_applets()`:

- `BinaryLocal`
- `FrontendInline`
- `ExternalUrl`
- `Placeholder`

Better fix:

- Add a serialized `kind`/`launch_kind` field to `AppletEntry`.
- Keep `status` for availability/licence/build state.
- Stop overloading `launch_url`, `launch_binary`, and `frontend_port` as the only way to infer type.

### High

3. **Fix 3nvizen frontend packaging or remove it from npm workspaces.**

Two acceptable directions:

- Add `applets/3nvizen/package.json`, `vite.config.ts`, and `tsconfig.json`.
- Or remove `applets/3nvizen` from npm workspaces until frontend package work is scheduled.

Given it already has real source files, adding package metadata is probably the better path.

4. **Remove or retire `manifest_parser.rs`.**

Options:

- Delete it and use `model_manager::AppletManifest` everywhere.
- Or turn it into the canonical parser wrapper over `model_manager::AppletManifest`.

Do this after frontend-only manifests are normalized so the parser removal does not hide schema drift.

5. **Clean root workspace declarations.**

Remove non-package placeholder directories from npm workspaces unless they intentionally receive package manifests:

- `applets/s3studio`
- `applets/mymories`
- `applets/strands-game`

Then refresh `package-lock.json` after Loom is intentionally part of the workspace graph.

### Medium

6. **Add the canonical launch/manifest diagram to `WIKI.md`.**

Should cover:

- Desktop click.
- Inline applet route.
- External URL route.
- Binary applet route.
- Manifest scan path.
- Model assessment/requirements path.

7. **Split or index shell CSS when it crosses 8k tokens.**

`shell.css` is at 7,184 rough tokens. No urgent split, but it is the next style file to watch.

8. **Add a small manifest validation test.**

One Rust test or command should scan `applets/*/applet.toml` and assert either:

- Parses as canonical `AppletManifest`, or
- Is explicitly tagged/allowlisted as non-canonical placeholder/external.

This would have caught the stale audit's confusion immediately.

### Low

9. **Reconcile old OODA addenda in `WIKI.md`.**

The 2026-05-18 addendum is still visible in the canonical wiki. Mark it superseded or fold it into the current state.

10. **Backlog large-file watch list.**

No split now. Recheck after video-modal or shell UI work.

---

## A: ACT

### Completed In This Corrective Pass

- Re-ran source census and largest-file list.
- Rebuilt current applet/workspace inventory from disk.
- Verified current dirty working tree.
- Verified launcher behavior from `ShellLayout.tsx` and `lib.rs`.
- Verified canonical manifest schema in `model-manager`.
- Verified model metadata fields are used by launcher conversion.
- Verified VideoGeneratorModal applet files are wrappers, not duplicate implementations.
- Ran targeted checks:
  - `npm -w @everywear/loom run build`
  - `npm -w everywear-os run build`
  - `cargo check -p everywear-os`

### Recommended Next Implementation Sequence

1. Patch `applets/loom/applet.toml`, `applets/character-studio/applet.toml`, and `applets/vid/applet.toml` into canonical zero-model manifests.
2. Add one manifest validation test or command so this cannot drift silently again.
3. Add explicit applet category semantics to the registry or at least document them beside `builtin_applets()`.
4. Decide 3nvizen frontend packaging: package it now or remove it from root npm workspaces.
5. Remove/retire `manifest_parser.rs`.
6. Refresh docs with a launch/manifest pipeline diagram.

### Vault Note Candidate

```text
2026-05-23 SGT - Corrected Everywear OODA:
  Repo size healthy: 239 source files, 86.6% <=2k rough tokens, no >16k files.
  Builds pass: Loom frontend, shell frontend, cargo check -p everywear-os.
  Corrected stale claims: VideoGeneratorModal de-dup has landed; rich manifest fields are used.
  Real next issue: frontend-only applet manifests are not canonical, so model scans/checks skip/fail them even though inline launch can work.
  Next work: normalize loom/character-studio/vid manifests, add manifest validation, clarify applet kinds in registry, package or delist 3nvizen frontend, retire manifest_parser.rs.
```
