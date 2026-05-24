# 2026-05-24 Gener8 Vault Typed Section Fixes

## Scope

Implemented the first real Everywear Vault taxonomy pass for Gener8 library fixes. The goal was to stop treating every audio item as a song and to preserve legacy S3 song semantics while keeping stems and future reusable assets in typed sections.

## Changes

- Added `asset_kind` exposure for Vault audio documents, inferred from explicit metadata, `asset:<kind>` tags, stem state, and applet ownership.
- Added backend audio filters for `gener8_song`, `riff`, `sample`, `reference`, `cover_source`, `cover_output`, and `local_audio`.
- Updated Gener8 song reads to query `gener8_song` rather than all audio or `!is_stem`.
- Updated legacy S3 audio import to read `library.json` metadata and reindex matching finished songs with title, style, lyrics, duration, BPM, key, created time, and tags.
- Marked generated and manually saved Gener8 outputs as `assetKind: gener8_song`.
- Added Vault UI tabs for Gener8 Songs, Stems, Riffs, Samples, References, Cover Sources, Local Audio, Images, Videos, and Favorites.
- Replaced the Vault detail audio placeholder with an HTML audio preview using the existing Vault file URL resolver.
- Fixed the standalone Gener8 web entrypoint to include the same provider stack used by the shell app, resolving the `useResponsive must be used within a ResponsiveProvider` blank-screen failure in preview.

## Verification

- `npm run build --workspace @everywear/transport` passed.
- `npm run build --workspace @everywear/gener8-web` passed.
- `npm run build` in `platform/everywear-os` passed.
- `cargo check -p everywear-os` passed with existing warnings.
- `cargo check -p gener8` passed with existing warnings.
- `cargo test -p ew-vault` passed.
- `cargo test -p everywear-os migration::tests` passed.
- Browser smoke against `http://127.0.0.1:4173/` confirmed the standalone Gener8 app renders after the provider fix. Plain browser preview still logs expected Tauri `invoke` warnings because it is not running inside the Tauri shell.

