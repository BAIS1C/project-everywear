# 3nvizen LTX Runtime Sidecar

This folder is the scaffold for the managed local video sidecar used by `3nvizen`.

## Goal

Bundle a self-contained local runtime for official LTX safetensor inference when:

- the GGUF path is missing required audio-conditioned features
- lip-sync patches depend on the official audio/video stack
- we need a reproducible install for Everywear users

## Packaging Direction

- Environment manager: `uv`
- Runtime shape: local FastAPI service
- Distribution target: Tauri external sidecar binary or managed local script runner
- Model storage owner: Everywear shell

## Important Constraint

This scaffold intentionally does not pretend the dependency pinning is final.
The exact official LTX package pinning needs a short spike against a real target machine before we freeze the environment.

## Near-Term Deliverables

1. Pin official LTX runtime dependency strategy.
2. Add model verification and download hooks from Everywear shell.
3. Implement `/health`, `/api/v1/models/ensure`, `/api/v1/segments/generate`, and `/api/v1/patches/lipdub`.
4. Add deterministic frame extraction and FFmpeg helpers.

