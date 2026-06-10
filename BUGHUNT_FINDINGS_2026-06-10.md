# Everywear Bughunt Findings - 2026-06-10

Location: `C:\Users\MAG MSI\Project Everywear`

## Phase 1 Proof Findings

| ID | Proof | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| P1-001 | Provisioning replay | No safe genuine download path was available without mutating local model caches. Gener8 4ever launched with compatible local ACE models and emitted zero provisioning events. Missing 1magen/3nvizen requirements lacked complete downloadable HF metadata, so they could not exercise `download_with_resume_and_progress`. | `screenshots/2026-06-10-proof-pass/p1-gener8-provisioning-25s.json`; native `resolve_all_models` output in session log. | Tier 3 | Decision/card needed before cache purge or seeded test requirement. |
| P2-001 | Engine-health smoke | Native proof initially failed because the running `target/debug/everywear-os.exe` was stale from 01:47, before lane-A. `cargo check` verified source but did not update the executable used by native QA. | No `engine-health` direct Tauri events or shared browser events until `cargo build -p everywear-os` and relaunch. | Tier 1 | Fixed operationally by rebuilding before proof; keep as QA discipline. |
| P2-002 | Engine-health smoke | Direct JS invoke `request_applet_switch('gener8-4ever')` returns `FrontendInline applet is missing frontend_port`, while the visible shell UI opens Gener8 4ever. | `screenshots/2026-06-10-proof-pass/p2-engine-health-smoke.json`. | Tier 2 | Carry into event/command contract audit; not a P2 blocker. |
| P3-001 | Vid export, sidecar down | WASM fallback is no longer a silent no-op, but it still does not complete: the visible alert reports a broken `HTMLImageElement` in `drawImage`, then `Nothing was saved`. | `screenshots/2026-06-10-proof-pass/p3-vid-sidecar-down-wasm-result.json`; `p3-vid-sidecar-down-wasm-result.png`. | Tier 1 | Open. Needs WASM render input sanitization or fallback image handling. |
| P3-002 | Vid export, sidecar up | NVENC encode path worked but post-encode save failed before the fix. The sidecar received 1440 frames and produced a 29.9MB MP4 in 5.5s, while the UI showed `Rendering failed: Failed to fetch. Nothing was saved.` Root cause: save path depended on legacy Gener8 shim API at 3001 while shell engine-health correctly reports `gener8-shim` down. | `screenshots/2026-06-10-proof-pass/p3-vid-sidecar-up-gpu-result.json`; `.codex-runlogs/video-encoder-manual.out.log`. | Tier 1 | Fixed by native `vault_register_video_from_encoder` path. |
| P3-003 | Vid export, shell sidecar start | Direct `request_video_encoder` returned `{ ok: true, value: 9877 }` during proof but did not leave a listener on 9877. The successful P3 postfix replay used the already-running manual encoder process. | `screenshots/2026-06-10-proof-pass/p3-video-encoder-start-attempt.json`; port checks in session log. | Tier 1 | Open. Separate shell-owned encoder lifecycle bug. |
| P3-004 | Vid export, postfix | GPU export and Vault registration now pass when an encoder is listening. Native Vid showed GPU CTA, rendered via NVENC, displayed `Video saved (14.9 MB) -> Videos/Strands Sound Studio`, wrote a 15,636,134 byte MP4 under `Documents/Everywear Vault/Videos`, and `vault_search(mediaFilter=videos)` indexed the 960x540 / 24fps item with SHA256 `0d6b17b16a57d01cdf22bf079c80578d8f80beee082efd4b9fc282fa164c31e1`. | `screenshots/2026-06-10-proof-pass/p3-vid-gpu-postfix-result.json`; `p3-vid-gpu-postfix-vault-search.json`; `p3-vid-gpu-postfix-result.png`. | Tier 1 | Fixed/verified for encoder-up save + Vault registration. |
| P4-001 | VRAM release | BinaryLocal kill cleanup passed x3 with My Mait / kasai. Each launch allocated the same two kasai rows (20,500MB primary + 5,400MB encoder); killing the exact `everywear-kasai.exe` child emitted `applet-webview-closed`, cleared `active_applet`, emptied budget allocations, and left no kasai process. | `screenshots/2026-06-10-proof-pass/p4-vram-baseline.json`; `p4-kasai-kill-1.json`; `p4-kasai-kill-cycles-2-3.json`. | Tier 1 | Passed. No reservation stacking reproduced. |

## Phase 2 H1 - Silent Failure Sweep

| ID | Class | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| H1-001 | Swallowed lifecycle failure | Shell applet close swallowed `closeAppletWebview` failures, leaving a possible dirty applet/process state with no visible feedback. | `platform/everywear-os/src/shell/ShellLayout.tsx:1108` from H1 grep. | Tier 1 | Fixed: catch now warns and shows an `Everywear · applet lifecycle` error toast. |
| H1-002 | Swallowed encoder release failure | Shared Vid modal ignored `release_video_encoder` failures on close. That can hide a stuck encoder lifecycle while GPU export looks idle. | `packages/video-modal/src/components/VideoGeneratorModal.tsx:363` from H1 grep. | Tier 2 | Fixed: catch now logs a targeted warning. |
| H1-003 | Tauri-unreliable alert | Stem Studio used `alert()` when an audio element failed to load. In the Tauri WebView this can disappear or block awkwardly, repeating the Vid no-op class. | `applets/gener8/web/src/components/studio/StemStudio.tsx:1237` from H1 grep. | Tier 2 | Fixed: uses existing inline `extractError` surface and error phase. |
| H1-004 | Tauri-unreliable alert/confirm | Legacy Gener8 profile, playlist, and song management still contain `alert()` / `confirm()` calls. These are user-facing but outside the current native shell proof path. | `EditProfileModal.tsx:118`; `UserProfile.tsx:150`; `PlaylistDetail.tsx:106`; `SongProfile.tsx:208,480`; `Gener8Core.tsx:821`. | Tier 2 | Open. Replace with app-native modal/toast confirmation surfaces in a focused legacy Gener8 UI cleanup. |
| H1-005 | Swallowed DAW mutations | DAW view paths swallow undo/redo/track volume/pan failures with `.catch(() => {})`, so transport failures can leave controls lying about state. | `applets/gener8/web/src/views/DawView.tsx:791,792,815,821`; `components/studio/DawPage.tsx:764,768`. | Tier 2 | Open. Needs DAW-local status/toast surface, avoid mixing with event-contract audit. |
| H1-006 | Best-effort local persistence/cleanup | Several empty catches are acceptable best-effort localStorage, clipboard, audio autoplay, FFmpeg temp cleanup, or channel-send cleanup, but many lack comments marking that intent. | H1 grep output: localStorage catches in 1magen/3nvizen/Gener8, clipboard copy in `ShareModal`, FFmpeg delete catches in `VideoGeneratorModal`, Rust channel `let _ = ...send`. | Tier 3 | Carded. Comment best-effort paths opportunistically when touched; no broad churn in this pass. |

## Phase 2 H2 - Event Contract Audit

Artifact: `screenshots/2026-06-10-proof-pass/h2-event-contract-postfix.json`

| Event | Emitters | Listeners | Verdict | Status |
| --- | --- | --- | --- | --- |
| `agent-event` | Mock transport emits in `applets/kasai/src/lib/transport.ts`. | `KasaiCore.tsx`. | Paired. | OK. Browser/mock transport only. |
| `applet-switch-progress` | Rust shell launcher/lib emits during applet lifecycle. | `LifecycleHud.tsx`, `ShellLayout.tsx`. | Paired. | OK. |
| `applet-webview-opened` / `applet-webview-closed` | Rust shell emits on applet webview/process state changes. | `ShellLayout.tsx`. | Paired. | OK. |
| `download-progress` | Rust model/download/provisioning paths emit shared progress. | Lifecycle HUD and applet consumers. | Paired. | OK. Mixed legacy/v2 payloads are documented compatibility debt, not an orphan. |
| `educ8-download-progress` | Educ8 emits legacy inline download progress. | Educ8 inline UI. | Paired. | OK. Mirrored onto shared `download-progress` separately. |
| `engine-health` | `engine_health.rs` emits one endpoint-health sweep. | `ShellLayout.tsx`. | Paired. | OK. |
| `kasai://slot-event` | Rust Kasai IPC bridge emits slot status. | `SlotStatusPanel.tsx`. | Paired. | OK. |
| `kasai://tool-call/update` / `kasai://tool-call/complete` | Rust Kasai command bridge emits tool-call lifecycle events. | `KasaiCore.tsx` and tool UI. | Paired. | OK. |
| `provision-manifest` | Rust launcher/provisioning paths emit provision plan metadata. | `LifecycleHud.tsx`. | Paired. | OK. |
| `kasai://reasoning-trace` | Rust Kasai IPC bridge emits reasoning traces. | `KasaiCore.tsx`. | Was orphan emitter. | Fixed: `KasaiCore.tsx` now normalizes the payload and renders it as assistant reasoning. |
| `everywear:applet-status` | No in-repo emitter found. | `ShellLayout.tsx` browser custom-event listener. | Orphan listener. | Open Tier 3. Likely external/browser self-report hook; needs origin decision before removal. |
| `everywear:launch-applet` | No in-repo emitter found. | `ShellLayout.tsx` browser custom-event listener. | Orphan listener. | Open Tier 3. Likely external/deep-link hook; needs origin decision before removal. |
| `s3:skin` | No in-repo emitter found. | `character-studio/src/lib/skinSync.js`. | Orphan listener. | Open Tier 3. Decide whether S3 donor skin sync is still live or stale. |
| `SIGTERM` | Process signal, not an app bus event. | Node sidecar process handlers. | Excluded. | OK. |
| DOM/browser events (`click`, `resize`, `keydown`, `message`, pointer/mouse/touch events, etc.) | Browser/runtime-owned. | App UI listeners. | Excluded. | OK. Not part of Tauri emit/listen contract. |

## Phase 2 H3 - Port/URL Literal Sweep

Artifact: `screenshots/2026-06-10-proof-pass/h3-port-url-literal-sweep.json`

| ID | Literal class | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| H3-001 | Legacy Gener8 shim 3001 | Multiple consumers still call or describe the phantom Gener8 shim directly, even though `engine_health.rs` now owns the `gener8-shim` expected-down row. This is the same surface that made P3 save fail before the native Vault path fix. | `platform/everywear-os/src/shell/ShellLayout.tsx:1084`; `applets/vid/web/src/context/SongStoreContext.tsx:15`; `applets/gener8/web/src/services/api.ts:54`; `DawTransportBar.tsx:17`; `BetterModelsBanner.tsx:48`. | Tier 1 | Logged. Do not migrate in H3. Next slice should replace consumer calls with shell/registry-owned routes or explicitly retire the shim contract. |
| H3-002 | Video encoder 9877 | Encoder health is centralized in `engine_health.rs`, but the new native save path still fetches `/download/{session_id}` from literal `127.0.0.1:9877`. Health and artifact-download ownership are now split. | `platform/everywear-os/src-tauri/src/vault_commands.rs:559`; `platform/everywear-os/src-tauri/src/video_encoder.rs:286`; sidecar docs in `platform/everywear-os/src-tauri/sidecar/video-encoder/src/index.ts`. | Tier 1 | Logged. Keep for H3; migrate to a single encoder endpoint helper/config with the shell-owned lifecycle fix. |
| H3-003 | LTX sidecar 8787 | 3nvizen standalone transport hardcodes `127.0.0.1:8787` while shell health owns `ltx-sidecar`. The applet already has comments explaining standalone adapter default, so this is compatibility debt rather than a fresh silent bug. | `applets/3nvizen/src/transport.ts:14`; Rust runtime fallback in `applets/3nvizen/src-tauri/src/runtime_ipc.rs`. | Tier 2 | Logged. Keep standalone fallback, but shell-mounted 3nvizen should continue preferring shell engine-health state. |
| H3-004 | Layer U SON 3117 | Layer U uses `127.0.0.1:3117` directly. This is a Project SON service boundary, not currently represented in `engine_health.rs`. | `platform/everywear-os/src/son/sonBridge.ts:3`. | Tier 2 | Logged. Decide whether SON becomes a formal engine-health endpoint or remains a Layer U owned service dependency. |
| H3-005 | Character Studio 8081 | Character Studio donor contract files still point at `localhost:8081`. This looks like legacy donor API wiring, not an Everywear-owned engine endpoint. | `applets/character-studio/src/services/contract.jsx:1`; `applets/character-studio/src/components/Contract.jsx:3`. | Tier 2 | Logged. Needs Character Studio donor cleanup, not H3 migration. |
| H3-006 | Allowed literals | Applet vite/dev configs, Tauri `devUrl`/CSP, applet IPC random-port wiring, frontend-port assembly, local auth hostname checks, and documentation/schema/marketing literals were excluded from the defect list. | Filtered artifact allowed bucket plus raw grep session. | Tier 3 | OK. Keep excluded unless they become runtime consumers. |

## Phase 2 H4 - Rust Lock Discipline Sweep

Artifact: `screenshots/2026-06-10-proof-pass/h4-lock-discipline-scan.json`

| ID | Class | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| H4-001 | Snapshot command lock stack | `platform_status` held many unrelated guards while building a JSON response, then awaited `engine_registry.lock()` while those guards were still live. | `platform/everywear-os/src-tauri/src/commands/platform.rs` pre-H4. | Tier 2 | Fixed: command now snapshots one mutex at a time before building JSON. |
| H4-002 | Registry command nested locks | `list_applets` and `get_applet` held the applet registry while waiting for tier and entitlement locks. | `platform/everywear-os/src-tauri/src/commands/registry.rs` pre-H4. | Tier 2 | Fixed: commands now snapshot tier/entitlements first, then take registry. |
| H4-003 | Launcher structural lock debt | `request_applet_switch` still holds `budget_lock` across purge/provision/launch-adjacent async work and mixes budget/model/process/active state in one long command. This is the real deadlock and latency risk. | `platform/everywear-os/src-tauri/src/lib.rs:278-477` scan/readback. | Tier 1 | Carded. Needs dedicated launcher refactor, not a drive-by patch. |
| H4-004 | Canonical order missing | The repo had no explicit lock-order standard for `gpu`, `registry`, `budget`, `model_mgr`, runtime process maps, and engine scheduler state. | WIKI before v1.1.73. | Tier 2 | Fixed: WIKI now documents the one-lock snapshot rule and fallback order. |

## Phase 2 H5 - Fresh Machine Manifest

Artifact: `screenshots/2026-06-10-proof-pass/h5-fresh-machine-manifest.json`

| ID | Class | Finding | Evidence | Installer action | Tier | Status |
| --- | --- | --- | --- | --- | --- | --- |
| H5-001 | Gitignored runtime artifact | Video encoder `dist/` exists locally but is ignored; release resource copy is missing. | Local `platform/everywear-os/src-tauri/sidecar/video-encoder/dist/index.js` exists; `platform/everywear-os/src-tauri/resources/sidecar/video-encoder/dist/index.js` missing. | Build `@s3/video-encoder` and copy `dist/` into Tauri resources before packaging. | Tier 1 | Blocker logged. Installer/resource workstream, not fixed in H5. |
| H5-002 | Missing portable runtime | `node.exe` is missing from Tauri resources. Debug can use PATH fallback; release cannot. | `platform/everywear-os/src-tauri/resources/node.exe` missing; `video_encoder.rs` requires bundled Node outside debug fallback. | Bundle a known Node runtime or replace encoder sidecar with a compiled binary. | Tier 1 | Blocker logged. |
| H5-003 | Host absolute ACE path | ACE-Step sidecar discovery still contains Sean-machine paths. | `applets/gener8/applet.toml`; `gener8_engine.rs`; `ace_server.rs` point at `C:\Users\MAG MSI\Project Ace\S3 STUDIO\acestep.cpp\build\Release`. | Provision ACE binaries and companions into `~/.everywear/bin/ace-server` or app resources. | Tier 1 | Blocker logged. |
| H5-004 | FFmpeg env dependency | FFmpeg discovery relies on PATH/standard install paths and one Sean-specific Scoop path. | `platform/everywear-os/src-tauri/src/video_encoder.rs:35-43`. | Bundle FFmpeg or first-run bootstrap it, then pass explicit `FFMPEG_PATH`. | Tier 2 | Logged. |
| H5-005 | CWD/dev checkout fallback | Some resolvers still use `current_dir`, repo-root walking, or dev candidates. | `video_encoder.rs`; `assessment.rs`; `3nvizen runtime_ipc.rs`. | Release should validate `current_exe/resources` and `~/.everywear` roots only, then fail visibly with repair guidance. | Tier 2 | Logged. |
| H5-006 | 3nvizen sidecar packaging | 3nvizen LTX runtime packaging remains undecided. | `applets/3nvizen/src-tauri/build.rs` contains sidecar packaging TODO; LTX config defaults to `~/.everywear`. | Decide Python runtime bundle vs managed bootstrap before beta machine install. | Tier 2 | Logged. |

First-run beta machine checklist:

- `platform/everywear-os/src-tauri/resources/node.exe` or Node-free encoder binary present.
- `resources/sidecar/video-encoder/dist/index.js` present in packaged app.
- FFmpeg available with expected encoder support or explicit bundled `FFMPEG_PATH`.
- `~/.everywear/bin/ace-server` contains `ace-server.exe` and companion DLL/exe files.
- ACE models resolve under `~/.everywear/models` without Sean's local caches.
- 3nvizen LTX sidecar install/bootstrap path decided and health check visible.
- No release path depends on `C:\Users\MAG MSI\...` absolute directories.
- No release path depends on running from `target\debug` or repo cwd.

## Phase 2 H6 - Entitlement Bypass Audit

Artifact: `screenshots/2026-06-10-proof-pass/h6-entitlement-bypass-audit.json`

| ID | Class | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| H6-001 | Owner/admin local effective-state bypass | `AuthContext.tsx` promotes admin/support or Sean-owned identities to local `creator_studio`, merges every `expandTierToFlags('creator_studio')` flag, and adds `admin_override: true` before `syncToShell`. | `isAdminOrOwnerAccount()` plus `applyAdminTestBypass()` in `platform/everywear-os/src/shell/AuthContext.tsx`. | Tier 3 by prompt | Read-only. Carded for pre-paid-release closure. |
| H6-002 | Scope of unlock | The bypass unlocks `gener8_base`, `gener8`, `gener8.audio`, `1magen`, `1magen.image`, `vid`, `vid_pro`, `3nvizen`, `3nvizen.video`, `gener8_pro`, `creator_studio`, `daw_pro`, `ai_director`, `ai_director.planner`, `creator_pro`, plus free/default `loom`, `loom.teacher_agent`, `character_studio`, and `mymaits_lite_runtime`. | `expandTierToFlags('creator_studio')`. | Tier 3 | Documented. |
| H6-003 | Consumer surface | Launcher badges and pre-launch gates consume `authUser.entitlements ?? authUser.tiers`, so the promoted flags affect visible lock state and applet launch permission. | `LauncherGrid.tsx` uses `resolveAppletStatus(...)`; `ShellLayout.tsx` uses `appletLaunchBlocked(applet, tier, authUser?.entitlements ?? authUser?.tiers)`. | Tier 3 | Documented. |
| H6-004 | Server guard remains owner-bound | No SQL RLS bypass found in this audit. `active_tier(p_user)` returns null for non-self users, `entitlement_flags(p_user)` only reads when `p_user = auth.uid()`, and `user_entitlements` has own-user select RLS. | `supabase/migrations/20260528140643_everywear_identity_entitlement_vault_contract.sql`; `20260530175000_correct_vid_tier_contract.sql`. | Tier 3 | Documented. |
| H6-005 | Browser preview bypass | Separate dev bypass exists for non-Tauri localhost/127/::1 with `?preview=1`, creating a `creator_studio` preview user. It is not native runtime behavior. | `isLocalPreviewBypass()` in `AuthContext.tsx`. | Tier 3 | Documented. Keep dev-only or env-gate before release. |

## Decision Cards

CARD: P1 cache mutation or seeded test model
CONTEXT: P1 cannot prove real provisioning replay while local compatible models satisfy the applet ladders and missing requirements lack download metadata. Forcing it requires moving/deleting model cache files or adding a small seeded downloadable test requirement.
RECOMMEND: Add a seeded downloadable test requirement for QA, because it proves the lifecycle contract without risking Sean's working model cache.
ALTERNATIVE: Approve a temporary move of exact model cache paths before P1, then restore them after the replay.
COST OF DELAY: Provisioning HUD and resume/failure behavior remain unproven for the beta gate.
REVERSAL: Easy if test requirement is QA-only and excluded from release manifests.
-> "ok" locks it; one-line redirect re-routes it

CARD: P3 shell-owned video encoder lifecycle
CONTEXT: Vid GPU export now saves and registers through the shell when an encoder is already listening on 9877, but direct `request_video_encoder` previously returned port 9877 without a live listener. That means the save path is fixed, while the shell-owned boot path is still not trustworthy.
RECOMMEND: Treat shell encoder boot as the next Tier 1 slice before calling P3 fully closed. Verify with manual encoder stopped: call `request_video_encoder`, assert 9877 listens, render Vid GPU, then call/rely on release and assert the lifecycle policy is honest.
ALTERNATIVE: Keep using manual encoder for local QA only, but label P3 as encoder-up save-path coverage rather than complete shell lifecycle coverage.
COST OF DELAY: First-run users can still hit GPU-unavailable fallback or dead-start behavior even though the encoder and Vault save code are now capable.
REVERSAL: Easy; lifecycle fix should be isolated to `video_encoder.rs` / command wiring, not the modal.
-> "ok" locks it; one-line redirect re-routes it

CARD: H4 launcher lock refactor
CONTEXT: `request_applet_switch` still spans applet gate checks, requirement planning, purge, download provisioning, sidecar provisioning, allocation recording, active-applet mutation, process launch, and cleanup while carrying the VRAM budget guard through async work. The small command snapshots are fixed; this one is architectural.
RECOMMEND: Split launcher into plan and commit phases. Build immutable launch/purge/provision plans without holding budget, perform IPC/download/process work with no global guards, then reacquire budget only to commit allocations or rollback.
ALTERNATIVE: Add tactical drops around the existing command, but that risks state drift between check and commit without a launch transaction.
COST OF DELAY: Rare deadlocks and long stalls remain possible during applet switching, especially around purge/download/launch failure paths.
REVERSAL: Medium. A plan/commit split is invasive but local to shell launcher ownership.
-> "ok" locks it; one-line redirect re-routes it

CARD: H6 close owner-QA local entitlement bypass before paid release
CONTEXT: The current owner/admin bypass is useful for QA because it proves paid surfaces without payment setup friction, but it lives in `AuthContext.tsx` as local effective-state promotion. It can mask paid-release regressions because launcher status and shell launch gates see `creator_studio` even if persisted entitlements, provider subscriptions, or checkout backfill are broken.
RECOMMEND: Replace the local promotion before paid release with one of two explicit mechanisms: persisted `admin_override`/`user_entitlements` rows seeded by service-role tooling, or a build-gated QA-only switch that cannot exist in production builds.
ALTERNATIVE: Keep the bypass only in dev/preview builds and add a paid-release smoke account with real provider entitlement rows for beta gating.
COST OF DELAY: Owner QA keeps proving the app surface while bypassing the monetization truth path, which is exactly how paid-release bugs hide in plain sight.
REVERSAL: Easy if done as an auth-state adapter removal plus seeded admin entitlement path; medium if launch gates have accumulated assumptions around `admin_override`.
-> "ok" locks it; one-line redirect re-routes it
