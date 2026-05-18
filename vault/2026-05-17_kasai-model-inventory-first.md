# Vault Note: Kasai Model Inventory First

Date: 2026-05-17

## Decision

Everywear model provisioning must scan all known local model inventories before downloading. The shell should choose the best usable local match per required slot, then download only unresolved slots.

This is especially important for Kasai because users may already have multi-GB GGUF weights in LM Studio, Hugging Face cache, Ollama, GPT4All, or Everywear's own model tree. Re-downloading those files is bad UX and wastes time, bandwidth, and storage.

## Current Kasai Target

Kasai Full/Ultra should align with the current working local setup:

- Orchestrator: `Qwen3.6-35B-A3B-Q4_K_M.gguf`
- Agent: `Qwen3.5-9B-Q8_0.gguf` preferred for Ultra, with `Qwen3.5-9B-Q4_K_M.gguf` accepted as a compatible local fallback
- Embedder remains separate and small: `nomic-embed-text-v1.5-Q8_0.gguf`

Current machine state:

- LM Studio has `Qwen3.6-35B-A3B-Q4_K_M.gguf` at about 19.71 GiB.
- LM Studio has `Qwen3.5-9B-Q4_K_M.gguf` at about 5.24 GiB.
- LM Studio did not currently show `Qwen3.5-9B-Q8_0.gguf`.
- `%LOCALAPPDATA%\Kasai-Local\models` has zero-byte Qwen placeholders; these must be ignored.

## Implementation Note

`crates/model-manager/src/discovery.rs` now recursively scans nested model caches, ignores local matches below 50 MB, and supports same-family GGUF fallback when the local file has an equal-or-smaller footprint than the planned model.

Exact filename still wins. Same-family fallback is only for avoiding unnecessary downloads when a compatible local quant already exists.

## Next Runtime Port Rule

When porting Kasai from `C:\Users\MAG MSI\Project Claude\Kasai-Local`, do not bring over its model downloader as the authority. Port the inference/session/tool runtime pieces, but let Everywear own:

- model inventory scanning
- download/resume/verification
- VRAM plan selection
- IPC handoff of selected model paths
- auth and entitlement gating
- vault/mait shared crates

## 2026-05-17 Port Slice

Kasai's Everywear applet now has a headless runtime harness:

- Accepts model paths from shell env vars and `StartInference`
- Maps primary/orchestrator to the orchestrator slot
- Maps encoder/agent/worker to the agent slot
- Rejects missing, corrupt, or zero-byte model files
- Reports `QueryStatus` with model slot state
- Handles `Warmup`, `UnloadModel`, and `ExecuteJob`
- Writes `ExecuteJob` output JSON to `output_target` when provided

This is not the final llama.cpp inference port yet. It establishes the correct ownership boundary so the next slice can transplant Kasai-Local's slot manager and generation loop into a backend that Everywear already knows how to launch and supervise.

UI note: Kasai's window/panel is an Everywear OS EWDS surface, not a standalone Kasai Tauri window. The embedded panel should use EWDS window chrome, including mac-style traffic lights.
