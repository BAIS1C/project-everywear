# PROJECT_STATE.md — Everywear / Gener8 Port

Single source of live state for surgical work. Read this first, every session. Last updated: 2026-05-30T15:43+08 SGT (Codex).

Canonical context remains `CONTEXT.md` (history) and the Mymory vault. This file is the WORKING STATE: what is true right now, what is broken, what is the next smallest move. Update it after every patch.

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
- SMOKE-PENDING: registered + mounted, runtime not yet verified this pass.

### Top-level applets (shell launcher — both registries + AppletViewRouter)

| Applet (id) | Routed via | Status | Note |
|---|---|---|---|
| 1magen | ImagenCore | SMOKE-PENDING | mounted; image gen |
| gener8-4ever | Gener8ShellApp `/` | WORKING | player fixed |
| gener8-pro | Gener8ShellApp `/` | SMOKE-PENDING | needs play test + ref/cover (BROKEN, below) |
| vid (Vid Studio) | Gener8ShellApp `/vid` → VidApp | WORKING | launcher opens; Gener8 handoff selects source song |
| ai-director | Gener8ShellApp `/director` → AIDirectorView | SMOKE-PENDING | shim returns fallback shot plans (known carry) |
| 1magen/3nvizen/character-studio/loom/kasai/layeru-osint | own indexes | mixed | see below |
| 3nvizen | @applets/3nvizen | NOTBUILT | binary/package gap (shows NotBuilt) |
| character-studio (Avatar Studio) | @applets/character-studio | SCAFFOLD | placeholder only |
| loom (The Loom) | @applets/loom | SMOKE-PENDING | manifest fixed this pass |
| kasai (My Mait) | KasaiCore | SMOKE-PENDING | |
| layeru-osint | LayerUOsintApplet | SMOKE-PENDING | |
| strands-game (Strands Nation) | NOT in AppletViewRouter | IFRAME/EXTERNAL | falls through to HeadlessAppletView (iframe); likely intended (strandsnation.xyz) — verify |
| s3studio | ExternalUrl | WORKING | opens s3studio.xyz |

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

### AUTH INTEGRITY — RELEASE BLOCKER (decision 2026-05-30, Sean)

Finding: the backend tier/entitlement gate is CLIENT-AUTHORITATIVE. `update_auth` (auth.rs:236-288) writes `AppState.licence_tier` and `entitlement_flags` from client-supplied `update.tier` / `update.entitlements`, and the JWT is parsed via `parse_jwt_unverified` (no signature check). `require_tier` (gener8_engine.rs:480-482) trusts those. So paid-tier enforcement is honor-system; anyone can push `tier: creator_studio` and unlock everything. Supabase IS the source of truth, but nothing currently verifies against it.

DECISION:
- DEV (Sean's machine, no users): client-trust gate is ACCEPTED. Proceed.
- PRE-PUSH (hard release blocker): reinforce Supabase enforcement before any public release.
  1. Verify the Supabase JWT signature in the Rust backend using asymmetric/JWKS public keys (NEVER ship the HS256 secret).
  2. Read tier/entitlements FROM the verified claims (put them in the token via a Supabase custom-access-token hook); ignore client-supplied update.tier/update.entitlements.
  3. Server-side validate any feature that costs us (cloud gen, API credits, gated weight downloads). Own-GPU local features may stay on the verified-local-token model.
- TIER NAMING: suspected mismatch. auth.rs:230 hard-rejects any tier not exactly demo/gener8/gener8_pro/creator_studio. Verify against live Supabase (profiles/plan table) what strings it actually issues; reconcile names (note: code tier `gener8` = product "Gener8 4ever"). Pending Supabase query.

Carries (do not lose): AI Director SAPI adapter unplumbed (fallback shot plans); 3nvizen binary; character-studio scaffold; VideoGeneratorModal 4,374-line hard-ceiling; shell.css / CreatePanel over soft target.

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
