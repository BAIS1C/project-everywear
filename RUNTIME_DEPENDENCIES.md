# Runtime Dependencies

Everywear resolves local runtime assets before it downloads anything. Model lookup order is:

1. Everywear vault: `~/.everywear/models/`
2. Known local tool installs
3. User-configured custom scan paths
4. HuggingFace downloads as the last resort

Resolution is read-only until the user explicitly adopts a local model by symlink, copy, or move.

## Local Model Sources (scan these FIRST)

| Tool | Default Install Path (Windows) | Model Format | Scan Strategy |
|------|-------------------------------|-------------|---------------|
| LM Studio | `%LOCALAPPDATA%\LM Studio\models\` | GGUF (`*.gguf`) | Recursive glob, match by filename stem, family, architecture metadata, and quant |
| Ollama | `%USERPROFILE%\.ollama\models\` | GGUF in content-addressed blobs | Recursive scan blobs, detect `GGUF` magic, read metadata, map manifests when available |
| ComfyUI | `%USERPROFILE%\ComfyUI\models\` | Safetensors, GGUF, CKPT | Scan `checkpoints/`, `loras/`, `unet/`, `vae/`, `text_encoders/` recursively |
| Automatic1111 | `%USERPROFILE%\stable-diffusion-webui\models\Stable-diffusion\` | CKPT, Safetensors | Recursive glob for `*.safetensors` and `*.ckpt` |
| Fooocus | `%USERPROFILE%\Fooocus\models\checkpoints\` | Safetensors | Recursive glob for checkpoint files |
| LTX Desktop | `G:\LTX\LTX Desktop\resources\backend\models\` | Safetensors | Scan configured backend model directory; prefer `config.py MODEL_DIR` when present |
| Raw downloads | `%USERPROFILE%\Downloads\`, `%USERPROFILE%\Models\`, `%USERPROFILE%\huggingface\` | Any | Shallow scan Downloads, recursive scan Models/HF cache, warn before adopting |

Environment overrides are honored first: `LM_STUDIO_MODELS_DIR`, `OLLAMA_MODELS`, `COMFYUI_PATH`, `ACE_SERVER_PATH`, and `FFMPEG_PATH`.

## Validation

| Format | Validation |
|--------|------------|
| GGUF | Read header magic `GGUF`, parse metadata keys such as `general.architecture`, `general.file_type`, context length, embedding length, block count, and head count without loading tensors. Quantization falls back to filename if metadata is absent. |
| Safetensors | Read the 8-byte JSON header length and parse tensor metadata only. Infer architecture from tensor names and count tensors; never load tensor data. |
| CKPT | Validate extension and size, then match filename/architecture heuristics. Full tensor inspection is deferred because pickle checkpoints are not safe to parse blindly. |

## Applet Model Requirements

### Kasai

| Model ID | Format | Search Patterns | Validation | Common Sources |
|----------|--------|-----------------|------------|----------------|
| `kasai-orchestrator-qwen3-6-35b-a3b-q4km` | GGUF Q4_K_M | `Qwen3.6-35B-A3B`, `35B-A3B`, `Q4_K_M` | Architecture `qwen3` or `qwen2.5`, quant `Q4_K_M` preferred, context >= 4096, size about 21 GB | LM Studio, Ollama, raw HuggingFace cache |
| `kasai-agent-qwen3-5-9b-q8` | GGUF Q8_0 | `Qwen3.5-9B`, `Q8_0` | Architecture `qwen3` or `qwen2.5`, quant `Q8_0` preferred, context >= 4096 | LM Studio, Ollama |
| `kasai-agent-qwen3-5-9b-q4km` | GGUF Q4_K_M | `Qwen3.5-9B`, `Q4_K_M` | Same family as above, `Q4_K_M` preferred, `Q5_K_M`/`Q8_0` compatible if VRAM allows | LM Studio, Ollama |
| `kasai-orchestrator-qwen3-5-9b-q5km` | GGUF Q5_K_M | `Qwen3.5-9B`, `Q5_K_M` | Architecture `qwen3`/`qwen2.5`, quant ladder compatible | LM Studio, raw downloads |
| `kasai-worker-qwen3-4b-q4km` | GGUF Q4_K_M | `Qwen3-4B`, `Q4_K_M` | Architecture `qwen3`, fallback `qwen2.5`/`qwen2`, context >= 4096 | LM Studio, Ollama |
| `kasai-lite-nemotron-3-nano-4b-q4km` | GGUF Q4_K_M | `Nemotron-3-Nano-4B`, `Q4_K_M` | Architecture `nemotron` or llama-family, quant compatible | LM Studio, Ollama |
| `kasai-lite-qwen3-4b-q4km` | GGUF Q4_K_M | `Qwen3-4B`, `Q4_K_M` | Same as worker model | LM Studio, Ollama |

### 1magen

| Model ID | Format | Search Patterns | Validation | Common Sources |
|----------|--------|-----------------|------------|----------------|
| `z-image-turbo-q8` | Safetensors | `z-image`, `z_image`, `turbo`, `q8` | Safetensors header, tensor names indicating `z-image`; SDXL/SD15 only as possible fallback | ComfyUI, raw downloads |
| `z-image-turbo-q4km` | Safetensors | `z-image`, `z_image`, `turbo`, `q4` | Same as Q8, smaller file preferred for 8 GB class GPUs | ComfyUI, raw downloads |
| `qwen3-4b-encoder-q4` | GGUF | `Qwen3-4B`, `Q4_K_M`, `encoder` | `qwen3`/`qwen2.5`/`qwen2`, quant `Q4_K_M` preferred | LM Studio, Ollama |
| `pig-flux-vae` | Safetensors | `pig`, `flux`, `vae` | Safetensors header, VAE/Flux/SDXL tensor naming, size below 2 GB | ComfyUI, Automatic1111, Fooocus |

### 3nvizen

| Model ID | Format | Search Patterns | Validation | Common Sources |
|----------|--------|-----------------|------------|----------------|
| `ltx-2.3-22b-distilled-1.1` | Safetensors | `ltx-2.3-22b-distilled`, `ltx`, `distilled` | Exact filename preferred: `ltx-2.3-22b-distilled.safetensors`; architecture `ltx-video` | LTX Desktop, ComfyUI, raw downloads |
| `ltx-2.3-text-projection` | Safetensors | `ltx`, `text`, `projection` | Safetensors header and LTX tensor family | LTX Desktop |
| `ltx-2.3-video-vae` | Safetensors | `ltx`, `video`, `vae` | VAE tensor names, size below 2 GB | LTX Desktop, ComfyUI |
| `ltx-2.3-audio-vae` | Safetensors | `ltx`, `audio`, `vae` | Audio VAE tensor names, size below 2 GB | LTX Desktop |
| `gemma-3-video-text-encoder` | Safetensors | `gemma`, `text`, `encoder` | Gemma-family tensor names, size below 8 GB | LTX Desktop, raw downloads |

### Gener8

| Model ID | Format | Search Patterns | Validation | Common Sources |
|----------|--------|-----------------|------------|----------------|
| `acestep-turbo-q8` | GGUF Q8_0 | `acestep-v15-xl-turbo`, `Q8_0` | ACE-Step GGUF, quant `Q8_0`, size about 5 GB | LM Studio, raw downloads |
| `acestep-turbo-q6k` | GGUF Q6_K | `acestep-v15-xl-turbo`, `Q6_K` | ACE-Step GGUF, quant ladder compatible | LM Studio, raw downloads |
| `acestep-turbo-q5km` | GGUF Q5_K_M | `acestep-v15-xl-turbo`, `Q5_K_M` | ACE-Step GGUF, quant ladder compatible | LM Studio, raw downloads |
| `acestep-turbo-q4km` | GGUF Q4_K_M | `acestep-v15-xl-turbo`, `Q4_K_M` | ACE-Step GGUF, quant ladder compatible | LM Studio, raw downloads |
| `acestep-lm` | GGUF Q8_0 | `acestep-5Hz-lm`, `lm`, `Q8_0` | GGUF header; language model role; size about 710 MB | LM Studio, raw downloads |
| `acestep-vae` | GGUF BF16 | `vae-BF16`, `vae` | GGUF header, BF16/F16 compatible | Raw downloads |
| `acestep-text-encoder` | GGUF Q8_0 | `Qwen3-Embedding-0.6B`, `embedding`, `qwen3` | Qwen architecture, quant `Q8_0` preferred | LM Studio, Ollama |
| `acestep-base-q4km` | GGUF Q4_K_M | `acestep-v15-xl-base`, `sftturbo50`, `Q4_K_M` | ACE-Step base model; HF filename may differ from local renamed filename | LM Studio, raw downloads |
| `acestep-base-q5km` | GGUF Q5_K_M | `acestep-v15-xl-base`, `sftturbo50`, `Q5_K_M` | Same base model with Q5 quant | LM Studio, raw downloads |
| `acestep-base-q6k` | GGUF Q6_K | `acestep-v15-xl-base`, `sftturbo50`, `Q6_K` | Same base model with Q6 quant | LM Studio, raw downloads |
| `acestep-base-q8` | GGUF Q8_0 | `acestep-v15-xl-base`, `sftturbo50`, `Q8_0` | Same base model with Q8 quant | LM Studio, raw downloads |

## Non-Model Runtime Dependencies

| Dependency | Local-First Resolution |
|------------|------------------------|
| ACE server | Check `~/.everywear/bin/ace-server/`, `ACE_SERVER_PATH`, local Project Ace build paths, common install directories, and PATH. If found, symlink or copy into Everywear bin. If absent, install `ace-server-stub.js`, which serves `/props` and returns silence for generation. |
| FFmpeg | Check `FFMPEG_PATH`, PATH, `C:\ffmpeg\bin\ffmpeg.exe`, `C:\Program Files\ffmpeg\bin\ffmpeg.exe`, and Chocolatey/Scoop locations. |
| Video encoder | Shell-owned Node sidecar at `platform/everywear-os/src-tauri/sidecar/video-encoder/dist/index.js`; exposes `/health` and uses `FFMPEG_PATH` when provided. |
| uv | Checked through PATH for Python sidecars; missing uv is reported in setup status. |
