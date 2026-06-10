# PROJECT_STATE.md - Everywear / Gener8 Port

Single source of live state for surgical work. Read this first, every session. Last updated: 2026-06-11T00:51+08 SGT (Codex: Swarm fixrun visual QA integration).

Canonical context remains `CONTEXT.md` (history) and the Mymory vault. This file is the WORKING STATE: what is true right now, what is broken, what is the next smallest move. Update it after every patch.

## 2026-06-11 00:51 SGT - Swarm Fixrun Visual QA Integration (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: shell-native applets use shell chrome without nested router headers. `1magen` now opens with a compact shell strip and no duplicated `Everywear Applet` / `1magen` header stack.
- FIXED: My Mait opens through `KasaiApp`, Avatar Studio is labeled as Avatar Studio, and `FrontendInline` applets with no `frontend_port` open through `everywear://shell/{applet_id}` instead of erroring.
- FIXED: Gener8 suite lifecycle status is persistent in shell chrome and the taskbar pill; zero-byte manifests show waiting state instead of fake 0 percent progress.
- FIXED: shared Gener8 applet close/unload now routes through the Rust `unload_inline_applet_models` command. `ShellLayout.tsx` no longer performs a browser fetch to port 3001.
- FIXED: DAW engine health no longer publishes the phantom `gener8-shim` 3001 endpoint. `engine_health.rs` now reports `daw-shell-bridge` as an internal shell capability.
- FIXED: native DAW no longer throws the pending bridge error in Tauri. `dawApi.ts`, legacy Studio `DawPage.tsx`, and `DawTransportBar.tsx` route through the Rust `daw_bridge_request` command. `daw_bridge.rs` owns in-memory project state, stem URL/local-directory import into tracks/regions, transport, track/region edits, save/load, and waveform peak responses.
- FIXED BY VISUAL QA: shell-mounted Vid is `applets/gener8/web/src/shell/VidApp.tsx`; its old persistent song sidebar and "Choose from your library on the left" copy are gone. Vid now exposes `Load from Vault` in the main flow.
- VISUAL QA RECEIPTS: `screenshots/2026-06-11-fixrun-visual-qa/01-desktop.png` through `11-bug-report.png`, including fixed `08-vid-standalone-fixed.png`.
- VERIFICATION PASSED: `npm run build --workspace @everywear/shared`; `npm run build --workspace onemagen`; `npm run build --workspace kasai-applet`; `npm run build --workspace @everywear/character-studio`; `npm run build --workspace @everywear/video-modal`; `npm run build --workspace @everywear/vid-web`; `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo check -p everywear-os`; `cargo test -p everywear-os daw_bridge --lib`; targeted `model-manager` tests; `git diff --check`.
- REMAINING CARD: semantic stem separation still depends on the shell-managed Pro Model producing stem URLs. The DAW bridge now accepts those stems and makes timeline/transport/edit state operable; it does not fake extraction.

---

## 2026-06-10 23:55 SGT - Lane 3 Bug-Report Diagnostic Ring (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: bug reports no longer depend only on unflushed in-memory logger buffers. `packages/shared/src/lib/logger.ts` now keeps a recent 200-entry diagnostic ring independent of backend flush.
- FIXED: `platform/everywear-os/src/components/BugReportModal.tsx` uses the recent diagnostic ring, so a launch failure report can include the preceding applet/model/runtime chain instead of only the current post-flush residue.
- FIXED: `platform/everywear-os/src/shell/ShellLayout.tsx` enriches bug-report seeds with active window, open applets, launching applet, active inference applet, inference phase, Tauri applet banner state, engine-health endpoints, and the last lifecycle events from `applet-switch-progress`, `provision-manifest`, and `download-progress`.
- SCOPE: Lane 3 diagnostic pipeline only. This does not connect the 1magen BinaryLocal runtime handoff, generation commands, or save/Vault path.
- VERIFICATION PASSED: `npm run build --workspace @everywear/shared`; `npm run build --workspace everywear-os`; `npm run build --workspace onemagen`; `cargo check -p everywear-os`; `git diff --check`.
- NOTE: `BUGHUNT_FINDINGS_2026-06-10.md` was already dirty before this patch; it was not edited in this lane.

---

## 2026-06-10 16:49 SGT - Phase 2 H6 Entitlement Bypass Audit (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H6 ARTIFACT: `screenshots/2026-06-10-proof-pass/h6-entitlement-bypass-audit.json` records the read-only bypass map.
- H6 SCOPE: `platform/everywear-os/src/shell/AuthContext.tsx` promotes admin/support profile roles or Sean-owned handles/emails to local `creator_studio`, merges `expandTierToFlags('creator_studio')`, and adds `admin_override: true` before `syncToShell`.
- H6 UNLOCKS: the owner/admin bypass unlocks Gener8, 1magen, Vid/Vid Pro, 3nvizen, Gener8 Pro, Creator Studio, DAW Pro, AI Director/planner, Creator Pro, plus default free surfaces through the effective auth state.
- H6 CONSUMERS: `ShellLayout.tsx` and `LauncherGrid.tsx` consume `authUser.entitlements ?? authUser.tiers`, so promoted flags alter launcher badges and pre-launch gate decisions.
- H6 GUARD: Supabase `active_tier(p_user)`, `entitlement_flags(p_user)`, and `user_entitlements` RLS remain owner-bound. No server-side RLS bypass was found in this audit.
- H6 SEPARATE DEV BYPASS: browser-only preview mode still creates a `creator_studio` preview user only outside Tauri on localhost/127/::1 with `?preview=1`.
- PAID-RELEASE VERDICT: close the local owner-QA bypass before paid release by seeding persisted `admin_override`/`user_entitlements` rows or by moving QA promotion behind a dev-build-only switch. Do not use owner QA as proof that the monetization entitlement path works.
- VERIFICATION: read-only audit/docs pass. Entitlement behavior was not changed by design.

---

## 2026-06-10 16:43 SGT - Phase 2 H5 Fresh-Machine Manifest (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H5 ARTIFACT: `screenshots/2026-06-10-proof-pass/h5-fresh-machine-manifest.json` records the installer/bootstrap trap list.
- H5 TIER 1 BLOCKER: `platform/everywear-os/src-tauri/resources/node.exe` is missing and the `resources` directory does not exist in this tree. Debug can fall back to PATH Node; release cannot assume that.
- H5 TIER 1 BLOCKER: video encoder `dist/index.js` exists locally under ignored `platform/everywear-os/src-tauri/sidecar/video-encoder/dist/`, but the packaged resource path `resources/sidecar/video-encoder/dist/index.js` is missing.
- H5 TIER 1 BLOCKER: ACE-Step sidecar discovery still has Sean-machine absolute fallbacks in `applets/gener8/applet.toml`, `platform/everywear-os/src-tauri/src/gener8_engine.rs`, and `applets/gener8/src-tauri/src/ace_server.rs`.
- H5 TIER 2 BLOCKERS: FFmpeg is PATH/standard-path/Scoop-discovered, 3nvizen LTX sidecar packaging is undecided, and some runtime resolvers still fall back to repo cwd/dev candidates.
- BETA MACHINE VERDICT: installer/bootstrap workstream must bundle or provision Node, video encoder dist, ACE server companions, FFmpeg or explicit FFmpeg bootstrap, ACE models, and the 3nvizen LTX sidecar before a fresh trusted-user machine can be called ready.
- VERIFICATION: audit-only docs pass. No installer build was attempted; prompt explicitly excluded building the installer in H5.

---

## 2026-06-10 16:41 SGT - Phase 2 H4 Rust Lock Discipline Sweep (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H4 ARTIFACT: `screenshots/2026-06-10-proof-pass/h4-lock-discipline-scan.json` records the lock/await scan over `src/lib.rs` and `src/commands/`.
- H4 FIXED: `platform/everywear-os/src-tauri/src/commands/platform.rs` no longer holds many unrelated guards while building `platform_status`; it snapshots one mutex at a time before producing JSON.
- H4 FIXED: `platform/everywear-os/src-tauri/src/commands/registry.rs` no longer holds the applet registry while awaiting tier/entitlement locks. It snapshots tier and entitlements before registry access.
- H4 WIKI LOCKED: WIKI v1.1.73 now documents the canonical lock discipline: prefer one lock at a time, never hold guards across IPC/HTTP/provisioning/process-launch/file-heavy work, and use the documented fallback order only for unavoidable non-async guarded sections.
- H4 CARDED: `request_applet_switch` remains the structural lock debt. It holds VRAM budget state across purge/provision/launch-adjacent async work and needs a dedicated plan/commit launcher refactor.
- VERIFICATION PASSED: `cargo check -p everywear-os`. Existing workspace profile and dead-code warnings only.

---

## 2026-06-10 16:36 SGT - Phase 2 H3 Port/URL Literal Sweep (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H3 ARTIFACT: `screenshots/2026-06-10-proof-pass/h3-port-url-literal-sweep.json` records the filtered source/runtime literal sweep.
- H3 RULE APPLIED: allowed literals are applet vite/dev config, Tauri `devUrl`/CSP, applet IPC random-port wiring, frontend-port assembly from registry metadata, and local hostname checks. Docs, generated schemas, archives, and marketing harnesses were excluded from defect classification.
- H3 LOGGED TIER 1: legacy Gener8 shim `3001` consumers remain in shell/Gener8/Vid/DAW paths even though `engine_health.rs` owns the `gener8-shim` expected-down row. P3 already proved direct 3001 save-path dependency is dangerous.
- H3 LOGGED TIER 1: video encoder `9877` is health-owned in `engine_health.rs`, but `vault_commands.rs` still downloads encoder artifacts by literal URL. Keep until shell-owned encoder lifecycle is repaired, then centralize endpoint ownership.
- H3 LOGGED TIER 2: 3nvizen LTX `8787`, Layer U SON `3117`, and Character Studio donor API `8081` remain documented endpoint debts with distinct ownership decisions.
- VERIFICATION: audit-only docs pass. No endpoint consumers were migrated in H3 by prompt constraint.

---

## 2026-06-10 16:34 SGT - Phase 2 H2 Event Contract Audit (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H2 ARTIFACT: `screenshots/2026-06-10-proof-pass/h2-event-contract-postfix.json` records the post-fix emit/listen table.
- H2 FIXED: `kasai://reasoning-trace` was a real orphan emitter. Rust forwarded it from the Kasai IPC bridge, but the Kasai UI did not listen. `applets/kasai/src/shell/KasaiCore.tsx` now listens, normalizes malformed payloads, and renders traces as assistant reasoning.
- H2 VERIFIED PAIRED: `agent-event`, `applet-switch-progress`, `applet-webview-opened`, `applet-webview-closed`, `download-progress`, `educ8-download-progress`, `engine-health`, `kasai://slot-event`, `kasai://tool-call/update`, `kasai://tool-call/complete`, `provision-manifest`, and `kasai://reasoning-trace`.
- H2 OPEN DECISIONS: `everywear:applet-status`, `everywear:launch-applet`, and `s3:skin` are orphan browser/custom-event listeners with no in-repo emitters. Decide whether they are external hooks to document or stale donor hooks to remove.
- VERIFICATION PASSED: `npm run build --workspace kasai-applet`; `npm run build --workspace everywear-os`. Existing Vite dynamic import and large chunk warnings only.

---

## 2026-06-10 16:31 SGT - Phase 2 H1 Silent-Failure Sweep (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- H1 FIXED: `platform/everywear-os/src/shell/ShellLayout.tsx` no longer swallows `closeAppletWebview` failures. Close failure now logs and shows an `Everywear · applet lifecycle` error toast.
- H1 FIXED: `packages/video-modal/src/components/VideoGeneratorModal.tsx` no longer silently ignores `release_video_encoder` failure on modal close. It now logs a targeted GPU encoder release warning.
- H1 FIXED: `applets/gener8/web/src/components/studio/StemStudio.tsx` no longer uses browser `alert()` for invalid/unloadable uploaded audio. It now sets error phase and the existing inline `extractError` surface.
- H1 FINDINGS RECORDED: legacy Gener8 alert/confirm surfaces, swallowed DAW mutations, and best-effort empty catches requiring comments are recorded in `BUGHUNT_FINDINGS_2026-06-10.md`.
- VERIFICATION PASSED: `npm run build --workspace @everywear/video-modal`; `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`.

---

## 2026-06-10 16:23 SGT - Phase 1 P4 BinaryLocal VRAM Release Proof (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- P4 VERDICT: PASS. My Mait / `kasai` was used as the BinaryLocal target. Baseline `get_vram_budget` showed no allocations and `get_active_applet` returned null.
- PROVEN: Each of three `request_applet_switch("kasai")` launches allocated the same two budget rows: `kasai-orchestrator-qwen3-6-35b-a3b-q4km` as Primary at 20,500MB and `kasai-agent-qwen3-5-9b-q4km` as Encoder at 5,400MB, with `active_applet = kasai`.
- PROVEN: killing the exact child PIDs (`everywear-kasai.exe`) emitted `applet-webview-closed { applet_id: "kasai" }`, cleared `active_applet`, emptied `get_vram_budget().allocations`, and left no remaining `everywear-kasai` process. Repeated x3 with no reservation stacking.
- RECEIPTS: `screenshots/2026-06-10-proof-pass/p4-vram-baseline.json`, `p4-kasai-launch-1.json`, `p4-kasai-kill-1.json`, `p4-kasai-kill-cycles-2-3.json`, plus `p4-kasai-after-kill-1.png`, `p4-kasai-launch-2.png`, `p4-kasai-after-kill-2.png`, `p4-kasai-launch-3.png`, `p4-kasai-after-kill-3.png`.
- PHASE 1 STATUS: P1 remains blocked pending safe seeded provisioning replay or approved cache mutation; P2 passed; P3 GPU save + Vault registration passed after native save-path fix, with shell encoder boot debt still open; P4 passed.

---

## 2026-06-10 16:17 SGT - Phase 1 P3 Vid GPU Encoder-to-Vault Save Fix (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- P3 SIDECAR-DOWN VERDICT: PARTIAL. With video-encoder down, Vid showed the WASM CTA and failed visibly with `Rendering failed: Failed to execute 'drawImage'... broken state.. Nothing was saved.` This satisfies no-silent-no-op, but WASM export completion remains broken.
- P3 SIDECAR-UP INITIAL VERDICT: FAIL. With manual NVENC encoder healthy on 9877, Vid showed `RENDER 540P (16:9) (GPU)`, streamed 1440 frames, and the sidecar completed a 29.9MB MP4 in 5.5s, but the UI failed post-encode with `Rendering failed: Failed to fetch. Nothing was saved.`
- ROOT CAUSE: post-encode save still depended on the legacy Gener8 shim API at 3001 while shell engine health honestly reports `gener8-shim` down. Encoder health, frame rendering, and NVENC were not the failing layer.
- FIXED: `platform/everywear-os/src-tauri/src/vault_commands.rs` added `vault_register_video_from_encoder`, which validates an encoder session id, pulls `/download/{session}` from the local encoder, stages the MP4, and registers it through the existing Vault video path. `platform/everywear-os/src-tauri/src/lib.rs` registers the command. `packages/video-modal/src/components/VideoGeneratorModal.tsx` now uses that native save path for GPU `save-from-encoder` and skips duplicate wrapper registration when the shell already registered the video.
- P3 POSTFIX VERDICT: PASS for GPU export + Vault registration. Native replay showed `video-encoder` online, `gener8-shim` still down, Vid rendered through GPU, UI displayed `Video saved (14.9 MB) -> Videos/Strands Sound Studio`, wrote `C:\Users\MAG MSI\Documents\Everywear Vault\Videos\everywear-encoder-1781079328-0f8d630d-14b7-4913-8456-4657598e7de0.mp4` at 15,636,134 bytes, and `vault_search(mediaFilter=videos)` indexed it as a 960x540 / 24fps video item with SHA256 `0d6b17b16a57d01cdf22bf079c80578d8f80beee082efd4b9fc282fa164c31e1`.
- VERIFICATION PASSED: `npm run build --workspace @everywear/video-modal`; `npm run build --workspace everywear-os`; `cargo check -p everywear-os`; `cargo build -p everywear-os`; native CDP Vid GPU export replay.
- RECEIPTS: `screenshots/2026-06-10-proof-pass/p3-vid-sidecar-down-wasm-result.json`, `p3-vid-sidecar-up-gpu-result.json`, `p3-vid-gpu-postfix-result.json`, `p3-vid-gpu-postfix-vault-search.json`, and paired screenshots.
- REMAINING P3 DEBT: shell `request_video_encoder` previously returned `{ ok: true, value: 9877 }` without leaving a listener on 9877. The passing replay kept the already-running manual encoder on 9877, so shell-owned encoder start still needs its own bug-hunt slice.

---

## 2026-06-10 15:47 SGT - Phase 1 Proof Pass P1/P2 (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- P1 PROVISIONING REPLAY VERDICT: BLOCKED, not faked. Gener8 4ever opened natively but emitted zero `provision-manifest` / `download-progress` events because local compatible models satisfy the selected ACE ladder. `resolve_all_models` showed missing 1magen/3nvizen model IDs, but those missing requirements do not currently carry complete downloadable HF repo/file metadata, so they cannot exercise `download_with_resume_and_progress` without moving/deleting model cache files. No model cache mutation was performed.
- P1 RECEIPTS: `screenshots/2026-06-10-proof-pass/p1-before-gener8-switch.png`, `p1-gener8-download-25s.png`, `p1-gener8-provisioning-25s.json`.
- P2 ENGINE-HEALTH VERDICT: PASS after rebuilding the native EXE. The stale 01:47 debug binary initially produced no engine-health events; `cargo build -p everywear-os` was run, the rebuilt native app was relaunched, and `window.__EVERYWEAR_ENGINE_HEALTH__` then published all four endpoints every sweep.
- P2 PROVEN: baseline `ace-server` online on 8080, `ltx-sidecar` down on 8787, `video-encoder` down on 9877, `gener8-shim` expected/down on 3001; `Stop-Process -Id` killed `ace-server`, port 8080 disappeared, the next sweep flipped `ace-server` offline; restarting `ace-server.exe --models "%USERPROFILE%\.everywear\models" --host 127.0.0.1 --port 8080` flipped it back online. DAW opened with the honest `gener8-shim` / `localhost:3001` offline copy visible.
- P2 RECEIPTS: `screenshots/2026-06-10-proof-pass/p2c-engine-health-kill-restart.json`, `p2c-engine-health-baseline.png`, `p2c-engine-health-after-ace-kill.png`, `p2c-engine-health-after-ace-restart.png`, `p2-daw-gener8-shim-honest-down.json`, `p2-daw-gener8-shim-honest-down.png`.
- FINDINGS TO CARRY: direct JS invoke `request_applet_switch('gener8-4ever')` returns `FrontendInline applet is missing frontend_port`, while the visible UI can open Gener8 4ever. Treat as a bug-hunt finding, not a P2 blocker. P1 needs either a safe cache-mutation approval or a seeded downloadable test requirement before it can prove resume/failure.

---

## 2026-06-10 15:28 SGT - Phase 0 Backfill: Lane-A Engine-Health Consumer Migration (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- BACKFILLED: the lane-A engine-health consumer migration was present in the dirty tree without a PROJECT_STATE entry. This entry is an honest Phase 0 receipt before committing that work.
- DOCTRINE LINE RELIED ON: WIKI v1.1.67 says engine-health consumers migrate in slice 2 while engine ports remain owned by `engine_health.rs` until manifest-driven registration.
- FILES CHANGED: `packages/shared/src/engineHealth.ts` plus shared exports; `platform/everywear-os/src/shell/ShellLayout.tsx` listens once to Rust `engine-health`, republishes browser context, and merges endpoint state into runtime labels and the desktop Inference card; `applets/3nvizen` consumes the shell `ltx-sidecar` endpoint when shell-mounted; `packages/video-modal` consumes the shell `video-encoder` endpoint with standalone probing as fallback; `applets/gener8/web/src/shell/intentBus.ts` uses the honest-down `gener8-shim` endpoint for DAW Pro Model copy.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo check -p everywear-os`. Warnings only: existing Vite large chunk/dynamic import warning and existing Rust dead-code warnings.
- OWED: Phase 1 native proof pass: provisioning replay, engine-health devtools smoke, Vid export both worlds, and VRAM release on child kill x3.

---

## 2026-06-10 10:24 SGT - Punch-List Wave 2 (Claude Cowork)

Location: `C:\Users\MAG MSI\Project Everywear`

- ADDED: `engine_health.rs` (single prober, `engine-health` event, honest-down reporting of the DAW 3001 phantom; spawned via new lib.rs `.setup()` hook). Port literals must now only be added to KNOWN_ENDPOINTS.
- IMPLEMENTED: sidecar URL provisioning Phase 2 (`provision_sidecar_from_url`): resumable download -> zip-slip-safe extract -> exe SHA256 verify -> staging + clear-then-rename swap; HUD progress via contract-v2 events; launcher.rs TODO stub removed; `provision_sidecar` now async (call site updated). NEW DEP: zip 2.4 (deflate only) in src-tauri Cargo.toml.
- CONSOLIDATED: educ8 downloads mirror onto the `download-progress` v2 bus (legacy event kept for its inline UI); 1magen untouched by design (separate binary, own webview bus, already on model-manager crate). LifecycleHud auto-settles standalone sessions (all rows done, 1.5s quiet -> done -> 4s hide).
- VERIFICATION PASSED: tsc --noEmit clean (everywear-os).
- OWED: cargo check -p everywear-os (new zip dep compiles here), native sweep watch (engine-health event in devtools), a real source_url sidecar pull test when a CI archive exists. Remaining list: engine-health consumer migration (slice 2), llama-server migration, video-modal split execution (promptpack filed).

---

## 2026-06-10 09:51 SGT - Punch-List Wave 1 (Claude Cowork, parallel scouts + single writer)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: Vid render silent no-op (exportError surface, loud guards, alert() removed: unreliable in Tauri WebView); Kasai/applet VRAM stacking (orphan child kill on IPC accept failure in launcher.rs; event-pump close now releases budget + active_applet + process entry + emits applet-webview-closed); 3nvizen registry NotBuilt->Active (native/browser agreement); announcer truthfulness (educational launch toast gated off for runtime-owned 1magen/3nvizen).
- ADDED: 3nvizen data-tour anchors (8, vid/daw convention); CODEX_PROMPTPACK_VIDEO_MODAL_SPLIT_2026-06-10.md (7-step staged split of packages/video-modal 3,465-line monolith; gener8 copy already a 74-line wrapper, stale OODA premise corrected).
- VERIFICATION PASSED: tsc --noEmit clean for everywear-os, @everywear/video-modal, 3nvizen (session sandbox).
- OWED: cargo check -p everywear-os + workspace builds + native replay (Vid export smoke with sidecar down AND up; 3nvizen desktop launch via native registry; kill-an-applet VRAM release check). Remaining punch list: engine port registry, sidecar URL provisioning Phase 2, download path consolidation, llama-server migration, video-modal split execution.
- METHOD: 5 parallel read-only scouts (4 Explore + 1 Plan) -> single-writer scripted patches via sandbox layer (host edit-tool grow-truncation bug still active), 24 replacement pairs, all count==1 asserted.

---

## 2026-06-10 09:21 SGT - Provisioning Contract v2 + Lifecycle HUD (Claude Cowork)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: post-commit (7029aaa) audit session moved to the ranked punch list item 2 from `ARCH_REPORT_MODEL_LIFECYCLE_UX_2026-06-10.md`: kill the announce-then-silence toast disease at the root.
- FILES CHANGED: `platform/everywear-os/src-tauri/src/launcher.rs` (ProvisionManifestPayload + DownloadProgressV2, provision_models signature + manifest preflight emit); `platform/everywear-os/src-tauri/src/lib.rs` (switch_session uuid, two provision_models call sites); added `platform/everywear-os/src/components/LifecycleHud.tsx`; `platform/everywear-os/src/styles/shell.css` (HUD styles appended); `platform/everywear-os/src/shell/ShellLayout.tsx` (mount HUD, demote toasts to Failed-only, remove per-percent download toast + its readout churn).
- COMPAT: `download-progress` keeps legacy fields via serde flatten; 1magen's listener unaffected. `provision-manifest` is a new additive event.
- VERIFICATION PASSED: `tsc --noEmit -p platform/everywear-os` clean in session sandbox.
- OWED: `cargo check -p everywear-os` + `npm run build --workspace everywear-os` + native download replay on the dev machine (sandbox has no CUDA toolchain); follow-up from report: Vid render silent no-op (9877), shell announcer truthfulness gate, VideoGeneratorModal split.
- TOOLING INCIDENT: host-side file edits that grow a file were truncated at original byte length by the Cowork mount this session (hit ShellLayout.tsx, lib.rs, launcher.rs); recovered via `git show HEAD:` restore + scripted re-apply through the sandbox layer, verified by byte size + tsc. Use sandbox-layer writes for this repo until explained.

---

## 2026-06-10 01:49 SGT - First-Run Tour Host First Slice (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: coded the first tour slice after the architecture lock.
- FILES CHANGED: added `platform/everywear-os/src/tour/tourManifests.ts`; added `platform/everywear-os/src/tour/FirstRunTourHost.tsx`; mounted `<FirstRunTourHost />` in `platform/everywear-os/src/shell/ShellLayout.tsx`.
- IMPLEMENTED: shell-level first-run overlay using existing EWDS `.ew-tour-*` primitives; verified manifest copy/selector steps; halo geometry; missing-target fallback; Start/Back/Next/Skip/Done controls; keyboard Escape/Enter/Arrow navigation; native preference persistence through `getPreference` / `setPreference`; browser localStorage fallback.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; native DOM confirmed `.ew-tour-host`, `.ew-tour-card`, `.ew-tour-halo`, step `1/8 Home Node`, enabled Skip and Start Tour, disabled Back, and no bug modal.
- NAVIGATION VERIFIED: native CDP clicked Start Tour and reached `2/8 Companion` with a My Mait halo, then Back returned to `1/8 Home Node`; host remained open and usable.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-first-run-tour-host-2026-06-10.png`, `native-first-run-tour-host-2026-06-10.json`, `native-first-run-tour-navigation-2026-06-10.png`, and `native-first-run-tour-navigation-2026-06-10.json`.
- BOUNDARY: this is the shell host and first verified manifest slice only. It does not launch applets, add Settings replay/reset, add 3nvizen anchors, or guide any generation/export side effects.

---

## 2026-06-10 01:45 SGT - First-Run Tour Architecture Lock (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: completed original visual QA manifest lane through Gener8, DAW, Vid, and 3nvizen sheets, then moved to tour architecture.
- OODA / CONTEXT STATUS: `ShellLayout.tsx` is 1,894 lines, `main.tsx` is 52 lines, `transport.ts` is 658 lines, and `packages/ewds/src/css/components.css` is 656 lines. `ShellLayout.tsx` remains below hard ceiling but should not absorb tour engine logic.
- ARCHITECTURE LOCKED: add `platform/everywear-os/src/tour/FirstRunTourHost.tsx` for overlay state, geometry, navigation, and preference persistence; add `platform/everywear-os/src/tour/tourManifests.ts` for verified selector/copy manifests; mount only `<FirstRunTourHost />` in `ShellLayout`.
- PERSISTENCE LOCKED: use existing shell preference IPC through `getPreference` / `setPreference` keys `tour.firstRun.completed` and `tour.firstRun.step`. Browser fallback may use `localStorage`.
- SELECTOR LOCKED: phase one uses verified stable selectors only: desktop applet ids, S3 folder aria label, Gener8/DAW/Vid `data-tour` anchors, Settings/Vault system buttons, and text/class selectors only for 3nvizen until anchors are added.
- PRODUCT BOUNDARY: first tour copy must teach verified promises only: Gener8 4ever create -> Vault -> playback, S3 Library as receipt surface, Avatar Studio -> My Mait verified path, 1magen setup-safe, DAW/Vid/3nvizen as orientation surfaces with explicit blockers.
- NEXT CODE MOVE: implement a shell-level host and initial manifest with Start/Next/Back/Skip/Done controls; do not add applet generation actions or mutate applet internals in the first slice except optional 3nvizen anchors if needed later.

---

## 2026-06-10 01:42 SGT - 3nvizen Offline Setup Sheet (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued original visual QA manifest lane after Vid; target was 3nvizen as an offline/setup tour sheet.
- PATCH STATUS: no code patch required in this slice.
- VERIFICATION PASSED: native Everywear OS remained live from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; desktop `button[data-applet-id="3nvizen"]` launched 3nvizen; the applet showed `OFFLINE`, LTX sidecar offline banner, Engine Offline badge, Text to Video, Image to Video, Audio to Video, Retake Soon, prompt field, duration slider, aspect-ratio select, seed field/random button, IC-LoRA conditioning placeholder, spatial upscaler placeholder, audio source dropzone, disabled Generate button, generated-video empty preview, no failed-load text, and no bug modal.
- RUNTIME BOUNDARY CONFIRMED: `http://127.0.0.1:8787/health` refused connection, matching the visible LTX sidecar offline state.
- TOUR ANCHOR GAP: applet-local `data-tour` anchor count is `0`; current first-run automation must use shell applet id plus visible text/class selectors until anchors are added.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-3nvizen-offline-setup-sheet-2026-06-10.png` and `native-3nvizen-offline-setup-sheet-2026-06-10.json`.
- BOUNDARY: 3nvizen is tourable as an offline local-video setup surface, but sidecar readiness, model status/download/load, generation, progress polling, output playback/download, Save to Vault, retake, IC-LoRA, upscaling, and folder-open remain unverified.
- NEXT ORIGINAL VISUAL QA MOVE: original tour sheets are now sufficiently manifested for the first tour architecture stage. Code should start with shell-level tour host plus stable manifest/anchor coverage, not with generation claims.

---

## 2026-06-10 01:39 SGT - Vid Seeded-Song Render/Export Blocker Sheet (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued original visual QA manifest lane after DAW; target was Vid Studio Pro with the fresh Gener8 4ever Vault MP3 as seeded input.
- PATCH STATUS: no code patch required in this slice.
- VERIFICATION PASSED: native Everywear OS remained live from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; S3 Studio folder opened; `button[data-applet-id="vid"]` launched Vid Studio Pro; the song sidebar loaded 121 rows and selected `Codex QA Gener8 Smoke 2026-06-10 0114`; Visualiser rendered a preview canvas at `960x540`; no failed-load text and no bug modal appeared.
- TOUR ANCHORS VERIFIED: Vid exposes applet-local anchors `vid.applet-root`, `vid.song-list`, `vid.subtab.visualiser`, `vid.tab.presets`, `vid.tab.style`, `vid.tab.text`, `vid.tab.effects`, `vid.tab.render`, `vid.preview`, and `vid.render-cta`.
- RENDER SURFACE VERIFIED: Render tab exposed enabled CTA text `RENDER 540P (16:9) (WASM)` and readiness copy `WASM encoder ready`; native GPU encoder health check failed with connection refused on `127.0.0.1:9877`, so the page showed the fallback copy `Native GPU encoder unavailable... Export will use the slower in-browser encoder.`
- BLOCKER CONFIRMED: programmatic DOM click and trusted CDP mouse click on the enabled render CTA did not start export, did not change CTA state, did not surface an error, did not create MP4/WebM output under Everywear Vault, Videos, or Downloads, and did not register a Vault video.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-vid-seeded-song-preflight-2026-06-10.png`, `native-vid-seeded-song-preflight-2026-06-10.json`, `native-vid-seeded-song-render-tab-2026-06-10.png`, `native-vid-seeded-song-render-tab-2026-06-10.json`, `native-vid-seeded-song-render-attempt-2026-06-10.png`, `native-vid-seeded-song-render-attempt-2026-06-10.json`, `native-vid-seeded-song-render-trusted-click-2026-06-10.png`, and `native-vid-seeded-song-render-trusted-click-2026-06-10.json`.
- BOUNDARY: Vid is tourable as a selected-song visualiser with preview and render-tab orientation, but render/export completion, native encoder boot, MP4 download, shim save, and Everywear Vault video registration remain unverified and currently blocked.
- NEXT ORIGINAL VISUAL QA MOVE: continue with 3nvizen offline/setup sheet and remaining tour manifests before first-run tour architecture/coding.

---

## 2026-06-10 01:26 SGT - DAW Functional Blocker Sheet (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued original visual QA manifest lane after the Gener8 4ever new-song Vault playback smoke; target was DAW with the fresh Vault MP3 context.
- PATCH STATUS: no code patch required in this slice.
- VERIFICATION PASSED: native Everywear OS remained live from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; S3 Studio folder opened; `button[data-applet-id="daw"]` launched DAW; the active window showed DAW, `READY`, Stems, Timeline, MixLens, Lego, Complete, S3 DAW header, Load a Track, Upload Audio File, From Library, transport bar, no failed-load text, and no bug modal.
- TOUR ANCHORS VERIFIED: DAW exposes applet-local anchors `daw.root`, `daw.tab.stems`, `daw.tab.timeline`, `daw.tab.analysis`, `daw.tab.lego`, `daw.tab.complete`, `daw.stems-panel`, `daw.load`, `daw.upload`, and `daw.library`.
- BLOCKER CONFIRMED: DAW still reports the real functional blocker in product copy: `Could not verify the Pro Model because the local Gener8 engine is offline on localhost:3001.` Current listeners show ACE on `127.0.0.1:8080`, but no Gener8 shim on `3001`.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-daw-functional-blocker-2026-06-10.png` and `native-daw-functional-blocker-2026-06-10.json`.
- BOUNDARY: DAW is tourable as a Creator Studio stem/timeline entry surface and can teach the From Library starting point, but Pro Model verification, model download, stem extraction, timeline/mixer population from a separated track, playback, export, and Vault registration remain blocked until the local Gener8 shim is running on `localhost:3001`.
- NEXT ORIGINAL VISUAL QA MOVE: continue with Vid seeded-song render/export, then 3nvizen offline/setup sheet and remaining tour manifests before first-run tour architecture/coding.

---

## 2026-06-10 01:16 SGT - Gener8 4ever New-Song Vault Playback Smoke (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued original visual QA functional smoke lane after 1magen runtime guard; target was Gener8 4ever generation, Vault registration, and playback for a new output.
- PATCH STATUS: no code patch required in this slice.
- VERIFICATION PASSED: native Everywear OS was running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; S3 Studio folder -> Gener8 4ever opened as `LIVE`; local `ace-server.exe` was running from `C:\Users\MAG MSI\.everywear\bin\ace-server\ace-server.exe` on `127.0.0.1:8080`; `/props` returned ACE model inventory and defaults.
- NATIVE UX VERIFIED: the Create panel accepted title `Codex QA Gener8 Smoke 2026-06-10 0114` and style `short cinematic synth pulse, clean local QA smoke, warm bass, subtle drums, thirty second instrumental`; clicking Create produced a new My Workspace row and selected detail panel with Vault metadata.
- VAULT VERIFIED: generated MP3 exists at `C:\Users\MAG MSI\Documents\Everywear Vault\Audio\Codex QA Gener8 Smoke 2026-06-10 0114-704107cff46f1960-288e4410.mp3`, length `480000` bytes, last written `2026-06-10T01:12:46+08`. Detail panel exposed `vault_id=vault-20eee1aed6eec467`, `source_app=gener8`, `library_scope=songs`, and `storage=vault_move`.
- PLAYBACK VERIFIED: clicking the new track playback control requested `http://asset.localhost/...Codex%20QA%20Gener8%20Smoke...mp3`, WebView returned `206` with `audio/mpeg`, metadata loaded, waveform rendered, and the bottom player advanced to `0:06 / 0:30`.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-gener8-4ever-generation-preflight-2026-06-10.png`, `native-gener8-4ever-generation-preflight-2026-06-10.json`, `native-gener8-4ever-create-smoke-final-2026-06-10.png`, `native-gener8-4ever-create-smoke-final-2026-06-10.json`, `native-gener8-4ever-new-track-playback-2026-06-10.png`, and `native-gener8-4ever-new-track-playback-2026-06-10.json`.
- BOUNDARY: this proves the native Gener8 4ever song path: create -> Vault record -> MP3 file -> asset playback. Still unverified: Pro Reference/Cover, delete persistence, search/filter correctness, pagination behavior, stale-index cleanup, DAW handoff, Vid handoff/render, and broad library mutation flows.
- NEXT ORIGINAL VISUAL QA MOVE: continue with DAW with shim online, Vid render/export, 3nvizen/remaining applets, then manifest final tour sheets before tour architecture/coding.

---

## 2026-06-10 01:03 SGT - 1magen Runtime Guard Visual Fix (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued the original visual QA functional smoke lane after S3 Library seven-theme sweep; target was the 1magen runtime/generation guard found during native smoke.
- FINDING BEFORE PATCH: native 1magen correctly disabled `Generate Image` while the BinaryLocal runtime handoff was not connected, but the disabled CTA still looked active, still read `Generate Image`, and the controls pane could show model recommendation/download language that implied provisioning was ready. Shell launch toasts also said `Checking requirements...` and `Downloading 3 models...` before the local engine handoff existed.
- FIXED: `applets/1magen/src/shell/ImagenCore.tsx` now derives explicit runtime-blocked/checking action state, labels the disabled hero CTA as `Runtime Handoff Pending`, blocks provisioning while runtime commands are absent, hides recommendation/download labels during runtime-blocked state, and keeps the runtime handoff note out of the sticky action bar. `applets/1magen/src/styles/imagen.css` styles the blocked primary action and runtime note.
- VERIFICATION PASSED: `npm run build --workspace onemagen`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; rebuilt native Everywear OS from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; opened 1magen from the desktop.
- NATIVE UX VERIFIED: 1magen opens its workbench, badge reads `Runtime handoff pending`, hero CTA reads `Runtime Handoff Pending`, button is disabled with `imagen-primary-btn--blocked`, cursor is `not-allowed`, no bug modal appears, and no model recommendation/download label appears in the 1magen controls while the runtime bridge is absent.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-1magen-runtime-guard-layout-final-2026-06-10.png` and `native-1magen-runtime-guard-layout-final-2026-06-10.json`.
- BOUNDARY: this is an applet-level setup-safe visual guard, not a generation/runtime bridge fix. Residual shell-level bug: global model lifecycle toasts still announce `Checking requirements...` and `Downloading 3 models...` during 1magen launch before the BinaryLocal handoff is actually connected.
- NEXT ORIGINAL VISUAL QA MOVE: continue functional smokes in parked order: Avatar remaining debt, Gener8 4ever generation/playback/save, DAW with shim online, Vid render/export, and remaining applets; then manifest final tour sheets before tour architecture/coding.

---

## 2026-06-10 00:47 SGT - S3 Library Seven-Theme Sweep Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: returned from Avatar Studio Export to Kasai / My Mait handoff closeout to the original visual QA lane. Sean's parked order was S3 Library seven-theme sweep first, then functional smokes.
- PATCH STATUS: no code patch required in this slice.
- VERIFICATION PASSED: native Everywear OS was running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon; each pass opened S3 Studio folder -> Gener8 4ever -> Library via the visible `button[title="Library"]`.
- NATIVE UX VERIFIED: every theme showed Gener8 4ever, Everywear Vault, media counts, search, sort, filters, populated rows including `Moving to the Sun`, record tags, row sizes/dates, scroll rail, no failed-load text, and no bug modal. Pixel spot-checks on Light and Carbon showed readable rows and no obvious overlap or contrast failure.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-s3-library-theme-light.png`, `native-s3-library-theme-classic.png`, `native-s3-library-theme-refined.png`, `native-s3-library-theme-terminal.png`, `native-s3-library-theme-graphite.png`, `native-s3-library-theme-anodized.png`, `native-s3-library-theme-carbon.png`, and `native-s3-library-theme-sweep.json`.
- BOUNDARY: this proves S3 Library / Everywear Vault visibility and theme readability across all seven shell themes. Playback remains proven by the earlier `Moving to the Sun (3)` native playback slice, but delete persistence, search/filter correctness, pagination behavior, stale-index cleanup, and save-to-Vault from a new generation remain separate functional QA gates.
- NEXT ORIGINAL VISUAL QA MOVE: continue functional smokes in parked order: 1magen generation/runtime handoff, Avatar remaining debt, Gener8 4ever generation/playback/save, DAW with shim online, Vid render/export, and remaining applets.

---

## 2026-06-09 14:38 SGT - Avatar Studio Export to Kasai / My Mait Handoff Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from Lora/sprite ZIP export into the Export to Kasai sidecar and My Mait companion import path.
- FINDING BEFORE PATCH: `Export to Kasai` generated the VRM export path but produced no verifiable `Anon.vrm`, no `strands-avatar.json`, no visible success state, and no My Mait import. Source inspection showed the frontend wrote files through browser File System Access only, while the backend already had `import_character_studio_avatar`; the two were not bridged. The sidecar also used `vrmFile`, but the MAIT importer reads `vrm_path`, `model_path`, or `assets.vrm`.
- FIXED: `platform/everywear-os/src-tauri/src/commands/my_mait.rs` now exposes `export_character_studio_avatar`, which picks or accepts an export directory, writes the VRM and `strands-avatar.json`, enriches the sidecar with importer-readable VRM paths, imports it into the MAIT store, and sets it as the active My Mait companion manifest. `lib.rs` registers the command. `download-utils.js` uses the native command in Tauri before browser fallback. `ExportMenu.jsx` now shows visible export status.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; rebuilt native WebView CDP replay opened Avatar Studio -> Create Character -> Drophunter -> Export -> Export to Kasai.
- NATIVE UX VERIFIED: Save screen rendered, Export to Kasai status reached `Exported to My Mait`, no bug modal, and no failed-load text. QA target-folder replay wrote `avatar-kasai-export-postfix\Anon.vrm` at 10,254,144 bytes with header magic `glTF`, version 2, and declared length equal to actual size. It also wrote `avatar-kasai-export-postfix\strands-avatar.json` with schema `strands-avatar-v1`, traits, `vrmFile`, `vrm_path`, `model_path`, and `assets.vrm`.
- MY MAIT VERIFIED: native `get_my_mait_settings` returned `active_manifest_id=f8b0ccc1-dc69-48bd-8b63-33b4c5601e25`; manifest list includes `Anon`, `source_schema=strands-avatar-v1`, `shard_count=1`. The MAIT store wrote `C:\Users\MAG MSI\.everywear\data\kasai\mait\f8b0ccc1-dc69-48bd-8b63-33b4c5601e25.json` with a `strands_avatar` shard pointing to the exported VRM path and the full Drophunter trait summary.
- PICKER BRANCH VERIFIED: with no QA target override, clicking `Export to Kasai` opened the native picker branch and Escape returned visible status `Export cancelled`; no silent fallback or hang.
- ARTIFACTS: `native-avatar-studio-kasai-export-postfix-00-landing.png`, `native-avatar-studio-kasai-export-postfix-01-drophunter.png`, `native-avatar-studio-kasai-export-postfix-02-save-screen.png`, `native-avatar-studio-kasai-export-postfix-03-after-export.png`, `native-avatar-studio-kasai-export-postfix-state.json`, `native-avatar-studio-kasai-export-picker-cancel.png`, `native-avatar-studio-kasai-export-picker-cancel.json`, and `avatar-kasai-export-postfix\*`.
- REMAINING AVATAR DEBT: Vault registration beyond the MAIT companion store, randomized trait persistence, full trait matrix, companion presence rendering beyond settings/import, and shared exporter cleanup for the non-blocking `Cannot read properties of undefined (reading 'direction')` exception.

---

## 2026-06-09 14:17 SGT - Avatar Studio Lora/Sprite ZIP Export Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from BatchManifest `Download All` into optional Lora and sprite data ZIP export.
- FINDING BEFORE PATCH: enabling `Download Lora Data` and `Download Sprites Data` wrote the VRM but produced no ZIP. Native page errors included `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` because generator manifest fetches used raw relative paths (`./lora-assets/manifest.json`, `./sprite-atlas-assets/manifest.json`) and received the shell HTML fallback.
- FIXED: `applets/character-studio/src/library/loraDataGenerator.js` and `applets/character-studio/src/library/spriteAtlasGenerator.js` now pass generator manifest URLs through `getAssetUrl(...)`, matching the local Character Studio asset-base contract.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; fresh native WebView CDP replay opened Avatar Studio -> Batch Download -> Manifest, dropped a Drophunter manifest JSON, enabled VRM, Lora data, and sprite data, then clicked the bottom Download action.
- NATIVE UX VERIFIED: BatchManifest route rendered, Lora and sprite toggles stayed enabled, avatar rendered, no bug modal, no failed-load text, no `Unexpected token '<'` manifest parse error, and no `data:` or `blob:` CSP export error. Download wrote `avatar-batchmanifest-lora-sprite-postfix\drophunter-lora-sprite-postfix.vrm` at 11,092,840 bytes with header magic `glTF`, version 2, and declared length equal to actual file size.
- ZIP VERIFIED: `avatar-batchmanifest-lora-sprite-postfix\drophunter-lora-sprite-postfix.zip` is 11,361,795 bytes with `PK` magic. Archive inspection found 46 Lora PNG files, 46 Lora TXT prompt files, and 40 sprite PNG frames under `spriteData/Multiple Animations`, matching the Drophunter source manifests. Total ZIP entries are 141 including directory entries; payload file count is 132.
- ARTIFACTS: `native-avatar-studio-batchmanifest-lora-sprite-postfix-00-route.png`, `native-avatar-studio-batchmanifest-lora-sprite-postfix-01-options-enabled.png`, `native-avatar-studio-batchmanifest-lora-sprite-postfix-02-after-download.png`, `native-avatar-studio-batchmanifest-lora-sprite-postfix-manifest.json`, and `avatar-batchmanifest-lora-sprite-postfix\*`.
- REMAINING AVATAR DEBT: Vault registration beyond the MAIT companion store, randomized trait persistence, full trait matrix, companion presence rendering beyond settings/import, and shared exporter cleanup for the non-blocking `Cannot read properties of undefined (reading 'direction')` exception.

---

## 2026-06-09 14:03 SGT - Avatar Studio BatchManifest Download All Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from Optimizer export into the BatchManifest route and multi-file `Download All`.
- FINDING BEFORE PATCH: BatchManifest export itself worked, but the Trait Selection panel showed a broken `Selection Thumbnail` image because dropped manifest JSON kept its raw relative `thumbnail` path.
- FIXED: `applets/character-studio/src/pages/BatchManifest.jsx` now passes dropped manifest thumbnails through `getAssetUrl(...)` before displaying them in the Trait Selection panel.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; fresh native WebView CDP replay opened Avatar Studio -> Batch Download -> Manifest, dropped Drophunter and Neurohacker manifest JSON files, and clicked `Download All`.
- NATIVE UX VERIFIED: BatchManifest route rendered, `Download All` appeared, Drophunter thumbnail loaded at `190x190`, avatar rendered, no bug modal, no failed-load text, no `data:image` CSP export error, and no `blob:` CSP export error. Download All wrote two valid VRM containers: `avatar-batchmanifest-downloadall-postfix\drophunter-manifest-all-postfix.vrm` at 10,776,676 bytes and `avatar-batchmanifest-downloadall-postfix\neurohacker-manifest-all-postfix.vrm` at 13,708,792 bytes; both have header magic `glTF`, version 2, and declared length equal to actual file size.
- ARTIFACTS: `native-avatar-studio-batchmanifest-downloadall-postfix-00-route.png`, `native-avatar-studio-batchmanifest-downloadall-postfix-01-loaded.png`, `native-avatar-studio-batchmanifest-downloadall-postfix-02-after-download.png`, `native-avatar-studio-batchmanifest-downloadall-postfix-manifest.json`, and `avatar-batchmanifest-downloadall-postfix\*.vrm`.
- REMAINING AVATAR DEBT: Vault registration beyond the MAIT companion store, randomized trait persistence, full trait matrix, companion presence rendering beyond settings/import, and shared exporter cleanup for the non-blocking `Cannot read properties of undefined (reading 'direction')` exception.

---

## 2026-06-09 13:53 SGT - Avatar Studio Optimizer Export Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from Batch Download into the Optimizer output path.
- PATCH STATUS: no code patch required for this slice.
- VERIFICATION PASSED: native WebView CDP replay opened Avatar Studio -> Optimize Character, dropped `applets\character-studio\public\character-assets\drophunter\body\drophunter.vrm`, loaded model information, and clicked the bottom Download action.
- NATIVE UX VERIFIED: Optimizer screen rendered, `DROPHUNTER` model loaded, geometry counts stayed visible (`SkinnedMeshes: 3`, `Triangles: 9816`, `Bones: 198`), Download appeared only after model load, no bug modal, no failed-load text, no KTX warning, no `data:image` CSP export error, and no `blob:` CSP export error. Download wrote `screenshots\2026-06-09-everywear-full-tour\avatar-optimizer-downloads-final\drophunter_merged.vrm` at 6,750,672 bytes; header magic is `glTF`, version 2, declared length equals actual file size.
- ARTIFACTS: `native-avatar-studio-optimizer-export-final-before-drop.png`, `native-avatar-studio-optimizer-export-final-loaded.png`, `native-avatar-studio-optimizer-export-final-after-download.png`, `native-avatar-studio-optimizer-export-final-manifest.json`, and `avatar-optimizer-downloads-final\drophunter_merged.vrm`.
- REMAINING AVATAR DEBT: Vault registration beyond the MAIT companion store, randomized trait persistence, full trait matrix, companion presence rendering beyond settings/import, and shared exporter cleanup for the non-blocking `Cannot read properties of undefined (reading 'direction')` exception.

---

## 2026-06-09 13:48 SGT - Avatar Studio Batch Download Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from Create export into the Batch Download surface.
- FINDING BEFORE PATCH: Batch source selection and JSON drop worked, but the screen leaked raw `CALLTOACTION.BACK` copy in Batch routes. The earlier automation also clicked the visible Download checkbox label instead of the bottom action button, creating a false negative for export.
- FIXED: `applets/character-studio/src/pages/BatchDownload.jsx` and `BatchManifest.jsx` now use plain `Back` copy instead of the uninitialized translation hook.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; native WebView CDP replay opened Avatar Studio -> Batch Download -> Drophunter, dropped `screenshots\2026-06-09-everywear-full-tour\avatar-batch-drophunter-selection-final.json`, and clicked the bottom Download action.
- NATIVE UX VERIFIED: Batch screen rendered, Drophunter selection loaded, trait list stayed visible, avatar rendered, no raw Back key, no bug modal, no failed-load text, no `data:image` CSP export error, and no `blob:` CSP export error. Download wrote `screenshots\2026-06-09-everywear-full-tour\avatar-batch-downloads-final\drophunter-batch-smoke.vrm` at 9,389,472 bytes; header magic is `glTF`, version 2, declared length equals actual file size.
- ARTIFACTS: `native-avatar-studio-batch-final-00-landing.png`, `native-avatar-studio-batch-final-selection-loaded.png`, `native-avatar-studio-batch-final-after-download.png`, `native-avatar-studio-batch-final-manifest.json`, `avatar-batch-drophunter-selection-final.json`, and `avatar-batch-downloads-final\drophunter-batch-smoke.vrm`.
- REMAINING AVATAR DEBT: Vault registration beyond the MAIT companion store, randomized trait persistence, full trait matrix, and companion presence rendering beyond settings/import.

---

## 2026-06-09 13:34 SGT - Avatar Studio Create VRM Export/Download Verification (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio Create QA from visible Drophunter customization into the Save/Export surface.
- FINDING BEFORE PATCH: Create -> Export reached the Save screen and `VRM 0` created a real `Anon.vrm`, but the screen leaked raw i18n keys (`pageTitles.saveCharacter`, `CALLTOACTION.BACK`) and native CSP blocked export-time `fetch(data:image/svg+xml, ...)` calls under `connect-src`.
- FIXED: `applets/character-studio/src/pages/Save.jsx` now uses plain visible Save/Back copy instead of the uninitialized translation hook; `platform/everywear-os/src-tauri/tauri.conf.json` now includes `data:` in `connect-src` for in-memory export assets.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; fresh native WebView CDP replay opened Avatar Studio -> Create Character -> Drophunter -> Export -> VRM 0.
- NATIVE UX VERIFIED: Save screen rendered with plain `Save Your Character`, Back, GLB, VRM 0, Export to Kasai, Download Options, no raw save keys, no bug modal, and no failed-load text. `VRM 0` wrote `screenshots\2026-06-09-everywear-full-tour\avatar-create-export-downloads-postfix\Anon.vrm` at 10,564,076 bytes; header magic is `glTF`, version 2, declared length equals actual length; no `data:image` CSP export error remained.
- ARTIFACTS: `native-avatar-studio-create-export-postfix-save-screen.png`, `native-avatar-studio-create-export-postfix-vrm0-after-click.png`, `native-avatar-studio-create-export-postfix-vrm0-manifest.json`, and `avatar-create-export-downloads-postfix\Anon.vrm`.
- REMAINING AVATAR DEBT: Export to Kasai directory-pick flow, `strands-avatar.json` sidecar, Vault registration, My Mait handoff, randomized trait persistence, full trait matrix, Batch completion, and optimized output inspection remain unverified. The export run still emitted a non-blocking page exception `Cannot read properties of undefined (reading 'direction')`, despite producing a valid VRM container, so exporter cleanup needs a separate source pass.

---

## 2026-06-09 13:21 SGT - Avatar Studio Create Customizer Visibility Repair (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from Optimizer import into Create Character -> Drophunter -> Appearance customizer.
- FINDING BEFORE PATCH: class choice and Appearance controls worked, but the central avatar viewport stayed black after initial traits loaded. Hit-testing showed the legacy `Background` component's black `_backgroundImg_*` layer was the top element over the WebGL canvas, hiding the loaded avatar.
- FIXED: `applets/character-studio/src/components/Background.module.css` now disables the legacy background fallback in the embedded Everywear applet so the WebGL studio canvas and backdrop remain visible.
- FOUND/FIXED: Drophunter body thumbnail referenced missing `_textureCollections/body/drophunter.png`; local ignored asset manifest `applets/character-studio/public/character-assets/drophunter/manifest.json` now points to existing `_textureCollections/skin/drophunter.png`.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo clean -p everywear-os`; `cargo build -p everywear-os`; fresh native WebView CDP replay opened Avatar Studio -> Create Character -> Drophunter -> Body.
- NATIVE UX VERIFIED: class choice rendered with Drophunter/Neurohacker and no raw keys; Appearance reached; avatar visible in the canvas; Body category and body trait picker rendered; Body thumbnail loaded; Export visible; no bug modal; no failed-load text; no character asset failures; no KTX support warning.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-avatar-studio-create-postfix-final-body-selected.png`, `native-avatar-studio-create-postfix-final-manifest.json`, plus pre-fix and probe screenshots.
- REMAINING AVATAR DEBT: Export/download/save, Vault registration, My Mait handoff, randomized trait persistence, full trait matrix, Batch completion, and optimized output inspection remain unverified.

---

## 2026-06-09 13:07 SGT - Avatar Studio Optimizer VRM Drop CSP Repair (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued Avatar Studio native QA from KTX2 helper transport into a real bundled VRM import on the Optimizer surface.
- FINDING BEFORE PATCH: dropping `applets\character-studio\public\character-assets\drophunter\body\drophunter.vrm` reached Optimizer and exposed `DROPHUNTER`, but WebView CSP blocked `fetch(blob:http://tauri.localhost/...)` under `connect-src`. The UI entered a fake-success state: Download appeared, but model information showed `Meshes: 0`, `SkinnedMeshes: 0`, `Triangles: 0`, `Bones: 0`.
- ROOT CAUSE: Avatar Studio's VRM loader uses `URL.createObjectURL(file)` and GLTF/VRM internals fetch that `blob:` URL. `script-src` and `worker-src` already allowed `blob:`, but native `connect-src` did not.
- FIXED: `platform/everywear-os/src-tauri/tauri.conf.json` now adds `blob:` to `connect-src`, scoped to local object-URL fetches rather than broad remote origins.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo clean -p everywear-os`; `cargo build -p everywear-os`; native WebView CDP replay opened Avatar Studio -> Optimize Character and dropped the same Drophunter VRM.
- NATIVE UX VERIFIED: before drop there was no premature Download button; after drop, `blob:http://tauri.localhost/...` VRM returned `200 model/vrm`, texture blobs returned `200 image/png`, console logged `Loaded VRM1 file`, Model Information showed `DROPHUNTER`, `SkinnedMeshes: 3`, `Triangles: 9816`, `Bones: 198`, `MTOON opaque: 6`, Download appeared, Download All stayed hidden for the single file, no bug modal, no KTX support warning, and no blob/KTX CSP violation.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-avatar-studio-optimizer-vrm-drop.png`, `native-avatar-studio-optimizer-vrm-drop-manifest.json`, `native-avatar-studio-optimizer-vrm-drop-after-csp.png`, and `native-avatar-studio-optimizer-vrm-drop-after-csp-manifest.json`.
- REMAINING AVATAR DEBT: actual optimizer export/download, compressed output inspection, Vault registration, My Mait handoff, Create completion, and Batch completion remain unverified. The loaded model is functionally accepted, but the visual canvas composition still deserves a dedicated polish pass because the captured avatar is not well framed in the center viewport.

---

## 2026-06-09 12:54 SGT - Avatar Studio KTX2 Asset-Script CSP Repair (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued the Avatar Studio deep-card QA lane from the verified Optimizer entry surface into the native console risk exposed by that replay: local `ktx2/libktx.js` was blocked by Content Security Policy even though the file exists under the scoped local Character Studio asset root.
- ROOT CAUSE: Windows WebView2 serves `convertFileSrc()` paths through `http://asset.localhost/...`; `tauri.conf.json` already allowed that origin for `img-src`, `media-src`, and `connect-src`, but `script-src` only allowed `'self' blob: 'wasm-unsafe-eval'`, so the local KTX2 helper script was blocked before compressed-texture support could initialize.
- FIXED: `platform/everywear-os/src-tauri/tauri.conf.json` now allows `asset: http://asset.localhost https://asset.localhost` in `script-src`, matching the existing Windows asset-protocol rule without adding broad external script origins.
- VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo clean -p everywear-os`; `cargo build -p everywear-os`; native WebView CDP replay opened Avatar Studio -> Optimize Character and captured console/network proof.
- NATIVE UX VERIFIED: `ktx2/libktx.js` returned `200` from `http://asset.localhost/...`; no KTX request failures; no KTX-specific CSP console violation; no `Failed to load KTX2 support` / `Compressed textures may not decode` warning; no bug modal; 8/8 optimizer images loaded; optimizer panel remained below app chrome.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-avatar-studio-ktx2-csp-final.png` and `native-avatar-studio-ktx2-csp-final-manifest.json`.
- REMAINING AVATAR DEBT: real compressed-texture decode on an imported/optimized VRM, download/export/save, Vault registration, My Mait handoff, and batch-download completion remain unverified. Separate native CSP debt remains for Google Fonts and `http://ipc.localhost/get_current_session_id`, but those are not Avatar KTX2 blockers.

---

## 2026-06-09 12:48 SGT - Avatar Studio Deep Card QA + Tour Polish (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued the visual QA tour from the 1magen runtime handoff gate into the previously unverified Avatar Studio deep-card lane.
- NATIVE QA: launched rebuilt `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; opened Avatar Studio through `button.ew-desktop-icon[data-applet-id="character-studio"]`; clicked Create Character, Batch Download, and Optimize Character through their native landing-card anchors.
- FINDING BEFORE PATCH: all three deep routes opened without bug modal or failed images, but Create and Batch exposed raw i18n keys (`pageTitles.chooseClass`, `CALLTOACTION.BACK`), Batch actually lands on a choose-source / manifest-load screen, and Optimizer showed a `Download` button before any VRM was loaded.
- FIXED: `Create.jsx` and `Claim.jsx` now show plain Everywear-native route labels and Back copy; `Optimizer.jsx` hides Download / Download All until a VRM or multi-file VRM batch is actually loaded; `MergeOptions.jsx` and `MergeOptions.module.css` add optimizer tour anchoring and move the options panel below the Avatar app chrome.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo clean -p everywear-os`; `cargo build -p everywear-os`; native WebView CDP replay confirmed fresh `index-CE5t7bP7.js`, no raw i18n keys, no premature Download button, 8/8 optimizer images loaded, 1 canvas, no bug modal, and panel rect top `215`.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-avatar-studio-deep-flow-manifest.json`, `native-avatar-studio-deep-flow-postfix-manifest.json`, `native-avatar-studio-deep-postfix-00-landing.png`, `native-avatar-studio-deep-postfix-01-create.png`, `native-avatar-studio-deep-postfix-02-batch-download.png`, `native-avatar-studio-optimizer-final.png`, and `native-avatar-studio-optimizer-final-manifest.json`.
- REMAINING AVATAR DEBT: no download/export/save operation was triggered in this pass; save path, Vault registration, My Mait handoff, real VRM optimization, and batch-download completion remain unverified. Native console still reports CSP blocking `asset.localhost/.../ktx2/libktx.js`, so compressed-texture decode support remains at risk until the shell CSP permits the local KTX2 helper or Character Studio loads it through an approved path.

---

## 2026-06-09 12:32 SGT - 1magen Runtime Handoff Generation Gate (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued the visual QA tour from the fixed Gener8 Library playback slice into the next first-run blocker: native 1magen generation, output save, and Vault registration.
- FINDING: native Everywear OS opens the integrated `ImagenCore` surface for `1magen`, but no `onemagen.exe` process is alive and the active shell Tauri process does not register the real 1magen commands: `list_models`, `download_model`, `load_model`, `generate_image`, or `save_image`.
- BROKEN BEFORE PATCH: clicking `Generate Image` with auto-save enabled showed `z-image-turbo-q8 · queued`, then surfaced `Command download_model not found`. This proved generation/provisioning/Vault registration cannot pass in the current integrated shell route.
- FIXED GUARDRAIL: `applets/1magen/src/shell/ImagenCore.tsx` now probes `list_models` on mount, marks the surface `Runtime handoff pending`, explains that the local runtime process must be active, and disables `Generate Image` while the real engine commands are missing.
- WIKI UPDATED: `WIKI.md` current-state note v1.1.36 records the BinaryLocal/runtime-command mismatch and guardrail boundary.
- VERIFICATION PASSED: `npm run build --workspace onemagen`; `npm run build --workspace everywear-os`; `cargo clean -p everywear-os`; `cargo build -p everywear-os`; native WebView CDP replay.
- NATIVE UX VERIFIED: clean rebuilt native shell served `index-eMXRHQmp.js` and `ImagenCore-CbJudRgz.js`; 1magen showed `Runtime handoff pending`; `Generate Image` was disabled; `list_models` still returned `Command list_models not found`; no stale `Command download_model not found` or queued-download copy appeared.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-1magen-generate-before.png`, `native-1magen-generate-after-missing-command.png`, `native-1magen-generate-missing-command-manifest.json`, `native-1magen-generate-gated-final.png`, and `native-1magen-generate-gated-final-manifest.json`.
- NEXT REAL FIX: connect the BinaryLocal `onemagen` runtime handoff so the integrated surface can invoke the actual applet commands, or route 1magen generation through an explicit shell job bridge. Until then, first-run tutorial can show the setup surface only, not an image-generation win.

---

## 2026-06-09 12:21 SGT - Gener8 Library Playback Stale Duplicate Repair (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: continued the native Gener8 Library QA slice after the Light/Dark contrast repair and tested first-row playback.
- ROOT CAUSE: `vault_search` returned duplicate same-sha `Moving to the Sun (3)` rows; the first row pointed at a stale missing Vault path, while the second row pointed at the live imported `-0c41f5c5.mp3` file. The UI faithfully clicked the stale first row and Tauri asset protocol returned 404.
- FIXED: `applets/gener8/web/src/views/LibraryView.tsx` now de-duplicates normalized Vault rows by content identity at the Library adapter boundary and prefers the row whose id is reflected in the Vault file path, keeping the playback queue aligned with the live Vault copy.
- VERIFICATION PASSED: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; `git diff --check`.
- NATIVE PLAYBACK PASSED: launched `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; opened S3 Studio folder -> Gener8 4ever -> Library; clicked the visible `Moving to the Sun (3)` row; asset protocol returned `206`; audio metadata loaded with `duration: 30`; player advanced to `0:05 / 0:30`.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-s3-library-playback-dedupe-before.png`, `native-s3-library-playback-dedupe-after.png`, and `native-s3-library-playback-dedupe-manifest.json`.
- FOLLOW-UP: the Vault index still contains stale duplicate documents. This frontend adapter fix makes the native Library usable, but a backend/offline Vault repair should remove or filter missing-path duplicates at source.
- SEPARATE QA NOTE: native console still logs a CSP violation for `http://localhost:3001/api/diag/log`; it did not block playback but should be handled in the local diagnostic logging lane.

---

## 2026-06-09 12:09 SGT - Gener8 Library Light Contrast Repair (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- CONTINUATION POINT: resumed the visual QA tour from the undocumented orphan artifact `screenshots\2026-06-09-everywear-full-tour\native-s3-library-theme-light.png`, created after the 07:45 home desktop sweep.
- FIXED: `applets/gener8/web/src/views/LibraryView.tsx` no longer renders the Gener8 Library / Everywear Vault list with S3 dark-surface utility classes that collapse contrast in Light mode. The list now uses EWDS tokens for the route background, row panels, row text, metadata, tags, tabs, sort menu, skeletons, and footer controls.
- VERIFICATION PASSED: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`.
- ARTIFACTS: `screenshots\2026-06-09-everywear-full-tour\native-s3-library-postfix-light.png`, `native-s3-library-postfix-dark.png`, and `native-s3-library-postfix-manifest.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; opened Gener8 4ever; selected the `button[title="Library"]` route; confirmed Everywear Vault text, populated rows, no failed-load text, and no Report a Problem modal.
- TUTORIAL STATUS: the Gener8 first-run loop can now show the Library/Vault review surface after Create without the Light-mode row contrast failure.
- BOUNDARY: this proves native Library/Vault route visibility and Light/Dark readability only. It does not prove playback, Tauri asset-protocol audio loading, delete persistence, search/filter semantics, page navigation, or save-to-Vault from a fresh generation.

---

## 2026-06-09 07:45 SGT - Native Shell Home Desktop Theme Sweep (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- PATCH STATUS: no code patch required.
- ARTIFACTS: screenshots at `screenshots\2026-06-09-everywear-full-tour\native-home-theme-*.png`; manifest `screenshots\2026-06-09-everywear-full-tour\native-home-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon; all windows and modals were closed before each capture; Show Desktop/Start returned to the shell home surface.
- PASSED VISUALS: every theme showed the clean home desktop with no open windows/modals, seven desktop applet buttons (My Mait, 1magen, Strands Nation, Layer U OSINT, 3nvizen, Avatar Studio, Educ8), S3 Studio folder closed, Settings and Vault system buttons, center clock/status cards, Node card, Inference card, Network card, weather/signal card, GPU label, Light/Dark toggle, profile chip, report bell, and no failed-load text.
- TUTORIAL STATUS: the first-run shell tour can teach the desktop layout: left launcher, S3 folder, center home status/readouts, bottom taskbar, profile, Settings, Vault, and report bell.
- BOUNDARY: this proves home shell visibility and launch anchors across themes. It does not prove fresh auth gate, restart persistence, actual applet launches, weather/geolocation success, clipboard/email/report submission, or deeper applet flows; those remain owned by separate QA slices.

---

## 2026-06-09 05:21 SGT - Vid Studio Pro Native Theme Sweep + Light Contrast Fix (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- FIXED: Vid Studio Pro's visualiser empty state no longer renders near-white text on the Light theme's cream surface. `applets/gener8/web/src/shell/VidApp.tsx` now uses EWDS text tokens for the empty-state icon, title, and hint, matching the token-safe `VidView.tsx` route.
- QA PASSED: native Vid Studio Pro was captured across Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon after the contrast fix.
- VERIFICATION PASSED: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace @everywear/vid-web`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched `target\debug\everywear-os.exe` with WebView CDP; reloaded each shell theme, opened the S3 folder, clicked `button[data-applet-id="vid"]`, and captured the active native Vid window. WebView checks confirmed Vid Studio Pro window, Visualiser tab, AI Video Soon, Storyboard Soon, Your Songs list, readable empty prompt, no failed-load text, and no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-vid-studio-pro-theme-light.png`, `native-vid-studio-pro-theme-classic.png`, `native-vid-studio-pro-theme-refined.png`, `native-vid-studio-pro-theme-terminal.png`, `native-vid-studio-pro-theme-graphite.png`, `native-vid-studio-pro-theme-anodized.png`, `native-vid-studio-pro-theme-carbon.png`, plus `native-vid-studio-pro-theme-sweep.json`.
- STATUS: Vid Studio Pro visual/theme coverage is captured for the native shell. This proves the empty/select-a-song Visualiser entry surface and coming-soon tabs are readable across themes; it does not prove video render/export, encoder health, playback, or Vault video registration.

---

## 2026-06-09 05:12 SGT - Gener8 Pro Native Theme Sweep Captured (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- QA PASSED: native Gener8 Pro was captured across Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- VERIFICATION: reloaded each shell theme, waited for the S3 folder button, opened the S3 folder, clicked `button[data-applet-id="gener8-pro"]`, and captured the active native Pro window. WebView checks confirmed Gener8 Pro window, S3 brand, Title, Lyrics, Style of Music, Vocal Language, Reference, Cover, Create, My Workspace, model lifecycle toast, no failed-load text, and no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-gener8-pro-theme-light.png`, `native-gener8-pro-theme-classic.png`, `native-gener8-pro-theme-refined.png`, `native-gener8-pro-theme-terminal.png`, `native-gener8-pro-theme-graphite.png`, `native-gener8-pro-theme-anodized.png`, `native-gener8-pro-theme-carbon.png`, plus `native-gener8-pro-theme-sweep.json`.
- STATUS: Gener8 Pro visual/theme coverage is captured for the native shell. This proves the Pro Reference/Cover entry surface and model lifecycle messaging are visible across themes; it does not prove Reference/Cover generation, Pro model download completion, route/API health, playback, or save-to-Vault behavior.

---

## 2026-06-09 05:08 SGT - Gener8 4ever Native Theme Sweep Captured (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- QA PASSED: native Gener8 4ever was captured across Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- VERIFICATION: opened the S3 folder and confirmed child route tiles for Gener8 4ever, Gener8 Pro, Vid, AI Director, and DAW; opened Gener8 4ever in the native shell; WebView checks confirmed active Gener8 4ever window, S3 brand, Title, Lyrics, Style of Music, Vocal Language, Creative Controls, Create, My Workspace, no failed-load text, and no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-gener8-4ever-theme-light.png`, `native-gener8-4ever-theme-classic.png`, `native-gener8-4ever-theme-refined.png`, `native-gener8-4ever-theme-terminal.png`, `native-gener8-4ever-theme-graphite.png`, `native-gener8-4ever-theme-anodized.png`, `native-gener8-4ever-theme-carbon.png`, plus `native-gener8-4ever-theme-sweep.json`.
- STATUS: Gener8 4ever visual/input-surface coverage is captured for the native shell. No song generation, route/API smoke, save-to-Vault flow, or deeper workspace control accessibility audit was run in this slice; the manifest's high icon-only button count needs a focused follow-up before claiming deep accessibility coverage.

---

## 2026-06-09 04:52 SGT - Vault Native Theme Sweep Captured (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- QA PASSED: native Everywear Vault was captured across Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- VERIFICATION: opened Vault via `button.ew-desktop-icon--system[aria-label="Open Vault"]`; WebView checks confirmed active Vault window, `.ew-vault-panel`, Media and Logs tabs, active Media tab, record summary `649 items|0 images|638 audio|11 videos|96 stems|3.0 GB`, real record rows, 12 filter buttons, delete controls with ARIA labels, no failed-load text, and no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-vault-theme-light.png`, `native-vault-theme-classic.png`, `native-vault-theme-refined.png`, `native-vault-theme-terminal.png`, `native-vault-theme-graphite.png`, `native-vault-theme-anodized.png`, `native-vault-theme-carbon.png`, plus `native-vault-theme-sweep.json`.
- STATUS: Vault visual/theme coverage is captured for Sean's populated QA vault. A true first-user empty Vault state still needs a clean-profile or reset pass before final tutorial copy can claim empty-state behavior.

---

## 2026-06-09 04:48 SGT - Avatar Studio Native Theme Sweep + Tour Anchors (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- QA PASSED: Avatar Studio native landing surface was captured across Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PATCH: `applets/character-studio/src/pages/Landing.jsx` now gives the three landing image-card buttons stable first-run anchors and accessibility text: `data-tour="avatar-create-character"`, `avatar-batch-download`, `avatar-optimize-character`, with matching `aria-label`, `title`, `type="button"`, and image `alt`.
- VERIFICATION PASSED: `npm run build --workspace @everywear/character-studio`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`; relaunched native `target\debug\everywear-os.exe`; opened Avatar Studio through `button.ew-desktop-icon[data-applet-id="character-studio"]`; local manifest fetched `200 application/json`; WebView verified 3 card buttons, 3 loaded card images, 1 canvas, no failed-load text, no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-avatar-studio-theme-light.png`, `native-avatar-studio-theme-classic.png`, `native-avatar-studio-theme-refined.png`, `native-avatar-studio-theme-terminal.png`, `native-avatar-studio-theme-graphite.png`, `native-avatar-studio-theme-anodized.png`, `native-avatar-studio-theme-carbon.png`, plus `native-avatar-studio-theme-sweep.json`.
- STATUS: Avatar Studio landing/tutorial entry is visually covered and now has stable anchors. Deeper Create, Batch Download, Optimize, save path, and My Mait handoff flows remain unverified.

---

## 2026-06-09 04:37 SGT - 1magen Native Theme Sweep Captured (Codex)

Location: `C:\Users\MAG MSI\Project Everywear`

- QA PASSED: the fixed native 1magen workbench was captured across every current shell theme target: Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- VERIFICATION: live WebView DOM/state per theme confirmed `.imagen-workbench`, `.imagen-controls`, `.imagen-output`, `bodyDisplay=grid`, no `failed to load` text, and no bug modal.
- EVIDENCE: `screenshots\2026-06-09-everywear-full-tour\native-1magen-theme-light.png`, `native-1magen-theme-classic.png`, `native-1magen-theme-refined.png`, `native-1magen-theme-terminal.png`, `native-1magen-theme-graphite.png`, `native-1magen-theme-anodized.png`, `native-1magen-theme-carbon.png`, plus `native-1magen-theme-sweep.json`.
- STATUS: 1magen visual tutorial coverage now has per-theme evidence. The remaining 1magen blocker is functional, not visual: model provisioning, actual image generation, output save path, and Vault registration are still unproven.

---

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

---

## 2026-06-09 05:44 SGT: AI Director native theme sweep and Light contrast repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCHED: `applets/gener8/web/src/views/AIDirectorView.tsx` now uses dark-surface contrast classes for the AI Director sidebar, shot plan, package card, and Creator Studio gate card. Root cause was Light-mode EWDS text tokens rendering inside dark `ew-card` / `ew-v2-bevel` panels.
- BUILD VERIFICATION PASSED: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-ai-director-theme-*.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-ai-director-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; S3 folder opened; `button[data-applet-id="ai-director"]` opened AI Director in Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED: every theme showed AI Director, Creator Studio label, Draft Plan, six deterministic shot rows, Package card, Planner Route `SAPI: lm studio, ollama, external API`, Vid Studio handoff, no failed-load text, and no bug modal.
- TUTORIAL STATUS: AI Director can be taught as the Creator Studio shot-planning surface across all shell themes, with model lifecycle toast visible during launch.
- BOUNDARY: this proves the native visual route and deterministic fallback plan surface only. It does not prove provider-routed SAPI success, Draft Plan API execution, Vid/3nvizen handoff, render/export, or Vault registration.

---

## 2026-06-09 05:55 SGT: DAW native theme sweep and engine-origin repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCHED: `applets/gener8/web/src/services/api.ts` now treats native `tauri.localhost` like hosted Everywear surfaces for local-engine calls, returning `http://localhost:3001` instead of `''`. DAW Pro Model checks no longer hit the shell HTML document and no longer throw `Unexpected token '<', '<!DOCTYPE ... is not valid JSON`.
- PATCHED: `applets/gener8/web/src/shell/intentBus.ts` now reports the real blocker in product language: `Could not verify the Pro Model because the local Gener8 engine is offline on localhost:3001.`
- BUILD VERIFICATION PASSED: `npm run build --workspace @everywear/gener8-web`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-daw-theme-*.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-daw-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; S3 folder opened; `button[data-applet-id="daw"]` opened DAW in Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED: every theme showed DAW, Stems tab, S3 DAW header, Load a Track empty state, Upload Audio File, From Library, transport bar, no `Unexpected token` parse error, no failed-load text, and no bug modal.
- BLOCKED: every theme still reports local engine failure because the Gener8 shim is not listening on `localhost:3001`. DAW Pro Model verification, model download, stem extraction, timeline/mixer population, playback, and Vault registration remain unproven.

---

## 2026-06-09 06:30 SGT: My Mait native theme sweep, launch-ledger repair, and Light settings contrast repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCHED: `platform/everywear-os/src-tauri/src/launcher.rs` now releases an applet's prior VRAM budget reservation before recording a new reservation for the same applet. This prevents failed or repeated My Mait launches from stacking stale `kasai` model allocations.
- PATCHED: `platform/everywear-os/src-tauri/src/lib.rs` now releases the applet reservation and clears `active_applet` when BinaryLocal launch or `StartInference` handoff fails after the shell has reserved models. Root cause was stale My Mait ledger state: native status showed real NVML free VRAM around 24.8GB, but shell budget had three `kasai` allocations totaling 28.9GB and only 3.7GB ledger-free.
- PATCHED: `applets/kasai/src/styles/agent-hub.css` now gives My Mait settings dark inset panels a scoped dark-surface text palette. Light mode no longer renders model and residency settings as dark text on dark panels.
- BUILD VERIFICATION PASSED: `npm run build --workspace kasai-applet`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-my-mait-theme-*.png` and `native-my-mait-settings-theme-*.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-my-mait-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; My Mait opened without bug modal after the ledger fix; all themes captured hub and settings surfaces.
- PASSED: Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon show My Mait hub, Agent Hub surface, chat composer, right panel, settings button, Everywear Vault connection, slot state, safety rails, model/residency settings, no failed-load text, and no bug modal. Light settings panel text color verified as `rgb(229, 238, 246)`.
- TUTORIAL DEBT: first-run skill list still exposes raw internal registry noise: `EVERYWEAR SKILLS 71`, repeated `zsh-compatible` entries, and MyMory-labeled skill names. Summaries are mostly Everywear Vault aligned, but the first-run tutorial should not present raw skill registry internals as the default user experience.
- BOUNDARY: this proves native launch, hub visibility, settings visibility, and theme readability. It does not prove a fresh-user curated onboarding flow, real local chat inference beyond the existing loaded surface, tool execution, approval-loop audit, Avatar Studio handoff, or Vault write path from My Mait.

---

## 2026-06-09 06:45 SGT: Educ8 native theme sweep and donor-copy repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCHED: `platform/everywear-os/src-tauri/src/commands/educ8.rs` now keeps Tier B wire/data ids intact while replacing user-facing content manifest copy that leaked donor/runtime language: `My Maits Lite IGCSE Teacher Skill`, `My Maits Lite headless model slot`, `loom-db setup phase`, and `Project NOMAD` source labels.
- PATCHED: `applets/educ8/src/Educ8Core.tsx` now displays the default internal `~/.everywear/data/loom/downloads` path as `Default Everywear Educ8 content store` in the visible setup UI. The raw path remains available as metadata, and the actual `loom` applet id/data path is unchanged by design.
- BUILD VERIFICATION PASSED: `npm run build --workspace @everywear/educ8`; `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-educ8-theme-*.png` and `native-educ8-theme-*-lower.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-educ8-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; `button[data-applet-id="loom"]` opened Educ8 in Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED: every theme showed Educ8, Learner Setup, IGCSE Teacher Pack, Plan Downloads, Choose Location, Accept Plan, Download, subject tabs, five Mathematics content cards, lower Pedagogy Model view, no failed-load text, no bug modal, no visible `My Maits Lite`, no visible `Project NOMAD`, no visible `loom-db setup`, and no visible raw default `data\loom` path.
- TUTORIAL STATUS: Educ8 can be taught as the first-run offline IGCSE tutor setup: choose learner subject, review required/recommended content, press Plan Downloads, inspect size/location/status, press Accept Plan, then only download after explicit consent.
- BOUNDARY: this proves native visual route, plan/accept flow, copy hygiene, and lower pedagogy visibility. It does not prove actual ZIM transfer, checksum validation, symlink creation after Choose Location, offline reader/indexing, local tutor inference, learner progress persistence, or Vault registration.

---

## 2026-06-09 06:55 SGT: 3nvizen native theme sweep, offline-sidecar tutorial boundary

Project location: `C:\Users\MAG MSI\Project Everywear`

- MODE: native Tauri Everywear OS from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; no 3nvizen code changes in this slice.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-3nvizen-theme-*.png`, `native-3nvizen-theme-*-advanced.png`, `native-3nvizen-theme-*-image-mode.png`, and `native-3nvizen-theme-*-audio-mode.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-3nvizen-theme-sweep.json`.
- VERIFIED: `button[data-applet-id="3nvizen"]` opened 3nvizen in Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED VISUALS: every theme showed the 3nvizen workbench, `LTX sidecar is offline` banner, `Engine Offline` badge, Text to Video / Image to Video / Audio to Video / Retake Soon tabs, prompt field with entered prompt, empty generated-video preview, disabled Generate button with `Engine offline`, advanced controls, IC-LoRA placeholder, Spatial Upscaler placeholder, Image mode source-image dropzone, and Audio mode audio-track dropzone.
- TUTORIAL STATUS: 3nvizen is tourable as a Creator Studio video workbench in offline-engine state. First-run teaching should say: choose a mode, write a prompt or attach source media, inspect advanced controls, then start generation only after the LTX sidecar/model handoff reports online.
- BLOCKED FUNCTIONAL QA: LTX sidecar remains offline on `127.0.0.1:8787`. Real model status, model download/load, generation, progress polling, output playback/download, Save to Vault, auto-save, retake, IC-LoRA extraction, upscaling, and folder-open are not proven.

---

## 2026-06-09 07:06 SGT: Layer U native theme sweep and offline retry repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCHED: `platform/everywear-os/src/son/styles/layer-u-osint.css` now makes the Project SON offline overlay pointer-enabled and styles `Retry connection` as a real EWDS button. Before the patch, the button rendered as inert text because `.lu-worldview__offline` had `pointer-events: none`.
- BUILD VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os`. Warnings only.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-layer-u-theme-*.png`, `native-layer-u-theme-*-feeds.png`, and `native-layer-u-theme-*-sources.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-layer-u-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS launched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; `button[data-applet-id="layeru-osint"]` opened Layer U OSINT in Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED VISUALS: every theme showed Layer U OSINT, OFFLINE status, posture standby, market placeholders, Map / Feeds / Sources tabs, Project SON service offline overlay, port `3117` instruction, visible clickable Retry connection button, Feeds empty state, Sources rollup, Refresh, Pull Live, and Reload Map.
- TUTORIAL STATUS: Layer U can be taught as the free OSINT shell bridge in offline SON state: the user sees worldview, feeds, and source posture tabs; the app explains that Project SON must be running on port `3117`; Retry/Refresh/Pull Live/Reload Map are visible controls.
- BOUNDARY: this proves native visual route, theme readability, tab coverage, and clickable offline retry. It does not prove Project SON live data, map iframe rendering, feed ingestion, source sweep, live pull, geolocation, or downstream My Mait/analysis handoff.

---

## 2026-06-09 07:19 SGT: S3 folder native theme sweep and tray repair

Project location: `C:\Users\MAG MSI\Project Everywear`

- FOUND: the native S3 Studio folder opened in every theme and contained the correct five child applets, but the tray was capped at `430px`, clipping DAW out of the first-open view. Carbon also let underlying Settings/Vault desktop labels bleed through the tray because the tray background mixed `--ew-surface-raised`, which is a gradient token in EWDS-v2 skins.
- PATCHED: `platform/everywear-os/src/styles/shell.css` now sizes the open folder tray to `min(532px, calc(100vw - 136px))`, preserves a max-content rail, and uses `--ew-surface-overlay` as the second background layer instead of invalid color-mixing a gradient token.
- BUILD VERIFICATION PASSED: `npm run build --workspace everywear-os`; `cargo build -p everywear-os` after stopping the locked QA instance. Warnings only after rerun.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-s3-folder-theme-*.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-s3-folder-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS relaunched from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon; S3 Studio folder opened in each theme.
- PASSED VISUALS: every theme now shows the S3 folder tray with Gener8 4ever, Gener8 Pro, Vid Studio Pro, AI Director, and DAW visible inside the tray on first open. DOM checks confirm `children=5`, child IDs `gener8-4ever,gener8-pro,vid,ai-director,daw`, center hit-tests true, child rects within the tray, no failed-load text, and no bug modal.
- TUTORIAL STATUS: the platform first-run tour can teach S3 Studio as a folder containing five Creator Studio tools without needing the user to horizontally scroll or guess that DAW exists offscreen.
- BOUNDARY: this proves shell folder visibility/readability and child launch target presence, not the child applets' generation/export paths. Those remain covered by the separate Gener8 4ever, Gener8 Pro, Vid, AI Director, and DAW slices.

---

## 2026-06-09 07:27 SGT: Profile native theme sweep

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCH STATUS: no code patch required. The initial lower-panel check was an automation mistake: `.ew-profile-panel` is the scroll container, not `.ew-window__body`.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-profile-theme-*.png`, `native-profile-theme-*-lower.png`, and `native-profile-theme-*-edit.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-profile-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon; taskbar profile button opened the Profile panel in each theme.
- PASSED VISUALS: every theme showed Profile, avatar initials, display name, alias, Identity section, Everywear ID, Display Name, Alias, Email, Bio, Edit Profile, Subscription, Tier, Status, Provider, Next Billing, Session, Sign Out, and no failed-load text or bug modal.
- PASSED EDIT STATE: every theme entered Edit Profile mode with four controls: display name input, alias input, read-only email input, bio textarea, plus Save and Cancel buttons.
- TUTORIAL STATUS: Profile can be taught as the account/identity first-run stop: confirm Everywear ID, explain immutable ID versus editable display profile, show subscription status, then leave Sign Out as the recovery/session control.
- BOUNDARY: this proves native Profile visibility, edit controls, scroll behavior, and theme readability for Sean's authenticated Creator Studio session. It does not prove fresh unauthenticated sign-in/signup, OTP, failed-auth states, profile save persistence, Supabase round trip, or sign-out recovery flow.

---

## 2026-06-09 07:34 SGT: Settings native theme sweep

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCH STATUS: no code patch required. The initial lower Settings check was an automation mistake: `.ew-settings` is the scroll container, not `.ew-window__body`.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-settings-theme-*.png` and `native-settings-theme-*-lower.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-settings-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings tile opened Settings; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- PASSED VISUALS: every theme showed Settings, Appearance, seven Theme choices, five Accent choices, EWDS-v2 density sample, Chrome/Wallpaper/Bevel sliders, Traffic Lights controls, Surface Treatment controls, About, Everywear OS v0.1.0, PT Metafintek AI Studios, Lombok, Indonesia, and the `everywear.id` link.
- PASSED SCROLL STATE: corrected lower captures scrolled `.ew-settings` by roughly 411-413px and confirmed Traffic Lights, Surface Treatment, and About are reachable without failed-load text or bug modal.
- TUTORIAL STATUS: Settings can be taught as the first-run personalization stop: choose visual theme, choose accent, tune chrome/wallpaper/bevel density, pick traffic-light side, choose widget surface treatment, and find product/about link.
- BOUNDARY: this proves native Settings visibility, scroll behavior, control presence, and theme readability. It does not prove persistence across app restart for every setting, external `everywear.id` link opening, or accessibility keyboard traversal.

---

## 2026-06-09 07:39 SGT: Bug report modal native theme sweep

Project location: `C:\Users\MAG MSI\Project Everywear`

- PATCH STATUS: no code patch required.
- ARTIFACTS: screenshots at `screenshots/2026-06-09-everywear-full-tour/native-bug-report-theme-*.png`; manifest `screenshots/2026-06-09-everywear-full-tour/native-bug-report-theme-sweep.json`.
- VERIFIED: native Tauri Everywear OS running from `target\debug\everywear-os.exe` with WebView CDP on `127.0.0.1:9223`; Settings UI selected Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon; taskbar bell opened the manual Report a Problem modal in each theme.
- PASSED VISUALS: every theme showed Report a Problem, close control, What went wrong textarea with QA text, Include in report, ten log categories, six default-checked categories, per-category entry counts, Estimated size, Send to, three send targets, Copy to Clipboard, and Send Report.
- VERIFIED TARGETS: send targets were Everywear Team via Email, Local Kasai for diagnostics, and Save to this computer only. No failed-load text appeared.
- TUTORIAL STATUS: the first-run platform tutorial can teach the bell as the recovery/reporting path: describe the problem, include relevant logs, choose team/Kasai/local target, copy report if needed, then send.
- BOUNDARY: this proves modal visibility, log-category controls, target choices, and action buttons across themes. It does not prove clipboard write, email client launch, local-file save, Kasai diagnostic handoff, backend `submit_bug_report`, or report persistence.
