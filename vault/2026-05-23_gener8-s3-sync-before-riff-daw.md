# 2026-05-23 Gener8 S3 Sync Before Riff DAW

Decision: sync the significant S3 Studio Gener8/DAW upstream changes into the
Everywear Gener8 applet before implementing the new Riff DAW feature.

Reason:

- S3 upstream already has a Rust-backed `DawPage` with a bar ruler.
- S3 upstream already has `LegoPanel`, `CompletePanel`, `DawCore`, stem tabs,
  and `studioApi` wrappers for `extract`, `lego`, `repaint`, and `complete`.
- Everywear's current Gener8 applet is behind that surface and only exposes
  Create, Library, Settings, and a simple transport bar.
- Building Riff Bank directly on the stale applet would create work that must
  be redone after the S3 migration.

Recommendation:

1. Port/adapt the relevant S3 surfaces into Everywear first.
2. Keep Everywear shell/auth/EWDS boundaries.
3. Do not copy S3 Supabase auth or shell chrome.
4. Keep S3 "Lego" internal but rename user-facing labels to **Add Layer**.
5. After the S3 baseline builds in Everywear, add the new Riff Bank section.

Primary S3 source files:

- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\DawPage.tsx`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\LegoPanel.tsx`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\CompletePanel.tsx`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\shell\applets\DawCore.tsx`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\services\api.ts`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\services\dawApi.ts`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\CreatePanel.tsx`
- `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s-gener8\src-tauri\src\shim.rs`

Everywear target surfaces:

- `applets/gener8/web/src/App.tsx`
- `applets/gener8/web/src/components/Sidebar.tsx`
- `applets/gener8/web/src/views/*`
- `applets/gener8/web/src/services/*` if created
- `applets/gener8/src-tauri/src/shim.rs`
- `applets/gener8/src-tauri/src/shim/daw.rs`

Migration shape:

- Add a DAW route/view to the Everywear Gener8 applet.
- Port S3 `DawPage` as the initial timeline UI, adapting API base and EWDS
  tokens.
- Port `dawApi` and studio task wrappers as narrow services.
- Compare S3 shim generate payload mapping against Everywear shim and pull in
  missing `task_type`, source audio, model default, and supported task metadata
  fixes.
- Preserve Everywear's modular `shim/daw.rs` split.

Then continue with the Riff DAW work:

- Add lower `RiffBankPanel`.
- Add restricted `Generate Riff`.
- Add `Add Layer` as the user-facing wrapper around ACE `lego`.
- Store generated riffs/layers as `RiffAsset` metadata while timeline placement
  remains existing DAW audio `Region`s.

