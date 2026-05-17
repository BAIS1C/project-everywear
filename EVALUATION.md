# Everywear Migration Evaluation

Date: 2026-05-17

## Current Verdict

The workspace compiles with the integrated migration chain. The core runtime bridge is now past the pure-scaffold phase: applets can advertise signed capabilities, the shell registers those engines, heartbeats are tracked, and the shell can dispatch a validated `EngineJob` to the active advertised engine via an authenticated `ExecuteJob` envelope.

## Verified

- `cargo check -p everywear-os`
- `cargo check --workspace`

Both pass. The warning backlog remains mostly unused imports/dead code from migration-era scaffolding, especially Gener8 and shell modules.

## Implemented Since Last Audit

- `applet-ipc::ShellChannel` now has an envelope-aware background reader.
- Signed `AdvertiseCapabilities` is verified before envelope mode is accepted.
- Shell `AppState` owns `EngineRegistry` and `VramScheduler`.
- Launch registers advertised engines and starts an applet event pump.
- Heartbeats update scheduler state.
- Event-stream closure purges registered engines for that applet.
- `submit_engine_job` validates engine readiness, capability, output target, and input file hashes, then sends `ExecuteJob` over IPC.
- Data migration receipts now use RFC3339 timestamps.
- Shell applet binary resolution now follows the intended package shape: installer manifest/env override first, then workspace and flat-layout dev binaries.
- Gener8 now builds as `target/debug/gener8.exe`, boots the S3-compatible API shim, attempts ACE/video sidecar startup, and uses shell-provided model paths for ACE model discovery.
- Model discovery now includes immediate subdirectories of `~/.everywear/models`, covering migrated legacy files under `~/.everywear/models/gener8`.

## Remaining Risks

- Shell process state still supports one active applet process, not a table of concurrently connected applets.
- `submit_engine_job` is currently blocking request/response; full `SubmitJob`/`SubmitPlan` should be event-driven.
- Entitlement manifest validation is modeled in `engine_router.rs` but not yet wired into the Tauri dispatch command.
- Cold engine orchestration is not complete: provision, `StartInference`, `Warmup`, then `ExecuteJob` should become a strict state machine.
- Applet package installation is not implemented yet. Everywear can discover/build local applet executables, but production download/update of applet binaries and sidecar resources is still pending.
- Gener8 still depends on ACE/video sidecar resources existing under managed paths. The current monorepo does not yet package/copy those resources from the original S3 repo.
- Job result relay back to a different requesting applet is not implemented yet.

## Recommended Next Cut

Implement the applet package installer/manifest first, starting with Gener8 sidecar resources. Then add the applet process table and route by `engine.applet_id`.
