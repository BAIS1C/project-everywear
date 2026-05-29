# Everywear Architecture Note

**Date:** 2026-05-15
**Status:** Draft direction note
**Purpose:** Capture the current product and platform direction for migrating the Strands / S3 ecosystem into Everywear without losing the standalone wedge that already exists.

---

## 1. Core Decision

Everywear becomes the long-term platform shell and install surface for the ecosystem.

Standalone `S3 Studio` and its current `Gener8` / `Gener8 Pro` beta products continue to exist as the wedge in the near term, but the strategic direction is:

1. New users should increasingly be directed to install `Everywear` first.
2. Inside `Everywear`, users install applets / bundles rather than separate standalone products.
3. Existing standalone users should eventually be migrated into Everywear with as little friction as possible.

The key principle is:

`Everywear` is the product surface.
Applet graphs, models, engines, and orchestration dependencies are platform concerns.

Users should understand products. Everywear should understand components.

---

## 2. Product Strategy

The platform should separate:

- user-facing products
- internal runtime components

These are not the same thing.

### 2.1 User-facing products

The current working product direction is:

- `Gener8 Free`
  Music generation wedge. Free, email registration only.
- `Studio Pro`
  Paid music production tier.
- `Creator Pro`
  Paid multimodal creator tier.
- `Kasai Full`
  Standalone flagship local agent product.

### 2.2 Internal runtime components

These may exist as real Everywear applets or services without all being sold independently:

- `Gener8`
- `Vid Studio`
- `AI Director`
- `1magen`
- `3nvizen`
- `Kasai Lite`
- `Kasai Full`
- `Stem Separation`
- `DAW`
- `Style Forge`
- `Style Patch`

The platform must allow a runtime component to be:

- a standalone product
- a bundled product dependency
- a hidden service dependency
- a shared engine used by multiple products

---

## 3. Bundle Positioning

### 3.1 Gener8 Free

Recommended position:

- free wedge
- email registration only
- includes `Gener8`
- may include `Vid Studio` in limited form
- watermark and/or capped export quality

Purpose:

- low-friction acquisition
- hardware discovery
- ecosystem entrypoint
- migration path into paid Everywear bundles later

### 3.2 Studio Pro

Recommended position:

- music-focused paid tier
- for users whose core need is music generation and production finishing

Suggested included surfaces:

- `Gener8 Pro`
- `Vid Studio Pro`
- `Stem Separation`
- `DAW`
- `Style Forge`
- `Style Patch`

### 3.3 Creator Pro

Recommended position:

- multimodal creation bundle
- should feel like the “full creator workstation” tier

Included user-visible capabilities:

- `AI Director`
- `1magen`
- `3nvizen`
- credit path to larger cloud models where local hardware is insufficient

Included hidden runtime dependency:

- `Kasai Lite`

Important rule:

Users buy `Creator Pro`.
Users do not separately buy or reason about `Kasai Lite`.

### 3.4 Kasai Full

`Kasai Full` should remain a first-class standalone product.

Reason:

- it is independently valuable
- it should not be framed as only a support subsystem for Creator
- it can serve a distinct buyer persona: agent / operator / assistant users

The presence of `Kasai Lite` inside `Creator Pro` must not weaken the identity of `Kasai Full`.

---

## 4. Kasai Split

### 4.1 Kasai Lite

`Kasai Lite` is a runtime-grade orchestration dependency required by `AI Director`.

Its job is to:

- support local shot planning
- coordinate creator-side orchestration tasks
- replace the prior `Ollama` dependency for AI Director
- remain constrained to the Creator workflow

`Kasai Lite` should usually be hidden from storefront-level user choice.

Possible user-facing wording:

- “Built-in local orchestration”
- “AI Director local runtime”
- “Creator orchestration engine”

Avoid making users compare `Kasai Lite` vs `Kasai Full` during initial purchase.

### 4.2 Kasai Full

`Kasai Full` is the standalone agent product.

It can later expose:

- richer UI
- broader tools
- local memory / retrieval
- bigger local models
- system workflows
- optional personal-cloud deployment

Design rule:

- `Kasai Lite` is dependency-tier
- `Kasai Full` is product-tier

---

## 5. Product-to-Component Mapping

### 5.1 Intended mapping

| User-facing product | Visible capabilities | Hidden/runtime dependencies |
|---|---|---|
| `Gener8 Free` | `Gener8`, limited `Vid Studio` | music models, video-lite models, shared shell services |
| `Studio Pro` | `Gener8 Pro`, `Vid Studio Pro`, `Stem Separation`, `DAW`, `Style Forge`, `Style Patch` | audio engines, model packs, shared shell services |
| `Creator Pro` | `AI Director`, `1magen`, `3nvizen` | `Kasai Lite`, image/video models, orchestration runtime, optional cloud fallbacks |
| `Kasai Full` | full local agent product | LLM models, retrieval, memory, tool adapters |

### 5.2 Important interpretation

This means:

- `1magen` and `3nvizen` can stay modular applets in the platform
- they do not need to launch as separate paid SKUs
- `Creator Pro` can bundle them automatically
- `Kasai Full` can still be sold and installed independently

---

## 6. Migration from Standalone S3 Studio

**Current implementation constraint, 2026-05-22:** the commercial migration
direction below does not permit direct code migration of S3 Studio web
monoliths. S3 Studio web informs S3-derived applet behaviour. Everywear OS may
borrow its base desktop visual language, but the platform shell keeps its own
architecture. Before further Gener8 / Studio Pro / Vid behaviour is migrated,
the migration-touch Everywear files over the context budget must be split or
hoisted per `ARCHITECTURE_MODULES_2026-05-21.md`.

### 6.1 Near-term

Keep standalone `S3 Studio` alive as the wedge while Everywear matures.

This is especially important because:

- `Gener8` and `Gener8 Pro` already exist as beta software
- the wedge is already working
- immediate forced migration would create unnecessary friction

### 6.2 Mid-term

Shift the center of gravity:

1. New marketing points to `Everywear`.
2. `Gener8`, `Studio Pro`, and `Creator Pro` become installs inside Everywear.
3. Standalone builds remain supported for a transition period.

### 6.3 Migration expectations

Everywear should eventually support:

- entitlement sync
- model reuse where possible
- content/library import
- settings import
- clear “move into Everywear” messaging

The migration path should feel like an upgrade, not a product discontinuity.

---

## 7. Platform Architecture Implication

The current Everywear manifest idea is not yet sufficient.

Today it mostly describes:

- one applet
- its engine type
- its model groups
- its hardware requirements

The next architecture needs to describe:

- user-facing bundles
- applet-to-applet dependencies
- hidden service dependencies
- model packs
- optional cloud fallbacks
- entitlement gates

In other words, the manifest system must evolve from:

`applet -> models`

to:

`product/app bundle -> applets/services -> models/engines -> fallback policies`

---

## 8. Manifest vNext Requirements

Everywear needs a manifest layer that can express at least the following.

### 8.1 Product bundle definition

Example concepts:

- product id
- display name
- entitlement tier
- installable applets
- hidden dependencies
- optional dependencies

### 8.2 Dependency kinds

Dependencies should not all be treated the same.

Needed kinds:

- visible bundled applet
- hidden service dependency
- shared engine dependency
- optional enhancement dependency
- cloud fallback dependency

### 8.3 Capability exposure

A product may expose one surface while depending on several hidden components.

Example:

- `Creator Pro` exposes `AI Director`
- bundles `1magen`
- bundles `3nvizen`
- silently installs `Kasai Lite`

### 8.4 Hardware policy

A bundle needs more than simple min VRAM.

It should also be able to express:

- hard floor
- quality tiers by hardware
- local fallback mode
- cloud/API fallback mode

### 8.5 Entitlement policy

A component may be:

- installed but locked
- installed and active
- required by another product but hidden from the storefront

---

## 9. Example Creator Pro Interpretation

The target platform understanding for `Creator Pro` should look something like this:

- Product: `Creator Pro`
- User-visible applets:
  - `AI Director`
  - `1magen`
  - `3nvizen`
- Hidden dependency:
  - `Kasai Lite`
- Required resources:
  - image generation models
  - video generation models
  - orchestration model
- Optional fallback:
  - API credits for larger models or insufficient local VRAM

The user experience should be:

1. User installs `Creator Pro`.
2. Everywear installs all required applets/services automatically.
3. Everywear provisions required models.
4. If local hardware is insufficient, Everywear offers the appropriate degraded mode or cloud path.

The user should not manually compose this graph.

---

## 10. Storefront Rule

A good operating rule for product design:

- if the user needs to open it, configure it, or think about it, it may be a product
- if it only exists to make another product work, it should usually be a dependency

Applied here:

- `Kasai Full` is a product
- `Kasai Lite` is a dependency
- `1magen` and `3nvizen` are modular applets and may remain hidden inside `Creator Pro` commercially, even if they are visible inside the installed workspace

---

## 11. Recommended Near-Term Decisions

These are the most stable decisions to work from now.

1. `Everywear` becomes the future install surface for the whole ecosystem.
2. Standalone `S3 Studio` remains the current wedge during transition.
3. `Creator Pro` includes `AI Director + 1magen + 3nvizen`.
4. `Kasai Lite` is a hidden required dependency of `AI Director`.
5. `Kasai Full` remains a standalone flagship product.
6. The manifest/runtime architecture must be extended to support bundles and hidden dependencies.

---

## 12. Open Questions

These are still strategic questions, not yet final decisions.

1. Whether `Vid Studio` belongs under `Gener8 Free`, `Studio Pro`, or both with different limits.
2. Whether `1magen` and `3nvizen` should ever later become separately purchasable products.
3. Whether `Kasai Full` cloud / personal-instance deployment is a separate SKU or an add-on to the main Kasai offer.
4. How aggressively to migrate existing standalone users into Everywear.
5. Whether the user-facing store should show applets individually, bundles only, or both.

---

## 13. Summary

The correct direction is not “sell every module separately.”

The correct direction is:

- modular runtime
- simple storefront
- hidden dependency support
- Everywear as the shell that resolves the graph

This preserves architectural flexibility while keeping the user experience understandable.

---

## 14. Creator Pro Local Video Direction

The local music-video path is now clearer.

`Creator Pro` should treat local video generation as a chained segment workflow, not as a single monolithic render.

Target sequence:

1. `Kasai Lite` / `AI Director` plans the song as shot segments.
2. `1magen` creates the first anchor frame for the first segment.
3. `3nvizen` generates the first local video segment.
4. `3nvizen` extracts the last frame of that segment.
5. That last frame becomes the first frame of the next segment.
6. The process repeats until the full music video is complete.
7. FFmpeg or equivalent local assembly combines the segments and muxes the master audio.

This is the continuity-preserving local video architecture.

## 15. 3nvizen Runtime Decision

`3nvizen` should be a real Everywear applet and also a bundled capability inside `Creator Pro`.

The runtime rule should be:

1. Prefer a direct local runtime only if it fully supports:
   - image-to-video
   - audio-conditioned generation
   - sequential segment chaining
   - continuity via first-frame / last-frame handoff
   - lip-sync capable patch workflows
2. If the GGUF route cannot cleanly support the full required path, the canonical local implementation becomes a managed Python sidecar using the official LTX runtime and safetensor weights.

This means the platform should not be ideologically attached to GGUF if that sacrifices critical product capability.

## 16. Lip-Sync Is Core, Not Optional

Auto lip syncing is important enough for music-video creation that it should be treated as a first-class workflow capability.

This does not necessarily mean it belongs in the baseline generation path for every render, but it does mean:

- `3nvizen` must be architected with lip-sync patch support in mind from the start
- multilingual dubbing, lyric-driven mouth motion, and lower-face expression adaptation are not “nice to haves”
- if the local stack needs the official audio/video runtime to provide this properly, that is an acceptable architectural choice

Commercially and structurally, lip-sync should likely be framed as a `patch` workflow within the `3nvizen` / `Creator Pro` ecosystem, rather than as a separate app.

## 17. UV Sidecar Packaging Direction

The preferred self-contained path for the official LTX runtime is:

- managed Python sidecar
- `uv` environment management
- Everywear-owned model provisioning
- applet-owned request contract

This sidecar should:

- expose a narrow local HTTP contract
- remain hidden behind Everywear shell orchestration
- use safetensor checkpoints plus companion VAE assets where required
- support both baseline segment generation and lip-sync patch workflows

The user should still experience this as:

- install Everywear
- install `Creator Pro` or `3nvizen`
- Everywear provisions what is needed
- generation runs locally without the user managing Python directly

## 18. 1magen Runtime Decision

`1magen` is now canonically a `Z-Image` applet.

This needs to stay mentally and technically stable:

- `1magen` base family = `Z-Image`
- VRAM gating selects the appropriate quant / weight tier inside that family
- `1magen` is not a mixed `Z-Image + Qwen-Image + Flux` patch playground

Current intended local stack:

- `z_image_turbo-Q8_0.gguf` or `z_image_turbo-Q4_K.gguf`
- `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`
- `diffusion_pytorch_model.safetensors`

## 19. Style Patch Compatibility Rule

The compatibility rule for `1magen` style patches is now locked:

- `1magen` style patches must explicitly work with `Z-Image`
- if a patch is not explicitly `Z-Image` compatible, it is not a valid `1magen` patch
- there is no "close enough" mixed-runtime patch library

This is important for both product honesty and runtime stability.

## 20. Style Forge Training Direction

`Style Forge` for `1magen` should be treated as a separate training lane from the lightweight runtime lane.

### Runtime lane

- applet-first generation
- GGUF-oriented local inference
- fast provisioning and generation

### Training lane

- managed Python sidecar
- `uv` environment management
- `safetensors`-based Z-Image assets
- LoRA training using open tooling

Training should not target the GGUF runtime artifacts.

The best current open-source path appears to be:

- `Tongyi-MAI/Z-Image-Turbo`
- `ostris/ai-toolkit`
- `ostris/zimage_turbo_training_adapter`
- optional `DiffSynth-Studio/Z-Image-Turbo-DistillPatch` for preserving turbo-style acceleration during patched inference

## 21. Local Training Feasibility

Local `Style Forge` training appears viable on sufficiently capable hardware.

Practical envelope:

- `12 GB VRAM`: possible for smaller patch jobs with conservative settings
- `24 GB VRAM`: recommended floor for a productized local trainer
- `32 GB+`: comfortable

Reasonable first training jobs:

- `20-100` clean images
- `800-3000` steps
- LoRA rank `8-32`
- batch size `1`
- resolutions around `512`, `768`, or `1024`

This means `Style Forge` can be a real local feature, not just a cloud fantasy, but it should be framed as a capable-user workflow rather than a casual one-click toy.

## 22. Implementation Progress Snapshot

Current reality:

- `1magen` now works locally for the base text-to-image path
- provisioning, checksum verification, preview, and save are all functioning
- source-image mode is surfaced in the applet UI
- the control layout has been simplified to a dropdown resolution picker and a larger primary generate action
- `Style Patch (LoRA)` and `Task Shard (Workflow)` are visible as coming-soon workflow surfaces

`3nvizen` currently exists as:

- a manifest-backed scaffold
- a segment-chain contract
- a `uv`-managed LTX sidecar scaffold

The central Everywear-owned model tree is still pending. `1magen` currently stores models in its own roaming-data path, which should later be migrated into an Everywear-wide model hierarchy.
