# Everywear OS: Platform Architecture

Version: 0.1.0-draft
Author: Sean Uddin / Somo Kasane
Date: 2026-05-08
Status: ACTIVE SCAFFOLD

---

## Vision

Everywear OS is the Steam OS of AI one-click apps. A polished, Rust-native
desktop platform that handles GPU detection, model management, VRAM arbitration,
and inference engine lifecycle so that applets are thin UI layers with declarative
resource manifests. The nearest analogue is Pinokio; Everywear aims a full tier
above in UX quality and architectural soundness.

Operator: PT Metafintek AI Studios (Lombok, Indonesia)
Live shell: everywear.id (Vercel)
Design system: EWDS v1.0

---

## Monorepo Layout

```
Project Everywear/
  platform/
    everywear-os/              Shell: GPU detect, model registry, VRAM arbiter,
                               engine pool, applet launcher. Ships as Tauri binary.
  applets/
    s3studio/                  Strands Sound Studio (web, s3studio.xyz)
      engines/
        gener8/                Music gen (ACE-Step GGUF)
        gener8-pro/            BF16 premium inference
        style-forge/           Style transfer
        stem-separator/        Demucs sidecar
        video-studio/          Video generation (Wan 2.2 / LTX)
        ai-director/           Shot planning + multi-engine pipeline
        daw-studio/            WaveSurfer + Web Audio DAW
    1magen/                    Image gen/edit (Tauri + diffusion-rs)
    3nvizen/                   Video gen (Tauri + Wan 2.2 / LTX)
    kasai/                     Local AI agent (Tauri + llama-cpp-2)
    mymories/                  Memory/knowledge app
    strands-game/              The game (Three.js, game.strandsnation.xyz)
  packages/                    Shared TypeScript
    ewds/                      Design system tokens + components
    transport/                 Tauri IPC / WebSocket abstraction
    shared/                    Common utils, types, constants
  engines/                     Shared native inference binaries
    sd-server/                 stable-diffusion.cpp (image + video gen)
    ace-server/                ACE-Step (music gen)
    llama-server/              llama.cpp (LLM inference)
  crates/                      Shared Rust workspace crates
    model-manager/             GGUF discovery, download, SHA256, symlinks
    vault/                     LanceDB + Tantivy hybrid search
    mait/                      Trait-shard personality engine
```

---

## Platform Shell (everywear-os)

The shell is the single process that owns hardware and model lifecycle.
Applets never touch GPU, models, or inference engines directly. They declare
what they need; the shell provides it.

### Shell Responsibilities

1. Compute Backend Detection (three-tier, ported from Kasai-Local)
   - Tier 1: CUDA (NVIDIA) via NVML direct binding + nvidia-smi CLI fallback
     - cuBLAS discovery: bundled app dir > CUDA_PATH > system install paths
     - Compute capability matrix: SM 5.0+ (Maxwell), flash attention SM 7.0+ (Volta)
     - CUDA toolkit version detection via nvcc
   - Tier 2: Vulkan (AMD, Intel, NVIDIA fallback) via vulkaninfo CLI
   - Tier 3: CPU (OpenBLAS bundled or system) with system RAM budget
   - VramTier classification: Ultra (24GB+), Standard (16-23GB), Constrained (12-15GB), Minimal (8-11GB), CpuFallback (<8GB)
   - Live VRAM monitoring: per-GPU utilization, temperature, memory via NVML polling
   - Cross-platform: Windows + Linux ready, macOS CPU fallback (Metal variant planned)

2. Model Registry (model-manager crate)
   - Unified GGUF cache at ~/.everywear/models/
   - GGUF Discovery: scan LM Studio, Ollama, HF Hub cache, GPT4All before downloading
   - Symlink management: one file on disk, multiple applet references
   - Manifest-driven: each engine type declares its models in a TOML manifest
   - SHA256 verification on every download before trust
   - Progress events streamed to shell UI during downloads

3. VRAM Arbitration
   - Budget tracker: maps loaded models to their VRAM consumption
   - Load request queue: applets request model loads, shell checks budget
   - Eviction policy: LRU with priority weights (foreground applet > background)
   - Hard limit: refuse loads that would exceed 90% VRAM utilisation
   - Preemptive unload: when switching applets, offer to free background models

4. Inference Engine Pool
   - sd-server: stable-diffusion.cpp for image and video generation
   - ace-server: ACE-Step for music generation
   - llama-server: llama.cpp for LLM inference
   - Direct FFI alternative: applets can link diffusion-rs or llama-cpp-2 directly
     (single-process, no HTTP overhead, but exclusive GPU access)
   - Shell manages lifecycle: spawn on demand, health check, graceful shutdown
   - Port allocation: dynamic, tracked in shell state

5. Applet Launcher
   - Reads applet manifest (see Applet Contract below)
   - Validates resource requirements against available hardware
   - Provisions engine + model before launching applet UI
   - IPC bridge: applet communicates with shell via Tauri commands

---

## Applet Contract

Every applet ships a declarative manifest at its root. The shell reads this
manifest to understand what the applet needs before launching it.

### Manifest Schema (applet.toml)

```toml
[applet]
id = "1magen"
name = "1magen"
version = "0.1.0"
description = "Local AI image generation and editing"
icon = "icons/1magen.png"
transport = "tauri"         # "tauri" | "web" | "hybrid"

[engine]
type = "diffusion"          # "diffusion" | "llm" | "audio" | "custom"
backend = "ffi"             # "ffi" (in-process) | "server" (sidecar)
server_binary = ""          # only if backend = "server"

[[models]]
key = "z-image-turbo-q4km"
role = "primary"            # "primary" | "encoder" | "vae" | "lora"
required = true
vram_mb = 4800

[[models]]
key = "qwen3-4b-encoder-q4"
role = "encoder"
required = true
vram_mb = 2400

[[models]]
key = "pig-flux-vae"
role = "vae"
required = true
vram_mb = 200

[requirements]
min_vram_mb = 7400          # sum of all required models
recommended_vram_mb = 10240
cuda_compute = "7.0"
```

### Applet Lifecycle

```
1. User clicks applet in shell
2. Shell reads applet.toml
3. Shell checks GPU: enough VRAM? correct compute capability?
4. Shell checks model registry: all required models downloaded?
   - If not: prompt download with progress UI
5. Shell loads models into VRAM (or starts engine server)
6. Shell launches applet UI
7. Applet calls inference via shell IPC (not directly)
8. On applet close: shell decides whether to keep models hot or evict
```

---

## Shared Crates

### model-manager

The model-manager crate extracts the pattern independently implemented in:
- 1magen: model_manager.rs (Z-Image GGUF manifest, HF download, SHA256)
- Kasai-Local: model download + verification logic
- s-gener8: ACE-Step model fetching

Unified interface:

```rust
use model_manager::{ModelManifest, ModelInfo};

let manifest = ModelManifest::from_file("applet.toml")?;
let missing = manifest.check_available(&registry)?;
for model in missing {
    registry.download(&model, |progress| {
        emit_progress(progress);
    }).await?;
}
```

### ew-vault

Hybrid search for local knowledge. Combines:
- Tantivy: BM25 full-text indexing
- LanceDB: vector similarity (embeddings from local model via llama-server)
- Reciprocal rank fusion for result merging

Used by: Kasai (RAG retrieval), Mymories (knowledge search)

### mait

Trait-shard personality engine. Each AI agent is composed of trait shards:
- Tone shards: formal, casual, technical, poetic
- Domain shards: blockchain, music, visual arts, code
- Behaviour shards: response length, question-asking, assumption-challenging
- Boundary shards: what the agent will/won't do

Composable, versionable, JSON-serializable.
Used by: Kasai (agent personality), Strands Game (NPC personalities)

---

## Shared Packages (TypeScript)

### @everywear/ewds

Everywear Design System v1.0. Three skins (Classic, Refined, Terminal),
three accent colours (Signal, Amber, Plasma), dark mode. All theming via
CSS custom properties cascading from body[data-skin][data-mode].

Exports: tokens.css, ThemeProvider, useTheme hook, shared UI components.

Already implemented in 1magen and s3studio-web. This package canonicalises
the tokens so both apps import from one source.

### @everywear/transport

Abstracts the difference between Tauri IPC (invoke) and WebSocket/HTTP.
Applets write transport-agnostic code:

```typescript
const t = createTransport({ mode: 'tauri' });
const result = await t.call('generate_image', { prompt, width, height });
```

Tauri applets (1magen, 3nvizen, Kasai) use invoke mode.
Web applets (S3 Studio, Strands Game) use WebSocket mode.

### @everywear/shared

Common types mirroring Rust crate types (ModelInfo, GpuInfo, ProgressEvent),
shared constants (default ports, VRAM thresholds), and utility functions.

---

## Engines (Native Binaries)

The engines/ directory holds build instructions and (gitignored) compiled
binaries for the inference servers.

| Engine | Source | Consumers | Protocol |
|--------|--------|-----------|----------|
| sd-server | stable-diffusion.cpp | 1magen, 3nvizen, AI Director | HTTP :8090 |
| ace-server | ACE-Step | S3 Studio Gener8 | HTTP :8082 |
| llama-server | llama.cpp | Kasai, Mymories | HTTP :8080 |

Alternative: applets can skip the server and link the Rust FFI crate directly
(diffusion-rs for images, llama-cpp-2 for LLM). Trade-off: FFI is faster
(no HTTP overhead) but locks the GPU to that process. Server mode allows
multiple applets to share one engine instance.

---

## Evidence: Shared Patterns Across Existing Codebases

Three codebases independently implement the same infrastructure:

| Concern | Kasai-Local | 1magen | s-gener8 / S3 Studio |
|---------|-------------|--------|----------------------|
| GPU detect | nvml-wrapper | planned | planned |
| Model manifest | hardcoded LLM list | Z-Image GGUF manifest | ACE-Step model list |
| GGUF discovery | LM Studio, Ollama scan | Same + HF Hub, GPT4All | Not yet |
| Download + verify | reqwest + SHA256 | reqwest + SHA256 + progress | reqwest (no verify) |
| Engine lifecycle | llama-cpp-2 FFI | diffusion-rs FFI | ace-server HTTP |
| VRAM budget | manual check | manual check | none |

Every row is duplicated logic. The platform crates (model-manager, ew-vault)
and the shell (VRAM arbiter, engine pool) collapse all of this into shared
infrastructure. Each new applet becomes a UI + manifest, nothing more.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Shell binary | Tauri 2 + Rust |
| Applet binaries | Tauri 2 + Rust (desktop) or Next.js/Vite (web) |
| Image inference | diffusion-rs (FFI) or sd-server (HTTP) |
| LLM inference | llama-cpp-2 (FFI) or llama-server (HTTP) |
| Music inference | ace-server (HTTP) |
| GPU detection | nvml-wrapper |
| Model management | model-manager crate |
| Search/RAG | ew-vault (Tantivy + LanceDB) |
| Design system | EWDS v1.0 (CSS custom properties) |
| Frontend | React 18 + TypeScript |
| Build | Vite 5 (frontend) + Cargo workspace (Rust) |
| Deployment | Vercel (web apps), Tauri bundler (desktop) |

---

## Security Model

1. SHA256 Trust Layer
   - Every model file verified against known hash before loading
   - Manifest embeds expected hashes from HuggingFace API
   - Tampered files rejected with user-visible error
   - Re-download offered automatically on hash mismatch

2. Process Isolation
   - Each engine server runs as a child process of the shell
   - Applet UIs run in Tauri webview (sandboxed)
   - No applet can directly exec system commands
   - Shell scope in tauri.conf.json restricts allowed binaries

3. Network Scope
   - Only outbound: HuggingFace (model downloads), Vercel (web apps)
   - No telemetry, no cloud inference, no data exfiltration
   - All inference runs locally on user hardware

---

## Applet Inventory

| Applet | Type | Engine | Status |
|--------|------|--------|--------|
| 1magen | Tauri | diffusion-rs (FFI) | Scaffolded |
| 3nvizen | Tauri | sd-server (Wan 2.2 / LTX) | Planned |
| Kasai | Tauri | llama-cpp-2 (FFI) | In progress (Kasai-Local) |
| S3 Studio | Web | ace-server (HTTP) | Active (s3studio.xyz) |
| Mymories | Tauri | llama-cpp-2 + ew-vault | Planned |
| Strands Game | Web | none (Three.js) | Active (game.strandsnation.xyz) |

---

## Next Steps

1. ~~Implement platform/everywear-os shell with GPU detect + model registry~~ DONE (2026-05-08)
2. Extract model-manager crate from 1magen's model_manager.rs
3. Port EWDS tokens from 1magen into packages/ewds as canonical source
4. Define applet.toml schema and parser
5. Build VRAM arbiter with LRU eviction
6. Wire first end-to-end flow: shell launches 1magen, manages its models
7. Add Metal backend variant for macOS Apple Silicon
8. npm install + first Tauri dev build of everywear-os

---

## Addendum 2026-05-17: Canonical 1magen Runtime

`1magen` is now canonically a `Z-Image` applet.

The important distinction is:

- model family choice: fixed to `Z-Image`
- model tier choice: selected by VRAM gating

So the current `1magen` image stack is:

- `z_image_turbo-Q8_0.gguf` or `z_image_turbo-Q4_K.gguf`
- `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`
- `diffusion_pytorch_model.safetensors`

This means `1magen` must not drift into a mixed patch identity. Product-canonical rule:

- `1magen` uses `Z-Image`
- `1magen` style patches must explicitly work with `Z-Image`
- if a patch is not explicitly `Z-Image` compatible, it is not a valid `1magen` patch

## Addendum 2026-05-17: Runtime Lane vs Training Lane

`1magen` inference and future `Style Forge` training should be treated as two different lanes.

### Runtime lane

- direct local applet execution
- GGUF-oriented lightweight inference
- shell/app-level provisioning

### Training lane

- managed Python sidecar
- `uv` environment management
- full `safetensors` Z-Image assets
- LoRA training via open tooling

Training should not be performed against the GGUF runtime artifacts.

The current best-fit open path for `Z-Image-Turbo` patch training is:

- `Tongyi-MAI/Z-Image-Turbo`
- `ostris/ai-toolkit`
- `ostris/zimage_turbo_training_adapter`
- optional `DiffSynth-Studio/Z-Image-Turbo-DistillPatch` during patched inference if preserving turbo behaviour matters

## Addendum 2026-05-17: Local Style Forge Feasibility

Local style-patch training looks viable on sufficiently capable machines.

Practical guidance:

- `12 GB VRAM`: possible for smaller style LoRAs with careful settings
- `24 GB VRAM`: recommended floor for a user-friendly local training workflow
- `32 GB+`: comfortable

Reasonable first-pass jobs:

- `20-100` clean images
- `800-3000` steps
- rank `8-32`
- batch size `1`
- resolutions around `512`, `768`, or `1024` depending on VRAM tier

This should become a guided Everywear feature later under `Style Forge`, not a raw trainer exposed directly to casual users.

## Addendum 2026-05-17: Current Reality Check

As of this date:

- `1magen` base text-to-image is working locally end to end
- automatic provisioning works
- checksum verification works
- output preview works
- output save works
- optional source-image mode is exposed in the UI
- the resolution picker has been simplified to a dropdown
- placeholder `Style Patch (LoRA)` and `Task Shard (Workflow)` surfaces are now present in the UI

`3nvizen` is scaffolded as:

- a real applet manifest
- a segment-chain contract
- a managed `uv` Python sidecar scaffold for the LTX runtime

The shared Everywear-wide model tree has not yet been implemented. `1magen` still stores models in its own app-local roaming-data path for now.
