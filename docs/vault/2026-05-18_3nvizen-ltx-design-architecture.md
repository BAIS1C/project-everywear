# 3nvizen LTX Design Architecture

Date: 2026-05-18

## Summary

`3nvizen` should be treated as Everywear's local video-generation and video-patch applet. It is not merely a Wan/LTX placeholder. The architecture should center on segment generation, continuity-preserving timeline rendering, and patch workflows such as LipDub.

The backend should use a managed Python sidecar for the canonical safetensors path, while Everywear's shell continues to own model provisioning, VRAM planning, entitlement checks, launch, sandboxing, and unload policy.

## Local Findings

The installed LTX Desktop backend at `G:\LTX\LTX Desktop\resources\backend` is a readable FastAPI Python backend. Useful modules:

- `api_types.py`: Pydantic request and response contracts.
- `ltx2_server.py`: runtime bootstrap, app data layout, CUDA/MPS/CPU selection, logging, SageAttention setup, warmup.
- `app_factory.py` and `app_handler.py`: route registration and dependency wiring.
- `_routes/generation.py`: `/api/generate`, `/api/generate/cancel`, `/api/generation/progress`.
- `_routes/models.py`: model status and download routes.
- `_routes/ic_lora.py`: IC-LoRA listing, download, conditioning extraction, and generation.
- `_routes/retake.py`: video patch / retake route.
- `handlers/video_generation_handler.py`: text-to-video, image-to-video, audio-to-video, forced API fallback, progress updates, cancellation, and output writing.
- `services/fast_video_pipeline/ltx_fast_video_pipeline.py`: distilled local video wrapper.
- `services/a2v_pipeline/ltx_a2v_pipeline.py`: audio-to-video wrapper.
- `services/retake_pipeline/ltx_retake_pipeline.py`: retake/patch workflow.
- `services/ic_lora_pipeline/ltx_ic_lora_pipeline.py`: IC-LoRA workflow.

The current `3nvizen` Rust IPC bridge already expects a FastAPI sidecar at `THREENVIZEN_SIDECAR_URL` and advertises `text2video`, `image2video`, `segment_generate`, and `lipdub`. The current Python sidecar is still scaffold-only.

## Low-VRAM Design

The repo's `ltx2.3 on 8gb vram consistent characters nad dialogue.html` note changes the design:

Low-VRAM LTX is not a separate tiny model. It is an execution profile:

- LTX 2.3 Distilled 1.1.
- Transformer-only weights where possible.
- Chunked feed-forward.
- Separate audio VAE, video VAE, and preview VAE.
- Text encoder CPU/offload options.
- Two-pass sampling: low-resolution draft, latent upscale, final detail pass.
- Preview/cancel before committing to expensive final render.
- Strict dimensions: width and height divisible by `32`.
- Strict frame counts: `8n + 1`, e.g. `17`, `25`, `33`.
- Timeline prompts must match segment frame lengths.

Continuity rules:

- A starting frame should show the state before the action begins.
- Do not use an anchor frame that already contains the action requested in the prompt.
- Keep screen direction, eyeline, character position, wardrobe, and lighting consistent between segments.

## Runtime Tiers

| Tier | Target Hardware | Executor Profile | Candidate Weights |
|---|---:|---|---|
| Ultra | 32GB+ VRAM | official safetensors sidecar | `Lightricks/LTX-2.3` dev/distilled |
| Pro | 24GB VRAM | FP8 safetensors sidecar | `Lightricks/LTX-2.3-fp8`, `Kijai/LTX2.3_comfy` |
| Standard | 16GB VRAM | FP8/MXFP8, transformer-only, CPU/offload text encoder, chunked feed-forward | `Kijai/LTX2.3_comfy` |
| Low VRAM | 12GB VRAM | GGUF Q2/Q3 or INT8/NVFP4 experimental bridge | `QuantStack/LTX-2.3-GGUF`, `Winnougan/LTX-2.3-INT8` |
| Experimental | 8GB VRAM | low-res draft plus heavy offload and strict segment sizes | ComfyUI-derived low-VRAM profile |

Safetensors is the canonical path because it maps cleanly to `ltx-core` and `ltx-pipelines`. GGUF and INT8/NVFP4 are separate executor profiles until the bridge is proven.

## Hugging Face Inventory

Official base:

- `Lightricks/LTX-2.3`
- `ltx-2.3-22b-dev.safetensors`
- `ltx-2.3-22b-distilled-1.1.safetensors`
- `ltx-2.3-22b-distilled-lora-384-1.1.safetensors`
- `ltx-2.3-spatial-upscaler-x2-1.1.safetensors`
- `ltx-2.3-temporal-upscaler-x2-1.0.safetensors`

Official FP8:

- `Lightricks/LTX-2.3-fp8`
- `ltx-2.3-22b-dev-fp8.safetensors`
- `ltx-2.3-22b-distilled-fp8.safetensors`

Comfy low-VRAM safetensors:

- `Kijai/LTX2.3_comfy`
- transformer-only BF16/FP8/MXFP8 diffusion files
- `LTX23_audio_vae_bf16.safetensors`
- `LTX23_video_vae_bf16.safetensors`
- `taeltx2_3.safetensors`
- `ltx-2.3_text_projection_bf16.safetensors`

Text encoder alternatives:

- `GitMylo/LTX-2-comfy_gemma_fp8_e4m3fn`
- `gemma_3_12B_it_fp8_e4m3fn.safetensors`
- `gemma_3_12B_it_nvfp4_uncalibrated.safetensors`

Quantized/experimental:

- `QuantStack/LTX-2.3-GGUF`
- `Winnougan/LTX-2.3-INT8`

Patch and control IC-LoRAs:

- `Lightricks/LTX-2.3-22b-IC-LoRA-LipDub`
- `Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control`
- `Lightricks/LTX-2.3-22b-IC-LoRA-Motion-Track-Control`

## Segment Generation

Target Creator Studio sequence:

1. AI Director writes a SAPI-routed shot plan, timing, continuity notes, and init sources.
2. `1magen` creates anchor frames for cut shots.
3. `3nvizen` generates timeline segments in order.
4. Last frame extraction feeds continuation shots.
5. FFmpeg concatenates segments and muxes final audio.
6. Outputs become Mait shard artifacts.

Expected sidecar endpoints:

- `GET /health`
- `POST /api/v1/models/ensure`
- `GET /api/v1/models/status`
- `POST /api/v1/segments/generate`
- `POST /api/v1/segments/extract-last-frame`
- `POST /api/v1/patches/lipdub`

## LipDub Patch Workflow

The multi-language LipDub note shows this should be a patch workflow, not a standalone app. LipDub regenerates lip movement and lower-face expression to match the target language while preserving identity, background, and motion context.

Pipeline:

1. Whisper-align extracts source transcript and timing.
2. AI Director formats speaker lines through the active SAPI provider.
3. `3nvizen` builds a patch request with source video, source audio, target language, translated script, speaker labels, and emotion cues.
4. LTX LipDub IC-LoRA runs video and audio conditioning.
5. Result is stored as a language variant Mait shard for the source scene.

Inputs:

- source video path
- source/reference audio path
- translated script
- target language
- speaker labels for multi-character scenes
- optional emotion cues such as `laughing`, `whispering`, or `shouting`

## Boundary

Shell owns:

- model discovery and download
- integrity verification
- VRAM tier selection
- entitlement checks
- process spawn
- dynamic sidecar port and auth token
- sandbox roots
- unload, kill, reclaim, and heartbeat policy

`3nvizen` owns:

- sidecar request translation
- model loading inside its process
- segment generation
- frame extraction
- LipDub and IC-LoRA patch orchestration
- progress events back to the shell

## Next Implementation Work

- Replace scaffold responses in `applets/3nvizen/src-tauri/sidecar/ltx-runtime/src/ltx_runtime/server.py`.
- Port/adapt the LTX Desktop FastAPI composition style rather than inventing a new service shape.
- Add a real model ladder to `applets/3nvizen/applet.toml`.
- Keep GGUF/INT8 as explicit experimental executor profiles.
- Add last-frame extraction and segment metadata.
- Connect outputs to Mait shard storage.
