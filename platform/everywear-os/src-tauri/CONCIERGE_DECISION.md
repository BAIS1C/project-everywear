# Concierge Module Decision

Date: 2026-05-18

Decision: do not implement `src/concierge.rs` yet.

Reason:
- `rg -n "concierge|Concierge"` found zero code references under `platform/everywear-os/src-tauri/src`.
- The only Project Everywear references are in `OODA_AUDIT_2026-05-18.md`, which reports wiki drift and a missing file.
- No local wiki directory is present in this checkout, so there is no concrete Rust API contract to implement.

TODO:
- Clean up wiki references to `concierge.rs`, or restore the intended requirements/spec before adding a module.
- If Concierge is revived, define the command surface and AppState ownership first, then add `mod concierge;` and registered Tauri commands in `src/lib.rs`.
