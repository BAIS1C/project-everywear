<p align="center">
  <img src="https://everywear.id/logo.svg" alt="Everywear OS" width="120" />
</p>

<h1 align="center">Everywear OS</h1>

<p align="center">
  <strong>The operating system for local AI.</strong><br/>
  One desktop. Every model. Your GPU. No cloud required.
</p>

<p align="center">
  <a href="https://everywear.id"><img src="https://img.shields.io/badge/web-everywear.id-00e5ff?style=flat-square" alt="everywear.id" /></a>
  <img src="https://img.shields.io/badge/status-pre--GA%20beta-amber?style=flat-square" alt="pre-GA" />
  <img src="https://img.shields.io/badge/shell-Rust%20%2B%20Tauri%20v2-orange?style=flat-square" alt="Rust + Tauri" />
  <img src="https://img.shields.io/badge/inference-100%25%20local-success?style=flat-square" alt="local inference" />
  <img src="https://img.shields.io/badge/licence-Metafintek%20Source--Available-blue?style=flat-square" alt="licence" />
</p>

<p align="center">
  <a href="https://everywear.id">everywear.id</a> ·
  <a href="https://strandsnation.xyz">Strands Nation</a> ·
  <a href="https://s3studio.xyz">S3 Studio</a> ·
  <a href="https://metafintek.xyz">Metafintek</a>
</p>

---

## What is Everywear OS?

Everywear OS is a Rust-native desktop platform that turns your GPU into a
personal AI studio. The shell owns hardware detection, model management,
VRAM arbitration, entitlements, and inference engine lifecycle, so that
applications ("applets") stay thin creative surfaces with declarative
resource manifests.

Think of it as **an operating system for AI apps**: install once, launch
anything, and let the platform handle the plumbing. The end-state is a
desktop you leave running instead of Windows.

Built by [PT Metafintek AI Studios](https://metafintek.xyz), Lombok, Indonesia.

---

## Philosophy

**Sovereignty over convenience.** Every model runs on your hardware. Every
file stays on your disk. There is no API key between you and your work, and
no runtime CDN between you and your apps. Assets, models, and your vault are
local by doctrine, not by accident.

**The GPU is a shared resource, not a locked room.** Everywear arbitrates
VRAM across applets the way an OS arbitrates RAM across processes: budgets,
priority weights, LRU eviction, deterministic purge on applet switch. Models
load when their applet is active and unload when it is not.

**Applets declare; the shell provides.** An applet never touches the GPU
directly. It ships an `applet.toml` describing the models it needs, at what
quantisation, within what VRAM budget. The shell assesses, provisions with a
visible install receipt, then hands the applet a ready inference channel.

**Status tells the truth.** A surface that is offline, asset-broken, or
unmounted says so. READY means ready.

**Licence tiers unlock capability, not access.** Every user gets the full
shell and the demo tier. Paid tiers unlock higher-fidelity models and pro
features via upgrade packs, enforced through HMAC-signed tier sync between
hub (Supabase), shell, and applet. No DRM, no phoning home: cryptographic
proof of entitlement, verified locally.

---

## The Surface

| Applet | Domain | What it does |
|--------|--------|--------------|
| **My Mait** | Companion | Your local AI agent: chat, tools, memory, skills, model management. Runs Qwen-family models on llama.cpp with orchestrator/agent slot swapping. Knows it is local, because it is. |
| **Gener8 4ever / Gener8 Pro** | Music | ACE-Step music generation: full songs from text, reference and cover modes, Pro model packs. |
| **Vid Studio / Vid Studio Pro** | Video | Audio-reactive visualizers and video export from your songs. NVENC-accelerated export through the shared encoder sidecar, WASM fallback in-browser. |
| **AI Director** | Music video | Multi-engine render sequencing on the Gener8 chassis. |
| **DAW** | Audio | Stem separation and arrangement tools on your generated songs. |
| **1magen** | Image | Local diffusion: txt2img, img2img, editing. Desktop-level applet. |
| **3nvizen** | Video gen | Wan / LTX text-to-video and image-to-video. Desktop-level applet. |
| **Avatar Studio** | Identity | Character and avatar creation; feeds My Mait companion presence. Assets fully local. |
| **Educ8** | Education | Offline-first home education: curricula, lesson planning, local AI tutor, downloadable content packs with explicit plan/accept controls. |
| **Layer U** | OSINT | Free-tier open-source intelligence layer powered by Project SON. |
| **Vault** | Library | Your media and knowledge vault at `Documents/Everywear Vault`: hybrid vector + full-text search over everything you make. |
| **Strands Nation** | World | The Strands game world, embedded live from strandsnation.xyz. |

---

## Architecture

```
Everywear OS
├── platform/everywear-os/     Tauri shell: GPU detect, registry, VRAM
│                              arbiter, launcher, auth gate, encoder sidecar
├── applets/
│   ├── 1magen/                Image generation (diffusion-rs FFI)
│   ├── 3nvizen/               Video generation (Wan / LTX)
│   ├── gener8/                Music chassis: Gener8, Vid, AI Director, DAW
│   ├── kasai/                 My Mait agent (llama.cpp, slot manager)
│   ├── character-studio/      Avatar Studio (local asset doctrine)
│   └── educ8/                 Knowledge engine (wire id: loom)
├── crates/                    Shared Rust workspace
│   ├── applet-ipc/            IPC protocol (envelope v2 + legacy)
│   ├── model-manager/         GGUF discovery, download, SHA256, resolver
│   ├── vault/                 LanceDB + Tantivy hybrid search
│   ├── everywear-paths/       Canonical local paths (~/.everywear, vault)
│   ├── mait/                  Trait-shard personality engine
│   └── video-encoder/         NVENC sidecar lifecycle
├── engines/                   Native inference sidecars
│   ├── sd-server/             stable-diffusion.cpp
│   ├── ace-server/            ACE-Step
│   └── llama-server/          llama.cpp
└── packages/                  Shared TypeScript
    ├── ewds/                  Design system (EWDS v2: skins, accents, bevels)
    ├── video-modal/           Shared render/export modal
    ├── transport/             Tauri IPC / WebSocket abstraction
    └── shared/                Common utils, logging, types
```

### The Shell

The single process that owns your hardware:

- **Detects compute** across three tiers: CUDA (NVIDIA via NVML), Vulkan (AMD/Intel), CPU fallback
- **Classifies VRAM** into budgets: Ultra (24GB+), Standard (16-23GB), Constrained (12-15GB), Minimal (8-11GB)
- **Manages models** through a unified cache at `~/.everywear/models/`, discovering existing weights across LM Studio, Ollama, and HuggingFace caches before downloading anything
- **Arbitrates VRAM** with LRU eviction, priority weights, and a hard utilisation ceiling; one active S3 suite applet at a time
- **Owns shared services**: the NVENC video-encoder sidecar (acquire/release, boots on first consumer), bug-report capture with a local-only save path, applet health and status truth
- **Authenticates** via Supabase and syncs licence tier to applets over HMAC-signed IPC

### IPC

Shell-to-applet communication over localhost TCP, two modes: legacy
newline-JSON (v1) and `IpcEnvelope` (v2) with UUID correlation, sequence
numbers, HMAC-SHA256 authentication, async events, heartbeats, and tier
sync. A per-launch shared secret is injected into each applet's
environment; applets that cannot verify it refuse to start.

### Entitlements

Defence-in-depth, three layers: the hub (Supabase) is the single writer of
tier state; the shell gates launches by manifest requirements; applets
verify HMAC-signed `TierSync` internally. No applet trusts its own tier
claim.

---

## Getting Started

### Prerequisites

- Windows 10/11 (Linux planned; macOS CPU-only planned)
- NVIDIA GPU with 8GB+ VRAM recommended (CUDA 11.8+); Vulkan and CPU fallbacks exist
- Rust 1.77+, Node.js 20+, Tauri v2 CLI (`cargo install tauri-cli`)

### Build

```bash
git clone <repo> project-everywear
cd project-everywear
npm install

# Shell
cd platform/everywear-os
npm install
cargo tauri build
```

### Development

```bash
# Shell dev mode (hot reload)
cd platform/everywear-os
cargo tauri dev
```

Applets are launched BY the shell (they need the shell's IPC environment;
`gener8.exe` exits without `EVERYWEAR_CMD_PORT`). For applet UI work, use
the shell dev server and the inline applet routes.

Contributors and agents: read `WIKI.md` before touching code. Wiki-first
editing is enforced; see `AGENTS.md` and `CONTEXT.md` for the working
protocol, and `CHANGELOG.md` for release history.

---

## Licensing

Everywear uses a two-layer licensing model. The short version: **our code
is commercial, their code is theirs.**

### First-party (Metafintek)

All first-party source, applets, the EWDS design system, branding, and
product names are Copyright (c) 2025-2026 PT Metafintek AI Studios, released
under the [Metafintek Source-Available Licence v1.0](./LICENCE.md): view for
reference, study, and security audit; commercial use, redistribution, and
derivative works require written permission.

Commercial licensing, OEM embedding, derivative works: **legal@metafintek.xyz**

### Third-party (their own licences, always)

Everywear orchestrates open-source engines and AI models. Those remain
under their own licences, which the Metafintek licence does not and cannot
override:

| Layer | Examples | Licence |
|---|---|---|
| AI models | Qwen, ACE-Step, Wan (Apache-2.0); LTX-Video (Lightricks licence); Stable Diffusion family (OpenRAIL-M / Stability Community) | Per model card, accepted at download |
| Engines | llama.cpp, stable-diffusion.cpp (MIT); diffusion-rs (MIT/Apache-2.0) | Upstream |
| Media | FFmpeg (LGPL/GPL per build; runs as a separate sidecar process) | Upstream |
| Frameworks | Tauri, React, Vite, Three.js (MIT/Apache-2.0) | Upstream |

Model weights are never redistributed in this repository; the shell
downloads them at install or first use and the user accepts each model's
licence at that point. Full component-by-component detail, including the
FFmpeg build caveat and copyleft hygiene rules, lives in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

---

## Entity

**PT Metafintek AI Studios**, Lombok, Indonesia · [metafintek.xyz](https://metafintek.xyz)
In formation: **somokasane Pte. Ltd.**, Singapore

<p align="center">
  <sub>Local-first by doctrine. Built on an island, runs on yours.</sub>
</p>
