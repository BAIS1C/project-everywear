# Third-Party Notices

Everywear OS is proprietary software by PT Metafintek AI Studios, licensed
under the [Metafintek Source-Available Licence v1.0](./LICENCE.md). That
licence covers ONLY first-party code and assets. Everywear is built on, and
orchestrates, third-party open-source software and AI models that remain
under their own licences at all times. Nothing in the Metafintek licence
restricts, modifies, or supersedes the upstream terms of the components
listed here.

Last reviewed: 2026-06-07 (SGT). Licences below reflect upstream defaults at
time of writing; the model card or upstream LICENSE file shipped with each
component is always authoritative. This document is informational and not
legal advice; verify obligations with counsel before redistribution.

---

## 1. AI models

Models are NOT redistributed in this repository. The shell downloads weights
at install or first use, from the user's chosen sources (HuggingFace Hub,
LM Studio, Ollama caches, or local files), and the user accepts the model's
licence at download time. GGUF and other quantised conversions inherit the
licence of their base model.

| Model family | Used by | Upstream licence | Notes |
|---|---|---|---|
| Qwen (LLM family) | My Mait (orchestrator/agent slots) | Apache-2.0 (per model card) | Verify per released size/variant; the model card shipped with each download governs. |
| ACE-Step (music generation) | Gener8 / S3 Studio | Apache-2.0 | Model and reference code. |
| Wan (video generation) | 3nvizen | Apache-2.0 (per model card) | |
| LTX-Video (video generation) | 3nvizen | Lightricks LTX-Video licence | Community licence with its own commercial-use terms; read the model card before any commercial deployment. |
| Stable Diffusion family (image generation) | 1magen | CreativeML OpenRAIL-M / Stability AI Community Licence (varies by model) | Licence differs per checkpoint generation; the checkpoint's own card governs. Use-based restrictions in OpenRAIL apply to outputs workflows. |
| User-supplied / community GGUF checkpoints | Any applet via model discovery | Inherits base model licence | Everywear's discovery of a local file does not change its licence. |

Tier gating in Everywear controls WHICH models the shell provisions for a
given licence tier. It does not and cannot relicense the models themselves.

## 2. Inference engines and media pipeline

| Component | Used by | Upstream licence | Notes |
|---|---|---|---|
| llama.cpp / llama-cpp-2 | My Mait runtime | MIT | |
| stable-diffusion.cpp | 1magen engine | MIT | |
| diffusion-rs | 1magen (FFI) | MIT / Apache-2.0 | |
| FFmpeg | Video encoder sidecar (NVENC export), media handling | LGPL-2.1-or-later; GPL-2.0-or-later if built with GPL components (e.g. libx264) | IMPORTANT: obligations depend on the exact ffmpeg build shipped or detected. An LGPL-only build with NVENC (nv-codec-headers, MIT) keeps proprietary linking simple; a GPL build does not. Pin and document the build before GA. |
| @ffmpeg/ffmpeg + @ffmpeg/core (WASM fallback) | Vid Studio in-browser export | MIT wrapper; FFmpeg core inside is LGPL/GPL per build | Same caveat as native FFmpeg. Fetched at runtime, not bundled. |

## 3. Frameworks and libraries (principal)

| Component | Upstream licence |
|---|---|
| Tauri v2 | MIT / Apache-2.0 |
| React 18 | MIT |
| Vite | MIT |
| Three.js | MIT |
| Tantivy (full-text search) | MIT |
| LanceDB (vector search) | Apache-2.0 |
| Supabase client libraries | MIT |
| Rust crate dependencies (workspace) | Predominantly MIT / Apache-2.0 dual; see `cargo license` output |
| npm dependencies | See each package's LICENSE; predominantly MIT |

A full machine-generated inventory (`cargo license`, `license-checker` for
npm) should be regenerated and attached to each release artifact. That
generated inventory, not this summary, is the complete record.

## 4. Copyleft hygiene rules (binding on contributors and agents)

1. No GPL/AGPL code may be statically linked into, or copied into,
   first-party crates or packages. GPL-family components run as separate
   processes (sidecars) communicating over IPC, as FFmpeg does today.
2. LGPL components are used unmodified as dynamically loaded/separate
   binaries; any modification to an LGPL component must be published per its
   licence.
3. Model weights never enter the git repository.
4. Attribution notices in vendored third-party source (e.g. the vendored
   Avatar Studio frontend lineage) must not be removed.
5. Before any public release: regenerate the dependency inventory, re-verify
   the FFmpeg build flavour, and re-read the LTX and Stable Diffusion model
   cards in force at that date.
