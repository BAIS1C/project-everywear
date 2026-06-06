# Context Append: Applet Install Assessment Doctrine

Location: `C:\Users\MAG MSI\Project Everywear`
Timestamp: 2026-06-05T22:30+08:00 SGT
Authority: Sean, 2026-06-05 SGT (originated during 3nvizen install/assessment tests)
Origin note: `C:\Users\MAG MSI\.codex\memories\extensions\ad_hoc\notes\2026-06-05-everywear-applet-install-assessment.md`
Status: LOCKED doctrine; implementation phased, not yet landed
Vault filing owed: Project Mymory (not mounted this session)

## Doctrine

### Canonical flow (three phases, strict order)

1. SHELL ASSESSMENT: Everywear shell runs the hardware assessment
   (VRAM, disk, model availability) at install, and again on tier change.
2. INSTALL / PROVISION: shell-owned. VRAM assessment, disk/model availability
   assessment, model-profile recommendation, user confirmation, full
   model-bundle download, install receipt creation. Upon first install,
   Everywear pulls the models required for ALL tier-appropriate applets
   (FREE tier minimum: My Mait base LM, VRAM-sized via
   model_manager::ModelResolver). Upon tier activation or "downloading"
   (activating) a newly entitled applet, the install-model process begins
   WITH VISIBLE UI: progress, confirmation, receipt.
3. RUNTIME LAUNCH: opening an applet activates it. Launch loads already
   provisioned models from resolved local paths through the runtime bridge.
   Launch never downloads.

### Authority rule (the teeth)

- Applets must NOT independently decide or pull model files through ad hoc
  UI endpoints. The shell / model-manager owns VRAM, entitlement,
  provisioning, and resolved model paths.
- Runtime sidecars stay dumb: load local paths handed over by Everywear,
  report status, generate, register outputs. Sidecars are never the
  authority for first-install model choice.

### Per-applet implications

- My Mait (kasai): open equals activate. Launch goes through the bridge
  (`request_applet_switch`) and loads the provisioned base LM.
  `KASAI_NOT_ACTIVE` must not exist as a user-visible state; the only valid
  states are "activating" and "install required" (with install UI).
- 3nvizen: Creator Studio activation triggers or offers a 3nvizen install
  run pulling the full selected LTX bundle: primary transformer plus
  required companions (projection, VAE/audio VAE, text encoder, optional
  upscaler/control models) per the assessed profile.
- Gener8 / DAW: the 2026-06-05 `shim.rs` pack-status / install-pack routes
  (`pro_base` ↔ `better_models` aliasing) are a DOCTRINE VIOLATION kept as
  a stopgap to unblock DAW stem extraction. Flagged for migration: install
  authority moves up to the shell/model-manager; the shim becomes a dumb
  consumer of resolved paths.

### Launcher dot vocabulary (locked)

- GREEN: model provisioned and runtime healthy
- AMBER: entitled, installing or pack missing (install UI available)
- GRAY: not entitled

## Known on-disk contradiction at filing time

Both registries (`platform/everywear-os/src-tauri/src/registry.rs` and
`BROWSER_APPLET_REGISTRY` in `platform/everywear-os/src/lib/transport.ts`)
currently hold kasai as pure `FrontendInline` with no `launch_binary`, which
breaks launch-time activation (reproduces `KASAI_NOT_ACTIVE`). The locked
contract per MYMAIT_INTEGRATION_PROGRESS_REPORT_2026-06-05.md, the
PROJECT_STATE.md 2026-06-05 append, and the WIKI launcher table is
`BinaryLocal` + `launch_binary = everywear-kasai` + no `frontend_port`.
Additionally `gener8-4ever` carries a stray inert
`launch_binary: Some("everywear-kasai")` documented nowhere. Restore is a
four-line mirrored fix; desktop acceptance pass owed after.

## Cross-references

- MYMAIT_INTEGRATION_CODEX_PROMPTPACK_2026-06-05.md (P4 = ModelResolver wiring)
- MYMAIT_INTEGRATION_PROGRESS_REPORT_2026-06-05.md (KASAI_NOT_ACTIVE evidence)
- OODA_REPORT_2026-06-05.md (full drift audit, this session)
- docs/wiki/gener8/split-architecture.md (DAW pack route fix, 2026-06-05)
