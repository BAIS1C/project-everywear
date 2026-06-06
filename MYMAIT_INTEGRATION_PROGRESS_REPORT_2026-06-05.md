# My Mait Integration Progress Report

Location: `C:\Users\MAG MSI\Project Everywear`
Timestamp: 2026-06-05T12:03:16+08:00 SGT
Status: filed for later continuation

## Current Truth

- My Mait is the user-facing singular name. Internal `kasai` ids remain unchanged.
- My Mait is top-billed in the Everywear desktop launcher.
- Browser preview rendered the My Mait applet cleanly with:
  - skill rail
  - MyMory status
  - slot status panel
  - visible skill run state
  - no forbidden public `My Maits` / Lite / Full naming in applet or shell code
- Desktop acceptance exposed three stacked issues:
  - false launch-failed report despite the applet opening
  - Edge / WebView external `127.0.0.1 refused to connect` page
  - gray availability dot on My Mait while the applet was actually usable
- User confirmed after the first desktop patch:
  - green availability dot appeared on My Mait
  - no apparent launch bug
  - My Mait opened inline on `LOCAL IPC`
- User then tested the over-corrected registry state and found:
  - model was not loaded
  - chat returned `Error: KASAI_NOT_ACTIVE`
  - conclusion: My Mait still needs bridge activation through `request_applet_switch`

## Implemented This Pass

### My Mait applet UI and graphics

- `applets/kasai/src/shell/KasaiCore.tsx`
  - Added visible skill running state.
  - Added minimum visible run-state window so the UI state does not disappear instantly in preview.
  - Added MyMory status and watched-project data to the right rail.
  - Added fail-closed tool-call event normalization.
- `applets/kasai/src/shell/ToolCallCard.tsx`
  - Added malformed payload handling.
  - Prevents bad tool payloads from breaking rendering.
- `applets/kasai/src/shell/SlotStatusPanel.tsx`
  - Added live slot-event display.
- `applets/kasai/src/styles/agent-hub.css`
  - Added running state visuals and slot-event styling.

### Naming cleanup

- `applets/kasai/applet.toml`
- `applets/kasai/package.json`
- `applets/kasai/src-tauri/Cargo.toml`
- `applets/kasai/src-tauri/src/runtime_ipc.rs`

Public display strings now use singular `My Mait`.

### Desktop shell launch contract

- `platform/everywear-os/src-tauri/src/registry.rs`
- `platform/everywear-os/src/lib/transport.ts`
- `platform/everywear-os/src/shell/ShellLayout.tsx`

Final intended contract after the KASAI_NOT_ACTIVE correction:

- My Mait remains `BinaryLocal`.
- My Mait keeps `launch_binary = everywear-kasai`.
- My Mait no longer advertises a `frontend_port`.
- `request_applet_switch("kasai")` still runs to activate Kasai and load the model.
- The React UI opens inline through `AppletViewRouter` after bridge activation.
- This should avoid the dead localhost / Edge path while preserving model activation.

### Window runtime status

- `platform/everywear-os/src/shell/ShellLayout.tsx`
  - The app window titlebar status is no longer hardcoded to `LIVE`.
  - It now derives from shell runtime state:
    - `LOADING` during launch / purge / opening
    - `LIVE` only when a model-backed applet is the active inference applet and inference phase is ready
    - `UI` when only the React surface is open
    - `ERROR` after launch error
    - `READY` for non-model panels/surfaces

### Bug report clipboard

- `platform/everywear-os/src/components/BugReportModal.tsx`
  - Clipboard copy now uses `navigator.clipboard.writeText` only when available and secure.
  - Adds a textarea / `document.execCommand("copy")` fallback for desktop WebView.
  - Adds visible copy state: `Copied` / error message.

## Verification Completed

Commands passed:

```powershell
npm run build --workspace kasai-applet
npm run build --workspace everywear-os
cargo check -p everywear-kasai
cargo check -p everywear-os
cargo build -p everywear-os
```

Known existing warnings:

- Vite unresolved runtime CSS asset URLs.
- Dart Sass legacy JS API deprecation.
- Tauri dynamic/static import chunk warning.
- Large chunk warnings.
- Existing Rust dead-code warning debt in `everywear-os`.
- Existing Rust warning debt in `everywear-kasai`.

Targeted naming grep passed:

```powershell
rg -n "My Maits|My Maits Lite|My Maits Full|My Mait Lite|My Mait Full" applets/kasai platform/everywear-os
```

No matches after final pass.

## Evidence Artifacts

Screenshots created under `C:\Users\MAG MSI\Project Everywear\screenshots`:

- `my-mait-preview-assessment-2026-06-05.png`
- `my-mait-preview-run-state-2026-06-05.png`
- `everywear-desktop-launch-2026-06-05.png`
- `everywear-desktop-my-mait-open-2026-06-05.png`
- `everywear-desktop-my-mait-after-doubleclick-2026-06-05.png`
- `everywear-desktop-my-mait-black-after-wait-2026-06-05.png`
- `everywear-desktop-launch-post-kasai-inline-2026-06-05.png`
- `everywear-desktop-my-mait-inline-clean-2026-06-05.png`
- `everywear-desktop-after-open-click-post-kasai-inline-2026-06-05.png`
- `everywear-desktop-after-icon-click-post-kasai-inline-2026-06-05.png`

## Carry For Next Session

Run a fresh desktop acceptance pass from the rebuilt binary:

```powershell
C:\Users\MAG MSI\Project Everywear\target\debug\everywear-os.exe
```

Acceptance checklist:

- My Mait launcher dot is green.
- Single click / hover launch behavior opens My Mait inline.
- No external Edge / WebView `127.0.0.1 refused` page appears.
- No automatic bug report modal appears on successful launch.
- My Mait chat does not return `KASAI_NOT_ACTIVE`.
- Slot panel shows the model loaded after activation.
- Window titlebar status does not show `LIVE` before the runtime is actually active.
- Bug report `Copy to Clipboard` changes to `Copied` and places the report on clipboard.

Important caution:

- Do not convert My Mait to pure `FrontendInline`. That breaks Kasai activation.
- Do not restore a `frontend_port` for My Mait unless there is a deliberate sidecar UI decision. That reintroduces the dead localhost path.
- The correct model is hybrid: bridge-backed `BinaryLocal` activation plus shell-native inline React UI.

