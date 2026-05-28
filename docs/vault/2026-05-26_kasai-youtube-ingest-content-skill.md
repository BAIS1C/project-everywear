# Kasai YouTube Ingest And Content Skill

Date: 2026-05-26

Reference:
https://github.com/aviz85/claude-skills-library/tree/main/plugins/youtube-downloader

## Summary

The referenced YouTube downloader plugin is a compact `yt-dlp` plus `ffmpeg`
skill. Its useful pieces are format listing, quality presets, audio-only
extraction, and a simple command-line wrapper.

For Everywear, the better shape is not just "download a YouTube video." The
better product skill is:

1. Probe the video.
2. Capture captions or make a local transcript.
3. Search the transcript.
4. Draft useful content from the transcript.
5. Store everything in Vault/MyMory with enough metadata to revisit later.

This can supersede older loose YouTube scripts once those scripts are compared
against the command contract below.

## Decision

Build a local-first `youtube-ingest` Kasai skill. Use `yt-dlp` and `ffmpeg` as
the backend tools, but keep them behind shell-owned commands so Kasai does not
blindly run arbitrary downloader scripts.

The primary use case is:

> grep a YouTube video, then write an article, LinkedIn post, tweet/thread, or
> Facebook post based on the information in that video.

## Command Contract

Proposed commands:

- `youtube_probe({ url })`
  - Returns title, channel, duration, upload date, description, thumbnail,
    available captions, available formats, and detected video ID.
- `youtube_download({ url, mode, quality?, destination? })`
  - `mode`: `metadata`, `captions`, `audio`, `video`, or `thumbnail`.
  - `quality`: `share-small`, `standard`, `high`, or `best`.
- `youtube_transcribe({ source, language?, prefer_captions? })`
  - Uses official captions first when requested and available.
  - Falls back to local Whisper-compatible transcription for audio.
- `youtube_search_transcript({ video_id, query })`
  - Searches timestamped transcript chunks.
  - Returns matching ranges with short snippets.
- `youtube_draft_content({ video_id, target, angle?, tone?, length? })`
  - `target`: `article`, `linkedin`, `tweet`, `thread`, or `facebook`.
  - Uses transcript chunks and metadata as source material.
  - Includes timestamp/source references in the draft metadata.

## Storage Shape

Store each ingest session under:

`<Everywear data>/kasai/youtube-ingest/<video_id>/`

Expected files:

- `metadata.json`
- `transcript.vtt`, `transcript.srt`, or `transcript.txt`
- `chunks.jsonl`
- optional `audio.m4a`
- optional `video.mp4`
- optional `thumbnail.jpg`
- `drafts/article.md`
- `drafts/linkedin.md`
- `drafts/tweet-thread.md`
- `drafts/facebook.md`

## Local Stack

Backend:

- `yt-dlp` for probe, captions, thumbnail, and media download.
- `ffmpeg` for audio extraction and conversion.
- local Whisper-compatible engine for audio transcription:
  - `whisper.cpp`
  - `faster-whisper`
  - `whisper-rs`

This connects directly to the local live transcription design captured in:

`docs/vault/2026-05-26_kasai-local-live-transcription-skill.md`

## Integration Points

- Kasai should expose this as a named skill, not as raw scripts.
- Layer U OSINT can surface YouTube/video ingest results and searched snippets.
- Everywear Vault can register optional downloaded audio/video media.
- MyMory/Knowledge should eventually store transcript text, extracted claims,
  summaries, and finished drafts.
- Gener8/social surfaces can reuse the content-drafting output, but posting must
  remain user-confirmed.

## Drafting Behavior

For an article:

- Create a working title.
- Extract the main claims or story arc.
- Use transcript timestamps as source references.
- Flag weak, ambiguous, or unsupported claims.

For LinkedIn:

- Lead with a professional insight.
- Keep it grounded in the transcript.
- Include a clear takeaway or question for discussion.

For tweet/thread:

- Keep each post concise.
- Preserve timestamp/source references in metadata, even if they are not visible
  in the final short post.

For Facebook:

- Use a conversational summary.
- Avoid pretending the post is personal experience unless the user asks for that
  and the transcript supports it.

## Guardrails

- Default to metadata, captions, audio-only, and transcript summaries.
- Full video download should be explicit and user-authorized.
- Never auto-post generated content.
- Do not claim a complete transcript when captions are missing or local
  transcription failed.
- Keep copyright and platform terms in mind: this is for authorized analysis,
  personal knowledge, and drafting.

## First Implementation Pass

1. Locate and compare any existing user downloader scripts.
2. Add a small shell-side command wrapper around `yt-dlp`.
3. Support `probe`, `captions`, and `audio` before full video download.
4. Reuse the local transcription path for audio fallback.
5. Add transcript chunking and search.
6. Add draft generation with timestamp references.
