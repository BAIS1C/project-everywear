# OODA Note: Everywear Project State

Date: 2026-05-18

## Observe

The current Everywear repo is much more implemented than the older wiki sections imply, but it is not build-clean.

Key observed deltas:

- `vid` is now a first-class frontend-only applet with `applets/vid/applet.toml`.
- `3nvizen` has a React workbench scaffold, not only backend IPC.
- `kasai` has a portable EWDS-style frontend scaffold in this repo.
- `crates/vault` has a real Tantivy index.
- `crates/mait` has real MAIT manifest/shard/store code and Strands Avatar v1 import.
- Gener8 CreateView is wired to the local shim `/api/generate` flow.
- Gener8 DAW playback is now cpal-backed.
- Shell Discourse commands and frontend wiring are substantially implemented.

## Orient

Everywear is now in an integration-stabilization phase.

The core architecture remains sound:

- Shell owns hardware, model provisioning, VRAM lifecycle, auth/tier sync, launch, and supervision.
- Applets own actual inference/model loading.
- Headless and frontend-only applets are both valid patterns.
- MAIT and vault are becoming the bridge between applet artifacts, Kasai memory, Character Studio avatars, and future Mymories.

The main mismatch is documentation/build status:

- Some docs still describe crates and applets as stubs.
- Some code is real but not compile-verified.
- Frontend surfaces are proliferating faster than shared component/type hygiene.

## Decide

Next work should prioritize making the current implementation verifiable:

1. Fix Vid JSX parse errors.
2. Fix Gener8/VideoGeneratorModal type errors and strict unused symbols.
3. Fix Kasai frontend missing component/type discriminants.
4. Re-run targeted Rust checks after killing stale build processes.
5. Continue feature work only after a known-good build baseline exists.

## Act

This OODA pass updated:

- `CONTEXT.md`
- `WIKI.md`
- this vault note

Verification attempted:

- `npm run build --workspace applets/gener8/web`: failed on TypeScript errors.
- `npm run build --workspace applets/kasai`: failed on missing `ToolCallCard` and message union issues.
- `npm run build --workspace applets/vid/web`: failed on malformed JSX.
- Cargo checks timed out and left build processes, which were stopped.

## Current Risks

- Single shell `applet_process` blocks true multi-binary applet lifecycle.
- 3nvizen has UI and IPC direction but no real LTX sidecar implementation yet.
- Kasai has strong backend architecture but lacks real tool execution.
- Vid and Gener8 duplicate a large modal surface; errors likely need to be fixed in both or extracted.
- Shell/1magen EWDS local copies will drift from `@everywear/ewds`.
- The wiki is still a large historical document; dated addenda should be treated as higher authority than older tables.
