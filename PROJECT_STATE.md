# PROJECT_STATE.md - Everywear / Gener8 Port

Single source of live state for surgical work. Read this first, every session. Last updated: 2026-06-09T04:32+08 SGT (Codex: 1magen shell styling fixed).

Canonical context remains `CONTEXT.md` (history) and the Mymory vault. This file is the WORKING STATE: what is true right now, what is broken, what is the next smallest move. Update it after every patch.

## 2026-06-09 04:32 SGT - 1magen Shell Styling Fixed (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: native 1magen no longer opens as a raw unstyled document flow or trips a lazy CSS preload failure. The shell now loads 1magen workbench CSS from the shell entry bundle, while standalone 1magen keeps its own `main.tsx` CSS import.
- ROOT CAUSE: `ImagenCore` is lazy-mounted directly by `AppletViewRouter`. Importing `imagen.css` from that lazy component emitted a separate `ImagenCore-*.css` asset; native WebView could fetch it afterward, but Vite's CSS preload path could throw `Unable to preload CSS for /assets/ImagenCore-*.css` and wedge the applet error boundary. Importing the applet CSS from `platform/everywear-os/src/main.tsx` removes the lazy CSS preload path.
- PATCH: `platform/everywear-os/src/main.tsx` imports `@applets/1magen/src/styles/imagen.css`; `applets/1magen/src/styles/imagen.css` scopes background/color/overflow to `.imagen-workbench` instead of `body`; `ImagenCore.tsx` stays component-only.
- VERIFICATION PASSED: `npm run build --workspace onemagen`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP; clicked `button.ew-desktop-icon[data-applet-id="1magen"]`; verified `.imagen-workbench`, `.imagen-controls`, and `.imagen-output` present, `bodyDisplay=grid`, no preload failure, no bug modal, no launch hang.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-postfix-1magen-styled-shell.png`.
- STATUS: 1magen is tutorial-safe as a styled setup/generation surface. Successful image generation, model provisioning, output save path, and Vault registration are still unproven and must be tested in the next QA pass.

---

## 2026-06-09 04:22 SGT - Strands Nation External-State Fallback Fixed (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: native Strands Nation no longer opens to a blank embedded iframe. Live `https://strandsnation.xyz` currently returns `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, so Everywear now shows an explicit external-open state for `strands-game` instead of mounting an iframe that the site forbids.
- PATCH: `platform/everywear-os/src/panels/HeadlessAppletView.tsx` detects `strands-game` remote embed policy and renders a launch-point panel with `Open in browser` and `Check again`; `platform/everywear-os/src/styles/shell.css` adds the blocked-state layout and Carbon-visible CTA styling.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP; clicked `button.ew-desktop-icon[data-applet-id="strands-game"]`; verified `hasExternalBlockedPane=true`, `hasIframe=false`, `reportModal=false`; screenshot `screenshots\2026-06-09-everywear-full-tour\native-postfix-strands-nation-external-state.png`.
- STATUS: first-run tutorial can include Strands Nation as an external launch point. Do not promise in-shell gameplay until `strandsnation.xyz` allows Everywear framing or Everywear ships a true internal browser path.

---

## 2026-06-09 04:14 SGT - Launcher Semantic Buttons Fixed (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: desktop applet tiles and shell-owned Settings/Vault tiles are now real `button.ew-desktop-icon` controls with `aria-label`, `title`, focus-visible styling, and preserved visual classes.
- PATCH: `platform/everywear-os/src/components/AppletIcon.tsx` renders a semantic button instead of a clickable div; `platform/everywear-os/src/shell/ShellLayout.tsx` renders Settings/Vault system icons as buttons; `platform/everywear-os/src/styles/shell.css` resets button chrome and owns the launcher pulse keyframes.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP; DOM verified 7 applet buttons, S3 folder button, Settings button, Vault button, and zero non-button applet/system launcher holdouts; native mouse click on `button.ew-desktop-icon[data-applet-id="character-studio"]` opened Avatar Studio with no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-postfix-launcher-semantic-home.png` and `native-postfix-launcher-semantic-buttons.png`.
- STATUS: keyboard/screen-reader first-run navigation is credible at the desktop launcher level. Remaining full-tour blockers are 1magen generation/layout, 3nvizen sidecar/video generation, Strands Nation embedded blank/blocked state, and deeper Avatar Studio Create/Batch/Optimize path verification.
- NOTE: `ShellLayout.tsx` and `shell.css` remain above the soft context target but below the hard ceiling; this pass was a narrow semantic patch. The next OODA/split debt still includes `ShellLayout.tsx` and `shell.css`.

---

## 2026-06-09 04:00 SGT - Avatar Studio Native Asset Protocol Scope Fixed (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: native Avatar Studio local bundle manifest now loads through Tauri's Windows asset protocol. The runtime command already returned the repo-local `applets/character-studio/public` fallback, but `tauri.conf.json` did not include that repo public tree in `assetProtocol.scope`, so `convertFileSrc(root)/manifest.json` returned `asset.localhost` 403 in native.
- PATCH: added narrow dev/debug asset scopes for `applets/character-studio/public/**` to `platform/everywear-os/src-tauri/tauri.conf.json`, while preserving `$HOME/.everywear/data/character-studio/**`, `$RESOURCE/character-studio/**`, and `$RESOURCE/cs-assets/**` as the packaged/local-install paths.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP; clicked `[data-applet-id="character-studio"]`; fetched `window.__EVERYWEAR_ASSET_BASE__/manifest.json` and got `200 application/json` with JSON content; screenshot `screenshots\2026-06-09-everywear-full-tour\native-postfix-avatar-studio-local-assets.png`.
- STATUS: Avatar Studio is no longer blocked on native manifest loading. It still needs first-run/tutorial polish: asset pack status, where created Blanks are saved, My Mait handoff copy, and deeper Create/Batch/Optimize path verification.

---

## 2026-06-07 10:47 SGT - Avatar Studio Local Asset Runtime Fix (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- IMPLEMENTED Sean correction: Avatar Studio runtime assets are local-first, not R2/CDN streamed.
- Shell asset base mounts Avatar Studio at `/cs-assets` in dev. In Tauri production, `AppletViewRouter.tsx` asks `get_character_studio_asset_root` for a local asset root and converts it through Tauri's asset protocol; no production `VITE_ASSET_PATH` handoff to `assets.everywear.id`.
- Shell Vite serves `applets/character-studio/public/` from `/cs-assets` in dev without copying the large payload into frontend dist; production expects local app data or Tauri resources, not runtime CDN streaming.
- Character Studio `assetBase.js` rejects remote `http(s)` `VITE_ASSET_PATH` values and documents the local-first contract.
- Shell CSP no longer allows `https://assets.everywear.id` in `connect-src`; the old R2 upload script is deprecated with a hard throw.
- Verification passed: local `manifest.json`, `character-assets/`, and `ktx2/libktx.js` exist; `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. The first implementation copied the large asset tree into frontend dist and produced a 4.79 GB MSVC archive; that dist-copy path was removed before the passing native build.

---

## 2026-06-06T12:48+08 SGT - Kasai Executive/Swarm Stabilization Pass (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- COMMITTED backup stack on branch `phase2/character-studio-absorption`: `aded3dd` My Mait shell/runtime integration; `4dd6325` registry truth + Gener8 pack routes + WIKI launcher reconciliation; `8dcb938` Character Studio CSS normalization + `.gitattributes`; `8bf0800` Educ8 compile-time rename; `150d379` Gener8 worker duplicate deprecation; `79e5544` first VideoGeneratorModal split. Tag: `checkpoint/2026-06-06-pre-swarm`.
- BUILD VERIFICATION PASSED: `cargo build -p everywear-os`; `cargo check -p gener8`; `cargo build -p gener8`; `npm run build --workspace @everywear/video-modal`; `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace @everywear/vid-web`; `npm run build --workspace everywear-os`. Warnings remain existing dead-code/chunk/Sass warnings, no build failures.
- REGISTRY TRUTH VERIFIED IN SOURCE: `kasai` is `BinaryLocal` with `launch_binary = everywear-kasai` and `frontend_port = None` in both registries; `gener8-4ever` has no stray launch binary; `1magen` is `BinaryLocal` using `onemagen` on port 3002; `s3studio` is a free external URL with no required entitlements.
- RUNTIME ROUTE SMOKE BLOCKED HEADLESS: direct `GET http://127.0.0.1:3001/api/health` and `/api/engine/pack-status` refused because no shim was running. Fresh `target\debug\gener8.exe` launch exited with `No EVERYWEAR_CMD_PORT env var set. Gener8 must be launched by the Everywear shell.` Shell-launched route smoke remains owed.
- LANE A: `packages/video-modal/src/components/VideoGeneratorModal.tsx` is the only live import path for the package worker. The orphan `applets/gener8/web/src/workers/videoRenderWorker.ts` differed only by old `// @ts-nocheck`; it is now marked deprecated in place. DELETION HELD as T2 until shell-launched video export parity smoke proves the package worker path end-to-end.
- LANE B: first safe split landed: `videoModalTypes.ts`, `videoModalDefaults.ts`, and `videoModalPresets.tsx` now own shared types, render presets/default state, and preset metadata. `VideoGeneratorModal.tsx` is reduced to 3,115 lines but remains above the soft target; render/export hooks, media controls, text/subtitle controls, and settings panels remain owed before major feature additions.
- HUMAN HANDOFF OWED: desktop My Mait acceptance (green dot, inline open, no Edge page, no `KASAI_NOT_ACTIVE`, truthful status pill), shell-launched Gener8 `/api/engine/pack-status`, video export parity, Character Studio visual QA, Educ8 native build/visual QA.

---

## 2026-06-05T22:45+08 SGT - Kasai Launch Contract Restored + Install Doctrine Filed (Claude Cowork)

Location: `C:\Users\MAG MSI\Project Everywear`

- OODA pass (full report: `OODA_REPORT_2026-06-05.md`) found both registries holding kasai as pure `FrontendInline` / `launch_binary: None`, contradicting the locked contract in the 12:03 My Mait section below, the WIKI launcher table, and the progress report's own caution. That state never calls `request_applet_switch("kasai")` (ShellLayout FrontendInline branch short-circuits) and reproduces `KASAI_NOT_ACTIVE`. A stray inert `launch_binary: "everywear-kasai"` sat on `gener8-4ever`, documented nowhere; assessed as the morning's intended kasai restore landing on the wrong entry during the 18:46 SGT registry write.
- RESTORED in both registries: kasai -> `BinaryLocal` + `launch_binary = everywear-kasai` + `frontend_port: None` (hybrid: bridge activation + shell-native inline UI). gener8-4ever -> `launch_binary: None`. Files: `platform/everywear-os/src-tauri/src/registry.rs`, `platform/everywear-os/src/lib/transport.ts`. The afternoon pass's other registry changes (1magen `BinaryLocal`, s3studio entitlements emptied) were NOT touched.
- VERIFICATION OWED: edits are source-level only from a sandbox that cannot run the Windows build. Required: `cargo build -p everywear-os`, `npm run build --workspace everywear-os`, relaunch, then the desktop acceptance checklist in `MYMAIT_INTEGRATION_PROGRESS_REPORT_2026-06-05.md` (green dot, inline open, no Edge page, no `KASAI_NOT_ACTIVE`, truthful status pill).
- Applet install assessment doctrine LOCKED and filed: `CONTEXT_APPEND_APPLET_INSTALL_DOCTRINE_2026-06-05.md` + WIKI v1.1.26 note. Shell assessment -> shell-owned install with UI and receipt -> launch activates from resolved paths, never downloads. Sidecars stay dumb. The 2026-06-05 `shim.rs` pack-status/install-pack routes are flagged as a stopgap doctrine violation pending migration to shell/model-manager authority.
- Process finding for the vault: the registries are the documented one-agent collision hotspot (promptpack binding rule 6) and were written by two streams in one day without reconciliation; the afternoon stream has no rollout summary in `.codex/memories`. Vault filing owed for: OODA report, doctrine, this restore.

---

## 2026-06-05T21:28+08 SGT - VideoGeneratorModal Phase B Package Parity

Location: `C:\Users\MAG MSI\Project Everywear`

- Phase B convergence landed as modularisation-only work: Gener8 now consumes `@everywear/video-modal` through a 68-line local wrapper instead of carrying the 3,939-line applet-local modal fork.
- Behavior intentionally preserved by applet-injected package hooks: Gener8 passes its responsive state, `vid_pro` entitlement gate, trial/watermark flags, `getApiBase()`, toast bridge, GPU `save-from-encoder` mode, and rich Vault registration metadata into the shared modal.
- Vid behavior intentionally unchanged: `applets/vid/web/src/components/VideoGeneratorModal.tsx` remains a thin 21-line wrapper over the shared package with `vaultTag="vid"` and no vault registration callback.
- Module map now: `applets/gener8/web/src/components/VideoGeneratorModal.tsx` owns only Gener8 app context adaptation; `applets/vid/web/src/components/VideoGeneratorModal.tsx` owns only Vid app context adaptation; `packages/video-modal/src/components/VideoGeneratorModal.tsx` owns the shared modal UI, presets, preview, FFmpeg/GPU/export orchestration, package worker import, and optional applet callbacks.
- Line counts: Gener8 `VideoGeneratorModal.tsx` 4,373 original -> 3,939 after Phase A -> 68 after Phase B; removed temporary `VideoGeneratorModal.canvas.ts`; package modal currently 3,349; Vid wrapper 21; Gener8 local duplicate worker still exists at 974 lines but is not imported by the modal path.
- Verification passed: `npm run build --workspace @everywear/video-modal`; `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace @everywear/vid-web`; `npm run build --workspace everywear-os`.
- Remaining split debt: split `packages/video-modal/src/components/VideoGeneratorModal.tsx` into types/presets/default config, render/export hooks, media controls, text/subtitle controls, and settings panels before major feature additions; decide whether to delete the orphan Gener8 worker duplicate after a dedicated import/dependency audit; live export parity still needs a human or seeded-song smoke to prove encoder/Vault side effects at runtime.

---

## 2026-06-05T21:14+08 SGT - VideoGeneratorModal Phase A Canvas Helper Split

Location: `C:\Users\MAG MSI\Project Everywear`

- Modularisation-only pass on `applets/gener8/web/src/components/VideoGeneratorModal.tsx`; visual behavior, presets, worker protocol, render output, and public props intentionally unchanged.
- Safest path chosen: local split first, not package migration. `packages/video-modal/src/components/VideoGeneratorModal.tsx` has different public API and tier/auth plumbing, so switching Gener8 to the package modal is Phase B risk, not this patch.
- Added `applets/gener8/web/src/components/VideoGeneratorModal.canvas.ts` for pure canvas helpers copied out of the local modal: core visualizer draw functions, particle background helper, album-art draw, watermark draw, and slideshow image fitting.
- Kept stateful Strands particle preset inside `VideoGeneratorModal.tsx` because it owns per-instance `useRef` particle state; lifting it now would risk visual behavior drift.
- Module map now: `VideoGeneratorModal.tsx` owns modal props, auth/tier decisions, FFmpeg/GPU/export flow, worker protocol, render orchestration, stateful Strands particle preset, upload/search/UI JSX; `VideoGeneratorModal.canvas.ts` owns stateless canvas draw helpers only; `packages/video-modal` remains the shared Vid package surface for later convergence.
- Line counts: Gener8 `VideoGeneratorModal.tsx` 4,373 -> 3,939; new `VideoGeneratorModal.canvas.ts` 450; package modal unchanged at 3,642; `VidApp.tsx` 244; `VidView.tsx` 194.
- Verification passed: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace @everywear/vid-web`; `npm run build --workspace everywear-os`; `git diff --check` returned exit 0 with line-ending warnings only.
- Remaining split debt: extract pure types/presets/default configs next; then decide Phase B convergence into `packages/video-modal`; worker de-dup into `packages/video-modal/src/workers/` remains untouched; live Vid visual parity smoke still owed before stronger production claims.

---

## 2026-06-05T21:03+08 SGT - DAW Pro Model Pack Route And Alias Fixed

Location: `C:\Users\MAG MSI\Project Everywear`

- Fixed source blocker: Gener8 shim now exposes `GET /api/engine/pack-status` and `POST /api/engine/install-pack`.
- Canonical public pack id: `pro_base`. Manifest compatibility id: `better_models`, retained for shell upgrade-pack provisioning and Creator Studio inheritance.
- Shim contract: `pro_base` aliases to manifest pack `better_models`, resolves the VRAM-selected xl-base quant from `applets/gener8/applet.toml`, checks reconciled Gener8 Pro-or-Creator entitlement, reports existing disk presence through `model_manager`, and installs through the same Everywear model cache.
- UI docs corrected: `BetterModelsBanner` now describes `pro_base` instead of stale `better_models`; manifest comments record the alias boundary.
- Verification passed: `cargo fmt -p gener8`; `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo check -p gener8`; `cargo check -p everywear-os`; `rg "pack-status|install-pack|pro_base|better_models" applets/gener8 platform/everywear-os packages`; `git diff --check` returned line-ending warnings only.
- Remaining gate: live route smoke/download requires the Gener8 shim running on `127.0.0.1:3001` with a reconciled Pro/Creator tier; a headless `GET /api/health` attempt timed out because the shim was not running. Source route is present, but model download itself may still fail on network/disk/HF availability.

---

## 2026-06-05T20:52+08 SGT - Manifest Icons And S3Studio Entitlement Coupling Fixed

Location: `C:\Users\MAG MSI\Project Everywear`

- Fixed blocker 1: added manifest PNG assets at `applets/1magen/icons/1magen.png` and `applets/3nvizen/icons/3nvizen.png`, matching the existing `applet.toml` icon paths.
- Inspection result: shell launcher glyphs still come from registry/browser icon ids; manifest-level PNG paths are asset hygiene for manifest consumers, not the current desktop glyph renderer.
- Fixed blocker 2: removed stale `loom` / `loom.teacher_agent` entitlement coupling from `s3studio` in both registries.
- `s3studio` now matches WIKI truth: free `ExternalUrl` boundary helper pointing to `https://s3studio.xyz`, no Loom entitlement requirement.
- Verification passed: `Test-Path` for both icon PNGs; `npm run build --workspace onemagen`; `npm run build --workspace @everywear/3nvizen`; `npm run build --workspace everywear-os`; `rg "loom|loom.teacher_agent"` now only returns the legitimate Loom applet id/icon rows; `cargo check -p everywear-os`.
- Existing unrelated residue: `git diff --check` reports trailing whitespace in `applets/character-studio/src/components/FloatingMenu.module.css:240`; not touched in this pass.

---

## 2026-06-05T12:03:16+08:00 SGT - My Mait Integration Filed For Continuation

Location: `C:\Users\MAG MSI\Project Everywear`

- Report filed: `MYMAIT_INTEGRATION_PROGRESS_REPORT_2026-06-05.md`.
- My Mait UI/graphics pass implemented: running state, tool-card fail-closed rendering, slot-event display, MyMory status rail, singular public naming.
- Desktop launch bug found and partially corrected: false launch-failed report, Edge `127.0.0.1 refused`, and gray launcher dot came from stale My Mait launch/health classification.
- Important correction: My Mait must remain bridge-backed `BinaryLocal` so `request_applet_switch("kasai")` activates the runtime and avoids `KASAI_NOT_ACTIVE`; it must not advertise a `frontend_port` because the UI is shell-native inline.
- Window chrome status is now contextual instead of hardcoded `LIVE`.
- BugReportModal clipboard copy now has WebView fallback and visible copied/error state.
- Verified builds/checks passed after final patch: `npm run build --workspace everywear-os`, `cargo check -p everywear-os`, `cargo check -p everywear-kasai`, `cargo build -p everywear-os`.
- Next required gate: fresh desktop relaunch from `target\debug\everywear-os.exe` and human acceptance of My Mait green dot, inline launch, no Edge popup, no false bug modal, no `KASAI_NOT_ACTIVE`, and truthful runtime status pill.

---

## 2026-06-05T12:35+08:00 SGT - Character Studio Vendored State Reconciled

Location: `C:\Users\MAG MSI\Project Everywear`

- Character Studio docs corrected: `applets/character-studio` is no longer scaffold-only. It is a full vendored Avatar Studio frontend with `@everywear/character-studio` package metadata, `applet.toml` name `Avatar Studio`, a large `src/` implementation, and a large `public/` asset base.
- Shell route confirmed: `platform/everywear-os/src/components/AppletViewRouter.tsx` sets `window.__EVERYWEAR_ASSET_BASE__` before lazy-loading `@applets/character-studio/src/index`; `src/lib/assetBase.js` resolves shell/dev asset bases through that shim or `VITE_ASSET_PATH`.
- Current status is `SMOKE-PENDING`, not `SCAFFOLD`: source and assets are vendored, but live shell visual QA is still owed.
- Resolved follow-up: Character Studio CSS asset refs now resolve through Vite-relative paths into the vendored public asset base. `token-frame-empty.svg` was not present in the vendored tree or donor tree, so the mask uses existing `token-frame-active.svg`.
- Verified after CSS repair: `npm run build --workspace @everywear/character-studio` and `npm run build --workspace everywear-os` passed with no unresolved Character Studio asset warnings.

---

## OPERATING PROTOCOL (surgical patch loop) — binding

This is how work on this codebase is done from now on. It exists because reactive, refactor-heavy, wrong-layer work has cost multi-hour delays. Follow it literally.

1. READ this PROJECT_STATE.md first. Orient on current state + the punch list below.
2. READ the actual failing evidence: the last failing log line, the specific symptom, the live runtime signal. Do not infer from memory.
3. Form ONE hypothesis. Inspect ONLY the files named in that hypothesis. Read each in full before touching it.
4. Propose the SMALLEST patch that addresses the hypothesis.
5. DO NOT: refactor, rename, "improve" architecture, touch working standalone logic, or change public API contracts. Preserve current contracts exactly.
6. APPLY the patch. Run the named test / verification.
   - Shell / Tauri / Rust / `tauri.conf.json` / `capabilities/*` / CSP change → `cargo build -p everywear-os` + relaunch. A green `npm run build` proves NOTHING about shell, config, or media behaviour.
   - A runtime bug that survives a green web build is BELOW the web layer. Stop patching React; check Tauri/Rust/config.
7. UPDATE this file: mark the item done/changed, record the fix and any new carry. Never delete prior carries; strike them through or move to "Resolved".

Hard-won rules baked in:
- INSTRUMENT before inferring on runtime bugs. The dev `everywear-os.exe` is unpackaged, so screen automation cannot read its WebView console; use F12 console or the (currently stubbed) diag pipeline. Source inference has produced wrong fixes repeatedly.
- NECESSARY != SUFFICIENT. "Nothing changed after a correct fix" means another blocker is stacked, not that the fix was wrong.
- ONE applet/module per agent when parallelising. `CreatePanel.tsx` and the two registries are collision hotspots.

---

## CURRENT BUILD STATE (2026-05-30)

- Player: WORKING. Vault audio plays in gener8-4ever (confirmed live). Root cause was the 3-part Windows asset stack (protocol-asset feature + assetProtocol.scope + `http://asset.localhost` CSP origin). See WIKI Addendum 2026-05-30 "Windows Asset-Protocol Media Loading".
- Auth: unlocked when signed in as the owner identity. The gate is a hardcoded whitelist (`shell/AuthContext.tsx:237-240`: handle `seanie` or `seanie@everywear.id`). Magic-string fragility; recurring "everything Locked" cause.
- Loom manifest: fixed (`applets/loom/applet.toml` `min_tier = "demo"`).
- Split: P0/P1/P2/P3 done (two applets register + group + icons; manifest force-loads locked model; selector hidden). P4 smoke passed 2026-05-30: `gener8-4ever` is Song-only, and `gener8-pro` still exposes Reference/Cover after the Rust serde camelCase boundary fix plus TS normalization. P5/P6 source-verified 2026-05-30: Pro audio state machine only accepts Reference/Cover, the single Vid Studio target is `vid` for both Gener8 applets, Vid Pro capabilities are gated internally by `vid_pro` at Gener8 Pro, and 4ever 12-step ceiling smoke passed. P7 runtime-smoked 2026-05-30: Gener8 camera handoff launches the single Vid applet, labels it Vid Studio Pro for `vid_pro`, and selects the source song after song-store hydration. P7 dead `CreateView.tsx` quarantine, P8 Vid Studio Pro Render smoke, and P9 S3 folder occlusion smoke are done. `gener8-pro` 75-step ceiling smoke still owed.
- Instrumentation: `[audio-diag]` console.warn still in `ShellAudioPlayer.tsx` — strip on next clean pass.

---

## PARITY MAP — S3Studio surfaces → Everywear routed status

Honest framing: this is an INTEGRATION-COMPLETENESS audit of the ported code, not a byte diff against the original (the original `Project Ace\S3 STUDIO\s3studio-web` is not mounted; mount it for a true diff). Every claim below is grounded in the Everywear code on disk. The core finding: the feature CODE crossed over intact; what is incomplete is registration / routing / nav wiring. This is bounded completion work, NOT a re-port.

### Status legend
- WORKING: registered, routed, mounts, verified or strongly expected to run.
- UNROUTED: code present and complete, but no launcher entry / nav / route reaches it. (Registration job.)
- BROKEN: routed but fails at runtime.
- DEFERRED: intentionally parked (tier-gated, not yet shipped).
- SCAFFOLD/NOTBUILT: placeholder or missing binary.
- VENDORED: substantial source/assets are present in-repo; runtime smoke still required unless marked WORKING.
- SMOKE-PENDING: registered + mounted, runtime not yet verified this pass.

### Top-level applets (shell launcher — both registries + AppletViewRouter)

| Applet (id) | Routed via | Status | Note |
|---|---|---|---|
| 1magen | ImagenCore | SMOKE-PENDING | mounted; image gen |
| gener8-4ever | Gener8ShellApp `/` | WORKING | player fixed |
| gener8-pro | Gener8ShellApp `/` | SMOKE-PENDING | needs play test + ref/cover (BROKEN, below) |
| vid (Vid Studio) | Gener8ShellApp `/vid` → VidApp | WORKING | launcher opens; Gener8 handoff selects source song |
| ai-director | Gener8ShellApp `/director` → AIDirectorView | SMOKE-PENDING | shim returns fallback shot plans (known carry) |
| 1magen/3nvizen/character-studio/loom/kasai/layeru-osint | own indexes or shell-local virtual surfaces | mixed | see below |
| 3nvizen | @applets/3nvizen | SPLIT-TRUTH | frontend package exists and TS no-emit passes; browser fallback marks Active/Locked from entitlements, but Rust registry still marks NotBuilt and native `list_applets` filters it out. Reconcile native/browser availability before launcher QA. |
| character-studio (Avatar Studio) | @applets/character-studio | VENDORED / SMOKE-PENDING | full vendored Avatar Studio frontend with large `src/` + `public/` asset base; shell asset-base shim present; CSS asset path repair verified; live visual QA still owed |
| loom (Educ8) | @applets/educ8 | SMOKE-PENDING | brand+Tier A rename 2026-06-06; internal id stays `loom` |
| kasai (My Mait) | KasaiCore | SMOKE-PENDING | |
| layeru-osint | LayerUOsintApplet | SMOKE-PENDING | |
| strands-game (Strands Nation) | NOT in AppletViewRouter | IFRAME/EXTERNAL | falls through to HeadlessAppletView (iframe); likely intended (strandsnation.xyz) — verify |
| s3studio | ExternalUrl | WORKING | opens s3studio.xyz |

Virtual applet rule, 2026-06-01 OODA: not every visible launcher has a physical
`applets/<id>/applet.toml`. `ai-director`, `daw`, and `layeru-osint` are
registry/router surfaces over existing code, while `s3studio` and `strands-game`
are external/iframe links. Treat them as virtual applets until a product decision
creates physical applet packages. Do not invent missing directories during fixes.

### Gener8 internal surfaces (original Sidebar nav vs live Gener8Nav)

Original `Sidebar.tsx` exposed: Create, Library, Search, Videos, Video Studio, Style Forge, DAW.
Live `Gener8Nav` (Gener8Core) exposes: Create, Library, Search.

| Surface | Code present | Status | Fix shape |
|---|---|---|---|
| Create (CreatePanel) | yes | WORKING | live |
| Library (views/LibraryView) | yes | WORKING | plays now |
| Search | yes | WORKING | live |
| Video Studio | yes | PROMOTED → `vid` applet | reachable from launcher |
| **DAW** (DawCore + StudioTab + daw_engine + dawApi) | yes, complete | **REGISTERED 2026-05-30 (build/smoke pending)** | `daw` applet added to transport.ts + registry.rs + AppletViewRouter (Gener8ShellApp @ `/daw`) + AppletIcon (DW glyph, blue) + LauncherGrid + ShellLayout S3 folder. tier creator_studio / `daw_pro`. Verify: `cargo build -p everywear-os` + relaunch, launch DAW, timeline loads. |
| **Videos** (VideoLibrary.tsx) | yes | **UNROUTED** | dropped from Gener8Nav; decide: re-add nav item or fold into Library |
| Style Forge (StyleForge.tsx) | yes | DEFERRED | creator_studio-gated; "coming in Creator Studio" by design |

### Known BROKEN (routed, fails at runtime)

- Reference + Cover UPLOAD (gener8-pro): WORKING 2026-05-30 after surfacing Tauri string errors and fixing the `vault_register_audio` IPC arg shape with required `isStem: false` and `tags: []`. Path: ProAudioModePanel.uploadAudio -> generateApi.uploadAudio -> gener8UploadAudio (`invoke gener8_upload_audio`) + vaultRegisterAudio (`invoke vault_register_audio`). Remaining auth finding is NOT closed security hardening: backend tier/entitlement gate is client-authoritative and JWT is unverified; paid-tier integrity remains a tracked risk/decision for server-side enforcement.
- Bottom mini-player: collapsed state shows pause glyph, no visible play control. Cosmetic; near `ShellAudioPlayer` UI.

### Dead / orphaned code (cleanup, not loss)

- `views/CreateView.tsx` — archived 2026-05-30 to `docs/_archive/_pending_delete_2026-05-30/`; live Create surface remains `CreatePanel.tsx`.
- `components/Sidebar.tsx` — orphaned by `Gener8Nav`; it is the record of original nav surfaces (useful as the parity reference). Decide keep-as-reference vs archive.
- `components/LibraryView.tsx` — legacy, superseded by `views/LibraryView.tsx`.

---

## CANONICAL APPLET GATES (Sean, 2026-05-30) — full record in WIKI + vault

Three independent axes: (1) license tier `demo<gener8<gener8_pro<creator_studio`; (2) content ownership = owned trait/skill shards (My Mait Trading Post, per-user inventory, NOT a tier flag); (3) VRAM/hardware = which local model runs (resolved at install via model_manager::ModelResolver, NOT a paywall).

License gates: Gener8 → 1magen, gener8-4ever, basic Vid Studio (`vid`). Gener8 Pro → gener8-pro + internal Vid Pro features (`vid_pro`). Creator Studio → 3nvizen, ai-director, daw, and inherits all lower-tier Gener8/Vid capabilities. FREE → kasai/My Mait, character-studio, layeru-osint, loom, strands-game, s3studio.

Gates must agree across transport.ts + registry.rs + applet.toml + AuthContext. Drift = the recurring "Locked"/"rejected" bugs.

My Mait (LOCKED): name singular "My Mait" (display; internal id stays `kasai`). No Lite/Full. Free, untiered, default starter personality, orchestration chassis running AI Director + Loom invisibly. Monetization = Trading Post (scoped, not built; NFT-shaped ownership ledger w/ creator+provenance). Model = VRAM-gated at install. Avatar Studio = free base + Trading Post premium.

## ACTIVE PUNCH LIST (smallest-move order)

1. [~] DAW: register `daw` applet — PATCHED 2026-05-30 (Claude). 6 files: transport.ts, registry.rs, AppletViewRouter.tsx (@/daw), AppletIcon.tsx, LauncherGrid.tsx, ShellLayout.tsx. Owner build/relaunch + launch-DAW smoke owed before marking done. No refactors; additive only.
2. [x] Ref/Cover upload: WORKING 2026-05-30 after surfacing Tauri string errors and fixing backend tier sync plus the `vault_register_audio` IPC arg shape (`isStem: false`, `tags: []`). Security status is still open: paid-tier integrity is client-authoritative and JWT verification is a pre-push blocker.
3. [ ] Videos surface: decide route (nav item vs fold into Library); wire it. — UNROUTED.
4. [ ] Mini-player play control: restore the collapsed-state play button. — cosmetic.
5. [ ] Per-applet runtime smoke: launch each registered applet, record WORKING/BROKEN. Convert all SMOKE-PENDING rows. — closes unknown-unknowns.
6. [ ] Observability (P3ii): repoint diag.ts to `~/.everywear/logs`, wire tracing file appender, implement `get_session_logs`. — so future bugs are visible.
7. [ ] THEN resume split P8-P9. GATE-0 is now clear for 4ever playback, Ref/Cover upload, and Vid handoff; `gener8-pro` 75-step ceiling and play test still owed.

### Gate reconciliation (code disagrees with canon — surgical patches, each verified)

8. [x] 3nvizen -> Creator Studio: transport.ts + registry.rs + applets/3nvizen/applet.toml (min_tier) + AuthContext now agree. `gener8_pro` no longer grants `3nvizen` / `3nvizen.video`; `creator_studio` grants them. Verified: `npm run build --workspace everywear-os`; `cargo check -p everywear-os`; `cargo build -p everywear-os`.
9. [ ] My Mait: remove Lite/Full in AuthContext; collapse mymaits_lite_runtime/mymaits_full to a single free base; introduce owned-shard inventory (content-ownership axis, NFT-shaped, creator+provenance).
10. [ ] My Mait VRAM model assignment: register base-LM requirements with model_manager::ModelResolver for install-time VRAM resolution (not tier).
11. [ ] Display rename "My Maits" → "My Mait" (user-facing strings only; internal `kasai` id unchanged — scheduled migration).
12. [ ] Trading Post surface: scoped, not built. Visuals-heavy storefront; own task.
13. [ ] AI Director invisibility: ensure the free My Mait orchestrates AI Director without surfacing the name; heavy compute stays gated at execution.

### Gener8 split contract footgun, DO NOT REPEAT

- Rust-to-TypeScript Tauri invoke structs must use one casing convention. Preferred: Rust structs crossing to TS carry `#[serde(rename_all = "camelCase")]`; TS reads camelCase.
- Casing mismatch does not error. TS gets `undefined`, and permissive fallback defaults can silently re-enable legacy behaviour.
- Tell: browser works but desktop/Tauri does not, or vice versa, suspect serde casing before patching product logic.
- `gener8-4ever` symptom: title/header correct, but `CreatePanel` reads `allowedAudioModes` / `lockedModel` / `vidTarget` as undefined and falls back to `['song','reference','cover']`, so Reference/Cover wrongly render.
- Anti-pattern: launcher-locked applet with null/empty/unreadable manifest must fail closed with a visible bug state, not fall back to permissive defaults.

### LATEST BUGS (queued — address AFTER the P-sequence, per Sean 2026-05-30)

Ref/cover UPLOAD now WORKS (fixes: backend tier check + transport wrapper `isStem: false` / `tags: []` to satisfy `vault_register_audio` arg shape + the `String(err)` error-surfacing patch). Sequencing: Codex runs P3.5 then P4-P9 in order first; then these:

- [ ] **Intermittent playback.** 2026-05-30 runtime smoke: Sean generated two tracks in `gener8-4ever`; 12-step P6 ceiling held, but the third generated track did not play. Do NOT fix during P7. Reproduce later and capture the `<audio>` error plus song `audioUrl` / `file_path`; likely suspects are new-song asset-URL resolution race or storage-path mismatch.
- [ ] **"Open track location" broken.** The reveal-in-explorer / opener action fails. Found while investigating the 3rd no-play.
- [ ] **Cover/Reference default duration = 30s.** Possibly a hook/stem-duration concept tied to the DAW changes (NOT yet started). Do NOT patch in isolation as a cover/reference default; revisit WITH the DAW/stem work so the duration model is consistent. (Cover arguably should track source length; reference 30s maybe short, but defer until the DAW stem-duration design lands.)
- [ ] **Model not verifiable from logs (P3ii).** Runtime model loads only reach terminal stdout; the file logger is startup-only. Add a one-line model-load log so "did the right model (xl-base for Pro) load" is checkable. Recurring; ties to P3ii observability.
- [ ] **No forgot-password / password-reset flow.** 2026-05-30 auth smoke constraint: older non-owner test accounts exist, but their passwords are not recoverable from Supabase because Auth stores hashes, not plaintext. Do not attempt to expose passwords. Architecture is recorded in `docs/wiki/shell/password-reset-auth.md`: v1 should use Supabase `resetPasswordForEmail` to a web callback (`https://everywear.id/auth/reset-password`) and then normal desktop sign-in; deep-link recovery is a later Windows-verified upgrade. Add this before relying on long-lived lower-tier test accounts. New signups currently receive demo access that behaves like a Gener8 Pro-level test grant, so they do not validate true `gener8` / Gener8 4ever base Vid behaviour.
- [~] **DAW Pro Model not recognised / stem extraction blocked.** Source blocker fixed 2026-06-05: Gener8 shim now exposes `/api/engine/pack-status` and `/api/engine/install-pack`; public pack id `pro_base` aliases to manifest upgrade pack `better_models`, resolves the VRAM-selected xl-base quant, and preserves Gener8 Pro / Creator Studio entitlement semantics. Runtime route smoke and real model-download verification are still owed with the shim running.

### AUTH INTEGRITY — RELEASE BLOCKER (decision 2026-05-30, Sean)

Finding: the backend tier/entitlement gate is CLIENT-AUTHORITATIVE. `update_auth` (auth.rs:236-288) writes `AppState.licence_tier` and `entitlement_flags` from client-supplied `update.tier` / `update.entitlements`, and the JWT is parsed via `parse_jwt_unverified` (no signature check). `require_tier` (gener8_engine.rs:480-482) trusts those. So paid-tier enforcement is honor-system; anyone can push `tier: creator_studio` and unlock everything. Supabase IS the source of truth, but nothing currently verifies against it.

DECISION:
- DEV (Sean's machine, no users): client-trust gate is ACCEPTED. Proceed.
- PRE-PUSH (hard release blocker): reinforce Supabase enforcement before any public release.
  1. Verify the Supabase JWT signature in the Rust backend using asymmetric/JWKS public keys (NEVER ship the HS256 secret).
  2. Read tier/entitlements FROM the verified claims (put them in the token via a Supabase custom-access-token hook); ignore client-supplied update.tier/update.entitlements.
  3. Server-side validate any feature that costs us (cloud gen, API credits, gated weight downloads). Own-GPU local features may stay on the verified-local-token model.
- TIER NAMING: suspected mismatch. auth.rs:230 hard-rejects any tier not exactly demo/gener8/gener8_pro/creator_studio. Verify against live Supabase (profiles/plan table) what strings it actually issues; reconcile names (note: code tier `gener8` = product "Gener8 4ever"). Pending Supabase query.

Carries (do not lose): AI Director is a virtual Gener8 `/director` route, not a physical applet package; DAW is a virtual Gener8 `/daw` route; DAW Pro Model source blocker is now fixed at the shim route/alias layer but runtime route smoke and real model download remain owed; 3nvizen frontend/package exists but native Rust registry still marks NotBuilt; character-studio is vendored Avatar Studio with CSS asset path repair verified but live visual QA still owed; VideoGeneratorModal 4,373-line hard-ceiling; packages/video-modal modal, shell.css, CreatePanel, StemStudio, and shim.rs watch-list.

---

## RESOLVED (this session, for the record)
- Silent player (Windows asset CSP origin). 2026-05-30.
- Everything-Locked (owner identity). 2026-05-30.
- Loom manifest parse. 2026-05-30.
- Library playback wiring (P3i). 2026-05-30.
- Vid handoff (P7). 2026-05-30. Single `vid` applet launches from Gener8 and selects the source song; `Vid Studio Pro` is label/capability state only, not a second applet.
- Dead CreateView quarantine (P7). 2026-05-30.
- Vid Studio Pro Render smoke (P8). 2026-05-30. Pro-tagged multi-resolution presets visible; base-state smoke awaits a real `gener8` / Gener8 4ever account. Fresh demo signups behave as Pro-level test grants, not base Vid test users.
- S3 folder occlusion (P9). 2026-05-30. Tray now renders above the desktop icon column with a solid raised surface.

---

> 2026-06-06 10:19 SGT: Loom -> Educ8 rename pass. Brand + Tier A compile-time surface renamed
> (applets/educ8, @everywear/educ8, Educ8Core, educ8-* css). Wire id stays `loom`
> (documented codename, kasai precedent). Historical "Loom"/"loom" mentions above
> this line are accurate for their dates; do not retro-edit. Native build verify owed.

---

## 2026-06-07 00:08 SGT: Full-system visual audit, preview-only due Computer Use blocker

Project location: `C:\Users\MAG MSI\Project Everywear`

- USER REQUEST: overnight hands-on full-system visual/computer-use audit, regular screenshots, Obsidian theme for now.
- PREFLIGHT REFRESH PASSED: `cargo build -p everywear-os`; `cargo build`; npm builds for `@everywear/ewds`, `@everywear/video-modal`, `onemagen`, `@everywear/3nvizen`, `kasai-applet`, `@everywear/educ8`, `@everywear/gener8-web`, `@everywear/vid-web`, `@everywear/character-studio`, and `everywear-os`. Warnings only.
- COMPUTER USE BLOCKER: Codex Computer Use returned `Computer Use native pipe path is unavailable` after reset and retry. Real desktop/Tauri acceptance was NOT run.
- FALLBACK AUDIT: browser preview at `http://127.0.0.1:5173/?preview=1`; Graphite used as current Obsidian-family skin because no literal `obsidian` skin exists.
- ARTIFACTS: screenshots at `screenshots/2026-06-06-everywear-full-tour/`; findings doc `QA_TOUR_FINDINGS_2026-06-06.md`; tutorial script `TUTORIAL_SCRIPT_FULL_SYSTEM_2026-06-06.md`; local rollout note `.codex/memories/2026-06-07-everywear-full-tour-preview-audit.md`.
- MAJOR FINDING: integrated My Mait shell route imports `KasaiCore` directly, bypassing `KasaiApp`, so `MyMaitSettings` and model group selection are not reachable in-shell. The hub reports loaded slots, including Qwen3.6 35B-A3B Q4 and Qwen3.5 9B Q8 in preview, but Sean's local model selection/discovery question remains blocked by route exposure.
- BLOCKER FINDING: Vault preview blanks the app. Console shows undefined Tauri `invoke` in Vault transport and `useShellAudio must be used within ShellAudioProvider` from `LibraryView`.
- EDUC8 FINDING: Plan Downloads and Accept Plan work in preview; after Accept Plan, `Download` is no longer DOM-disabled. It was not clicked.
- S3 FINDING: S3 tray entries render visually but are exposed as generic text, not stable buttons/data-tour targets. Coordinate clicks were required for Gener8, Vid, AI Director, DAW, 3nvizen, and 1magen.
- PREVIEW SURFACE STATUS: My Mait, Educ8, Avatar Studio, Layer U, Gener8 4ever, Gener8 Pro, Vid, AI Director, DAW, 3nvizen, and 1magen all mounted in preview except Vault crash. Deep generation/export/stem acceptance remains owed in real desktop/Tauri.

---

## 2026-06-08 02:20 SGT: Full-system visual audit, real Tauri desktop

Project location: `C:\Users\MAG MSI\Project Everywear`

- USER REQUEST: execute the full-system tour promptpack overnight; no source edits; run the build before stopping.
- MODE: real Tauri desktop from `target\debug\everywear-os.exe`, not preview.
- ARTIFACTS: screenshots at `screenshots/2026-06-08-everywear-full-tour/`; findings doc `QA_TOUR_FINDINGS_2026-06-08.md`; tutorial script `TUTORIAL_SCRIPT_FULL_SYSTEM_2026-06-08.md`; local rollout note `.codex/memories/2026-06-08-everywear-full-tour-desktop-audit.md`.
- BUILD VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- PASSED: Settings visual controls and bug report modal; My Mait inline launch, no Edge spawn, no `KASAI_NOT_ACTIVE`, settings reachability, and successful chat response; Educ8 plan/accept without download; Gener8 4ever real song generation and playback; Vid Studio handoff; Vault native media listing; AI Director generated shot plan.
- MAJOR FINDING: Vid Studio render/export fails after fallback encoder starts; native encoder service did not respond on port `9876`, then WASM render dialog reported `Video rendering failed. Please try again.`
- MAJOR FINDING: DAW opens with `Unexpected token '<', '<!DOCTYPE...' is not valid JSON`; selecting `Morning QA Pulse` from S3 Library returns to empty Load a Track state for 60 seconds.
- MAJOR FINDING: Avatar Studio cannot load local `/cs assets/manifest.json`; response is HTML, not JSON. This is the no-R2 local bundle boundary.
- MAJOR FINDING: 1magen launch path reports `Command get_recommended_stack not found`.
- MAJOR FINDING: Strands Nation opens to a blank/blocked browser surface instead of the game shell.
- MINOR FINDINGS: My Mait skill catalog polluted with repeated internal `zsh-compatible` entries; Settings About domain typo; Educ8 Choose Location starts in `Project Layer U`; Layer U SON service offline on port `3117`; 3nvizen LTX sidecar offline.
