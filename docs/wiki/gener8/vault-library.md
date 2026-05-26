# Gener8 Vault Library Module Contract

### gener8-vault-library (`applets/gener8/web/src/context/SongStoreContext.tsx`, `applets/gener8/web/src/views/LibraryView.tsx`, `platform/everywear-os/src-tauri/src/vault_commands.rs`, `crates/vault/src/index.rs`)

**Purpose**: Treat the Everywear Vault as the canonical Gener8 library for songs, stems, references, cover sources, local audio, images, and videos.

**Budget**: This page covers the cross-module contract only. Keep code edits local to the shell transport, Vault backend, Gener8 library view, and Gener8 generation/video save paths unless the contract changes.

**Pipes in**:

- Gener8 generation status -> `vault_register_audio` with `asset_kind = gener8_song`
- Gener8 reference/source upload -> `vault_register_audio` with `asset_kind = reference` or `cover_source`
- Gener8 video export -> `vault_register_video`
- Legacy Gener8 migration receipt -> Vault audio index repair/import
- Vault search filters -> Gener8 Library and Vault tab views

**Pipes out**:

- `vault_search(..., gener8_song, ...)` -> Gener8 song list
- `vault_search(..., reference, ...)` -> Vault References tab
- `vault_search(..., cover_source, ...)` -> Vault Cover Sources tab
- `vault_search(..., stem, ...)` -> Vault Stems tab
- `vault_search(..., video, ...)` -> Vault Videos tab

**Public API**:

- `vault_register_audio`
- `vault_register_video`
- `vault_search`
- `vault_get_item`
- `run_gener8_vault_audio_import`
- `generateApi.uploadAudio(file, token, assetKind)`

**State**:

- Vault owns indexed media documents and file paths.
- Gener8 song store mirrors `asset_kind = gener8_song` from Vault.
- The legacy S3 import is an offline/local maintenance step for this machine.
  Gener8 workspace and Vault providers must read the finished index directly
  on open; they must not launch the import as part of normal UI hydration.
- Placeholder legacy names are display-only corrected in UI when the indexed title is synthetic.
- The local S3-to-Everywear bridge is a one-time repair for this user's
  existing S3 body of work, not a required workflow for new users.

**Rules**:

- No user-facing copy should name underlying model/runtime brands.
- Do not treat all audio as songs. Song, stem, reference, cover source, cover output, riff, sample, and local audio are distinct asset kinds.
- Do not delete a temporary generating song from the UI until the completed result has either been registered in Vault or visibly marked as a registration failure.
- Videos saved from Gener8 must be registered in Vault before reporting a completed save to the user.
- Generated files registered into Vault keep their readable source filename.
  They must not be renamed to UUID-only paths.
- Legacy imports reindex existing matching Vault documents when metadata
  rules change. An existing indexed file must not be skipped if its title,
  `asset_kind`, stem state, or media type needs repair.
- Reindex repair must remove stale duplicate audio documents for the same
  file path before writing the corrected document. Otherwise an older
  `gener8_song` row can keep a stem visible in the workspace.
- Repair imports must batch audio index writes. Do not commit Tantivy once per
  track; for this user's local S3 body of work, run the offline importer before
  launching the app so open-time work is just reading the finished Vault index.
- `MediaFilter::AudioKind(_)` must be included in the audio search branch.
  Without that branch, Gener8 Songs, References, Cover Sources, and Local Audio
  tabs can return zero even when documents are indexed correctly.
- Opening Vault should not force a full legacy import every time. One-time
  repair imports must be version-keyed, user-triggered, or run offline before
  app launch.
- Reference/Cover source picking must use Vault IPC (`vault_search`) rather
  than stale web routes such as `/api/reference-tracks`; those routes can
  return shell HTML in Tauri and break JSON parsing.
- Source picking should show usable audio kinds (`gener8_song`, `reference`,
  `cover_source`, `local_audio`) and exclude stems unless the UI is explicitly
  a stem workflow.
- Preview playback can use `vaultFileUrl()` / Tauri `asset:` URLs, but
  generation requests must keep the raw Vault file path so the Rust engine can
  resolve the source audio on disk.
- Vault-backed audio and image previews require Tauri CSP support for
  `asset:` URLs.

**Tests**: Re-run `npm run build --workspace applets/gener8/web` and `cargo check -p everywear-os` after edits that touch this contract.

**Last verified**: 2026-05-27, Codex Gener8/Vault repair pass. Verified with `npm run build --workspace applets/gener8/web`, `cargo run -p everywear-os --example vault_stats`, and `cargo tauri build --debug`. The debug app was rebuilt at `C:\Users\MAG MSI\Project Everywear\target\debug\everywear-os.exe`.
