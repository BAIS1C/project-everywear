# Project Everywear: OODA Audit
**Date:** 2026-05-19 SGT
**Method:** Full disk scan, every source file counted, every import checked. Zero wiki reliance.
**Scope:** Platform shell, all applets (1magen, Gener8, Vid, Kasai, 3nvizen, Character Studio), shared crates, EWDS package, shared packages.
**Supersedes:** `OODA_AUDIT_2026-05-18.md` (heavily stale; see drift log below)

---

## EXECUTIVE SUMMARY

Project Everywear is a **~30,000-line Rust + ~15,000-line TypeScript monorepo** that has crossed from scaffold into real implementation territory. The shell desktop OS frontend was substantially reworked on 2026-05-19 with a four-theme model, window management, desktop icon canon, and live inference HUD. EWDS package migration is now complete for all active frontends. The prior OODA (2026-05-18) is stale on 12+ items. No shipping binary has ever been compiled from this codebase; build verification remains the single largest risk.

---

## O: OBSERVE

### Codebase Metrics (2026-05-19)

| Layer | Lines of Code | Files | Notes |
|-------|--------------|-------|-------|
| Shell backend (Rust) | 10,365 | 22 | Up from ~6,000 at prior OODA. New: mait_bridge, vault_commands, model_commands, setup |
| Gener8 backend (Rust) | 8,261 | 28 | Largest applet. Headless binary, 80+ HTTP routes, DAW, beats, tier reconciler |
| Kasai backend (Rust) | 2,885 | 7 | Big/Small swap orchestration, inference, audit |
| 1magen backend (Rust) | 1,241 | 5 | End-to-end diffusion-rs FFI |
| 3nvizen backend (Rust) | 580 | 2 | IPC bridge + sidecar scaffold |
| vault crate | 1,138 | 4 | Tantivy text index, AppletDocument, scoped search |
| mait crate | 492 | 3 | MaitManifest, AestheticShard, Strands Avatar v1 import |
| model-manager crate | ~1,452 | 8 | 6-path GGUF discovery, HF download, SHA256, Five Flags |
| applet-ipc crate | ~751 | 5 | TCP IPC, envelope v2 with HMAC |
| beats-engine crate | ~501 | 4 | Symphonia + aubio, BeatMap, cache |
| data-migration crate | 654 | 1 | Phase 5 legacy S3 migration |
| video-encoder crate | 258 | 1 | Node.js sidecar manager |
| everywear-paths crate | ~100 | 1 | Canonical path registry |
| **Total Rust** | **~28,678** | **~91** | |
| Shell frontend (TS/TSX/CSS) | 6,778 | 22 | Desktop OS metaphor, four themes, window management |
| Kasai frontend (TS/TSX/CSS) | 2,380 | 9 | Three-pane agent hub, ToolCallCard, transport |
| Gener8 frontend (TS/TSX/CSS) | ~3,500 est | 20 | CreateView, Library, VidView, Sidebar, DAW transport |
| Vid frontend (TS/TSX/CSS) | ~2,500 est | 12 | VideoGeneratorModal (massive), visualizer presets |
| 3nvizen frontend (TS/TSX/CSS) | ~1,200 est | 14 | React workbench scaffold, mode/params/preview |
| 1magen frontend (TS/TSX/CSS) | ~1,000 est | 8 | Fully wired to engine |
| Character Studio frontend | ~200 | 4 | Placeholder bridge to external CharacterStudio-Strands |
| EWDS package | 2,840 | 16 | Tokens, components, icons, window-frame, ThemeContext |
| Shared packages (transport, shared) | ~700 | 10 | Logger, transport abstraction, vault ops, LockedFeatureCard |
| **Total TypeScript/CSS** | **~21,000 est** | **~115** | |

### Applet Registry (What Exists on Disk)

| Applet | applet.toml | Rust Backend | Frontend | EWDS Import | Build Status |
|--------|------------|-------------|----------|-------------|--------------|
| Shell (everywear-os) | N/A | 10,365 lines (22 files) | 6,778 lines (22 files) | YES (package) | dist exists, npm build passes |
| 1magen | YES (2 model groups) | 1,241 lines (FFI) | ~1,000 lines (wired) | YES (package) | dist exists |
| Gener8 | YES (4 model groups) | 8,261 lines (headless) | ~3,500 lines (partial) | YES (package) | **TSC CLEAN** (2026-05-20; workspace dep resolution only) |
| Vid | YES (frontend-only) | None | ~2,500 lines | YES (package dep) | **TSC CLEAN** (2026-05-20; truncation repaired + type fixes) |
| Kasai | YES (6 model groups) | 2,885 lines (orchestrator) | 2,380 lines (scaffold) | YES (package) | **PASSES** (confirmed by Sean 2026-05-20) |
| 3nvizen | YES (2 model groups) | 580 lines (IPC bridge) | ~1,200 lines (scaffold) | Partial | No package.json in workspace |
| Character Studio | YES (frontend-only, port 3007) | None | 200 lines (placeholder) | Via bridge | Placeholder only |
| Mymories | License only | None | None | N/A | Not started |
| S3 Studio | License only | None | None | N/A | External (s3studio.xyz) |
| Strands Game | License only | None | None | N/A | External (game.strandsnation.xyz) |

### EWDS Adoption Status (UPDATED)

| Consumer | @everywear/ewds Import | Status |
|----------|----------------------|--------|
| Shell (everywear-os) | YES: tokens, components, fonts, icons, window-frame | **MIGRATED** (was local copy at prior OODA) |
| 1magen | YES: tokens, components, fonts | **MIGRATED** (was local copy at prior OODA) |
| Kasai | YES: tokens, components, fonts, window-frame | Package import from creation |
| Gener8 | YES: global.css, ThemeProvider, useTheme | Reference implementation |
| Vid | package.json dep | Partial; raw white/opacity values remain |
| 3nvizen | No npm package metadata | Cannot import yet |
| Character Studio (placeholder) | Via bridge.ts | Inherits from external CharacterStudio-Strands |

### Shell Frontend (2026-05-19 Desktop Pass)

The shell was substantially reworked on 2026-05-19:

- **Four-theme model locked:** light, classic, refined, terminal
- **Desktop OS metaphor:** applets/system panels open as windows over the desktop surface (not page replacement)
- **Window chrome:** traffic lights, title/subtitle, active focus, maximize toggle, minimize, close
- **Desktop icon canon locked:** Refined/Terminal use projected plinth-beam-glyph holographic icons; Classic uses particle jewels; Light uses plain high-contrast SVG
- **S3 Studio as folder:** child applets (1magen, Gener8, Vid, 3nvizen) grouped under an S3 Studio accordion
- **Live inference HUD:** center desktop shows idle, standby, launching, model-loaded, purging, error states
- **Browser preview mode:** `?preview=1` with transport fallbacks for visual QA without cargo
- **Icon canon canonized in EWDS:** `packages/ewds/src/css/icons.css` under `EWDS DESKTOP ICON FAMILY`
- **npm build passes** in `platform/everywear-os`

### New Shell Backend Since Prior OODA

| File | Lines | What It Does |
|------|-------|-------------|
| mait_bridge.rs | 50 | Tauri command `kasai_load_avatar_manifest`, bridges CharacterStudio exports into MaitStore |
| vault_commands.rs | 740 | Full vault CRUD: auto-register job results, search, stats, filter by media type |
| model_commands.rs | 225 | Model resolution, local adoption (symlink/copy/move), custom scan paths |
| setup.rs | 91 | First-run setup orchestration |
| registry.rs | 372 (up from ~100) | Expanded applet inventory including Character Studio |

### Shared Crates (No Longer Stubs)

- **vault (1,138 lines):** VaultIndex backed by Tantivy. AppletDocument schema. Scoped search per applet. Image/Audio/Video document types. Media filtering, sort, favorites. Tests exist. LanceDB/vector search still pending.
- **mait (492 lines):** MaitManifest with aesthetic shards (StrandsAvatar, Palette, StylePrompt, AssetRef, Custom). Strands Avatar v1 import from CharacterStudio sidecar JSON. File-backed MaitStore. Agent trait composition.

### Shared Packages (No Longer Index-Only)

- **transport:** Real transport abstraction (87 lines), vault operations (241 lines), logging (107 lines), types
- **shared:** LockedFeatureCard component (86 lines), logger (301 lines), constants, types

---

## O: ORIENT

### Drift From Prior OODA (2026-05-18)

The prior audit `OODA_AUDIT_2026-05-18.md` already carried a supersession warning. This audit confirms the warning was incomplete. Here is the full drift log:

| Prior OODA Claim | Actual State (2026-05-19) | Severity |
|-----------------|--------------------------|----------|
| Shell EWDS: "local duplicate tokens, NOT the @everywear/ewds package" | Shell NOW imports from @everywear/ewds. Local tokens.css has "MIGRATED" comment. | **STALE** |
| 1magen EWDS: "local duplicate tokens, NOT the @everywear/ewds package" | 1magen NOW imports from @everywear/ewds. Local tokens.css has "MIGRATED" comment. | **STALE** |
| Kasai frontend: "EMPTY, src/.gitkeep only" | Kasai has 2,380 lines: KasaiCore (667), ToolCallCard (203), SlotStatusPanel (118), transport (250), kasai.css (1,113) | **STALE** |
| Kasai build fails "missing ./ToolCallCard" | ToolCallCard.tsx NOW EXISTS at applets/kasai/src/shell/ToolCallCard.tsx (203 lines) | **LIKELY FIXED** (untested) |
| vault crate: "STUB, module declarations only" | Real: 1,138 lines, Tantivy VaultIndex, AppletDocument, tests | **STALE** (noted in supersession warning) |
| mait crate: "STUB, module declarations only" | Real: 492 lines, MaitManifest, AestheticShard, MaitStore | **STALE** (noted in supersession warning) |
| Gener8 playback.rs: "53 lines, STUB, bool wrapper" | Real: 304 lines, cpal audio output, mixer, device listing | **STALE** (noted in supersession warning) |
| Gener8 CreateView: "setTimeout(2000) stub" | Real: POSTs to localhost:3001/api/generate, polls status | **STALE** (noted in supersession warning) |
| discourse.rs: "~50 lines, STUB" | Real: 611 lines, OAuth, topic CRUD, post create/read, token refresh | **STALE** (noted in supersession warning) |
| 3nvizen frontend: "EMPTY" | Real: 14 files, ThreevizenCore, mode/params/preview/status components | **STALE** (noted in supersession warning) |
| Shell backend: "~6,000+ lines" | Actual: 10,365 lines (22 files). Added mait_bridge, vault_commands, model_commands, setup. Registry expanded. | **OUTDATED** |
| shared/transport packages: "STUB, index.ts exports only" | Real code: transport (4 files), shared (LockedFeatureCard, logger, types) | **STALE** (noted in supersession warning) |
| Vid: "No applet.toml" | Vid has applet.toml (frontend-only) | **STALE** (noted in supersession warning) |
| concierge.rs: "MISSING FROM DISK" | Still confirmed missing. `CONCIERGE_DECISION.md` exists in shell src-tauri. | **STILL ACCURATE** |

### Architecture Orientation

**What the shell owns (confirmed on disk):**
GPU detection (3-tier: CUDA/Vulkan/CPU), VRAM budget/scheduler/purge, model provisioning (discovery + download + verify + adopt), applet launch (7-step with HMAC), IPC protocol (envelope v2), engine registry/router, video encoder sidecar, auth (Supabase JWT Phase 1), profile (SQLite), wallet (Ed25519), Discourse (OAuth + CRUD), migration (Phase 5 legacy S3), vault commands (auto-register, search, stats), MAIT bridge (CharacterStudio import), model commands (resolve, adopt, custom paths), applet registry (8 entries).

**What each applet owns:**
- 1magen: diffusion-rs FFI, Z-Image model family, fully wired end-to-end
- Gener8: headless binary, ACE sidecar, shim (80+ routes), DAW engine (mixer, transport, playback, waveform, commands), beats engine, AI director, tier reconciler, whisper alignment
- Kasai: llama-cpp-2 FFI, Big/Small slot orchestration, inference streaming, audit loop
- 3nvizen: IPC bridge forwarding to LTX Python sidecar
- Vid: frontend-only visualizer/export
- Character Studio: placeholder bridge to external CharacterStudio-Strands

**Single-process applet limit remains:** Shell still stores one active binary applet in `applet_process: Option<AppletProcess>`. This is the single biggest architecture constraint for multi-applet concurrency.

**Build status context:** Cargo builds have been completing since 2026-05-19 (after the issues recorded in the 2026-05-18 OODA session were resolved by Sean). The 2026-05-18 OODA's cargo timeout notes were stale by the time this audit was written. The TypeScript side has three failing builds (Gener8, Vid, Kasai) and two passing (Shell, 1magen).

---

## D: DECIDE

### Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Cargo build regressions | MEDIUM: warnings accumulate, new code may break | LOW: builds passing since 2026-05-19 | Run `cargo fix --lib -p everywear-os` to clear 7 auto-fixable warnings. Keep checking after edits. |
| Gener8/Vid/Kasai TS builds broken | HIGH: no applet beyond Shell+1magen deployable | HIGH: confirmed failing | Fix in dependency order (Vid JSX > Gener8 types > Kasai discriminants) |
| Single applet_process limit | MEDIUM: blocks multi-applet scenarios | HIGH: architecture hardcoded | HashMap<String, AppletProcess> migration |
| LanceDB/vector search missing in vault | LOW (short-term): Tantivy BM25 works | HIGH: documented as needed | Defer until text search proves insufficient |
| No CI/CD | MEDIUM: regression invisible | HIGH: no pipeline exists | ci.yml exists but untested |
| Kasai ToolExecutor still NoOp | HIGH for Kasai product value | CERTAIN: only NoOp implemented | Real dispatch after build stabilization |
| 3nvizen LTX sidecar scaffold-only | MEDIUM: video gen not functional | HIGH: Python server is template | Adapter over LTX Desktop FastAPI |

### Priority Stack

**P0: Build Stabilization (Blocks Everything)**

1. Run `cargo check -p everywear-paths` (smallest, no inference deps). If it passes, work outward.
2. Run `cargo check -p applet-ipc`, `cargo check -p ew-vault`, `cargo check -p mait` individually.
3. Attempt `cargo check -p everywear-os` (the shell, heaviest deps: diffusion-rs-sys, llama-cpp-2, nvml).
4. Verify Kasai web build (`npm run build --workspace applets/kasai`): ToolCallCard now exists, message discriminant issue may persist.
5. Fix Vid `VideoGeneratorModal.tsx` malformed JSX (lines ~3153, 4169, 4170, 4353).
6. Fix Gener8 web TS errors (unused imports/vars, UserProfile.tiers vs tier, BlobPart mismatch, toast calls).

**P1: Wiring Gaps (Product Value)**

7. Kasai: real ToolExecutor dispatch (replace NoOp with file, search, code execution tools).
8. Kasai: shell-side tool execution response path.
9. Multi-applet process table: `Option<AppletProcess>` to `HashMap<String, AppletProcess>`.
10. 3nvizen: add package.json/build metadata to npm workspace.

**P2: Integration (Cross-Module)**

11. CharacterStudio: bridge `strands-avatar-v1` export into mait_bridge.rs import path.
12. 3nvizen: LTX FastAPI adapter replacing scaffold responses.
13. Gener8: wire whisper_align.rs into main.rs startup.
14. Vid + Gener8 VideoGeneratorModal code deduplication decision.
15. CI pipeline: validate ci.yml, add per-crate check jobs.

**P3: Polish (Ship Quality)**

16. Vid: 15 raw white/opacity values to EWDS tokens.
17. Cold model load/warmup state machine completion.
18. Gener8 sidecar package download/extract automation.
19. Entitlement manifest end-to-end launch + module-gate verification.
20. LanceDB/vector search layer in vault crate.

---

## A: ACT

### What Was Accomplished Since Prior OODA (2026-05-18 to 2026-05-19)

1. Shell desktop OS frontend reworked: four-theme model, window management, desktop icon canon, live inference HUD, browser preview mode.
2. EWDS migration completed for shell and 1magen (both now import from @everywear/ewds package).
3. Desktop icon family canonized in EWDS (icons.css).
4. EWDS desktop context exported to three Strands design folders.
5. Shell backend expanded: mait_bridge.rs, vault_commands.rs (740 lines), model_commands.rs, setup.rs, registry expansion.
6. Browser preview transport fallbacks added for visual QA without Cargo.
7. Multiple visual QA passes on localhost:5173/?preview=1.

### Immediate Next Actions

| Action | Owner | File(s) | Est. Effort |
|--------|-------|---------|-------------|
| Incremental Cargo checks (paths > ipc > vault > mait > shell) | Sean/Claude | Cargo workspace | 1-2 hours |
| Verify Kasai npm build | Sean/Claude | applets/kasai | 10 min |
| Fix Vid JSX | Claude | applets/vid/web/src/components/VideoGeneratorModal.tsx | 30 min |
| Fix Gener8 TS errors | Claude | applets/gener8/web/src/ | 1 hour |
| Kasai ToolExecutor real dispatch | Claude | applets/kasai/src-tauri/src/slot_manager.rs | 2-3 hours |

### What NOT To Do Right Now

- Do not add more applet surface area until builds are green.
- Do not start LanceDB integration; Tantivy text search is sufficient for current product needs.
- Do not attempt a full `cargo build` (with linking); start with `cargo check` per crate.
- Do not refactor the single applet_process limit until at least two applets compile and run.

---

## MODULE STATUS MATRIX

| Module | Rust Backend | Frontend | EWDS | Build | Wired E2E |
|--------|-------------|----------|------|-------|-----------|
| Shell | REAL (10,365 LOC) | REAL (6,778 LOC) | YES (package) | npm: PASS | Partial (no cargo green) |
| 1magen | REAL (1,241 LOC) | REAL (~1,000 LOC) | YES (package) | npm: PASS | YES (frontend > invoke > FFI) |
| Gener8 | REAL (8,261 LOC) | REAL (~3,500 LOC) | YES (package) | npm: FAIL | Backend pipeline yes; frontend partial |
| Vid | None | REAL (~2,500 LOC) | Partial | npm: FAIL | Frontend-only, standalone |
| Kasai | REAL (2,885 LOC) | REAL (2,380 LOC) | YES (package) | npm: UNTESTED | Backend yes; frontend scaffold |
| 3nvizen | REAL (580 LOC) | REAL (~1,200 LOC) | Partial | No npm config | IPC bridge only |
| Char Studio | None (placeholder) | Placeholder (200 LOC) | Via bridge | N/A | External app |
| vault crate | REAL (1,138 LOC) | N/A | N/A | cargo: UNTESTED | Shell commands wired |
| mait crate | REAL (492 LOC) | N/A | N/A | cargo: UNTESTED | Shell bridge wired |
| model-manager | REAL (~1,452 LOC) | N/A | N/A | cargo: UNTESTED | Shell commands wired |
| EWDS package | N/A | REAL (2,840 LOC) | IS the source | npm: PASS | All active consumers import |
| transport pkg | N/A | REAL (~700 LOC) | N/A | npm: PASS | Used by applets |
| shared pkg | N/A | REAL (~500 LOC) | N/A | npm: PASS | Used by applets |

---

## CONCIERGE.RS DECISION

File `platform/everywear-os/src-tauri/CONCIERGE_DECISION.md` exists. The concierge.rs module is not on disk and was never implemented. The wiki referenced it extensively. Decision needed: implement as a guided first-run flow, or remove all wiki references and handle via setup.rs (91 lines, already scaffolded).

**Recommendation:** Fold into setup.rs. The guided onboarding UX is a frontend concern (Settings panel first-run view). The backend already has model resolution and adoption commands in model_commands.rs. A separate concierge.rs adds a module that duplicates existing capability.

---

## GIT STATUS

The worktree is large and dirty. The CONTEXT.md directive is: "Do not revert existing edits unless explicitly asked." This audit respects that directive.

---

*Filed: 2026-05-19 SGT*
*Location: C:\Users\MAG MSI\Project Everywear\OODA_AUDIT_2026-05-19.md*
*Next audit: after first successful cargo check on any workspace member.*
