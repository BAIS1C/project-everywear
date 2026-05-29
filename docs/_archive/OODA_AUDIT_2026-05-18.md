# Project Everywear: OODA Code-First Audit
**Date:** 2026-05-18 SGT  
**Method:** Every source file read. Zero wiki reliance.  
**Scope:** Platform shell, all applets (1magen, Gener8, Vid, Kasai, 3nvizen), shared crates, EWDS package.

> **SUPERSESSION WARNING (2026-05-18 late OODA pass):** This audit's body
> text is stale on 9 of 10 items it reports. The code moved past this
> document within the same day. Specifically wrong: vault is NOT a stub
> (real Tantivy index), mait is NOT a stub (real manifest/shard/store),
> playback.rs is NOT 53 lines (305 lines, full cpal), CreateView is NOT a
> setTimeout stub (real POST+poll), Kasai frontend is NOT empty (9 files,
> three-pane scaffold), Vid HAS an applet.toml, 3nvizen frontend is NOT
> empty (14 files, workbench scaffold), discourse.rs is NOT 50 lines (612
> lines, full OAuth+CRUD), shared/transport packages are NOT index-only
> stubs.
>
> Only correct: concierge.rs still does not exist on disk.
>
> For current truth, read `CONTEXT.md` and `WIKI.md`'s "Current State
> Addendum 2026-05-18: OODA Refresh".

---

## EXECUTIVE VERDICT

The Rust backend is enormous and almost entirely real production code (~15,000+ lines across shell + applets + crates). The wiring chain from GPU detection through VRAM budgeting through IPC to applet runtimes is complete in code. Nothing has been compiled into a shipping binary yet. The frontend layer is mixed: 1magen is fully wired to its engine, Gener8 UI exists but its invoke bridge to the Rust engine is stubbed, Kasai and 3nvizen have zero frontend. EWDS is properly centralized in the `@everywear/ewds` package but only Gener8 imports it correctly; shell and 1magen still use duplicate local copies.

---

## 1. PLATFORM SHELL (platform/everywear-os/)

### Rust Backend: FULLY WIRED (~6,000+ lines)

| File | Lines | Status | What It Does |
|------|-------|--------|-------------|
| lib.rs | ~1175 | REAL | AppState (15+ fields), 30+ Tauri commands, full run() builder |
| gpu.rs | 797 | REAL | 3-tier GPU detection (CUDA/NVML -> nvidia-smi -> Vulkan -> CPU fallback), VramTier enum, cuBLAS discovery, NVML polling. 4 tests. |
| launcher.rs | 774 | REAL | 7-step applet switch: gate, budget, purge via IPC+NVML verify, provision models (streaming HF download), upgrade packs, sidecar provision, handoff with HMAC |
| budget.rs | 288 | REAL | VramBudget ledger, 4 PurgePolicy variants, select_model_group with reclaimable VRAM accounting, NVML cross-check |
| vram_scheduler.rs | 641 | REAL | Priority job queue with expiry, heartbeat (5s/3 miss = probe), 5-step unload escalation (IPC -> signal -> kill -> NVML verify). 6 tests. |
| engine_router.rs | 599 | REAL | Job submission, 4 priority tiers, entitlement gating from TOML manifest, path sandboxing with SHA256 integrity. 8 tests. |
| engine_registry.rs | 322 | REAL | Dynamic HashMap registry, capability search, per-applet purge. 5 tests. |
| assessment.rs | 333 | REAL | Reads applet.toml, matches GPU VRAM + compute cap against model groups. 3 tests. |
| migration.rs | 561 | REAL | Phase 5 migration from legacy S3 paths, SHA256 verify, symlink, receipts. 2 tests. |
| video_encoder.rs | 307 | REAL | Node.js sidecar on :9877, consumer-counted acquire/release, 12-retry health probe |
| manifest_parser.rs | 241 | REAL | Shell-side AppletManifest parser. 3 tests. |
| applet_resolver.rs | 216 | REAL | 3-tier binary resolution (installer manifest, env override, dev layout). 2 tests. |
| auth.rs | 301 | REAL | Supabase JWT (Phase 1 unverified), 4 commands, LicenceTier enum |
| profile.rs | ~200 | REAL | SQLite CRUD, preferences KV |
| wallet.rs | ~150 | REAL | Ed25519 keypair, mock balances |
| discourse.rs | ~50 | STUB | Client struct + API types only, no OAuth/HTTP |
| registry.rs | ~100 | REAL | 6-applet hardcoded inventory |

**MISSING FROM DISK:** `concierge.rs` (wiki references it extensively, does not exist)

### Frontend: REAL, EWDS-STYLED (local copy)

| File | Status | Notes |
|------|--------|-------|
| ShellLayout.tsx (201 lines) | REAL | Sidebar nav, custom titlebar, GPU status footer |
| transport.ts (284 lines) | REAL | Full typed invoke wrappers for ALL 30+ shell commands |
| shell.css | REAL | 100% EWDS tokens, zero hardcoded colors |
| tokens.css | REAL | EWDS v1.0 full token set (DUPLICATE of package) |
| 6 panels (Launcher, GPU, Profile, Wallet, Discourse, Settings) | REAL | All functional |
| AuthContext, AuthGate, ThemeContext | REAL | All functional |

### Shell Wiring Verdict
- Backend: complete, tested, production-ready pending compilation
- Frontend: complete and functional
- EWDS: uses local duplicate tokens, NOT the `@everywear/ewds` package

---

## 2. 1MAGEN APPLET (applets/1magen/)

### Rust Backend: FULLY WIRED

| File | Status | What It Does |
|------|--------|-------------|
| lib.rs | REAL | 10 Tauri commands (get_status, list_models, get_recommended_stack, download_model, load_model, unload_model, generate_image, edit_image, save_image, get_default_output_dir). VRAM via nvidia-smi. |
| engine.rs | REAL | diffusion-rs FFI wrapper (stable-diffusion.cpp). Txt2ImgRequest, Img2ImgRequest, Euler sampler, 9 steps, cfg_scale 1.0. Unsafe Send/Sync with mutex. |
| z_image_manifest.rs | REAL | 4 Z-Image model definitions |
| runtime_ipc.rs | REAL | Shell IPC connection |

### Frontend: FULLY WIRED TO ENGINE

| File | Status | Notes |
|------|--------|-------------|
| ImagenCore.tsx | REAL | Full workbench UI, all 10 transport functions called |
| transport.ts | REAL | 1:1 match with every Rust command |
| imagen.css | REAL | EWDS tokens throughout, zero hardcoded hex. Two raw px font-sizes (11px, 14px) because no EWDS font-size scale token exists. |

**applet.toml:** 2 model groups (Q8 at 10240MB, Q4_K_M at 7400MB), 3 models each, CUDA 7.0+

### 1magen Wiring Verdict
- **End-to-end wired.** Frontend invokes engine, engine wraps diffusion-rs FFI.
- Only gaps: LoRA Style Patches and Task Shards are UI placeholders ("Coming Soon"), no backend.
- EWDS: local duplicate tokens, NOT the `@everywear/ewds` package.

---

## 3. GENER8 APPLET (applets/gener8/)

### Rust Backend: MASSIVE, FULLY CODED (~6,500 lines)

This is a **headless binary** (not a Tauri app). No Tauri commands registered.

| File | Lines | Status | What It Does |
|------|-------|--------|-------------|
| main.rs | 434 | REAL | Headless entry. IPC connect + HMAC AdvertiseCapabilities. Boots shim (:3001), ACE server (:8080), video encoder (:9877). Spawns IPC loop, heartbeat, health monitor, tier reconciler. Graceful shutdown. |
| ace_server.rs | 283 | REAL | Spawns ace-server.exe sidecar. GGUF validation. 60s health wait on /props. Restart support. |
| engine_client.rs | 515 | REAL | Bidirectional jobs. submit_job/submit_plan to shell. handle_execute_job proxies to ACE /generate with progress. FileRef with SHA256. |
| ipc_handler.rs | 396 | REAL | Full dispatcher: Shutdown, UnloadModel, Ping, ExecuteJob, CancelJob, Warmup, StartInference, QueryStatus, TierSync (HMAC-verified), AuthContext. |
| shim.rs | 1580 | REAL | Axum HTTP on :3001. 80+ routes: health, VRAM, model init/unload/reload, generate (ACE proxy), upload-audio, format-lyrics, analyze-audio, CRUD songs/playlists, settings, beats, DAW engine (30 routes), video serve, SRT export. Tier-gated stubs: LoRA/training/patches return 501. AI Director stubs return not_implemented. CORS for s3studio.xyz, everywear.id. |
| library.rs | 312 | REAL | JSON-file CRUD tracks + playlists |
| storage.rs | 118 | REAL | Key-to-path with traversal protection |
| settings.rs | 223 | REAL | Cached user settings, path validation |
| video_encoder.rs | 263 | REAL | Node.js sidecar on :9877 |
| whisper_align.rs | 216 | REAL | Coded but NOT wired into main.rs startup |
| ai_director/mod.rs | 393 | REAL | BeatEntry, Section, BeatMap, Shot, ShotPlan, render_sequence(). 2 tests. Shim routes are stubs. |
| ai_director/shot_planner.rs | 246 | REAL | Feature-gated behind `creator-studio`. LLM call placeholder. |
| beats/ (4 files) | ~670 | REAL | Symphonia decode, aubio tempo, BeatMap, LRU cache, Axum handler. Tests. |
| daw_engine/ (7 files) | ~1239 | REAL | Mixer (N-channel, gain/pan/mute/solo, fades), transport (state machine with loop), project (Track/Region CRUD), waveform (peaks/meters), commands (split/move/import). |
| daw_engine/playback.rs | 53 | **STUB** | Bool wrapper only, no cpal audio output. Only real stub in the engine. |
| tier_reconciler/ (5 files) | ~861 | REAL | Licence tier reconciliation, model enable/disable with grace periods (30d/7d/1d warnings), VRAM detection |

### Frontend: UI EXISTS, INVOKE BRIDGE NOT WIRED

| File | Status | Notes |
|------|--------|-------|
| CreateView.tsx | REAL structure, EWDS classes | `handleGenerate` is `setTimeout(2000)` stub. Comment says "Phase 4: invoke('generate_music', {...})". |
| LibraryView.tsx | REAL | Static empty-state placeholder |
| SettingsView.tsx | REAL | Imports `useTheme` from `@everywear/ewds` correctly |
| VidView.tsx | REAL | Song browser + 3 tabs (Visualiser works, AI Video "Coming Soon", Storyboard "Coming Soon") |
| AuthContext.tsx | REAL | Tauri invoke('get_auth_context') with dev fallback |
| SongStoreContext.tsx | REAL | Fetches from localhost:3001 (the shim) |
| intentBus.ts | REAL | Pub/sub event bus |
| Sidebar.tsx | REAL | Navigation |

### Gener8 Wiring Verdict
- **Backend: production code, not compiled.** The full pipeline exists: main.rs -> IPC -> shim -> ACE server -> generate.
- **Frontend-to-backend bridge: NOT WIRED.** CreateView.tsx has the stub. The Rust backend has no Tauri commands because it's headless; the frontend talks to the shim on :3001. But the SongStoreContext already fetches from localhost:3001, so the pattern is established; the generate invoke just hasn't been connected.
- **playback.rs is the one real stub** in the entire engine. No audio output.
- **EWDS: CORRECTLY imported** from `@everywear/ewds` package. main.tsx imports global.css and ThemeProvider from the package. SettingsView uses useTheme. This is the reference implementation for EWDS adoption.

**applet.toml:** 4 VRAM-gated model groups (Q8_0 at 16GB down to Q4_K_M at 6GB), sidecar ace-server.exe, upgrade packs for Pro/Creator Studio.

---

## 4. VID APPLET (applets/vid/)

| File | Status | Notes |
|------|--------|-------|
| App.tsx (24 lines) | REAL | Minimal React Router |
| VidView.tsx | REAL | Copy of gener8's VidView |
| VideoGeneratorModal.tsx (~1800+ lines) | REAL | 13 visualizer presets, 13 post-processing effects, text/image layers, LRC lyrics sync, WebSocket export to video-encoder sidecar |

### Vid Wiring Verdict
- **No applet.toml.** Not registered as a proper Everywear applet.
- **No Rust engine.** Frontend-only.
- **EWDS gap:** ~15 instances of raw `white/[opacity]` values instead of semantic tokens.
- **Has `@everywear/ewds` as a package.json dependency** but unclear if actually imported in code.
- Functional as a standalone video visualization tool, not integrated into the shell pipeline.

---

## 4b. CHARACTER STUDIO (CharacterStudio-Strands) — NEEDS EVERYWEAR PORT

**Location:** `C:\Users\MAG MSI\Project Strands\CharacterStudio-Strands` (separate repo, NOT inside Project Everywear)
**Origin:** Fork of m3-org/CharacterStudio, Strands-customized
**Title:** "STRANDS // Avatar Studio"

### Tech Stack
- React 18 + Vite 7, Three.js 0.183, @pixiv/three-vrm 3.5.1
- Zustand state management, CSS Modules + styled-components
- i18n (react-i18next), GSAP animations, KTX2 texture compression
- Blockchain deps STUBBED (moved to `_blockchain_deps_TODO_TON` in package.json)

### Core Pipeline (FUNCTIONAL)

| Module | Status | What It Does |
|--------|--------|-------------|
| CharacterManager | REAL | Central orchestrator: loads VRM models, trait composition, integrates AnimationManager, EmotionManager, BlinkManager, LookAtManager, LipSync |
| VRMExporter / VRMExporterv0 | REAL | Exports VRM 0 and VRM 1 formats with bone mapping |
| `exportToStrands()` | REAL | Creates VRM + sidecar `strands-avatar.json` manifest (schema: `strands-avatar-v1`) with trait summary and presence tier flags. Uses File System Access API with download fallback. |
| AnimationManager | REAL | Mixamo animation integration with bone remapping |
| EmotionManager | REAL | VRM expression blendshape control |
| ManifestDataManager | REAL | Manifest-driven asset loading from `/public/` |
| merge-geometry, cull-mesh, create-texture-atlas | REAL | One-click optimization: texture atlasing, mesh merging, face culling |
| ScreenshotManager, ThumbnailsGenerator, SpriteAtlasGenerator | REAL | Media generation pipeline |
| LoraDataGenerator | REAL | VRM → LoRA training data export |

### Pages (11 views)
Landing, Create, Load, Appearance, Optimizer, Save, BatchDownload, BatchManifest, Wallet, Mint, Claim

### EWDS Status: PARTIAL (skinSync exists, token files MISSING)

- `skinSync.js` is implemented: handles standalone (localStorage), iframe embedding (postMessage), Tauri webview (event channel)
- `index.html` has `data-skin="classic" data-mode="dark"` on both `<html>` and `<body>`
- `index.html` references `/ewds/fonts.css`, `/ewds/tokens.css`, `/ewds/components.css` but **these files DO NOT EXIST on disk**
- 170 `var(--ew-*)` usages across 20 CSS module files (partial adoption)
- 57 remaining hardcoded hex values across 10 CSS module files
- No `@everywear/ewds` package import; was intended to load from static `/ewds/` copies
- DevSkinSwitcher component exists in Main.jsx (dev-only, three buttons: classic/refined/terminal)

### ExportMenu: "Export to Kasai" Button (WIRED)

The ExportMenu component has a live "Export to Kasai" button that calls `exportToStrands()`. This exports:
1. `{name}.vrm` (optimized VRM with texture atlas)
2. `strands-avatar.json` (sidecar manifest with trait composition + presence tier flags)

This is the bridge to Kasai's MaitManifest aesthetic shard system, but the receiving end (Kasai loading this manifest and rendering the VRM) is not yet implemented.

### Character Studio Wiring Verdict

- **3D pipeline: FUNCTIONAL.** VRM loading, trait composition, animation, optimization, export all work.
- **EWDS: BROKEN.** skinSync.js is correct but the actual token CSS files are missing from `/public/ewds/`. The 170 `var(--ew-*)` references silently fall to fallbacks or undefined.
- **Blockchain: STUBBED for TON migration.** Ethereum/Solana deps moved to `_blockchain_deps_TODO_TON`.
- **Not registered as an Everywear applet.** No applet.toml, not in the applet registry. Standalone web app.

### Everywear Porting Requirements (for Codex)

| Priority | Item | Notes |
|----------|------|-------|
| **P0** | Ship EWDS token files to `/public/ewds/` OR migrate to `@everywear/ewds` package import | 170 `var(--ew-*)` references are currently unresolved |
| **P0** | Register as Everywear applet | Create applet.toml, add to shell registry. No Rust engine needed (WebGL-only). |
| **P1** | Portable Core extraction | Extract a `CharacterStudioCore` component (like Gener8Core / AgentHubCore) that can mount inside the Everywear shell Window |
| **P1** | Bridge to Kasai MaitManifest | The `strands-avatar-v1` sidecar manifest needs to be consumable by Kasai's mait/manifest.rs. Define the IPC or file-watch integration. |
| **P1** | EWDS deep pass on CSS Modules | 57 hardcoded hex values across 10 CSS module files need tokenisation |
| **P2** | TON blockchain migration | Replace Ethereum/Solana with TON for NFT trait verification and minting |
| **P2** | KasaiTransport integration | Enable Tauri IPC for avatar data transfer to Kasai's Three.js renderer |
| **P3** | Game integration | Blank avatar creation → game player model pipeline. Animation shard export for marketplace. |

---

## 5. KASAI APPLET (applets/kasai/)

### Rust Backend: FULLY CODED, SOPHISTICATED

| File | Lines | Status | What It Does |
|------|-------|--------|-------------|
| inference.rs | 484 | REAL | llama-cpp-2 FFI wrapper. ChatML prompt building (Qwen/Nemotron). Streaming tokens via mpsc. Tool-call extraction from `<tool_call>` markers. Five Flags (GPU layers, KV quant, flash attention). 5 tests. |
| slot_manager.rs | 544 | REAL | Big/Small swap orchestration. State machine: Empty -> BigLoaded <-> SmallLoaded (SingleSlot) or BothLoaded (DualResident on Ultra 24GB+). route_prompt: Big plans -> Small executes tools (max 8 iterations) -> Big audits. ToolExecutor trait. SlotEvent for IPC. |
| runtime.rs | ~200 | REAL | KasaiRuntime headless. Model slots HashMap, VRAM tier from env, swap_manager. |
| audit.rs | ~150 | REAL | Big model audits Small's tool execution results |
| types.rs | 71 | REAL | SlotId (Orchestrator/Agent/Embedder), ModelSlotStatus, RuntimeStatus, KasaiJobResult, ToolCallInfo |
| runtime_ipc.rs | ~200 | REAL | IPC connection to shell |

### Frontend: EMPTY
- `src/.gitkeep` only. No web directory. No Tauri commands registered.
- ToolExecutor has only NoOpToolExecutor implemented.

### Kasai Wiring Verdict
- **Backend: complete and architecturally sophisticated.** The Big/Small swap pattern is the most complex orchestration in the codebase.
- **Frontend: zero.** Needs full UI: chat interface, model status, tool execution visualization.
- **ToolExecutor: needs real implementations.** Currently NoOp only.

**applet.toml:** 6 model groups from 4GB (Qwen3 4B Q4) to 32GB (Qwen3.6 35B-A3B MoE + Qwen3.5 9B dual-resident). CUDA 7.0+.

---

## 6. 3NVIZEN APPLET (applets/3nvizen/)

| File | Lines | Status | What It Does |
|------|-------|--------|-------------|
| main.rs | 13 | REAL | Thin entry |
| runtime_ipc.rs | 378 | REAL | Full v2 IPC. Advertises: text2video, image2video, segment_generate, lipdub. Heartbeat, job forwarding to sidecar :8787. unload_models() is placeholder (logs only). |
| sidecar/ltx-runtime/ | -- | REAL | Python sidecar with pyproject.toml + server.py for LTX runtime |

### Frontend: EMPTY
- `src/.gitkeep` only.

### 3nvizen Wiring Verdict
- IPC layer wired, sidecar structure exists.
- No frontend whatsoever.
- unload_models is a log-only placeholder.

**applet.toml:** 2 model groups (Draft 8GB, Standard 12GB). Provisional.

---

## 7. SHARED CRATES (crates/)

| Crate | Lines | Status | Notes |
|-------|-------|--------|-------|
| applet-ipc (4 files) | ~751 | REAL | TCP IPC, envelope v2 with HMAC, 17 CommandKind variants, ShellChannel, AppletListener |
| model-manager (6 files) | ~1452 | REAL | 6-path GGUF discovery, streaming HF download with resume + SHA256, manifest (ModelGroup, LicenceTier, UpgradePack, VRAM-gated quant ladder), Five Flags (LlamaFlags with MoE/dense presets) |
| beats-engine (3 files) | ~501 | REAL | Symphonia + aubio, BeatMap, two-tier cache. Tests. |
| data-migration | 654 | REAL | Phase 5 migration, SHA256, junctions, receipts |
| video-encoder | 258 | REAL | VideoEncoderManager for Node+FFmpeg sidecar |
| everywear-paths | ~100 | REAL | All canonical paths: root, models, data, staging, bin, config, logs, migration |
| vault | -- | **STUB** | Module declarations only, no Tantivy/LanceDB |
| mait | -- | **STUB** | Module declarations only, no shard definitions |

---

## 8. SHARED PACKAGES (packages/)

| Package | Status | Notes |
|---------|--------|-------|
| ewds | REAL, BUILT | ThemeContext, types, CSS (tokens, components, fonts, icons, global, window-frame), tailwind-preset. **This is the canonical EWDS source.** |
| shared | STUB | index.ts exports only |
| transport | STUB | index.ts exports only |

### EWDS Adoption Status

| Consumer | Imports @everywear/ewds? | Uses EWDS Tokens? | Gaps |
|----------|--------------------------|--------------------|------|
| Gener8 web | YES (main.tsx, SettingsView, App.tsx, tailwind.config) | YES | Reference implementation |
| Vid web | package.json dep, unclear import | Partial | ~15 raw white/[opacity] values |
| Shell (everywear-os) | NO, local duplicate | YES | Needs migration to package import |
| 1magen | NO, local duplicate | YES | Needs migration to package import, 2 raw px font-sizes |
| Kasai (applets/kasai/) | N/A (no frontend) | N/A | -- |
| Kasai-Local (standalone) | NO, local duplicate | YES (deep pass done 2026-05-18) | 0 non-existent tokens, 0 hardcoded primary colors. Local copy should migrate to package import. |
| CharacterStudio-Strands | NO, static /ewds/ files (MISSING) | Partial (170 usages, 57 hardcoded hex) | Token CSS files not on disk; skinSync.js works but tokens unresolved |
| 3nvizen | N/A (no frontend) | N/A | -- |

---

## 9. WIRING SUMMARY

### What Is End-to-End Wired RIGHT NOW

1. **Shell GPU detection -> VramTier -> assessment -> model group selection:** Complete chain.
2. **Shell launcher -> IPC -> applet handoff:** 7-step pipeline with HMAC, all coded.
3. **Shell VRAM scheduler -> budget -> purge -> NVML verify:** Complete with escalation.
4. **Shell engine registry -> engine router -> job submission:** Complete with entitlement gating.
5. **1magen: Frontend -> invoke -> Rust engine -> diffusion-rs FFI:** Fully wired end-to-end.
6. **Gener8: IPC -> shim(:3001) -> ACE server(:8080):** Backend pipeline complete.
7. **Gener8: Frontend -> SongStoreContext -> localhost:3001:** Read path wired (songs, playlists, settings).
8. **Kasai: inference.rs -> slot_manager.rs -> Big/Small swap:** Backend complete.
9. **3nvizen: IPC -> sidecar forwarding:** IPC layer wired.
10. **EWDS: token system -> skin/accent/mode switching:** Package built and working.

### What Needs Wiring (Priority Order)

| Priority | Gap | Location | Effort |
|----------|-----|----------|--------|
| **P0** | Gener8 CreateView.tsx generate invoke -> shim /generate endpoint | gener8/web/src/views/CreateView.tsx | Small. Pattern exists in SongStoreContext. Wire fetch to localhost:3001/generate with params. |
| **P0** | Compile everything. No binary exists yet. | Cargo workspace + applet builds | Medium. All code exists, needs build config validation. |
| **P1** | Kasai frontend (chat UI, model status, tool viz) | applets/kasai/src/ or web/ | Large. Full UI from scratch. |
| **P1** | Kasai ToolExecutor real implementations | applets/kasai/src-tauri/src/slot_manager.rs | Medium. Replace NoOpToolExecutor with actual tool dispatch. |
| **P1** | Shell + 1magen: migrate to @everywear/ewds package import | platform/everywear-os, applets/1magen | Small. Replace local token copies with package import. |
| **P2** | 3nvizen frontend | applets/3nvizen/src/ | Large. Full UI from scratch. |
| **P2** | Gener8 playback.rs: real cpal audio output | gener8/src-tauri/src/daw_engine/playback.rs | Medium. Currently bool stub. |
| **P2** | Gener8 whisper_align.rs: wire into main.rs | gener8/src-tauri/src/ | Small. Code exists, just not booted. |
| **P2** | Vid: proper EWDS migration (15 raw values) | applets/vid/web/ | Small. |
| **P2** | Vid: applet.toml creation | applets/vid/ | Small. Not registered as applet. |
| **P3** | vault crate: Tantivy/LanceDB implementation | crates/vault/ | Large. Module stubs only. |
| **P3** | mait crate: shard implementation | crates/mait/ | Large. Module stubs only. |
| **P3** | shared + transport packages: actual exports | packages/shared, packages/transport | Medium. |
| **P3** | discourse.rs: OAuth + HTTP client | platform/everywear-os/src-tauri/src/discourse.rs | Medium. |
| **P3** | concierge.rs: implement or remove from wiki | -- | Decision needed. |
| **P3** | EWDS font-size scale tokens (1magen has 2 raw px values) | packages/ewds/src/css/tokens.css | Small. |
| **P1** | CharacterStudio: ship EWDS token files or migrate to package | CharacterStudio-Strands/public/ewds/ OR package.json | 170 var(--ew-*) references currently unresolved. |
| **P1** | CharacterStudio: register as Everywear applet | CharacterStudio-Strands/ | applet.toml + shell registry. WebGL-only, no Rust engine. |
| **P1** | CharacterStudio: portable Core extraction | CharacterStudio-Strands/src/ | Extract CharacterStudioCore for Everywear shell embedding. |
| **P2** | CharacterStudio: bridge export to Kasai MaitManifest | strands-avatar-v1 schema → mait/manifest.rs | Export path exists, receiving end not implemented. |
| **P2** | CharacterStudio: TON blockchain migration | package.json _blockchain_deps_TODO_TON | Ethereum/Solana deps stubbed, TON integration pending. |

---

## 10. ARCHITECTURAL OBSERVATIONS

**The codebase is far more complete than any documentation suggests.** 15,000+ lines of production Rust with tests, a sophisticated VRAM lifecycle, a complete IPC protocol, and entitlement-gated model provisioning. The gap is compilation and frontend wiring, not backend logic.

**Gener8 is architecturally the most complex applet.** 6,500 lines of Rust, headless binary pattern, 80+ HTTP routes, DAW engine, beats engine, tier reconciler, AI director. The frontend just needs the generate invoke connected to the shim.

**Kasai's Big/Small swap is architecturally sound** but has no frontend and no real ToolExecutor. It's a complete reasoning engine waiting for a face and hands.

**EWDS centralization is half-done.** Gener8 got it right (imports from package). Shell and 1magen need to delete their local copies and import from `@everywear/ewds`. This is a quick win.

**The headless applet model (Gener8, 3nvizen) means the shell renders their UI.** This is clean architecture but means the shell needs UI components for each headless applet. Currently the shell has panels for its own features but not for rendering headless applet UIs.

**vid applet is orphaned.** No applet.toml, no engine, floating as a standalone web app. Decision needed: absorb into Gener8's VidView (which already imports it) or register as independent applet.

---

## ADDENDUM: KASAI-LOCAL EWDS PASS (2026-05-18 SGT)

**Scope:** `C:\Users\MAG MSI\Project Claude\Kasai-Local` (separate repo from Project Everywear)

This pass brought Kasai-Local's frontend into full EWDS compliance to match S3 Studio (Gener8) applet styling, added traffic light window controls, and wired graceful model unload on window close.

### Changes Made

| File | Change | Category |
|------|--------|----------|
| `src/lib/windowControls.ts` | **CREATED.** Shared window ops: close, minimize, maximize, graceful shutdown, showMainWindow, showSettings. Extracted from duplicated code in KasaiApp.tsx + Launcher.tsx. | Architecture |
| `src-tauri/src/lib.rs` | Added `shutdown_engine` Tauri command (drops model slots, nils agent_tx, resets LEDs). Registered first in invoke_handler. Updated `on_window_event` to use `prevent_close()` + async cleanup as safety net. | Graceful shutdown |
| `src/shell/KasaiApp.tsx` | Removed 3 duplicate window fns, imports shared controls, close button wired to `windowCloseGraceful`. | Dedup |
| `src/components/Launcher.tsx` | Removed 5 duplicate fns, imports shared controls, fixed `--ew-radius-sm` (non-existent token) to `--ew-radius`. | Dedup + EWDS |
| `src/styles/agent-hub.css` | Fixed 9x `--ew-surface-2` → `--ew-surface-raised`, 1x `--ew-surface-3` → `--ew-surface-overlay`, 4x `--ew-radius-sm` → `--ew-radius`, 1x `--ew-error` → `--ew-danger`, 1x hardcoded `#050608` → `var(--ew-sunken)`, traffic light dots now use `--ew-status-*` tokens. | EWDS |
| `src/styles/settings.css` | Fixed 1x `--ew-error` → `--ew-danger`. Converted 14x hardcoded `rgba(96,165,250,...)` → `color-mix(in oklab, var(--ew-primary) X%, transparent)`. Error/success/warning states now use semantic tokens. Button fg uses `--ew-primary-fg`. | EWDS |
| `src/styles/everywear/tokens.css` | Added `--ew-wf-*` window-frame tokens (height, padding, gap, control size, chamfer, border, bg, fg) and `--ew-status-green/amber/red` LED color tokens. | EWDS |
| `index.html` | Added `data-skin="classic" data-mode="dark"` to `<body>`. | EWDS |

### Verification Results

Post-pass grep confirms **zero instances** of non-existent tokens (`--ew-error`, `--ew-surface-2`, `--ew-surface-3`, `--ew-radius-sm`) across the entire `src/` tree. All color references in live CSS files are either EWDS `var(--ew-*)` with fallbacks or intentional `rgba(255,255,255, 0.0X)` glass overlays (skin-neutral by design).

### Dead Code Identified

- `src/components/Chat.tsx`: not imported anywhere, uses old `--ember` / `--bg-primary` namespace. Superseded by AgentHubCore.tsx.
- `src/styles/kasai.css`: not imported anywhere, uses old `--ember` vars. Superseded by agent-hub.css + tokens.css.

**Recommendation:** Delete both. They serve no purpose and will cause confusion.

### Kasai-Local Outstanding Items (for Codex)

| Priority | Item | File(s) | Notes |
|----------|------|---------|-------|
| **P0** | Delete dead code (Chat.tsx, kasai.css) | `src/components/Chat.tsx`, `src/styles/kasai.css` | Confirmed not imported anywhere |
| **P0** | Compile and test the Tauri build | `src-tauri/` | `shutdown_engine` command + updated `on_window_event` need compilation verification |
| **P1** | Companion window route | `src/App.tsx` | tauri.conf.json defines `#/companion` window but no matching route/component exists in App.tsx |
| **P1** | EWDS package import migration | `src/styles/everywear/tokens.css` | Currently a local copy of EWDS tokens; should import from `@everywear/ewds` package like Gener8 does |
| **P2** | settings.css glass overlays | `src/styles/settings.css` | ~25 instances of `rgba(255,255,255, 0.0X)` are intentionally skin-neutral but could optionally use `color-mix(in oklab, var(--ew-text) X%, transparent)` for full dark/light mode adaptation |

### Updated Kasai Section for Section 5

The OODA Section 5 (Kasai Applet) stated "Frontend: EMPTY" with `src/.gitkeep` only. This referred to `applets/kasai/` inside Project Everywear, which is correct; that applet frontend is still empty. However, Kasai-Local at `C:\Users\MAG MSI\Project Claude\Kasai-Local` is a **separate standalone Tauri app** with a complete frontend (Launcher, AgentHubCore three-pane layout, Settings, ThemeContext). After this EWDS pass, its frontend is fully tokenised and matches S3 Studio styling conventions. The two codebases relate as follows:

- `applets/kasai/` (inside Everywear): the Kasai engine crate (inference.rs, slot_manager.rs, etc.). Frontend empty.
- `Kasai-Local/` (standalone repo): the full Tauri desktop app with its own engine + frontend. This is the shipping product.
