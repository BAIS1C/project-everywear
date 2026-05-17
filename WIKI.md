# Everywear OS: Developer Wiki

Version: 1.0.0
Last updated: 2026-05-12
Maintainer: Sean Uddin / Somo Kasane

> This is the developer onboarding reference. For high-level vision and
> architectural rationale, see [ARCHITECTURE.md](./ARCHITECTURE.md).
> This document maps what is actually on disk, file by file.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Monorepo File Map](#2-monorepo-file-map)
3. [Platform Shell: Tauri Command Reference](#3-platform-shell-tauri-command-reference)
4. [1magen Applet: Tauri Command Reference](#4-1magen-applet-tauri-command-reference)
5. [IPC / Transport Layer](#5-ipc--transport-layer)
6. [VRAM Lifecycle and Purge Policy](#6-vram-lifecycle-and-purge-policy)
7. [Rust Crates API Reference](#7-rust-crates-api-reference)
8. [EWDS Design System Reference](#8-ewds-design-system-reference)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Database Schema](#10-database-schema)
11. [State Management Patterns](#11-state-management-patterns)
12. [Build, Run, Deploy](#12-build-run-deploy)
13. [Code Style and Contributing](#13-code-style-and-contributing)
14. [Implementation Status](#14-implementation-status)

---

## 1. Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | stable (edition 2021) | `rustup default stable` |
| Node.js | 18+ | npm workspaces used |
| CUDA Toolkit | 12.x | Required for GPU inference; cuBLAS must be discoverable |
| Tauri CLI | 2.x | `cargo install tauri-cli` or `npm install -g @tauri-apps/cli` |
| Visual Studio Build Tools | 2022 | Windows: C++ desktop workload for Rust linking |
| Ninja | latest | Required by diffusion-rs-sys cmake build. `winget install Ninja-build.Ninja` |

Optional: Vulkan SDK (AMD/Intel fallback), NVML headers (already bundled via nvml-wrapper crate).

**Important:** `CUDA_PATH` must be set in the environment for `cargo build`. On Windows it's typically set as a Machine env var by the CUDA installer (`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.x`), but new terminal sessions may not inherit it. Verify with `echo %CUDA_PATH%` before building.

**First build:** `diffusion-rs-sys` compiles `stable-diffusion.cpp` with CUDA kernels via cmake/ninja. First build takes 10-20 minutes. Subsequent builds are cached.

**Dist placeholders:** Tauri's `generate_context!()` macro checks that `frontendDist` exists at compile time. Before running `cargo build` without a prior `npm run build`, create placeholder dist dirs:
```bash
mkdir -p platform/everywear-os/dist && echo "<html></html>" > platform/everywear-os/dist/index.html
mkdir -p applets/1magen/dist && echo "<html></html>" > applets/1magen/dist/index.html
```

### Clone and Install

```bash
git clone <repo-url> "Project Everywear"
cd "Project Everywear"
npm install              # installs all workspace packages
```

### Run the Platform Shell (dev)

```bash
cd platform/everywear-os
npm run tauri dev
```

This starts Vite on port 5173 and launches the Tauri window (1400x900, custom titlebar, decorations off).

### Run the 1magen Applet (dev)

```bash
cd applets/1magen
npm run tauri dev
```

Vite on port 5173, Tauri window 1280x860 with native decorations.

### Build for Production

```bash
cd platform/everywear-os
npm run tauri build       # outputs to src-tauri/target/release/bundle/
```

Release profile: LTO enabled, symbols stripped, opt-level "z", single codegen unit, panic=abort.

---

## 2. Monorepo File Map

Every file in the repo (excluding node_modules, .git, target, dist) with its purpose.

### Root

| File | Purpose |
|------|---------|
| `Cargo.toml` | Rust workspace root. Members: model-manager, vault, mait, 1magen. Workspace-wide deps and release profile. |
| `package.json` | npm workspace root. Workspaces: packages/*, platform/everywear-os, all applets. Scripts: dev:shell, dev:1magen, build:ewds, lint, clean. |
| `.gitignore` | Standard Rust + Node ignores |
| `ARCHITECTURE.md` | Vision, design rationale, architectural overview |
| `WIKI.md` | This file. Developer onboarding reference. |

### platform/everywear-os/ (The Shell)

```
platform/everywear-os/
  index.html                    Vite entry HTML
  package.json                  everywear-os package (react, @tauri-apps/api)
  vite.config.ts                React plugin, port 5173, target esnext
  tsconfig.json                 ES2020, react-jsx, strict
  tsconfig.node.json            Node types for vite config
  src/
    main.tsx                    Entry: <ThemeProvider><ShellLayout /></ThemeProvider>
    shell/
      ShellLayout.tsx           Main frame: custom titlebar, sidebar, content router
      ThemeContext.tsx           Skin/mode/accent state provider (localStorage persisted)
    panels/
      LauncherGrid.tsx          Applet launcher grid (card per applet)
      GpuPanel.tsx              GPU monitoring (VRAM bars, temp, backend info)
      ProfilePanel.tsx          User identity (editable name, alias, email, bio)
      WalletPanel.tsx           Strands Chain wallet (generate, balance, txns)
      DiscoursePanel.tsx        Forum integration (OAuth, posts feed)
      SettingsPanel.tsx         Appearance settings (skin picker, mode toggle)
    lib/
      transport.ts              Typed IPC wrappers for all 21 Tauri commands
    styles/
      shell.css                 Shell-specific layout and component styles
      everywear/
        tokens.css              EWDS v1.0 design tokens (3 skins, dark/light)
  src-tauri/
    build.rs                    Standard tauri_build::build()
    Cargo.toml                  everywear-os crate (ed25519-dalek, rusqlite, nvml-wrapper)
    tauri.conf.json             id.everywear.os, 1400x900, decorations: false, CSP rules
    src/
      main.rs                   Calls everywear_os_lib::run()
      lib.rs                    App init, 21 Tauri commands registered, all state managers
      gpu.rs                    3-tier GPU detection (CUDA/Vulkan/CPU), NVML polling, VramTier
      profile.rs                SQLite-backed user profile + preferences
      wallet.rs                 Ed25519 keypair, Strands Chain testnet, mock balances
      discourse.rs              Discourse SSO client (stubs for OAuth + API)
      registry.rs               Hardcoded applet inventory (6 applets, 3 active)
      budget.rs                 VRAM budget tracker, PurgePolicy, model group selection
      launcher.rs               Applet launch pipeline: gate, purge, provision, handoff
      concierge.rs              [PLANNED] Kasai setup wizard: scripted state machine + Piper TTS
      audio.rs                  [PLANNED] Audio playback: pre-recorded .ogg + Piper dynamic TTS
      budget.rs                 [PLANNED] VRAM budget tracker + PurgePolicy
      manifest_parser.rs        applet.toml parser + model group selection (AppletManifest, ModelGroup, select_model_group)
      applet_resolver.rs        Three-tier applet binary resolution (installer manifest, env override, dev layout)
```

### applets/1magen/ (Image Generation)

```
applets/1magen/
  index.html                    Vite entry
  package.json                  onemagen package (react, tauri plugins)
  vite.config.ts                React plugin, port 5173, chrome105 target
  tsconfig.json                 ES2021, react-jsx, strict
  tsconfig.node.json            Node types
  src/
    main.tsx                    Entry: <ImagenApp />
    shell/
      ImagenApp.tsx             Wraps ImagenCore in ThemeProvider (standalone mode)
      ImagenCore.tsx            Main UI: prompt, resolution, generate/edit, gallery
      ThemeContext.tsx           Skin/accent provider (same pattern as shell)
    components/
      EditCanvas.tsx            Drag-and-drop image input (base64 FileReader)
      Gallery.tsx               Horizontal thumbnail strip with selection
      PromptInput.tsx           Textarea with Ctrl+Enter shortcut
      ResolutionPicker.tsx      3x2 grid: 1024x1024, 1024x768, 768x1024, 1280x720, 720x1280, 512x512
    lib/
      transport.ts              Typed IPC wrappers for all 8 Tauri commands
    styles/
      imagen.css                App-specific layout (Google Fonts imports, sidebar, canvas)
      everywear/
        tokens.css              EWDS v1.0 (duplicated from shell; to be replaced by @everywear/ewds)
  src-tauri/
    build.rs                    Standard tauri_build::build()
    Cargo.toml                  onemagen crate (diffusion-rs cuda, image, sha2)
    tauri.conf.json             xyz.metafintek.onemagen, 1280x860, decorations: true, HF CSP
    src/
      main.rs                   Calls onemagen_lib::run()
      lib.rs                    App init, 8 Tauri commands, AppState (engine + models)
      engine.rs                 diffusion-rs FFI wrapper (txt2img, img2img, load/unload)
      model_manager.rs          GGUF discovery, HF download with progress, SHA256 verify
```

### applets/ (Stubs)

| Directory | Contents | Status |
|-----------|----------|--------|
| `applets/3nvizen/` | `src/.gitkeep`, `src-tauri/src/.gitkeep` | Placeholder |
| `applets/kasai/` | `src/.gitkeep`, `src-tauri/src/.gitkeep` | Placeholder |
| `applets/mymories/` | `src/.gitkeep`, `src-tauri/src/.gitkeep` | Placeholder |
| `applets/strands-game/` | `src/.gitkeep` | Placeholder (web-only, no src-tauri) |
| `applets/s3studio/` | `engines/` with 7 .gitkeep subdirs | Placeholder engine slots |

### crates/ (Shared Rust)

```
crates/
  model-manager/
    Cargo.toml                  deps: serde, tokio, reqwest, sha2, dirs, futures-util
    src/
      lib.rs                    Re-exports ModelInfo, ModelManifest, ModelType
      manifest.rs               ModelInfo struct, ModelManifest, ModelType enum (6 variants)
      discovery.rs              STUB: GGUF location scanner
      download.rs               STUB: HF streaming download with progress
      verify.rs                 STUB: SHA256 file verification
  vault/
    Cargo.toml                  deps: serde, tokio, tantivy, chrono, uuid
    src/
      lib.rs                    Module declarations
      index.rs                  STUB: Tantivy + LanceDB index management
      search.rs                 STUB: Hybrid search with reciprocal rank fusion
  mait/
    Cargo.toml                  deps: serde, serde_json, uuid, tracing
    src/
      lib.rs                    Module declarations
      shard.rs                  STUB: Trait shard definitions
      agent.rs                  STUB: Agent identity composition
  everywear-paths/
    Cargo.toml                  deps: dirs
    src/
      lib.rs                    root(), models_dir(), data_dir(), staging_dir(), bin_dir(), config_dir(), logs_dir(), migration_dir(), ensure_dirs()
```

### packages/ (Shared TypeScript)

```
packages/
  ewds/
    package.json                @everywear/ewds v1.0.0
    src/
      index.ts                  Exports ThemeProvider, useTheme, Skin, Accent, Mode types
  shared/
    package.json                @everywear/shared v0.1.0
    src/
      index.ts                  Exports ModelInfo, ModelType, GpuInfo, ProgressEvent, DEFAULTS
  transport/
    package.json                @everywear/transport v0.1.0
    src/
      index.ts                  Exports createTransport, Transport, TransportConfig types
```

Note: all three packages are index stubs re-exporting types. The actual implementations live inline in each app's `lib/transport.ts` and `shell/ThemeContext.tsx`. Canonicalising into these packages is a pending task.

### engines/ (Native Binaries)

```
engines/
  sd-server/README.md          stable-diffusion.cpp build notes
  ace-server/README.md          ACE-Step build notes
  llama-server/README.md        llama.cpp build notes
```

README-only. Compiled binaries are gitignored and built separately.

---

## 3. Platform Shell: Tauri Command Reference

The shell registers 21 commands in `platform/everywear-os/src-tauri/src/lib.rs`. All commands receive `State<AppState>` and return `Result<T, String>`.

### GPU Commands (gpu.rs)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `get_gpu_status` | none | `SystemGpuState` | Full GPU state: all GPUs, VRAM, backend, tier |
| `poll_vram` | `gpu_index: u32` | `{ used_mb, free_mb }` | Live VRAM usage for a single GPU |
| `get_compute_backend` | none | `ComputeBackend` | Current backend (Cuda/Vulkan/Cpu) with details |
| `get_vram_tier` | none | `VramTier` | Classification: Ultra/Standard/Constrained/Minimal/CpuFallback |

#### Key Types (gpu.rs)

```rust
enum ComputeBackend {
    Cuda {
        device_name: String,
        vram_mb: u32,
        cuda: CudaStatus,           // driver, toolkit, cuBLAS path, compute cap
        needs_provisioning: bool,
    },
    Vulkan {
        device_name: String,
        vram_mb: u32,
        vulkan: VulkanStatus,       // api_version, device_name, vram_mb
    },
    Cpu {
        has_blas: bool,
        ram_mb: u64,
    },
}

enum VramTier {
    Ultra,          // 24GB+
    Standard,       // 16-23GB
    Constrained,    // 12-15GB
    Minimal,        // 8-11GB
    CpuFallback,    // <8GB or no GPU
}

struct SystemGpuState {
    gpus: Vec<GpuInfo>,             // per-GPU: name, VRAM total/used/free, util, temp
    nvml_available: bool,
    total_vram_mb: u64,
    total_free_mb: u64,
    primary_gpu: Option<String>,
    backend: ComputeBackend,
    vram_tier: VramTier,
}

struct GpuInfo {
    index: u32,
    name: String,
    vram_total_mb: u64,
    vram_used_mb: u64,
    vram_free_mb: u64,
    utilization_gpu: u32,           // percentage
    utilization_memory: u32,
    temperature_c: u32,
    driver_version: String,
    cuda_version: String,
    compute_capability: String,     // e.g. "8.6"
}
```

Detection priority: CUDA via NVML direct binding, then nvidia-smi CLI fallback, then Vulkan via vulkaninfo CLI, then CPU with OpenBLAS check.

cuBLAS discovery order: bundled app dir, CUDA_PATH env, system install paths (Windows: `C:\Program Files\NVIDIA*`, Linux: `/usr/local/cuda*`).

Minimum compute capability: SM 5.0 (Maxwell, GTX 750 Ti+). Flash attention requires SM 7.0+ (Volta).

### Profile Commands (profile.rs)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `get_profile` | none | `UserProfile` | Get or create default profile |
| `update_profile` | `update: ProfileUpdate` | `UserProfile` | Update display name, alias, email, bio |
| `set_preference` | `key: String, value: String` | `()` | Set a key-value preference |
| `get_preference` | `key: String` | `Option<String>` | Get a preference value |

#### Key Types (profile.rs)

```rust
struct UserProfile {
    id: String,                     // UUID v4
    display_name: String,
    alias: Option<String>,
    email: Option<String>,
    avatar_path: Option<String>,
    bio: Option<String>,
    created_at: String,             // ISO 8601
    updated_at: String,
    discourse_username: Option<String>,
    discourse_session_valid: bool,
    wallet_address: Option<String>,
    wallet_connected: bool,
}

struct ProfileUpdate {
    display_name: Option<String>,
    alias: Option<String>,
    email: Option<String>,
    avatar_path: Option<String>,
    bio: Option<String>,
}
```

Storage: SQLite at `{app_data_dir}/everywear/profile.db`. Auto-creates tables on first launch. Default profile: display_name "Everywear User", alias "user".

### Wallet Commands (wallet.rs)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `wallet_generate` | none | `WalletInfo` | Generate Ed25519 keypair |
| `wallet_info` | none | `Option<WalletInfo>` | Get wallet state (STUB: mock balances) |
| `wallet_transactions` | `limit: Option<usize>` | `Vec<Transaction>` | Transaction history (STUB: empty) |
| `wallet_disconnect` | none | `()` | Clear keypair from memory |

#### Key Types (wallet.rs)

```rust
struct WalletInfo {
    address: String,                // format: str1{first 40 hex of pubkey}
    public_key_hex: String,
    balance: WalletBalance,
    connected: bool,
    chain_id: String,               // "strands-testnet-1"
    network: String,                // "Strands Chain Testnet"
}

struct WalletBalance {
    strands: f64,                   // STUB: 1000.0
    founders_passes: u32,           // STUB: 1
    tokens: Vec<TokenBalance>,      // STUB: [500 BLANK]
}

struct Transaction {
    hash: String,
    from: String,
    to: String,
    amount: f64,
    token: String,
    timestamp: String,
    status: TxStatus,               // Pending | Confirmed | Failed
    block: Option<u64>,
}
```

Crypto: Ed25519 via `ed25519_dalek` crate. Keypair generated with `OsRng`. Address derived from first 40 hex characters of public key, prefixed with `str1`.

### Discourse Commands (discourse.rs)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `discourse_oauth_url` | none | `String` | SSO OAuth URL for forum.strandsnation.xyz |
| `discourse_user` | none | `Option<DiscourseUser>` | Current authenticated user (STUB) |
| `discourse_latest` | `limit: Option<usize>` | `Vec<DiscoursePost>` | Latest forum posts (STUB) |
| `discourse_disconnect` | none | `()` | Clear session |

Base URL: `https://forum.strandsnation.xyz`. OAuth and API calls are stubs returning empty/None.

### Registry Commands (registry.rs)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `list_applets` | none | `Vec<AppletEntry>` | Launchable applets only (excludes NotBuilt) |
| `get_applet` | `id: String` | `Option<AppletEntry>` | Single applet by ID |
| `launch_applet` | `id: String` | `()` | Launch an applet (placeholder) |

#### Key Types (registry.rs)

```rust
struct AppletEntry {
    id: String,
    name: String,
    description: String,
    version: String,
    icon: String,                   // string identifier (e.g. "1magen", "kasai")
    status: AppletStatus,           // Active | Locked | NotBuilt
    engine_type: String,            // "diffusion" | "audio" | "llm" | "none"
    min_vram_mb: u64,
    tags: Vec<String>,
    launch_url: Option<String>,     // web applets
    launch_binary: Option<String>,  // Tauri applets
}
```

Hardcoded inventory (6 applets):

| ID | Status | Engine | VRAM | Launch |
|----|--------|--------|------|--------|
| 1magen | Active | diffusion | 7400 MB | binary: "onemagen" |
| s3studio | Active | audio | 4096 MB | URL: s3studio.xyz |
| strands-game | Active | none | 0 MB | URL: game.strandsnation.xyz |
| kasai | NotBuilt | llm | 8192 MB | binary: "kasai" |
| 3nvizen | NotBuilt | diffusion | 12288 MB | binary: "envizen" |
| mymories | NotBuilt | llm | 4096 MB | binary: "mymories" |

### Platform Status Command

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `platform_status` | none | `serde_json::Value` | Combined status JSON (GPU + profile + wallet + registry) |

---

## 4. 1magen Applet: Tauri Command Reference

The 1magen applet registers 8 commands in `applets/1magen/src-tauri/src/lib.rs`.

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `get_status` | none | `serde_json::Value` | Engine loaded state, model name |
| `list_models` | none | `Vec<ModelInfo>` | All known models with download status |
| `download_model` | `model_key: String` | `()` | Download from HuggingFace with progress events |
| `load_model` | `model_key: String` | `()` | Load model into GPU via diffusion-rs FFI |
| `unload_model` | none | `()` | Release model from GPU |
| `generate_image` | `prompt, negative_prompt?, width?, height?, steps?, cfg_scale?, seed?` | `GenerationResult` | txt2img via diffusion-rs |
| `edit_image` | `image_path, prompt, strength?, steps?, seed?` | `GenerationResult` | img2img via diffusion-rs |
| `save_image` | `image_base64, path` | `String` | Decode base64 and write PNG to disk |

#### Key Types (engine.rs, model_manager.rs)

```rust
struct GenerationResult {
    image_base64: String,           // PNG encoded as base64
    seed: i64,
    elapsed_secs: f64,
}

struct Txt2ImgRequest {
    prompt: String,
    negative_prompt: String,
    width: u32,
    height: u32,
    steps: u32,
    cfg_scale: f32,
    seed: i64,
}

struct ModelInfo {
    key: String,                    // e.g. "z-image-turbo-q4km"
    name: String,
    filename: String,
    size_bytes: u64,
    sha256: Option<String>,
    hf_repo: String,                // e.g. "gguf-org/z-image-gguf"
    hf_file: String,
    path: Option<PathBuf>,          // set if downloaded
    downloaded: bool,
    model_type: ModelType,          // TextToImage | ImageEdit | Encoder | Vae
}
```

#### Built-in Model Manifest

| Key | Size | Type | HF Repo |
|-----|------|------|---------|
| z-image-turbo-q4km | 4.5 GB | TextToImage | gguf-org/z-image-gguf |
| z-image-turbo-q8 | 7.2 GB | TextToImage | gguf-org/z-image-gguf |
| qwen3-4b-encoder-q4 | 2.3 GB | Encoder | gguf-org/z-image-gguf |
| pig-flux-vae | 168 MB | Vae | gguf-org/z-image-gguf |

#### GGUF Discovery Paths (scanned before downloading)

1. `~/.lmstudio/models/`
2. `~/.ollama/models/blobs/`
3. `~/.cache/huggingface/hub/`
4. `~/Library/Application Support/nomic.ai/GPT4All/` (macOS)
5. `~/.local/share/nomic.ai/GPT4All/` (Linux)
6. `%LOCALAPPDATA%\nomic.ai\GPT4All\` (Windows)

#### Download Progress Events

During `download_model`, the backend emits Tauri events:

```
Event: "download-progress"
Payload: {
    model_key: String,
    downloaded: u64,
    total: u64,
    pct: u64,              // integer percentage (0-100)
}
```

Frontend can listen via `listen("download-progress", callback)` from `@tauri-apps/api/event`.

---

## 5. IPC / Transport Layer

### Frontend Transport (Tauri invoke wrappers)

Each app has its own `src/lib/transport.ts` that wraps `invoke()` from `@tauri-apps/api/core`. These are direct, typed wrappers with no abstraction layer.

**Shell transport** (`platform/everywear-os/src/lib/transport.ts`): 19 exported functions covering all 21 Tauri commands (some grouped). Exports 17 TypeScript types mirroring the Rust structs.

**1magen transport** (`applets/1magen/src/lib/transport.ts`): 8 exported functions. Exports types: `ModelInfo`, `EngineStatus`, `GenerationResult`.

### Shell-to-Applet Command Channel (`crates/applet-ipc`)

The `applet-ipc` crate provides a bidirectional command channel between the Everywear OS shell and running binary applets. Used for VRAM lifecycle management (unload before purge) and graceful shutdown.

**Transport**: TCP on `127.0.0.1` with OS-assigned port. No named pipes or Unix sockets; TCP works identically on Windows, Linux, and macOS with zero conditional compilation. Localhost-only; no network exposure.

**Protocol**: Newline-delimited JSON. Each message is a `Command` (shell to applet) or `Response` (applet to shell). Strictly sequential: one command, one response. No multiplexing needed for the current command set.

**Commands**:

| Command | Purpose | Expected behaviour |
|---------|---------|-------------------|
| `unload_model` | Release all models from GPU | Applet frees VRAM, responds `ok` |
| `shutdown` | Graceful exit | Applet unloads, flushes state, responds `ok`, exits |
| `ping` | Health check | Applet responds `ok` with status string |

**Flow**:
1. Shell calls `ShellChannel::bind()` to get a listener on a random port
2. Shell sets `EVERYWEAR_CMD_PORT=<port>` on the child process env
3. Shell spawns the applet binary
4. Shell calls `channel.accept(timeout)` (10s) to wait for connection
5. Applet reads `EVERYWEAR_CMD_PORT`, connects back via `AppletListener::connect_from_env()`
6. Applet spawns a background task running `listener.run(handler)` to process commands
7. Shell uses `channel.unload_model(timeout)` / `channel.shutdown(timeout)` as needed

**Applet side**: In `tauri::Builder::setup()`, the applet spawns an async task that calls `AppletListener::connect_from_env()`. If the env var is absent (standalone mode), no IPC is established. The handler closure receives each `Command` and dispatches to the engine (e.g. `engine.unload()` for `UnloadModel`).

### Planned: @everywear/transport

The `packages/transport/` package will abstract the difference between:

- **Tauri mode**: uses `invoke()` directly (desktop applets)
- **WebSocket mode**: connects to engine server over HTTP/WS (web applets like S3 Studio)

```typescript
// Future usage:
import { createTransport } from '@everywear/transport';

const t = createTransport({ mode: 'tauri' }); // or 'websocket'
const result = await t.call('generate_image', { prompt, width, height });
```

Currently a stub; each app's inline transport.ts is the source of truth.

### Known Transport Mismatches (1magen)

The following discrepancies exist between `applets/1magen/src/lib/transport.ts` and the actual Rust commands. These need resolving:

| TS Function | TS sends | Rust expects | Issue |
|-------------|----------|--------------|-------|
| `loadModel()` | `modelPath` param name | `model_key` param name | Param name mismatch |
| `editImage()` | `image_base64` (base64 string) | `image_path` (file path) | Type/semantics mismatch |
| `getStatus()` return | `sd_server_running: boolean` | `engine_loaded` field | Field name mismatch |

### Command Name Mapping (Rust to TypeScript)

The Tauri convention: Rust function `get_gpu_status` is invoked as `"get_gpu_status"` from JS. No transformation. The TypeScript wrappers use camelCase function names that call snake_case command strings:

```typescript
// transport.ts pattern:
export async function getGpuStatus(): Promise<SystemGpuState> {
    return invoke<SystemGpuState>('get_gpu_status');
}
```

---

## 6. VRAM Lifecycle and Purge Policy

This section defines how the shell manages GPU memory across applet switches. This is the core coordination logic that makes Everywear OS more than a launcher.

### Design Principle

The shell is the single authority over GPU state, model cache, and VRAM budget. Applets never detect GPUs, download models, or manage VRAM directly. They declare what they need via `applet.toml`; the shell provisions it. The applet receives model paths and backend info, loads its own inference engine (diffusion-rs, llama-cpp-2, etc.), and runs inference. On close, the shell reclaims everything.

### Kasai Concierge Subsystem (Bundled in Shell)

The shell bundles a setup wizard (the Kasai concierge) that guides users through onboarding, applet selection, model downloads, and platform usage. This is NOT a separate applet; it's a first-class subsystem of the shell binary.

**The concierge does NOT use an LLM.** It is a scripted state machine with pre-recorded voice lines and Piper TTS for dynamic templated speech. Zero GPU memory cost.

#### Why No LLM

The setup wizard follows a fixed, deterministic flow: detect GPU, explain results, pick a skin, download models, run first generation. None of these steps require reasoning or freeform Q&A. Pre-recorded audio is instant, testable, translatable, and works on every machine including CpuFallback. An LLM would add ~1GB+ VRAM overhead, require a model download before the wizard can even start (chicken-and-egg problem), and introduce latency and non-determinism for zero benefit in a scripted tutorial.

#### Why Bundled

The concierge must be available from first launch, before any applet models are downloaded, before the user understands VRAM tiers, before anything else works. It's the warm body in the room. Making it a separate applet would mean the user's first experience is a cold launcher grid with no guidance.

#### Voice Stack

| Component | Technology | Disk Size | VRAM | Role |
|-----------|-----------|-----------|------|------|
| Pre-recorded lines | .ogg audio files | ~5-10 MB | 0 | Fixed tutorial narration |
| Dynamic TTS | Piper (piper-rs, CPU-only) | ~20 MB | 0 | Templated lines with user-specific data |
| **Total** | | **~25-30 MB disk** | **0 VRAM** | |

Pre-recorded lines cover the fixed tutorial flow (~30-40 lines): greetings, transitions, explanations, celebrations. Generated at build time using Piper with a consistent voice.

Piper TTS handles dynamic lines that reference the user's specific state:
- "I see you have a {gpu_name} with {vram_gb} gigabytes of VRAM"
- "That puts you in the {tier_name} tier, which means {tier_explanation}"
- "Downloading {model_name} now, about {size_mb} megabytes"
- "{applet_name} is ready, let's try your first generation"

Template strings live in a localisable resource file. Piper renders them at runtime on CPU. This gives the wizard a natural, personalised feel without any inference cost.

#### Concierge Scope: Setup Wizard, Not Permanent Companion

The concierge is an onboarding assistant, not a persistent sidebar. It appears during initial setup to walk the user through their first experience, then disappears. The user gets the full Kasai AI assistant only when they install the Kasai Local applet (separate, full LLM, RAG-capable).

This means:
- Concierge loads ONCE: on first launch (or until setup is complete)
- After setup: concierge models are unloaded and the VRAM is fully free
- No ongoing VRAM cost, no cloud fallback complexity, no evict-reload dance
- The concierge panel hides from the sidebar after setup
- User can re-trigger setup wizard from Settings if needed

#### VRAM Budget Impact

**Zero.** The concierge uses no GPU memory. Pre-recorded audio plays from disk. Piper TTS runs on CPU. The full VRAM budget is available for applet model downloads even during setup.

This means the setup wizard works identically on every tier, including CpuFallback. No eviction logic, no cloud fallback, no degraded mode. The wizard is always fully functional.

The full Kasai AI experience (persistent assistant, RAG, deep reasoning) requires installing the Kasai Local applet, which goes through normal VRAM gating like any other applet.

#### Concierge Lifecycle

```
FIRST LAUNCH (setup wizard)
============================
1. GPU detection runs (gpu.rs)
2. VramTier determined
3. Shell checks: is setup complete? (flag in preferences DB)
4. If not complete: enter setup mode
5. Initialize Piper TTS (CPU, always available)
6. Concierge panel appears in sidebar
7. Kasai greets user (pre-recorded), walks through:
   a. GPU detection results (Piper TTS: "You have a {gpu} with {vram}GB")
   b. VramTier explanation (pre-recorded per tier)
   c. Skin selection (pre-recorded prompts)
   d. First applet selection (pre-recorded)
   e. Model download (Piper TTS: "{model} downloading, {size}MB")
   f. First generation/inference (pre-recorded celebration)
8. Setup complete: Kasai says goodbye (pre-recorded)
9. Set setup_complete = true in preferences
10. Concierge panel hides from sidebar
11. No GPU cleanup needed (nothing was loaded)

RE-TRIGGER (from Settings)
===========================
1. User clicks "Re-run Setup Wizard" in Settings panel
2. If an applet is running: confirm purge (user must agree)
3. Run setup flow again (no model loading needed)
4. Hides on completion

KASAI LOCAL (separate applet, future)
======================================
1. User installs Kasai Local applet from launcher
2. Goes through normal VRAM gating (needs ~8GB+ for full LLM)
3. Full AI assistant: persistent, RAG-capable, long-context
4. This is NOT the concierge; this is the power-user AI agent
```

#### Shell Modules (concierge.rs)

```rust
/// The concierge is a scripted state machine, not an LLM.
/// It plays pre-recorded audio for fixed lines and uses Piper TTS
/// for dynamic templated lines that reference user-specific state.
pub struct ConciergeEngine {
    tts: PiperEngine,                       // piper-rs, CPU-only, always available
    audio_assets: AudioAssetMap,            // pre-recorded .ogg files keyed by step ID
    step_scripts: Vec<SetupStep>,           // ordered tutorial steps
    current_step: usize,
    state: ConciergeState,
    personality: mait::AgentIdentity,       // trait shards for Kasai persona (text display)
}

pub enum ConciergeState {
    Idle,                                   // not active
    Running,                                // setup wizard in progress
    Complete,                               // setup finished
}

/// A single step in the setup wizard flow.
pub struct SetupStep {
    pub id: String,                         // "welcome", "gpu_result", "skin_select", etc.
    pub audio: AudioSource,                 // pre-recorded or dynamic TTS
    pub display_text: String,               // subtitle/caption shown in UI
    pub action: Option<SetupAction>,        // shell action to perform after user confirms
    pub wait_for: WaitCondition,            // what triggers advancing to next step
}

pub enum AudioSource {
    PreRecorded(String),                    // asset key in AudioAssetMap
    DynamicTts(String),                     // template string: "You have a {gpu_name}..."
}

pub enum SetupAction {
    DetectGpu,
    SelectSkin(String),
    StartModelDownload(String),
    LaunchApplet(String),
    SetPreference(String, String),
}

pub enum WaitCondition {
    UserClick,                              // user clicks "Next" / "Continue"
    UserSelect(String),                     // user picks from options (skin, applet)
    DownloadComplete(String),               // model download finishes
    Timer(Duration),                        // auto-advance after delay
}

pub struct PiperEngine {
    // piper-rs bindings (CPU only)
    voice_model_path: PathBuf,
    sample_rate: u32,                       // 22050
}

/// Map of step IDs to pre-recorded audio file paths.
pub type AudioAssetMap = HashMap<String, PathBuf>;

impl ConciergeEngine {
    pub fn new() -> Self;                   // no GPU state needed
    pub fn load_assets(&mut self, assets_dir: &Path) -> Result<()>;
    pub fn start_setup(&mut self);
    pub fn current_step(&self) -> Option<&SetupStep>;
    pub fn advance(&mut self) -> Option<&SetupStep>;
    pub fn is_complete(&self) -> bool;

    // Audio
    pub fn play_current(&self) -> Result<AudioOutput>;
    pub fn speak_template(&self, template: &str, vars: &HashMap<String, String>)
        -> Result<Vec<u8>>;                 // Piper TTS for dynamic lines
}

/// Variables injected into dynamic TTS templates.
/// Built from live shell state at each step.
pub struct TemplateVars {
    pub gpu_name: String,
    pub vram_gb: String,
    pub tier_name: String,
    pub tier_explanation: String,
    pub model_name: String,
    pub model_size_mb: String,
    pub applet_name: String,
}
```

#### New Shell Tauri Commands (Concierge)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `concierge_start` | none | `SetupStep` | Begin setup wizard, return first step |
| `concierge_advance` | none | `Option<SetupStep>` | Move to next step, None if complete |
| `concierge_status` | none | `ConciergeStatus` | Current state, step index |
| `concierge_play_audio` | `step_id: String` | `Vec<u8>` | Get audio bytes for a step |
| `concierge_set_voice` | `voice_id: String` | `()` | Switch Piper voice model |

```rust
pub struct ConciergeStatus {
    pub state: ConciergeState,          // Idle | Running | Complete
    pub current_step_index: usize,
    pub total_steps: usize,
    pub tts_available: bool,
    pub tts_voice: String,
}
```

#### Concierge Assets

The concierge ships with pre-recorded audio and a Piper voice model, bundled in the shell binary or downloaded on first launch (~25-30MB total):

```
~/.everywear/concierge/
  voices/
    en_US-amy-low.onnx          # Piper voice model (~20MB)
    en_US-amy-low.onnx.json     # Piper voice config
  audio/
    welcome.ogg                 # "Welcome to Everywear..."
    gpu_detecting.ogg           # "Let me check your hardware..."
    gpu_found_great.ogg         # "Great news!"
    gpu_found_ok.ogg            # "Good news..."
    gpu_not_found.ogg           # "No dedicated GPU detected..."
    tier_ultra.ogg              # "You're in the Ultra tier..."
    tier_standard.ogg           # etc.
    tier_constrained.ogg
    tier_minimal.ogg
    tier_cpu.ogg
    skin_select.ogg             # "Let's pick a look for your desktop..."
    download_starting.ogg       # "Now let's get your first model..."
    download_complete.ogg       # "All downloaded!"
    first_gen_prompt.ogg        # "Time for your first creation..."
    first_gen_celebrate.ogg     # "Look at that!"
    setup_complete.ogg          # "You're all set..."
    goodbye.ogg                 # "I'll be here if you need me..."
  scripts/
    setup_flow.toml             # step definitions, ordering, templates
    templates.toml              # dynamic TTS template strings (localisable)
```

```toml
# scripts/templates.toml (localisable)

[en]
gpu_result = "I see you have a {gpu_name} with {vram_gb} gigabytes of VRAM."
tier_explain = "That puts you in the {tier_name} tier, which means {tier_detail}."
download_progress = "Downloading {model_name}, about {size_mb} megabytes."
applet_ready = "{applet_name} is ready. Let's try your first generation."

[id]
gpu_result = "Saya melihat kamu punya {gpu_name} dengan {vram_gb} gigabyte VRAM."
# ... Bahasa Indonesia translations
```

#### Personality (mait Integration)

Even without an LLM, the concierge has personality. The mait trait shards define the tone of the pre-recorded lines and the text captions displayed in the UI:

```
Tone shards:     friendly, warm, patient, occasionally witty
Domain shards:   everywear-platform, gpu-hardware, ai-models, onboarding
```

Pre-recorded audio is voiced with this personality baked in. The voice actor (or Piper at build time) delivers lines in character. Display text in the UI uses the mait personality for subtitle formatting.

The concierge always knows the user's hardware situation through template variable injection: Piper TTS speaks the dynamic lines with real GPU names, VRAM numbers, and tier explanations.

#### Dependencies (New)

| Crate | Version | Purpose |
|-------|---------|---------|
| piper-rs | latest | Piper TTS bindings (CPU-only) |
| rodio | latest | Audio playback for .ogg files |

Two dependencies instead of three. No llama-cpp-2, no whisper-rs. The concierge adds minimal binary size and zero GPU complexity to the shell.

### Applet Manifest Schema (applet.toml) -- Extended

```toml
[applet]
id = "1magen"
name = "1magen"
version = "0.1.0"
description = "Local AI image generation and editing"
icon = "icons/1magen.png"
transport = "tauri"               # "tauri" | "web" | "hybrid"

[engine]
type = "diffusion"                # "diffusion" | "llm" | "audio" | "custom"
backend = "ffi"                   # "ffi" (in-process) | "server" (sidecar)
server_binary = ""                # only if backend = "server"

# Model groups: ordered by preference (first viable group wins)
# Shell walks groups top-down, picks the first where ALL required
# models fit within the VRAM budget.

[[model_groups]]
label = "High Quality"
min_vram_mb = 10240

  [[model_groups.models]]
  key = "z-image-turbo-q8"
  role = "primary"
  required = true
  vram_mb = 7200

  [[model_groups.models]]
  key = "qwen3-4b-encoder-q4"
  role = "encoder"
  required = true
  vram_mb = 2400

  [[model_groups.models]]
  key = "pig-flux-vae"
  role = "vae"
  required = true
  vram_mb = 200

[[model_groups]]
label = "Standard"
min_vram_mb = 7400

  [[model_groups.models]]
  key = "z-image-turbo-q4km"
  role = "primary"
  required = true
  vram_mb = 4800

  [[model_groups.models]]
  key = "qwen3-4b-encoder-q4"
  role = "encoder"
  required = true
  vram_mb = 2400

  [[model_groups.models]]
  key = "pig-flux-vae"
  role = "vae"
  required = true
  vram_mb = 200

[requirements]
cuda_compute = "7.0"
```

The `model_groups` array replaces the flat `[[models]]` list from the original ARCHITECTURE.md spec. Each group is a complete, self-contained model set. The shell selects the best group that fits the current VRAM budget. This is how an 8GB card gracefully falls back to Q4 quantization while a 24GB card gets Q8.

#### Download Metadata Fields (Extended)

`ModelRequirement` entries can optionally carry download metadata so the shell can provision models directly from applet.toml without a separate Rust-side manifest builder:

```toml
[[model_groups.models]]
key = "acestep-dit-q8"
role = "Primary"
required = true
vram_mb = 8192
filename = "acestep-v15-xl-base-Q8_0.gguf"          # local filename on disk
hf_repo = "Serveurperso/ACE-Step-1.5-GGUF"          # HuggingFace repo
hf_file = "acestep-v15-xl-sftturbo50-Q8_0.gguf"     # remote filename on HF
size_bytes = 5_310_000_000                            # expected file size
```

All four fields are optional. When present, the shell's `manifest_info_from_groups()` converts them into `ModelInfo` entries and adds them to the `ModelManager` before the provision step. When absent, the model is assumed to already be in the manager's manifest (e.g. shared models registered by another applet or a per-applet Rust manifest builder).

#### ACE-Step Model Tiers (LOCKED)

Gener8 ships two DiT model families, gated by licence tier:

**xl-turbo** (base install, all tiers): 8-step fast generation. Covers text2music natively. Cover/reference available but quality-limited due to turbo distillation. Filenames: `acestep-v15-xl-turbo-{Q}.gguf` (no rename needed, same name on HF and disk).

| Quant | VRAM floor | Size | HF + local filename |
|---|---|---|---|
| Q4_K_M | 6 GB | ~2.5 GB | `acestep-v15-xl-turbo-Q4_K_M.gguf` |
| Q5_K_M | 8 GB | ~3.3 GB | `acestep-v15-xl-turbo-Q5_K_M.gguf` |
| Q6_K | 12 GB | ~3.9 GB | `acestep-v15-xl-turbo-Q6_K.gguf` |
| Q8_0 | 16 GB | ~5.0 GB | `acestep-v15-xl-turbo-Q8_0.gguf` |

**xl-base / sftturbo50** (Pro upgrade pack, Gener8 Pro and Creator Studio): Full-quality 50-step model (50/50 SFT+Turbo distillation). Enables proper cover/reference/extract/lego/complete quality. Downloaded via the `better_models` upgrade pack when user upgrades to Pro. **Mandatory rename on download**: HF hosts as `sftturbo50`, saved as `xl-base` on disk so ace-server's `model-registry.h::registry_classify_gguf` recognises it.

| Quant | VRAM floor | Size | HF filename | Local filename |
|---|---|---|---|---|
| Q4_K_M | 6 GB | ~2.99 GB | `acestep-v15-xl-sftturbo50-Q4_K_M.gguf` | `acestep-v15-xl-base-Q4_K_M.gguf` |
| Q5_K_M | 8 GB | ~3.53 GB | `acestep-v15-xl-sftturbo50-Q5_K_M.gguf` | `acestep-v15-xl-base-Q5_K_M.gguf` |
| Q6_K | 12 GB | ~4.10 GB | `acestep-v15-xl-sftturbo50-Q6_K.gguf` | `acestep-v15-xl-base-Q6_K.gguf` |
| Q8_0 | 16 GB | ~5.31 GB | `acestep-v15-xl-sftturbo50-Q8_0.gguf` | `acestep-v15-xl-base-Q8_0.gguf` |

**Shared models** (all tiers, no rename): LM (`acestep-5Hz-lm-0.6B-Q8_0.gguf`, 710 MB), VAE (`vae-BF16.gguf`, 337 MB), Text Encoder (`Qwen3-Embedding-0.6B-Q8_0.gguf`, 784 MB).

The `applet.toml` model_groups declare only the base install (xl-turbo + shared). Pro/Creator upgrade models are handled by the tier_reconciler's upgrade pack system, not the shell's VRAM pipeline. This convention is established in `Project Ace/S3 STUDIO/s-gener8/src-tauri/src/model_downloader.rs` and the canonical model manifest at `s-gener8/s3-gener8/models/manifest.json`.

### PurgePolicy (Tier-Based Eviction Strategy)

`VramTier` is not just a UI label. It selects the eviction strategy:

```rust
pub enum PurgePolicy {
    /// 8-11GB: One applet at a time. Full purge on every switch.
    /// No background model retention. User warned before switch.
    Exclusive,

    /// 12-15GB: Purge primary model on switch. Keep sub-1GB
    /// auxiliary models (VAE, small encoders) if budget allows.
    PurgePrimary,

    /// 16-23GB: Keep one applet's models warm if total fits.
    /// LRU eviction when budget exceeded.
    WarmSwitch,

    /// 24GB+: Full LRU. Keep everything loaded until budget
    /// forces eviction. Background models deprioritised.
    Lru,
}

impl PurgePolicy {
    pub fn from_tier(tier: VramTier) -> Self {
        match tier {
            VramTier::Minimal      => PurgePolicy::Exclusive,
            VramTier::Constrained  => PurgePolicy::PurgePrimary,
            VramTier::Standard     => PurgePolicy::WarmSwitch,
            VramTier::Ultra        => PurgePolicy::Lru,
            VramTier::CpuFallback  => PurgePolicy::Exclusive,
        }
    }
}
```

### Applet Switch: Deterministic Purge Cycle

When a user clicks a new applet in the launcher, the shell executes this sequence:

```
APPLET SWITCH SEQUENCE
======================

1. GATE CHECK
   - Read incoming applet's applet.toml
   - Walk model_groups top-down
   - For each group: does min_vram_mb fit total GPU VRAM?
   - If no group fits even total VRAM: reject launch, show
     "This applet requires {X} MB VRAM. Your GPU has {Y} MB."
   - Select first viable group as the target model set.

2. BUDGET CHECK (against FREE VRAM)
   - Query NVML for current free VRAM (not total; other
     processes may be using GPU memory)
   - If target model set fits in free VRAM AND policy allows
     warm coexistence (WarmSwitch or Lru): skip to step 5.
   - Otherwise: proceed to purge.

3. USER CONFIRMATION (all tiers when purge is required)
   - Shell emits event: "applet-switch-confirm"
   - UI shows: "Switching to {applet} will unload {current
     model}. This may take a few seconds. Continue?"
   - Wait for user confirmation. If declined: abort switch.
   - Applies to ALL tiers, not just Exclusive/PurgePrimary.
     Even on Ultra tier, if LRU eviction is triggered, user confirms.
     No silent model unloads, ever.

4. PURGE CYCLE
   a. Shell sends unload command to current applet via applet-ipc:
      - Binary applets: `ShellChannel::unload_model(30s timeout)`
        over the TCP command channel (see Section 5)
      - Server applets: POST /unload to sidecar, then kill process
      - If IPC fails or times out: log warning, proceed anyway
   b. Wait for command to return (model released from GPU)
   c. NVML verification loop:
      - Poll gpu::poll_vram() 3 times at 500ms intervals (1.5s total)
      - Check: is reported free VRAM >= expected reclaim amount?
      - If 3rd poll still shows high VRAM: log warning, proceed regardless
        (driver lag is common; the memory IS freed, NVML just hasn't caught up)
      - Final verification: if next engine OOMs on load, purge truly failed
   d. Update VRAM budget tracker: mark previous allocation as freed
   e. PurgePrimary policy: only purge models with role "primary".
      Keep role "encoder", "vae" if their combined VRAM < 1GB.
      Exclusive policy: purge ALL models regardless of role.

5. PROVISION
   a. Check model registry: are all models in target group
      downloaded to ~/.everywear/models/?
   b. For each missing model:
      - Emit "download-required" event to UI
      - Show download progress panel
      - Stream download from HuggingFace with progress events
      - SHA256 verify on completion
      - On hash mismatch: delete file, retry once, fail if
        second attempt also mismatches
   c. All models verified and on disk.

6. HANDOFF
   a. Shell constructs ModelPaths struct:
      { primary: PathBuf, encoder: Option<PathBuf>,
        vae: Option<PathBuf>, lora: Vec<PathBuf> }
   b. Shell updates VRAM budget tracker: reserve target
      group's total vram_mb
   c. Shell resolves binary path via `resolve_binary_path()`:
      search order: applets/<id>/src-tauri/target/release/<bin>,
      applets/<id>/<bin>, sibling of shell exe, then bare PATH
   d. Shell binds IPC listener (random localhost port), passes
      EVERYWEAR_CMD_PORT + EVERYWEAR_MODEL_* env vars to child
   e. Shell spawns applet binary, waits for IPC connection (10s)
   f. Applet connects to IPC, loads models into its own engine
   g. Applet confirms load success back to shell

7. FAILURE HANDLING
   - If applet fails to load models: shell releases VRAM
     reservation, emits error to UI, offers to retry or
     fall back to next model_group in the manifest
   - If download fails: shell cleans up partial file,
     shows error, does NOT launch applet
```

### VRAM Budget Tracker

The shell maintains a runtime ledger of what's loaded:

```rust
pub struct VramBudget {
    pub total_mb: u64,                      // from SystemGpuState
    pub allocations: Vec<VramAllocation>,
}

pub struct VramAllocation {
    pub applet_id: String,
    pub model_key: String,
    pub role: ModelRole,                    // Primary | Encoder | Vae | Lora
    pub vram_mb: u64,
    pub loaded_at: chrono::DateTime<Utc>,   // NOTE: migrates to std::time::Instant when Phase 2.1 merges (v4 ActiveEngine uses Instant for monotonic timing)
}

impl VramBudget {
    pub fn free_mb(&self) -> u64 {
        let allocated: u64 = self.allocations.iter().map(|a| a.vram_mb).sum();
        self.total_mb.saturating_sub(allocated)
    }

    pub fn can_fit(&self, required_mb: u64) -> bool {
        self.free_mb() >= required_mb
    }

    pub fn allocate(&mut self, alloc: VramAllocation) {
        self.allocations.push(alloc);
    }

    pub fn release_applet(&mut self, applet_id: &str) {
        self.allocations.retain(|a| a.applet_id != applet_id);
    }

    pub fn release_primary(&mut self, applet_id: &str) {
        self.allocations.retain(|a| {
            !(a.applet_id == applet_id && a.role == ModelRole::Primary)
        });
    }

    /// Cross-check budget against actual NVML readings.
    /// Called after purge to detect leaks.
    pub fn verify_against_nvml(&self, nvml_free_mb: u64) -> bool {
        let drift = (self.free_mb() as i64 - nvml_free_mb as i64).abs();
        drift < 512 // allow 512MB tolerance for driver overhead
    }
}
```

The budget tracker is the shell's internal model of VRAM state. It's authoritative for allocation decisions but cross-checked against NVML readings after every purge to catch drift.

### Model Group Selection Algorithm

```rust
pub fn select_model_group(
    manifest: &AppletManifest,
    free_vram_mb: u64,
    policy: &PurgePolicy,
    current_allocations: &[VramAllocation],
) -> Option<&ModelGroup> {
    // With Exclusive/PurgePrimary: available = total VRAM (we'll purge first)
    // With WarmSwitch/Lru: available = current free VRAM
    let available = match policy {
        PurgePolicy::Exclusive | PurgePolicy::PurgePrimary => {
            // We'll reclaim current allocations before loading
            let reclaimable: u64 = current_allocations.iter()
                .filter(|a| match policy {
                    PurgePolicy::Exclusive => true,
                    PurgePolicy::PurgePrimary => a.role == ModelRole::Primary,
                    _ => false,
                })
                .map(|a| a.vram_mb)
                .sum();
            free_vram_mb + reclaimable
        }
        PurgePolicy::WarmSwitch | PurgePolicy::Lru => free_vram_mb,
    };

    // Walk groups top-down (highest quality first)
    manifest.model_groups.iter().find(|g| g.min_vram_mb <= available)
}
```

### Shell AppState (Updated)

With VRAM lifecycle and concierge, the shell's managed state grows:

```rust
struct AppState {
    gpu: Arc<Mutex<SystemGpuState>>,
    budget: Arc<Mutex<VramBudget>>,          // NEW: VRAM allocation ledger
    models: Arc<Mutex<ModelManager>>,         // NEW: shared model cache
    concierge: Arc<Mutex<ConciergeEngine>>,  // NEW: Kasai concierge (LLM + STT + TTS)
    registry: Arc<Mutex<AppletRegistry>>,
    profile: Arc<Mutex<ProfileManager>>,
    wallet: Arc<Mutex<WalletManager>>,
    discourse: Arc<Mutex<DiscourseClient>>,
    active_applet: Arc<Mutex<Option<String>>>, // NEW: currently running applet ID
}
```

### New Shell Tauri Commands (VRAM Lifecycle)

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `get_vram_budget` | none | `VramBudget` | Current allocations and free VRAM |
| `check_applet_requirements` | `applet_id: String` | `RequirementsCheck` | Can this applet launch? Which model group? |
| `request_applet_switch` | `applet_id: String` | `SwitchResult` | Full switch sequence (gate, purge, provision, handoff) |
| `get_active_applet` | none | `Option<String>` | Currently running applet ID |
| `cancel_switch` | none | `()` | Abort an in-progress switch |

```rust
pub struct RequirementsCheck {
    pub can_launch: bool,
    pub selected_group: Option<String>,      // label of selected model_group
    pub models_to_download: Vec<ModelInfo>,   // missing models
    pub download_size_bytes: u64,            // total download needed
    pub vram_after_load_mb: u64,             // projected free VRAM after load
    pub requires_purge: bool,                // will current models be unloaded?
    pub purge_targets: Vec<String>,          // model keys that will be evicted
    pub rejection_reason: Option<String>,    // if can_launch is false
}

pub enum SwitchResult {
    Success { applet_id: String, model_group: String },
    DownloadRequired { models: Vec<ModelInfo>, total_bytes: u64 },
    UserConfirmRequired { message: String },
    Failed { reason: String },
}
```

### Events Emitted During Switch

| Event | Payload | When |
|-------|---------|------|
| `applet-switch-confirm` | `{ from, to, purge_targets }` | Before purge (Exclusive/PurgePrimary) |
| `applet-switch-progress` | `{ phase, detail }` | Each phase of the switch sequence |
| `model-unloading` | `{ model_key, applet_id }` | Purge started for a model |
| `model-unloaded` | `{ model_key, reclaimed_mb }` | Purge complete, NVML verified |
| `download-progress` | `{ model_key, downloaded, total, pct }` | During model download |
| `model-loading` | `{ model_key, applet_id }` | Incoming applet loading a model |
| `applet-ready` | `{ applet_id, model_group }` | Switch complete, applet running |
| `switch-failed` | `{ reason, phase }` | Switch failed at any phase |

---

## 7. Rust Crates API Reference

### applet-ipc (crates/applet-ipc/)

TCP command channel between shell and binary applets. Two protocol modes: legacy (v1, raw Command/Response) and envelope (v2, IpcEnvelope with HMAC auth, events, async job results).

**Modules:**
- `protocol`: Wire types (`Command`, `Response`, `CommandKind`, `ResponseStatus`, `ModelPath`). CommandKind includes legacy (UnloadModel, Shutdown, Ping) and migration-era variants (AdvertiseCapabilities, ExecuteJob, SubmitJob, SubmitPlan, JobComplete, JobFailed, TierSync, AuthContext, etc.)
- `envelope`: `IpcEnvelope`, `IpcSource`, `IpcKind`. Correlation IDs, sequence numbers, optional HMAC. Feature-gated `compute_hmac()` / `verify_hmac()`.
- `shell`: `ShellChannel` (bind, accept, send, unload_model, shutdown)
- `applet`: `AppletListener` (connect_from_env, run with async handler)

**Env vars:** `EVERYWEAR_CMD_PORT` (IPC port), `EVERYWEAR_IPC_SECRET` (HMAC shared secret)

**Feature flags:** `hmac` (enables HMAC-SHA256 signing/verification in envelope mode)

### model-manager (crates/model-manager/)

Shared model lifecycle for all applets. The shell uses this crate for discovery, download, verify, cache, and model tracking. 1magen imports it directly via Cargo dep; the Z-Image manifest is defined in `applets/1magen/src-tauri/src/z_image_manifest.rs` using shared types.

#### Module: manifest

Parses `applet.toml` model declarations and resolves model groups.

```rust
pub struct ModelInfo {
    pub key: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub hf_repo: String,
    pub hf_file: String,
    pub model_type: ModelType,
}

pub struct ModelGroup {
    pub label: String,
    pub min_vram_mb: u64,
    pub models: Vec<ModelRequirement>,
}

pub struct ModelRequirement {
    pub key: String,
    pub role: ModelRole,
    pub required: bool,
    pub vram_mb: u64,
}

pub struct AppletManifest {
    pub applet: AppletMeta,
    pub engine: EngineMeta,
    pub model_groups: Vec<ModelGroup>,
    pub requirements: HardwareRequirements,
}

pub enum ModelType {
    TextToImage,
    ImageEdit,
    Encoder,
    Vae,
    Llm,
    Audio,
}

pub enum ModelRole {
    Primary,
    Encoder,
    Vae,
    Lora,
}
```

#### Module: discovery

Scans filesystem for existing model files before downloading.

```rust
/// Scan all known model cache locations for GGUF/safetensors files.
/// Returns a map of filename -> absolute path for every model found.
pub fn scan_all() -> HashMap<String, PathBuf>;

/// Check a specific model against the discovered cache.
/// Returns Some(path) if the model exists locally.
pub fn find_model(key: &str, manifest: &[ModelInfo]) -> Option<PathBuf>;
```

Discovery paths (in priority order):
1. `~/.everywear/models/` (Everywear canonical cache)
2. `~/.lmstudio/models/`
3. `~/.ollama/models/blobs/`
4. `~/.cache/huggingface/hub/`
5. `~/Library/Application Support/nomic.ai/GPT4All/` (macOS)
6. `~/.local/share/nomic.ai/GPT4All/` (Linux)
7. `%LOCALAPPDATA%\nomic.ai\GPT4All\` (Windows)

When a model is found outside `~/.everywear/models/`, the manager creates a symlink into the canonical cache rather than copying. One file on disk, multiple references.

#### Module: download

Streaming download from HuggingFace with progress events.

```rust
/// Download a model from HuggingFace Hub.
/// Emits progress events via the callback.
/// Returns the final path in ~/.everywear/models/.
pub async fn download_model(
    model: &ModelInfo,
    dest_dir: &Path,
    on_progress: impl Fn(DownloadProgress),
) -> Result<PathBuf>;

pub struct DownloadProgress {
    pub model_key: String,
    pub downloaded: u64,
    pub total: u64,
    pub pct: u64,
}
```

Uses `reqwest` with streaming response. Writes to a `.partial` temp file, renames on completion. If a `.partial` file exists from a previous interrupted download, resumes from where it left off via HTTP Range header.

#### Module: verify

SHA256 verification for downloaded model files.

```rust
/// Compute SHA256 hash of a file and compare against expected.
/// Returns Ok(()) if match, Err with details if mismatch.
pub fn verify_model(path: &Path, expected_sha256: &str) -> Result<()>;

/// Compute SHA256 hash of a file (streaming, low memory).
pub fn sha256_file(path: &Path) -> Result<String>;
```

Verification is mandatory. Every model is verified after download and before first load. On hash mismatch: delete the file, re-download once, fail if second attempt also mismatches.

#### Module: cache (NEW)

Manages the `~/.everywear/models/` directory and tracks what's on disk.

```rust
pub struct ModelCache {
    pub cache_dir: PathBuf,
    pub models: HashMap<String, CachedModel>,
}

pub struct CachedModel {
    pub key: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub sha256: String,
    pub verified: bool,
    pub last_used: chrono::DateTime<Utc>,
    pub source: CacheSource,
}

pub enum CacheSource {
    Downloaded,                     // fetched from HuggingFace
    Symlinked { original: PathBuf }, // found in LM Studio/Ollama/etc
    Bundled,                        // shipped with app
}

impl ModelCache {
    pub fn scan(&mut self);
    pub fn get(&self, key: &str) -> Option<&CachedModel>;
    pub fn total_size_bytes(&self) -> u64;
    pub fn prune_unused(&mut self, older_than: chrono::Duration) -> Vec<String>;
}
```

#### Module: purge (NEW)

VRAM purge and reclaim logic, driven by PurgePolicy.

```rust
pub struct PurgeRequest {
    pub applet_id: String,
    pub policy: PurgePolicy,
    pub target_free_mb: u64,        // how much VRAM we need freed
}

pub struct PurgeResult {
    pub models_unloaded: Vec<String>,
    pub vram_reclaimed_mb: u64,
    pub nvml_verified: bool,
    pub duration_ms: u64,
}

/// Execute the purge cycle:
/// 1. Send unload command to applet engine
/// 2. Wait for confirmation
/// 3. Poll NVML 3x at 500ms (1.5s cap), proceed regardless if not reclaimed
/// 4. Update budget tracker
pub async fn execute_purge(
    request: PurgeRequest,
    budget: &mut VramBudget,
    nvml_poll: impl Fn(u32) -> Option<(u64, u64)>,
) -> Result<PurgeResult>;

/// NVML verification loop.
/// Polls 3 times at 500ms intervals (1.5s total), then returns regardless.
/// If still high after 3rd poll, proceed optimistically; next engine OOM = true purge failure.
pub async fn verify_vram_reclaimed(
    gpu_index: u32,
    expected_free_mb: u64,
    nvml_poll: impl Fn(u32) -> Option<(u64, u64)>,
) -> bool;
```

### vault (crates/vault/)

Hybrid search engine combining full-text and vector similarity.

**Modules (all stubs):**
- `index` : Tantivy (BM25) + LanceDB (vector) index management
- `search` : query interface with reciprocal rank fusion

Dependencies: tantivy 0.22, chrono, uuid. LanceDB dependency not yet in Cargo.toml (needs adding).

Consumers: Kasai (RAG retrieval), Mymories (knowledge search).

### mait (crates/mait/)

Trait-shard personality engine for composable AI agent identities.

**Modules (all stubs):**
- `shard` : trait shard definitions (tone, domain, behaviour, boundary)
- `agent` : agent identity composed from shards

Dependencies: serde, serde_json, uuid, tracing.

Consumers: Kasai (agent personality), Strands Game (NPC personalities).

---

## 8. EWDS Design System Reference

EWDS (Everywear Design System) v1.0 lives in `tokens.css`, currently duplicated in:
- `platform/everywear-os/src/styles/everywear/tokens.css`
- `applets/1magen/src/styles/everywear/tokens.css`

Both files are identical. The canonical source should be `packages/ewds/` once that package is built out.

### Fonts

| Token | Classic | Refined | Terminal |
|-------|---------|---------|----------|
| `--ew-font-display` | Orbitron | Chakra Petch | IBM Plex Mono |
| `--ew-font-body` | Rajdhani | Rajdhani | IBM Plex Sans |
| `--ew-font-mono` | JetBrains Mono | JetBrains Mono | IBM Plex Mono |

Font weights: `--ew-fw-body: 400`, `--ew-fw-body-strong: 500`, `--ew-fw-display: 700`, `--ew-fw-display-heavy: 900`.

Google Fonts import (in imagen.css): Orbitron, Rajdhani, JetBrains Mono, Chakra Petch, IBM Plex Mono, IBM Plex Sans.

### Spacing Scale

| Token | Value |
|-------|-------|
| `--ew-space-0` | 0 |
| `--ew-space-1` | 4px |
| `--ew-space-2` | 8px |
| `--ew-space-3` | 12px |
| `--ew-space-4` | 16px |
| `--ew-space-5` | 20px |
| `--ew-space-6` | 24px |
| `--ew-space-7` | 32px |
| `--ew-space-8` | 40px |
| `--ew-space-9` | 56px |
| `--ew-space-10` | 80px |

### Radii

| Token | Value |
|-------|-------|
| `--ew-radius-xs` | 2px |
| `--ew-radius` | 4px |
| `--ew-radius-md` | 6px |
| `--ew-radius-lg` | 10px |
| `--ew-radius-xl` | 16px |

Note: Terminal skin sets all radii to 0. Classic and Refined skins do NOT override radii. Refined skin adds bevel cuts in addition to the default radii.

### Bevel Scale (Refined skin)

| Token | Value |
|-------|-------|
| `--ew-bevel-xs` | 6px |
| `--ew-bevel-sm` | 8px |
| `--ew-bevel-md` | 12px |
| `--ew-bevel-lg` | 16px |
| `--ew-bevel-xl` | 24px |

### Corner Cuts

| Token | Purpose |
|-------|---------|
| `--ew-cut-win` | 16px, window-level bevels |
| `--ew-cut-md` | 10px, card-level bevels |
| `--ew-cut-sm` | 8px, button-level bevels |

Refined skin applies NE-SW diagonal cuts via `--ew-corner-tr` and `--ew-corner-bl`. Classic and Terminal use rectangular corners (all cuts set to 0).

### Clip Paths

| Token | Used By |
|-------|---------|
| `--ew-clip-card` | `.ew-section`, `.ew-applet-card` |
| `--ew-clip-card-inner` | Inner card elements |
| `--ew-clip-button` | `.ew-btn`, `.btn-generate` |
| `--ew-clip-button-sm` | Small buttons |

Clip paths are polygon() values creating bevelled rectangle shapes. Classic and Terminal set these to `none` (rectangular). Refined uses the full polygon cuts.

### Motion

| Token | Value | Use |
|-------|-------|-----|
| `--ew-ease` | cubic-bezier(0.16, 1, 0.3, 1) | Default easing |
| `--ew-ease-servo` | cubic-bezier(0.2, 0.8, 0.2, 1) | Mechanical feel |
| `--ew-t-fast` | 120ms | Micro-interactions |
| `--ew-t-med` | 180ms | Standard transitions |
| `--ew-t-slow` | 320ms | Panel transitions |

### Z-Index Scale

| Token | Value | Layer |
|-------|-------|-------|
| `--ew-z-bg` | -1 | Background decorations |
| `--ew-z-content` | 1 | Main content |
| `--ew-z-chrome` | 100 | Shell chrome |
| `--ew-z-nav` | 1000 | Navigation |
| `--ew-z-overlay` | 9000 | Modals, dialogs |
| `--ew-z-toast` | 9500 | Toast notifications |

### Skin Color Palettes (Dark Mode)

#### Classic (data-skin="classic")

| Token | Value | Description |
|-------|-------|-------------|
| `--ew-bg` | #0A0B0D | Near-black background |
| `--ew-surface` | rgba(20, 21, 28, 0.85) | Card/panel surface (with alpha) |
| `--ew-surface-sunken` | rgba(5, 6, 10, 0.6) | Recessed areas |
| `--ew-chrome-bg` | rgba(8, 9, 12, 0.9) | Chrome/titlebar |
| `--ew-primary` | #00C2FF | Cyan accent |
| `--ew-primary-soft` | rgba(0, 194, 255, 0.7) | Subdued primary |
| `--ew-expressive` | #F000B8 | Magenta expressive |
| `--ew-premium` | #8B5CF6 | Purple premium |
| `--ew-warm` | #F9B960 | Warm/gold |
| `--ew-success` | #22C55E | Green |
| `--ew-danger` | #FF4444 | Red |
| `--ew-text` | #E2E8F0 | Primary text |
| `--ew-text-muted` | #A0AEC0 | Secondary text |
| `--ew-border` | rgba(255, 255, 255, 0.06) | Subtle borders |
| `--ew-shadow-glow` | 0 0 20px rgba(0, 194, 255, 0.15) | Cyan glow shadow |

Chroma multiplier: 1.25 (vivid).

#### Refined (data-skin="refined")

All colors use OKLCH notation for perceptual uniformity.

| Token | Value | Description |
|-------|-------|-------------|
| `--ew-primary` | oklch(72% .15 220) | Steel blue |
| `--ew-bg` | oklch(14% .02 240) | Cool dark |
| `--ew-surface` | oklch(18% .03 245 / .88) | Elevated surface (with alpha) |

Chroma multiplier: 0.8 (subdued).

#### Terminal (data-skin="terminal")

| Token | Value | Description |
|-------|-------|-------------|
| `--ew-bg` | #12100E | Warm dark |
| `--ew-surface` | #1A1714 | Warm surface |
| `--ew-primary` | #FF8800 | Amber |
| `--ew-border` | rgba(212, 183, 127, 0.22) | Warm border |

Chroma multiplier: 1.0. No glow effects, no inset shadows.

### Accent Overrides

Three accent colours override `--ew-primary` and related tokens:

| Accent | Hue | Preview |
|--------|-----|---------|
| Signal | 220 (cyan/blue) | Default |
| Amber | 80 (gold/warm) | Warm override |
| Plasma | 310 (magenta/pink) | Vivid override |

Applied via `data-accent` attribute on body. ThemeContext stores the preference in localStorage.

### Legacy Alias Layer

For backward compatibility, tokens.css maps old variable names to EWDS tokens:

| Old | New |
|-----|-----|
| `--c-accent` | `var(--ew-primary)` |
| `--c-bg` | `var(--ew-bg)` |
| `--c-surface` | `var(--ew-surface)` |
| `--font-display` | `var(--ew-font-display)` |
| `--clip-card` | `var(--ew-clip-card)` |

### How to Use EWDS in a New Component

```css
.my-component {
    background: var(--ew-surface);
    color: var(--ew-text);
    border: 1px solid var(--ew-border);
    border-radius: var(--ew-radius-md);
    padding: var(--ew-space-4);
    font-family: var(--ew-font-body);
    clip-path: var(--ew-clip-card);
    transition: all var(--ew-t-med) var(--ew-ease);
}

.my-component:hover {
    border-color: var(--ew-primary-soft);
    box-shadow: var(--ew-shadow-glow);
}
```

Always use `--ew-*` tokens, never hardcode colours or spacing. The skin system handles everything through CSS custom property cascading from `body[data-skin][data-mode]`.

---

## 9. Frontend Architecture

### Shell (platform/everywear-os)

```
Entry: main.tsx
  -> ThemeProvider (skin/mode/accent state, localStorage persisted)
    -> ShellLayout (main frame)
         Custom titlebar (38px, -webkit-app-region: drag)
           [minimize] [maximize] [close] via @tauri-apps/api/window
         Sidebar (260px)
           Avatar circle (initials from profile)
           Nav items: Applets, Profile, Wallet, Community, Hardware, Settings
           GPU status footer (backend + free VRAM)
         Content area (routed by `view` state)
           'launcher'  -> LauncherGrid
           'profile'   -> ProfilePanel
           'wallet'    -> WalletPanel
           'community' -> DiscoursePanel
           'gpu'       -> GpuPanel
           'settings'  -> SettingsPanel
```

Routing is state-based (`useState<View>`), not URL-based. No React Router.

### 1magen (applets/1magen)

```
Entry: main.tsx
  -> ImagenApp
    -> ThemeProvider (skin/accent, same pattern as shell)
      -> ImagenCore (main UI)
           Header bar with status dot
           Sidebar (360px)
             Tab switcher: Generate | Edit
             [Generate tab]
               PromptInput (textarea, Ctrl+Enter)
               ResolutionPicker (3x2 grid)
               Generate button
             [Edit tab]
               EditCanvas (drag-and-drop image loader)
               PromptInput
               Strength slider (0-1)
               Edit button
           Canvas area (flex: 1)
             Selected image display (centered, max-height)
           Gallery strip (bottom, horizontal scroll)
             Thumbnail per generation (click to select)
```

### Component Communication

No global state library (no Redux, Zustand, or Jotai). All state is local `useState` in the top-level layout component, passed down as props. IPC calls are made directly in event handlers.

---

## 10. Database Schema

### Profile Database

Location: `{app_data_dir}/everywear/profile.db` (SQLite via rusqlite, bundled)

```sql
CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    alias TEXT,
    email TEXT,
    avatar_path TEXT,
    bio TEXT,
    discourse_username TEXT,
    discourse_session_token TEXT,
    wallet_address TEXT,
    wallet_pubkey BLOB,
    created_at TEXT NOT NULL,       -- ISO 8601
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

The profile table always has exactly one row (created on first `get_profile` call with UUID v4 ID). Default values (display_name "Everywear User", alias None) are applied in Rust code during insert, not via SQL DEFAULT clauses.

### Model Cache

Location: `~/.everywear/models/` (planned)
Currently 1magen uses its own discovery logic scanning LM Studio, Ollama, HF Hub, GPT4All paths.

No database for model tracking yet; the manifest is hardcoded in `model_manager.rs::default_manifest()`.

---

## 11. State Management Patterns

### Rust Side (AppState)

Both apps use a single `AppState` struct registered with Tauri's managed state:

```rust
// Shell (current)
struct AppState {
    gpu: Arc<Mutex<SystemGpuState>>,
    profile: Arc<Mutex<ProfileManager>>,
    wallet: Arc<Mutex<WalletManager>>,
    registry: Arc<Mutex<AppletRegistry>>,
    discourse: Arc<Mutex<DiscourseClient>>,
}
// Shell (target, with VRAM lifecycle -- see Section 6)
// Adds: budget, models, active_applet

// 1magen
struct AppState {
    engine: Arc<Mutex<InferenceEngine>>,
    models: Arc<Mutex<ModelManager>>,
}
```

All state is behind `Arc<Mutex<T>>`, accessed via `state.inner().lock().await` in async Tauri commands. No Rust-side event bus between modules; each module is independent.

### TypeScript Side

No state library. Pattern is:

```typescript
const [data, setData] = useState<T | null>(null);

useEffect(() => {
    getDataFromTauri().then(setData);
}, []);
```

GpuPanel uses a 3-second polling interval for live VRAM updates:

```typescript
useEffect(() => {
    const interval = setInterval(() => {
        getGpuStatus().then(setGpu);
    }, 3000);
    return () => clearInterval(interval);
}, []);
```

Theme state (skin, mode, accent) is persisted to localStorage and applied as `data-*` attributes on `<body>`.

---

## 12. Build, Run, Deploy

### Development

| Target | Command | Cwd |
|--------|---------|-----|
| Shell (Tauri dev) | `npm run tauri dev` | `platform/everywear-os/` |
| 1magen (Tauri dev) | `npm run tauri dev` | `applets/1magen/` |
| Shell (Vite only) | `npm run dev` | `platform/everywear-os/` |
| 1magen (Vite only) | `npm run dev` | `applets/1magen/` |

Vite serves on port 5173. Tauri reads `TAURI_DEV_HOST` env for the dev server URL.

### Production Build

```bash
cd platform/everywear-os && npm run tauri build
cd applets/1magen && npm run tauri build
```

Output: `src-tauri/target/release/bundle/` (MSI installer on Windows, .deb/.AppImage on Linux).

Release Cargo profile: LTO=true, strip=true, opt-level="z", codegen-units=1, panic="abort".

### Web Deployments

| App | Domain | Host |
|-----|--------|------|
| S3 Studio | s3studio.xyz | Vercel |
| Strands Game | game.strandsnation.xyz | Vercel |
| Everywear landing | everywear.id | Vercel |

The landing page lives in a separate repo at `Project Strands/everywear/` (single `index.html`).

### Cargo Workspace

The workspace root `Cargo.toml` includes:
- `crates/applet-ipc`
- `crates/model-manager`
- `crates/vault`
- `crates/mait`
- `applets/1magen/src-tauri`

Commented out (not yet scaffolded): 3nvizen, kasai, mymories.

`platform/everywear-os/src-tauri` is NOT in the workspace (separate Cargo project). This is intentional; the shell has different dependency requirements (rusqlite, ed25519-dalek) and is built independently.

### npm Workspaces

Root `package.json` declares workspaces:
- `packages/*` (ewds, shared, transport)
- `platform/everywear-os`
- `applets/1magen`
- `applets/s3studio` (stub)
- `applets/3nvizen` (stub)
- `applets/kasai` (stub)
- `applets/mymories` (stub)
- `applets/strands-game` (stub)

Root scripts:
- `dev:shell` : starts shell dev server
- `dev:1magen` : starts 1magen dev server
- `build:ewds` : builds the EWDS package
- `lint` : ESLint across all workspaces
- `clean` : removes dist, target, node_modules

---

## 13. Code Style and Contributing

### Rust

- Edition 2021
- `tracing` for all logging (not `println!`)
- Error handling: `anyhow::Result` in library code, `Result<T, String>` at Tauri command boundary
- Naming: snake_case functions, PascalCase types, SCREAMING_SNAKE constants
- All public types derive `Serialize, Deserialize` for Tauri IPC
- Tests: `#[cfg(test)] mod tests` in the same file (see gpu.rs for examples)

### TypeScript

- Strict mode enabled
- React 18 functional components only (no class components)
- Hooks for all state and effects
- Types exported alongside functions in transport.ts
- No global state library; props-down pattern
- CSS via EWDS tokens exclusively; no inline styles, no Tailwind, no CSS modules

### Git

- Main branch: `main`
- Feature branches: `feat/<name>`
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- No force pushes to main

### File Naming

- Rust: snake_case (`model_manager.rs`)
- TypeScript components: PascalCase (`GpuPanel.tsx`)
- TypeScript utilities: camelCase (`transport.ts`)
- CSS: kebab-case (`shell.css`, `tokens.css`)

---

## 14. Implementation Status

### Fully Implemented

| Component | What Works |
|-----------|------------|
| **gpu.rs** | 3-tier detection (CUDA NVML + CLI, Vulkan CLI, CPU), VRAM polling, VramTier, cuBLAS discovery, compute capability check (CudaComputeCapability struct). 4 unit tests. |
| **profile.rs** | SQLite CRUD, preferences KV store, profile creation on first launch. |
| **wallet.rs** | Ed25519 keypair generation (rand_core feature), address derivation. Balances are mock/stub. |
| **registry.rs** | 6-applet inventory, status filtering. No dynamic manifest loading yet. |
| **1magen engine.rs** | diffusion-rs 0.1.19 FFI: load/unload models, txt2img, img2img, file-based output with base64 encoding. `unsafe impl Send/Sync` for C pointer safety (mutex-guarded). Uses `EULER_SAMPLE_METHOD`, `gen_img` writes to temp dir. |
| **1magen z_image_manifest.rs** | Z-Image model definitions (4 models) using shared `model_manager::ModelInfo` types. |
| **EWDS tokens.css** | 3 skins, full token set, legacy alias layer. |
| **Shell UI** | Full layout, all 6 panels rendering, custom titlebar, theme switching. |
| **1magen UI** | Generate/edit tabs, prompt input, resolution picker, gallery, save dialog. |

### Newly Implemented (Bridge)

| Component | What Works |
|-----------|------------|
| **crates/applet-ipc** | TCP command channel (localhost, random port). Protocol: JSON-lines. Commands: unload_model, shutdown, ping. Shell side (ShellChannel) and applet side (AppletListener). |
| **crates/model-manager** | Full crate: discovery (6 paths), download with progress callbacks, SHA256 verify, manifest parsing (applet.toml with model_groups), ModelManager struct. 1magen now imports directly. |
| **budget.rs** | PurgePolicy (4 variants from VramTier), VramBudget tracker (allocate/release/verify), model group selection algorithm, purge request builder, requirements checker. |
| **launcher.rs** | Full applet switch pipeline: gate check, budget check, purge with IPC unload + NVML verify (3x 500ms poll, 1.5s cap), provision (download missing), binary path resolution (4-tier search), handoff with IPC channel. |
| **applets/1magen/applet.toml** | Manifest with 2 model groups (High Quality Q8, Standard Q4_K_M). |
| **lib.rs (shell)** | Tauri bridge commands: get_vram_budget, get_active_applet, check_applet_requirements, request_applet_switch, submit_engine_job. AppState extended with budget, model_mgr, active_applet, engine_registry, and vram_scheduler. |
| **transport.ts (1magen)** | 3 mismatches fixed: model_key, image_path, engine_loaded. |
| **applet-ipc envelope transport** | ShellChannel now reads envelope events/responses in the background, verifies signed AdvertiseCapabilities with HMAC, and keeps legacy command/response compatibility. |
| **engine registry dispatch** | Shell registers advertised engines, tracks heartbeats, and exposes `submit_engine_job` to validate and send `ExecuteJob` envelopes to the active advertised engine applet. |
| **data-migration crate** | Dedicated migration crate with dry-run mode, SHA256 verification, Windows junction creation, and RFC3339 receipt timestamps. |

### Stubs (Type Definitions Only)

| Component | What Exists | What's Missing |
|-----------|-------------|----------------|
| **crates/vault** | Module structure | Tantivy indexing, LanceDB vectors, search fusion |
| **crates/mait** | Module structure | Shard definitions, agent composition |
| **discourse.rs** | Client struct, all API types | OAuth flow, HTTP calls to Discourse API |
| **packages/ewds** | index.ts exports | Actual ThemeProvider, tokens, components |
| **packages/shared** | index.ts exports | Actual type definitions, constants |
| **packages/transport** | index.ts exports | createTransport implementation |

### Placeholder Directories (No Code)

| Applet | Has | Needs |
|--------|-----|-------|
| 3nvizen | .gitkeep files | Full Tauri app (Wan 2.2 / LTX video gen) |
| kasai | .gitkeep files | Full Tauri app (llama-cpp-2 LLM agent) |
| mymories | .gitkeep files | Full Tauri app (knowledge/memory with vault) |
| strands-game | .gitkeep | Three.js web app (exists at game.strandsnation.xyz) |
| s3studio | engine .gitkeep dirs | Full integration (exists at s3studio.xyz) |

### Known Duplication to Resolve

1. **tokens.css** : identical copy in shell and 1magen. Should import from `@everywear/ewds`.
2. **ThemeContext.tsx** : near-identical in shell and 1magen. Should come from `@everywear/ewds`.
3. **transport.ts** : pattern duplicated. Should use `@everywear/transport`.
4. **model_manager.rs** : RESOLVED. 1magen now imports from crates/model-manager/. Z-Image manifest lives in z_image_manifest.rs. Local model_manager.rs deprecated.
5. **Google Fonts import** : in imagen.css. Should be in a shared location or loaded by EWDS.

---

## Appendix A: Tauri Plugin Usage

### Shell (everywear-os)

| Plugin | Purpose |
|--------|---------|
| tauri-plugin-shell | Execute sidecar binaries (engine servers) |
| tauri-plugin-dialog | File open/save dialogs |
| tauri-plugin-fs | Filesystem access (scoped to $APPDATA, $HOME/.everywear) |
| tauri-plugin-process | App lifecycle (exit, restart) |
| tauri-plugin-http | Outbound HTTP (Discourse API, HuggingFace) |
| tauri-plugin-opener | Open URLs in default browser |

### 1magen

| Plugin | Purpose |
|--------|---------|
| tauri-plugin-shell | sd-server sidecar (unused with FFI, kept for future) |
| tauri-plugin-dialog | Save image dialog |
| tauri-plugin-fs | Read/write images (scoped to $HOME/1magen, $PICTURE) |
| tauri-plugin-process | App lifecycle |

## Appendix B: CSP (Content Security Policy)

### Shell

```
default-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data: https:;
connect-src 'self' https://forum.strandsnation.xyz https://huggingface.co https://*.huggingface.co;
```

### 1magen

```
default-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' http://127.0.0.1:* https://huggingface.co https://*.hf.co;
```

## Appendix C: Filesystem Scopes

### Shell

- `$APPDATA` : app data directory (profile.db lives here)
- `$RESOURCE` : bundled resources
- `$HOME/.everywear` : model cache, config

### 1magen

- `$APPDATA` : app data
- `$RESOURCE` : bundled resources
- `$HOME/1magen` : output images
- `$PICTURE` : system pictures folder (save targets)

---

## 15. Addendum 2026-05-17

This addendum supersedes older `1magen` status notes where they conflict.

### Canonical 1magen Runtime

`1magen` is now canonically a `Z-Image` applet.

That means:

- model family choice is fixed to `Z-Image`
- VRAM detection selects the appropriate weight tier inside that family
- `1magen` is not a mixed-runtime patch surface

Current intended local stack:

- `z_image_turbo-Q8_0.gguf` or `z_image_turbo-Q4_K.gguf`
- `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`
- `diffusion_pytorch_model.safetensors`

### 1magen Working State

The base local path has now been validated end to end:

- automatic provisioning works
- checksum verification works
- model load works
- base text-to-image generation works
- output preview works
- output save works

The applet UI has also been simplified:

- resolution is now a dropdown rather than a large button grid
- the main generate action is larger and easier to reach
- optional source-image mode is exposed directly in the workbench
- `Style Patch (LoRA)` and `Task Shard (Workflow)` now appear as coming-soon surfaces

### Style Patch Rule

Compatibility rule for `1magen` style patches:

- a patch must explicitly work with `Z-Image`
- if a patch is not explicitly `Z-Image` compatible, it is not a valid `1magen` patch

This rule should be treated as product-canonical.

### Style Forge Direction

Future `Style Forge` training should be a separate lane from the lean GGUF runtime used by `1magen`.

Training lane:

- managed Python sidecar
- `uv` environment management
- `safetensors`-based Z-Image assets
- LoRA training via open tooling

Runtime lane:

- applet-first direct generation
- lightweight provisioned local stack

Do not attempt to train style patches against the GGUF runtime weights.

### 3nvizen Snapshot

`3nvizen` is no longer just a conceptual placeholder. It now has:

- an applet manifest
- a segment-chain contract
- a scaffolded `uv` Python sidecar for the LTX runtime

The full applet UI and shell-side server management are still pending.

### Model Storage Reality

The Everywear-wide shared model tree has not yet been implemented.

Right now:

- `1magen` still provisions into its own app-local roaming-data path
- centralization into an Everywear-owned model hierarchy is still a next-step item

### Repo / Push Note

At the time of this addendum, the working directory contents are present but the `.git` metadata is not visible from this workspace, so an authenticated push cannot be performed directly here without first reattaching or reinitializing the repository metadata.

---

## Addendum 2026-05-17 (Session 2): Architecture Decisions

Location: C:\Users\MAG MSI\Project Everywear

### VRAM Lifecycle: Purge-on-Switch as Default

`PurgePolicy::Exclusive` is now the DEFAULT behaviour, not an option among equals.

Rules:
- Every new applet launch purges the prior model from VRAM unconditionally
- Sequential pipeline stages (AI Director workflow) also purge between stages
- "Last frame from 3nvizen populates next 1magen first frame" is a filesystem pointer (`shot[n+1].init_image = shot[n].output_path`), not a cohabitation requirement
- No two inference models are ever warm simultaneously on any VRAM tier
- Sub-8GB users get a soft warning ("Generation queued; one model loads at a time"), not a hard gate

### Orchestration Pattern: Plan-Then-Execute (Locked)

Confirmed from AI Director's existing implementation (`shot_planner.rs` + `director_lm/`):

1. Kasai Lite (LLM) generates the full execution graph as a `ShotPlan` (JSON manifest)
2. LLM purges from VRAM immediately after plan generation
3. Kasai Concierge (scripted state machine, zero GPU) picks up the manifest
4. Concierge dispatches jobs sequentially to inference applets (1magen, 3nvizen)
5. Inter-stage data references are filesystem paths injected into subsequent job parameters

Kasai Lite NEVER cohabits with diffusion/video models. The entire orchestration flow is resolved before any inference applet loads. This works on ALL VRAM tiers.

AI Director ShotPlan schema (from `s-gener8/src-tauri/src/ai_director/mod.rs`):
```rust
pub struct ShotPlan {
    pub shots: Vec<Shot>,
    pub style_preset: String,
    pub brief: String,
    pub total_duration_ms: u64,
}

pub struct Shot {
    pub shot_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub visual_prompt: String,
    pub shot_type: String,       // closeup|wide|aerial|performance|abstract|transition
    pub reference_tags: Vec<String>,
}
```

### Multi-Applet Surface Architecture

UI surface and model lifecycle are decoupled:

- Each applet binds its own TCP localhost port (applet-ipc)
- Multiple WebView windows CAN be open simultaneously (cheap: RAM only)
- Model loading is exclusive; model-manager serialises GPU access
- When user hits "Generate" in any applet: check if model warm (cache hit) → if not, purge current → load requested → run inference → return result
- User experience: multiple windows open with cached results displayed, but generation is serial

### EWDS Shared Package Extraction (Planned)

Post-merge target structure:
```
packages/ewds/
├── tokens.css          ← canonical token source
├── components.css      ← .ew-btn, .ew-icon, .ew-label primitives
├── icons.css           ← sizing & skin variants
├── icons.svg           ← sprite (extracted from per-app index.html inlining)
├── fonts.css           ← @font-face declarations
├── tailwind-preset.js  ← shared color scales, font config, accent chain
├── ThemeContext.tsx     ← skin/accent/mode engine (React, single source)
└── index.ts            ← barrel export
```

All applets import from `@everywear/ewds`. Eliminates current duplications:
- Icon SVG sprite (currently inlined per-app)
- tokens.css / components.css (currently copy-synced via sync.ps1)
- ThemeContext.tsx (each shell has its own copy)
- Tailwind color config (duplicated per tailwind.config.js)
- Font declarations (loaded per-app)

Everywear OS shell requires a proper EWDS pass (currently approximation only).

### 1magen: Album Cover Art Capability (New)

Added command: `cover_art` alongside existing `txt2img`

Spec:
- Fixed output: 1024×1024 (square, album format)
- Prompt: derived from song metadata (title, genre, mood) + optional user style direction
- Style Patches applicable (Trading Post, when live)
- Same Z-Image GGUF model already loaded for txt2img; no additional model required
- Tier gate: Gener8 Pro+ (free tier gets watermarked output)
- Implementation: constrained generation parameters (forced square aspect, curated prompt template incorporating song metadata)

### S3 Gener8 → Everywear Migration (In Planning)

Full integration plan documented in `EVERYWEAR_S3_Integration_Plan_v1.docx` (Project Strands/everywear/).

Migration source: `C:\Users\MAG MSI\Project Ace\S3 STUDIO`

Key components to migrate:
| S3 Component | Destination | Transport |
|---|---|---|
| ACE-Step sidecar | applets/gener8/sidecar/ | JSON-RPC stdin/stdout |
| AI Director (shot_planner + director_lm) | applets/ai-director/src-tauri/ | Tauri commands |
| s3studio-web shell | merged into platform/everywear-os/ | shared EWDS package |
| Style Forge | applets/style-forge/ | applet-ipc TCP |
| Album Cover (new) | applets/1magen/ (cover_art command) | existing 1magen IPC |
| 3nvizen (LTX/Wan sidecar) | applets/3nvizen/ (already scaffolded) | uv Python sidecar |
| Kasai Lite | applets/kasai/ | llama-cpp-2 gated build |

Pricing model filed separately (vault: strands wing, decision category, 2026-05-17). Not reflected in wiki or marketing until financial modelling complete.

---

## Addendum 2026-05-17 (Session 3): Migration Architecture v4 Corrections

Location: C:\Users\MAG MSI\Project Everywear

**SUPERSEDES** the migration table in Session 2 above. The following corrections apply:

### Corrected Migration Table

| S3 Component | Destination | Notes |
|---|---|---|
| ACE-Step sidecar | applets/gener8/ (bundled inside Gener8 binary) | NOT separate applet. Gener8 manages its own sidecar. |
| AI Director | applets/gener8/src/ai_director/ (internal module) | NOT separate binary. Internal to Gener8. |
| Style Forge | applets/gener8/src/style_forge.rs (internal module) | NOT separate binary. Singular UI inside Gener8. |
| DAW Engine | applets/gener8/src/daw_engine/ (internal module) | NOT separate binary. |
| Tier Reconciler | applets/gener8/src/tier_reconciler/ (per-applet) | Stays per-applet. Shell syncs, applet enforces. |
| Dependency Bootstrap | applets/gener8/src/dependency_bootstrap.rs | Stays per-applet. Zendit replaces later. |
| Kasai Local | applets/kasai/ (full orchestrator from Project Claude) | Full binary. Kasai Lite = same binary, tier-gated. |
| 1magen | applets/1magen/ (already exists) | Adds runtime discovery + warmup. |
| 3nvizen | applets/3nvizen/ (already scaffolded) | Adds sandboxed Python sidecar. |
| Album Cover | applets/1magen/ (cover_art capability) | Existing 1magen, no change. |

### IPC Protocol: Envelope + Authentication (v4)

The wire protocol now uses `IpcEnvelope` wrapping all messages:
- `id`: UUID v4 correlation
- `seq`: monotonic sequence number per direction
- `source`: Shell | Applet(applet_id)
- `kind`: Command | Response | Event
- `payload`: serde_json::Value
- `hmac`: HMAC-SHA256 for authenticated messages

Authentication: shared secret exchanged at process spawn via `EVERYWEAR_IPC_SECRET` env var. First message from applet must include valid HMAC. TierSync messages always HMAC-signed (prevents local privilege escalation).

### VRAM Scheduler: Wraps Existing Primitives

`VramScheduler` consumes `VramBudget` + `PurgePolicy` (no parallel enums):
```rust
pub struct VramScheduler {
    budget: VramBudget,
    policy: PurgePolicy,  // from_tier(gpu.vram_tier)
    active_engine: Option<ActiveEngine>,
    job_queue: Vec<QueuedJob>,
    heartbeats: HashMap<String, AppletConnection>,
}
```

### Model Loading Boundary (Clarified)

- Shell provisions: downloads, verifies SHA256, provides model paths, allocates VRAM budget
- Applets load: call `load_model()` in their own process/GPU context
- Shell's authority: availability + VRAM allocation. NOT the actual model load call.

### Heartbeat Protocol

- Applet sends heartbeat event every 5 seconds
- Shell tracks per-applet: 3 missed (15s) -> send Ping probe -> wait 5s -> no response -> kill + reclaim VRAM + purge from registry

### Unload Timeout: Scaled + Graceful Escalation

- Timeout scaled by vram_requirement_mb (6GB=30s, 12GB=45s, 16GB+=60s)
- Escalation: UnloadModel cmd -> wait timeout -> CTRL_BREAK -> 10s -> SIGTERM -> 10s -> force kill
- Post-kill: NVML health check (3 polls at 500ms, then proceed)

### Engine-Grouped Render Sequence with Continuation Logic

ShotPlan shots have `InitSource`:
- `KeyframeGenerated`: cut shot, needs 1magen keyframe
- `PreviousShotEndFrame { previous_shot_id }`: continuation, uses end-frame of previous video

Render sequence: all cut-shot keyframes batched on 1magen first (one load), then all video segments on 3nvizen in timeline order (one load). Continuations skip 1magen entirely.

### Job Queue Safety

- Atomic plan submission (SubmitPlan): all-or-nothing enqueue
- Event-driven results (no blocking waits): submit returns job_id, results arrive as events
- Applet disconnect: cancel all owned jobs in queue
- Job timeout by priority (High=300s, Normal=120s, Low=60s, Background=30s)
- Large files via FileRef (staging dir), not base64 in JSON

### Defense-in-Depth Tier Enforcement

- Hub: source of truth (writes tier to user record)
- Shell: sync broker + launch gate (bundle manifests map product tier -> applet entitlements; refuses to spawn unentitled applets)
- Applet: module gates + reconciler (verifies signed TierSync, enforces internally)

### Python Sidecar Sandboxing

3nvizen + future Osiris: spawned with dynamic port + auth token, filesystem-fenced (read: models only; write: own data dir only), OS-level enforcement (job objects/seccomp/sandbox-exec), full command-line audit logging.

### New Shared Crates (Phase 0)

- `crates/everywear-paths/`: Single source of truth for all filesystem paths. No direct `dirs::` calls elsewhere in workspace.
- `manifest_parser.rs`: Now on critical path (was `[PLANNED]`). Shell parses applet.toml before launch for VRAM check, model provisioning, entitlement validation.
- `applet_resolver.rs`: 3-tier binary lookup (installer manifest -> env override -> relative fallback).

### Resumable Downloads

model-manager uses HTTP Range headers for resume. Partial `.part` files persist across interrupts. Only restart if partial is corrupted.

### Applet Self-Shutdown Safety Net

Applets detect IPC disconnection from shell -> 10s timer -> unload models -> exit. Prevents orphaned VRAM consumption on shell crash or dev restart.

### Repo Consolidation Target

| Current Location | Monorepo Destination |
|---|---|
| Project Everywear | IS the monorepo (stays) |
| Project Ace\S3 STUDIO | applets/gener8/ + EWDS. Archive after. |
| Project Claude\Kasai-Local | applets/kasai/ |
| Project Mymory | crates/vault/ + crates/library-store/ |
| Project Strands\everywear | packages/everywear-web/ or thin deploy |
| Project SON | Stays separate (too early) |

### Status

`manifest_parser.rs` tag updated: ~~[PLANNED]~~ -> **[CRITICAL PATH, Phase 0.5]**

Full migration architecture: `MIGRATION_ARCHITECTURE.md` v4 (same directory).
