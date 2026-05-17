<p align="center">
  <img src="https://everywear.id/logo.svg" alt="Everywear OS" width="120" />
</p>

<h1 align="center">Everywear OS</h1>

<p align="center">
  <strong>The operating system for local AI.</strong><br/>
  One desktop. Every model. Your GPU. No cloud required.
</p>

<p align="center">
  <a href="https://everywear.id">everywear.id</a> · 
  <a href="https://strandsnation.xyz">Strands Nation</a> · 
  <a href="https://s3studio.xyz">S3 Studio</a> · 
  <a href="https://metafintek.xyz">Metafintek</a>
</p>

---

## What is Everywear OS?

Everywear OS is a Rust-native desktop platform that turns your GPU into a personal AI studio. It handles hardware detection, model management, VRAM arbitration, and inference engine lifecycle so that applications ("applets") are thin creative interfaces with declarative resource manifests.

Think of it as **Steam for AI apps**: install once, launch anything, and let the platform handle the plumbing.

Built by [PT Metafintek AI Studios](https://metafintek.xyz) from Lombok, Indonesia.

---

## Philosophy

**Sovereignty over convenience.** Every model runs on your hardware. Every file stays on your disk. There is no API key between you and your work.

**The GPU is a shared resource, not a locked room.** Everywear arbitrates VRAM across multiple running applets the way an OS arbitrates RAM across processes. Load an image model in 1magen, switch to Kasai for text, come back; the shell manages eviction, preemption, and reloading transparently.

**Applets declare; the shell provides.** An applet never touches the GPU directly. It ships a manifest describing what models it needs, at what quantisation, for what VRAM budget. The shell reads the manifest, provisions the engine, and hands the applet a ready-to-use inference channel. This means a new applet can ship in days, not months.

**Licence tiers unlock capability, not access.** Every user gets the full shell and the demo tier. Paid tiers unlock higher-fidelity models and professional features via upgrade packs; the architecture enforces this through HMAC-signed tier sync between the hub (Supabase), the shell, and each applet. No DRM. No phoning home. Cryptographic proof of entitlement, verified locally.

---

## Architecture

```
Everywear OS
├── platform/everywear-os/     Tauri shell: GPU detect, model registry,
│                               VRAM arbiter, applet launcher, auth gate
├── applets/
│   ├── 1magen/                Image generation + editing (diffusion-rs)
│   ├── 3nvizen/               Video generation (Wan 2.2 / LTX)
│   ├── gener8/                Music generation (ACE-Step)
│   ├── kasai/                 Local AI agent (llama.cpp)
│   ├── mymories/              Memory + knowledge vault
│   ├── s3studio/              Strands Sound Studio (web)
│   └── strands-game/          The game (Three.js)
├── crates/                    Shared Rust workspace
│   ├── applet-ipc/            IPC protocol (envelope v2 + legacy)
│   ├── model-manager/         GGUF discovery, download, SHA256, symlinks
│   ├── data-migration/        Schema migration engine
│   ├── everywear-paths/       Cross-platform path resolution
│   ├── vault/                 LanceDB + Tantivy hybrid search
│   ├── beats-engine/          Audio/rhythm processing
│   ├── mait/                  Trait-shard personality engine
│   └── video-encoder/         Video encoding pipeline
├── engines/                   Native inference sidecars
│   ├── sd-server/             stable-diffusion.cpp
│   ├── ace-server/            ACE-Step
│   └── llama-server/          llama.cpp
└── packages/                  Shared TypeScript
    ├── ewds/                  Design system (tokens + components)
    ├── transport/             Tauri IPC / WebSocket abstraction
    └── shared/                Common utils + types
```

### The Shell

The shell is the single process that owns your hardware. It:

- **Detects compute** across three tiers: CUDA (NVIDIA via NVML), Vulkan (AMD/Intel), CPU fallback
- **Classifies VRAM** into budgets: Ultra (24GB+), Standard (16-23GB), Constrained (12-15GB), Minimal (8-11GB)
- **Manages models** through a unified cache at `~/.everywear/models/`, with discovery across LM Studio, Ollama, HuggingFace Hub, and GPT4All before downloading anything
- **Arbitrates VRAM** with LRU eviction, priority weights, and a hard 90% utilisation ceiling
- **Authenticates users** via Supabase (email OTP or password), syncs licence tier to applets over HMAC-signed IPC
- **Launches applets** by reading their `applet.toml` manifest, provisioning engines and models, then spawning the process with an IPC channel

### IPC Protocol

Shell-to-applet communication runs over TCP on localhost with two protocol modes:

- **Legacy (v1):** Newline-delimited JSON `Command`/`Response` pairs. Backward compatible with standalone applets.
- **Envelope (v2):** All messages wrapped in `IpcEnvelope` with UUID correlation, sequence numbers, source tagging, and HMAC-SHA256 authentication. Supports async events, heartbeats, capability advertisement, and tier sync.

A per-launch shared secret (`EVERYWEAR_IPC_SECRET`) is generated by the shell and injected into each applet's environment. Applets that cannot verify the secret refuse to start.

### Licence Tier Enforcement

Defence-in-depth, three layers:

1. **Hub (Supabase)** is the single writer of tier state via the `active_tier()` RPC
2. **Shell** syncs tier on auth hydration, gates applet launches by manifest requirements
3. **Applets** enforce tier internally via HMAC-verified `TierSync` messages from the shell

No applet trusts its own tier claim. No applet trusts the shell's claim without cryptographic verification.

---

## Applets

| Applet | Domain | What it does |
|--------|--------|-------------|
| **1magen** | Image | Local Stable Diffusion: txt2img, img2img, inpainting, ControlNet. FFI-linked diffusion-rs, no sidecar overhead. |
| **3nvizen** | Video | Wan 2.2 and LTX video generation. Text-to-video, image-to-video, interpolation. |
| **Gener8** | Music | ACE-Step music generation with DAW integration, stem separation, style transfer, and AI director for multi-engine render sequences. |
| **Kasai** | Agent | Local LLM agent running llama.cpp. Planning, tool use, memory, personality via trait shards. |
| **Mymories** | Knowledge | Personal memory vault with hybrid search (vector + full-text) over LanceDB and Tantivy. |
| **S3 Studio** | Web | Strands Sound Studio at s3studio.xyz. Web-based music creation interface. |
| **Strands Game** | Game | The Strands Nation game world. Three.js desktop OS at game.strandsnation.xyz. |

---

## Tech Stack

**Shell:** Rust + Tauri v2, React 18, TypeScript, Vite

**Inference:** diffusion-rs (FFI), llama-cpp-2, ACE-Step, stable-diffusion.cpp, Wan 2.2

**Auth:** Supabase (Tokyo region), email OTP + password, JWT with unverified parse (Phase 1), JWKS verification planned (Phase 2)

**Design System:** EWDS v1.0 (custom CSS properties, dark theme, tier-aware colour system)

**IPC:** TCP localhost, newline-delimited JSON, HMAC-SHA256 envelope authentication

**Search:** LanceDB (vector) + Tantivy (full-text) hybrid

---

## Getting Started

### Prerequisites

- Windows 10/11 or Linux (macOS CPU-only planned)
- NVIDIA GPU with 8GB+ VRAM recommended (CUDA 11.8+)
- Rust 1.77+ and Node.js 20+
- Tauri v2 CLI: `cargo install tauri-cli`

### Build

```bash
# Clone
git clone https://github.com/BAIS1C/project-everywear.git
cd project-everywear

# Install frontend dependencies
npm install

# Build the shell
cd platform/everywear-os
npm install
cargo tauri build

# Build an applet (e.g. 1magen)
cd ../../applets/1magen
npm install
cargo tauri build
```

### Development

```bash
# Shell dev mode (hot reload)
cd platform/everywear-os
cargo tauri dev

# Applet dev mode (standalone, no shell)
cd applets/1magen
cargo tauri dev
```

---

## Project Structure

| Path | Language | Purpose |
|------|----------|---------|
| `platform/everywear-os/src-tauri/` | Rust | Shell backend: GPU, models, VRAM, launcher, auth |
| `platform/everywear-os/src/` | TypeScript/React | Shell frontend: login, launcher grid, panels |
| `applets/*/src-tauri/` | Rust | Applet backends |
| `applets/*/src/` or `applets/*/web/` | TypeScript/React | Applet frontends |
| `crates/` | Rust | Shared workspace crates |
| `engines/` | C/C++ (prebuilt) | Inference engine sidecars |
| `packages/` | TypeScript | Shared frontend packages |

---

## Entity

**PT Metafintek AI Studios**
Lombok, Indonesia
[metafintek.xyz](https://metafintek.xyz)

In formation: **somokasane Pte. Ltd.** (Singapore)

---

## Licence

This project is released under the [Metafintek Source-Available Licence v1.0](./LICENCE.md).

You may view the source for reference, study, or security auditing. Commercial use, redistribution, and derivative works require written permission from PT Metafintek AI Studios. See `LICENCE.md` for full terms.

For commercial licensing enquiries: **legal@metafintek.xyz**
