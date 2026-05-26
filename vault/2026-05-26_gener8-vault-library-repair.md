# 2026-05-26 Gener8 Vault Library Repair

## Verified Input

- User-facing debug UI showed Gener8 banner copy exposing the underlying music model name.
- Everywear Vault debug UI showed 1,221 audio items, 144 stems, 0 images, and 0 videos.
- The newest migration receipt on disk was `~/.everywear/.migration/phase5-gener8-vault-audio-20260526T084107Z.json`.
- `WIKI.md` and `docs/wiki/README.md` had not been updated since May 22 before this pass.

## Repair Contract

- User-facing Gener8 and 1magen descriptions use product/runtime-neutral names.
- Gener8 uploaded reference/source audio registers into Vault with `reference` or `cover_source`.
- Gener8 video export registers saved MP4 output through `vault_register_video`.
- Gener8 completed-song UI keeps the temporary item visible until Vault persistence succeeds or fails visibly.
- Vault and Gener8 song lists prefer the real file stem when legacy indexed titles are only placeholders such as `track_#`, `Gener8 output`, or UUID names.
- Legacy Gener8 audio kind inference recognizes reference filenames and extracted track stems instead of classifying every legacy audio file as a song.

## Wiki Update

- Updated root `WIKI.md` with a 2026-05-26 Gener8/Vault addendum.
- Added `docs/wiki/gener8/vault-library.md`.
- Linked the new module page from `docs/wiki/README.md`.

## Follow-up Repair

- Located authoritative S3 user library metadata at `C:\Users\MAG MSI\AppData\Local\S3-Gener8\users\0a4423db-4a59-43b3-9008-676bc49092d2\library.json`.
- Located legacy S3 videos at `C:\Users\MAG MSI\Videos\Strands Sound Studio`.
- Changed legacy audio import so already-indexed files are reindexed with repaired metadata instead of skipped.
- Added legacy video import to the Gener8 Vault import command.
- Changed Vault registration destination naming so generated outputs keep readable source filenames rather than UUID-only filenames.
- Added one-time repair gating for the frontend Vault import so opening the Vault does not force the full import every time.

## Second Follow-up Repair

- Changed Vault audio reindex repair to remove stale duplicate audio documents with the same file path before writing the corrected document. This prevents old `gener8_song` rows from surviving after a stem/reference is repaired.
- Moved the local S3 library repair trigger into the Gener8 song store as well as Vault, so the Gener8 workspace can hydrate from the same S3 body of work without requiring a Vault visit first.
- Updated the repair key to force this dedupe pass once on the next run.
- Updated Tauri CSP so Vault-backed `asset:` media URLs are allowed for image and audio playback.
