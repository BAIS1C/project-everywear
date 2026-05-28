# 2026-05-23 Gener8 Riff DAW S3 Test Sync

Decision/update: the first riff DAW UI slice now exists in both Everywear
Gener8 and S3 Studio Web so the workflow can be tested in S3.

Everywear changes:

- Added `applets/gener8/web/src/views/DawView.tsx`.
- Added the `/daw` route and sidebar entry.
- Added DAW-local services:
  - `applets/gener8/web/src/services/dawApi.ts`
  - `applets/gener8/web/src/services/studioApi.ts`
- Added frontend bar-grid helpers:
  - `applets/gener8/web/src/lib/barGrid.ts`
- The DAW view has a fixed horizontal Create/Riff pane below the track
  timeline.
- The riff pane exposes only `Riff Model` as the user-facing model name.
  Do not expose ACE-Step filenames or model variants in this riff UI.
- `Add Layer` remains the user-facing name for internal ACE `taskType = "lego"`.

S3 Studio test changes:

- Updated:
  - `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\components\studio\DawPage.tsx`
- Added the same fixed horizontal Create/Riff pane below the S3 DAW timeline.
- Added lower tabs:
  - Riff Bank
  - Add Layer
  - Mic
  - MIDI
- S3 testing should happen in `s3studio-web` first.

Verification:

- Everywear Gener8 web: `npm run build` passed.
- S3 Studio Web: `npm run typecheck` passed.
- S3 Studio Web: `npm run build` passed.

Notes:

- S3 `npm run build` updates tracked `client-dist` assets. Expect generated
  dist changes alongside `src/components/studio/DawPage.tsx` unless those are
  intentionally reverted or excluded before commit.
- Current first slice is UI/scaffold only. Real riff generation is not wired
  yet.
