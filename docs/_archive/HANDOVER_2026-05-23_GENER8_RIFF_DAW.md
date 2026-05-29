# Handover Prompt - Gener8 Riff DAW

Date: 2026-05-23

Use this prompt to continue in a fresh context:

```text
We are in C:\Users\MAG MSI\Project Everywear. Continue the Gener8 Riff DAW work.

Important: the S3 Studio Gener8 upstream has moved significantly. Before building the riff DAW feature directly in Everywear, sync the relevant S3 Gener8/DAW deltas into the Everywear Gener8 applet. Do not blindly copy the whole S3 app; port the useful surfaces while preserving Everywear shell/auth/EWDS/app boundary.

Read these first:

- docs/gener8-riff-daw-architecture.md
- docs/gener8-riff-daw-todo.md
- docs/vault/2026-05-22_gener8-riff-daw-add-layer.md
- docs/vault/2026-05-23_gener8-s3-sync-before-riff-daw.md
- applets/gener8/src-tauri/src/daw_engine/project.rs
- applets/gener8/src-tauri/src/daw_engine/transport.rs
- applets/gener8/src-tauri/src/shim/daw.rs
- applets/gener8/web/src/views/CreateView.tsx
- applets/gener8/web/src/components/DawTransportBar.tsx

Also inspect the S3 upstream reference:

- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\DawPage.tsx
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\LegoPanel.tsx
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\CompletePanel.tsx
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\shell\applets\DawCore.tsx
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\services\api.ts
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\services\dawApi.ts
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\CreatePanel.tsx
- C:\Users\MAG MSI\Project Ace\S3 STUDIO\s-gener8\src-tauri\src\shim.rs

Current decision summary:

- Keep the current Gener8 DAW format and audio-region engine.
- Add a Riff Bank / Generate Samples section underneath the DAW.
- Add a top bar ruler/phrase grid that calculates bars from BPM and time signature.
- Imported stems should align cleanly to the bar ruler via analysis and snapping.
- Standalone riff generation should use restricted ACE Text2Music first.
- ACE `lego` is internal only. User-facing name is Add Layer.
- Add Layer means: select existing audio, then generate one compatible new instrument layer from context.
- Do not expose "Lego" in UI text.
- Add Layer uses ACE `task_type = "lego"`, requires `src_audio`, and likely requires base/SFT rather than turbo.
- Riffs/layers should be stored as `RiffAsset` metadata, while timeline placement continues using existing DAW audio `Region`s.
- Microphone input and MIDI are in scope later, but the first slice is bar ruler + lower Riff Bank + restricted Generate Riff.

Updated implementation order:

1. S3 sync baseline first:
   - Port/adapt S3 `DawPage` into Everywear Gener8 as a DAW route/view.
   - Add a sidebar entry/route for DAW in the Everywear applet.
   - Port/adapt `dawApi` if needed.
   - Port/adapt `studioApi` task wrappers for extract, lego, repaint, complete, but rename user-facing Lego to Add Layer.
   - Port/adapt S3 model-default/model inventory expectations if Everywear shim lacks any required fields.
   - Compare S3 `shim.rs` generate payload handling against Everywear `shim.rs`; bring across any missing task_type/source_audio/model-default fixes carefully, keeping Everywear's split `shim/daw.rs`.
   - Do not import S3 Supabase auth or shell chrome into Everywear.
   - Keep React 18 / Everywear package versions unless a separate migration is explicitly approved.
2. After S3 sync builds cleanly, implement the riff first slice:
   - Add shared bar-grid helpers:
   - beats_per_bar
   - ms_per_beat
   - ms_per_bar
   - bars_to_ms
   - ms_to_bar_beat_tick
   - snap_ms_to_beat/bar
   - S3 `DawPage` already has a simple `Ruler`; either reuse/adapt it or replace with a cleaner EWDS `BarRuler`.
3. Add a lower `RiffBankPanel` component with tabs:
   - Generate Riff
   - Riff Bank
   - Add Layer
   - Mic
   - MIDI
   The first pass can use placeholder tab content, but layout should preserve existing DAW controls.
4. Add restricted Generate Riff UI controls:
   - prompt
   - riff type
   - bars: 4, 8, 16, 32
   - BPM inherited from project/default 120
   - key/time signature fields
   - seed
5. Do not wire real ACE riff generation until the UI/layout and data contracts are stable.
6. Keep EWDS styling conventions. Do not copy S3 or openDAW visual styling wholesale.
7. After implementation, run the relevant build for Gener8 web.

Repo context:

- There is already an ACE server manager in applets/gener8/src-tauri/src/ace_server.rs.
- Existing DAW routes live in applets/gener8/src-tauri/src/shim/daw.rs.
- Existing DAW model is ms-based and already has BPM/time signature fields.
- Existing transport can compute bar/beat/tick.
- Existing beat analysis exists under applets/gener8/src-tauri/src/beats.
- openDAW reference checkout exists at C:\Users\MAG MSI\Project Claude\openDAW. Borrow concepts only: TimeAxis, SnapSelector, CaptureAudio, CaptureMidi, PianoRoll, SoundFont direction.
- S3 upstream has a useful `DawPage` with a simple bar ruler already, plus `DawCore`, `LegoPanel`, `CompletePanel`, and `studioApi` wrappers. Use these as the immediate migration source before riff work.

Current new/untracked docs from prior context:

- docs/gener8-riff-daw-architecture.md
- docs/gener8-riff-daw-todo.md
- docs/vault/2026-05-22_gener8-riff-daw-add-layer.md
- docs/vault/2026-05-23_gener8-s3-sync-before-riff-daw.md

Please start by checking `git status --short`, then implement the first slice carefully.
```
