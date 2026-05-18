# 3nvizen LTX Runtime Adapter

This directory contains the FastAPI sidecar that Claude's 3nvizen frontend talks to at `http://127.0.0.1:8787`.

## Runtime Shape

- `server.py` exposes the frontend endpoints: `/api/generate`, `/api/generation/progress`, `/api/gpu-info`, `/models/status`, `/models/download`, `/models/load`, `/api/serve-output`, `/api/serve`, and `/api/extract-last-frame`.
- `config.py` owns model/output/cache directories and resolves the LTX Desktop backend path.
- `services.json` maps service names to the local LTX Desktop backend under `G:\LTX\LTX Desktop\resources\backend\services`.
- `adapter/` holds translation and progress logic. It does not vendor LTX Desktop code.
- `utils/` holds GPU detection and media helpers.

## LTX Desktop Integration

The adapter adds `G:\LTX\LTX Desktop\resources\backend` to `sys.path` at startup when present. The concrete pipeline call is deliberately behind a small `CODEX_NEEDED` marker in `adapter/generate.py` until the exact target Python environment is frozen. This lets the sidecar boot, report GPU/model state, accept jobs, and fail generation cleanly on machines that do not yet have the full LTX stack installed.

Override paths with:

```powershell
$env:THREENVIZEN_LTX_BACKEND_PATH="G:\LTX\LTX Desktop\resources\backend"
$env:THREENVIZEN_MODEL_DIR="$HOME\.everywear\models\3nvizen"
$env:THREENVIZEN_OUTPUT_DIR="$HOME\.everywear\data\3nvizen\output"
```

## Model Downloads

`POST /models/download` uses a safe mock progress loop by default so a UI click does not accidentally pull a 40GB file. Set `THREENVIZEN_ENABLE_HF_DOWNLOADS=1` to use `huggingface_hub.hf_hub_download`.

## Run

```powershell
uv run server.py
```
