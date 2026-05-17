# Everywear Current Context

Date: 2026-05-17

## Workspace

Root: `C:\Users\MAG MSI\Project Everywear`

Original S3 Gener8 source reference:

`C:\Users\MAG MSI\Project Ace\S3 STUDIO\s-gener8`

Primary sprint reference:

`MIGRATION_ARCHITECTURE.md`

## What Is Real Now

- Workspace crates exist for shared paths, model management, beats, video encoder, applet IPC, and data migration.
- `model-manager` uses Everywear model paths and supports resumable `.part` downloads with HTTP Range.
- `data-migration` owns filesystem-heavy S3 Gener8 migration logic.
- 1magen, 3nvizen, and Kasai have runtime IPC implementations.
- Applets fail closed when `EVERYWEAR_IPC_SECRET` is missing.
- The shell launcher injects `EVERYWEAR_CMD_PORT` and `EVERYWEAR_IPC_SECRET`.
- The shell verifies signed applet capability advertisements.
- Runtime-discovered engines are registered in `EngineRegistry`.
- Heartbeats are tracked through `VramScheduler`.
- `submit_engine_job` dispatches `ExecuteJob` to the active advertised applet engine.
- Applet launch resolution now supports installer manifests/env overrides and workspace `target/{debug,release}` binaries, including binary names that differ from applet ids.
- `gener8.exe` builds locally and is discoverable by the shell.
- Gener8 now boots its local S3-compatible API shim, attempts ACE/video sidecar startup, and resolves ACE models from shell-provided `EVERYWEAR_MODEL_*` paths first.
- `model-manager` discovers models in immediate subfolders under `~/.everywear/models`, so migrated `~/.everywear/models/gener8` files are visible.
- Cross-platform CI workflow exists at `.github/workflows/ci.yml`.

## Important Limits

- The shell still stores only one active applet process.
- Multi-applet engine routing needs an applet process table.
- `SubmitJob` and `SubmitPlan` are protocol types, but the full event-driven queue is not wired yet.
- Entitlement-manifest validation exists as router logic but is not active in shell dispatch.
- Cold-engine model load/warmup orchestration is still partial: Gener8 starts services, but `StartInference`/`Warmup` is not yet a strict shell-driven state machine.
- Gener8 sidecar package installation is not implemented yet. ACE/video binaries still need to be present under Everywear-managed `bin/` paths or bundled package paths.
- Gener8 has many unused/dead-code warnings after integration; compile/build is green.

## Safe Next Steps

1. Add the applet package installer/manifest for managed applet binaries and sidecar resources.
2. Replace single `applet_process` with `HashMap<String, AppletProcess>`.
3. Route `submit_engine_job` by `engine.applet_id`.
4. Add non-blocking `SubmitJob`/`SubmitPlan` handling and job result relay.
5. Wire entitlement validation into dispatch.
