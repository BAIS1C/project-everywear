# Handoff: Gener8 Vault Library Fixes

Date: 2026-05-24

## User Direction

Stop patching symptoms. Everywear Vault must be a full cross-applet AI repository, not a flat media library. Gener8 must preserve S3 suite functionality while moving onto the Vault-backed architecture.

The Vault should emulate the original library behavior through typed sections:

- Gener8 Songs
- Stems
- Riffs
- Samples
- References
- Cover Sources
- Local Audio
- Videos
- Logs
- Contexts
- Conversations
- Style Patches
- Visual Patches
- Trait Shards
- Skill Shards

Files the user owns or imports as reference/cover/local audio should stay where they are on disk whenever possible. If ACE-Step needs a fixed path, stage a temporary copy or link under `~/.everywear/staging/gener8/<job_id>/` and clean it up after the job.

## Current Symptoms

- Library import now shows rows, but many names are `track_#`.
- Those `track_#` rows are stems imported from paths like `Documents/Everywear Vault/Audio/Stems/Gener8 Legacy/.../stems/<song>/track_8.mp3`.
- They should not appear in the main Songs library.
- Library playback is broken or unreliable.
- Generated Gener8 song flow works better than library playback.
- User expects the port to preserve all S3 suite behavior, not lose functionality in Gener8, DAW, Creator Studio, Style Forge, or future Character Studio.

## Important Findings So Far

- Legacy S3 per-user library exists at:
  `C:\Users\MAG MSI\AppData\Local\S3-Gener8\users\0a4423db-4a59-43b3-9008-676bc49092d2\library.json`
- That file has real song titles such as `Tsunami of Love`, real `audioKey`, `duration`, `createdAt`, `style`, lyrics, and other song metadata.
- Everywear Vault audio files exist under:
  `C:\Users\MAG MSI\Documents\Everywear Vault\Audio`
- The migration imported both songs and stems, but the frontend reads `vaultSearch('', 'audio', 'newest', ...)` and treats every audio item as a song.
- `packages/transport/src/vault.ts` had a TODO-style manual `http://asset.localhost/${encodeURIComponent(path)}` URL builder. It should use Tauri `convertFileSrc`.

## Edits Already Made Before Hold

These edits exist in the working tree and were made before the user said to hold fire:

- `packages/transport/src/vault.ts`
  - Changed `vaultFileUrl()` to use `convertFileSrc(filePath)`.
- `applets/gener8/web/src/context/SongStoreContext.tsx`
  - Temporarily filtered `item.media_type === 'audio' && !item.is_stem` in `fetchMySongs`.
  - Improved Vault field mapping for `duration_seconds`, `lyrics_text`, `genre`, and Unix timestamps.
- `applets/gener8/web/src/services/api.ts`
  - Temporarily filtered `!item.is_stem` in `/api/songs` compatibility paths.
- Earlier in the same session:
  - Model dropdown inventory normalization was added in `platform/everywear-os/src-tauri/src/gener8_engine.rs`, `applets/gener8/src-tauri/src/shim.rs`, and `applets/gener8/web/src/services/api.ts`.
  - Dropdown labels were reduced to `SONG`, `PRO`, or `MODEL` in `CreatePanel.tsx`.
  - ACE sidecar DLL folder launch fix was added in `applets/gener8/src-tauri/src/ace_server.rs`.
  - `~/.everywear/bin/ace-server` was populated with the ACE DLLs and binaries from the old S3 sidecar folder.

Do not assume the temporary `!is_stem` filter is the final architecture. It is a symptom guard. The real fix is typed Vault sections and views.

## Required Next Implementation Plan

1. Define a typed Vault asset taxonomy.
   - Add an `asset_kind` or equivalent field for audio and non-audio assets.
   - Required audio kinds: `gener8_song`, `stem`, `riff`, `sample`, `reference`, `cover_source`, `cover_output`, `local_audio`.
   - Required patch kinds: `style_patch`, `visual_patch`.
   - Required Mait/agent kinds: `trait_shard`, `skill_shard`, `conversation`, `context`, `log`.

2. Preserve old S3 library semantics.
   - Import `library.json` metadata into Vault documents.
   - Finished songs should keep title, style/genre, lyrics, duration, bpm, key signature, created time, tags, and original audio key linkage.
   - Stems should be grouped by parent song/session and not displayed as songs.

3. Fix playback.
   - Use Tauri `convertFileSrc` for absolute Vault/local paths.
   - Verify `asset.localhost` URLs work in the shell CSP and asset protocol scope.
   - Confirm the shell audio player receives playable URLs and non-zero durations.

4. Add Vault section views rather than flattening.
   - Main library shows `Gener8 Songs`.
   - DAW/Creator Studio can browse Stems, Riffs, Samples, References, Cover Sources, and Local Audio.
   - Future Style Forge browses Style Patches.
   - Future Character Studio browses Visual Patches and Character Assets.

5. Use staging for engine compatibility.
   - Do not move user reference/cover/local audio by default.
   - Stage per job only when ACE-Step requires a local engine path.

## Verification To Run

- `npm run build` in `applets/gener8/web`
- `npm run build` in `platform/everywear-os`
- `cargo check -p everywear-os`
- `cargo check -p gener8`
- Release builds only after behavior is correct:
  - `cargo build -p everywear-os --release`
  - `cargo build -p gener8 --release`
- Manual smoke:
  - Open `C:\Users\MAG MSI\Project Everywear\target\release\everywear-os.exe`
  - Gener8 model dropdown shows only `SONG` / `PRO`, not raw filenames.
  - Songs list does not show `track_#` stems.
  - Main player plays a legacy imported song.
  - Stem assets are still accessible from DAW/Studio-specific sections.
  - Reference/Cover flows preserve source files and use staging only for ACE jobs.

## Related Notes

- Repo note: `docs/vault/2026-05-24_everywear-vault-cross-applet-ai-repository-canon.md`
- MKV note: `C:\Users\MAG MSI\Project Mymory\strands\2026-05-24_everywear_vault_cross_applet_ai_repository_canon.md`

