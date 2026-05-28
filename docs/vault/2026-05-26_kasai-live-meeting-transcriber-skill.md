# Kasai Live Meeting Transcriber Skill

Date: 2026-05-26

Reference:
https://github.com/aviz85/claude-skills-library/tree/main/plugins/zoom-meeting/skills/zoom-meeting

Related local notes:

- `docs/vault/2026-05-26_kasai-local-live-transcription-skill.md`
- `docs/vault/2026-05-26_kasai-youtube-ingest-content-skill.md`

## Summary

The referenced Zoom skill is not a transcription plugin. It is a scheduler:
look up a contact, check calendar conflicts, create a Zoom meeting, create a
calendar invite, optionally notify the contact, and confirm the meeting details.

For Everywear, the useful idea is the meeting lifecycle. A live meeting
transcriber should build on that lifecycle:

1. Know which meeting or call is happening.
2. Start local capture with explicit consent.
3. Transcribe live into a readable file.
4. Let Kasai answer questions while the meeting is still happening.
5. Finalize transcript, summary, action items, decisions, and follow-ups.
6. Store the meeting memory in Vault/MyMory when approved.

## Decision

Build a platform-aware, local-first `live-meeting-transcriber` Kasai skill.

Zoom can be the first scheduling provider, but transcription should not depend
on Zoom APIs. The capture layer should work with:

- Zoom
- Google Meet
- Microsoft Teams
- browser meetings
- in-person microphone meetings
- imported audio/video recordings

The first product pass should reuse the local live transcription path rather
than introduce a new STT stack.

## Command Contract

Proposed commands:

- `meeting_probe({ url?, calendar_event_id? })`
  - Detects provider, title, known attendees, scheduled time, and meeting URL.
- `meeting_schedule({ provider, title, attendees, starts_at, duration })`
  - Optional scheduling path inspired by the Zoom reference.
- `meeting_transcription_start({ meeting_id?, source, language?, save_audio? })`
  - `source`: `microphone`, `system_audio`, `browser_tab`, or `recording`.
- `meeting_transcription_status({ session_id })`
  - Returns active/stopped/finalizing state, transcript path, elapsed time, and
    current token/chunk count.
- `meeting_transcription_read({ session_id, tail_chars? })`
  - Reads the live transcript while the meeting is still running.
- `meeting_transcription_stop({ session_id, finalize? })`
  - Stops capture gracefully and optionally runs final cleanup.
- `meeting_summarize({ session_id, style? })`
  - `style`: `brief`, `executive`, `client`, `engineering`, or `sales`.
- `meeting_extract_actions({ session_id })`
  - Extracts action items, owners, due dates, open questions, and decisions.
- `meeting_save_memory({ session_id, destination })`
  - Saves transcript and notes into Vault/MyMory after user approval.

## Storage Shape

Store sessions under:

`<Everywear data>/kasai/meetings/<meeting_id-or-session_id>/`

Expected files:

- `metadata.json`
- `participants.json`
- `transcript.live.txt`
- `transcript.final.txt`
- `speaker_segments.jsonl`
- optional `audio.wav`
- optional chunked audio under `audio_chunks/`
- `summary.md`
- `actions.md`
- `decisions.md`
- `followups.md`

## Local Transcription Path

Use the same local STT layer planned for live transcription:

- Rust capture option: `cpal` for microphone/system audio capture, then stream
  16 kHz mono PCM chunks to a local Whisper-compatible worker.
- Python prototype option: `sounddevice` plus `faster-whisper`.
- Packaging options: `whisper.cpp`, `whisper-rs`, or `faster-whisper` sidecar.

No ElevenLabs dependency. No cloud STT dependency for the default feature.

## Speaker Handling

First pass:

- Use simple stable labels: `Speaker 1`, `Speaker 2`, etc.
- Let the user rename speakers after the meeting.
- Keep a `participants.json` file that maps labels to names only when known.

Later:

- Add local diarization if the packaging/performance cost is acceptable.
- Add calendar/contact hints to suggest speaker names, but require user
  confirmation before committing names.

## Meeting Intelligence Outputs

At finalization, produce:

- concise meeting summary
- action items with owner and due date when available
- decisions made
- unresolved questions
- follow-up message draft
- optional CRM/client note
- optional engineering ticket summary

Kasai should be able to answer during the meeting:

- "what did they say about pricing?"
- "what decisions have we made?"
- "what are my action items so far?"
- "summarize the last ten minutes"

## Integration Points

- Kasai skill list: add `live-meeting-transcriber`.
- Shell/Tauri: own microphone/system-audio permissions and process lifecycle.
- Vault: register optional audio or video recordings.
- MyMory/Knowledge: store transcript, summary, action items, and decisions.
- Calendar/contact layer: schedule meetings or attach transcript sessions to an
  existing calendar event.
- YouTube ingest: reuse transcript chunking/search/drafting patterns for
  imported meeting recordings or webinars.

## Guardrails

- Require explicit user action before recording or transcribing a live meeting.
- Display a clear active transcription state.
- Do not silently join meetings.
- Do not silently record system audio.
- Do not auto-send meeting notes, action items, or follow-ups.
- Treat transcripts as private by default.
- Do not infer sensitive participant identity from voice without explicit user
  confirmation.
- Keep a clear error state when capture fails, permissions are missing, or local
  transcription falls behind.

## First Implementation Pass

1. Add the skill entry and command contract as planned/disabled.
2. Reuse the local live transcription start/read/stop backend.
3. Add meeting session storage and metadata files.
4. Add summarize/action-item extraction over finalized transcripts.
5. Attach outputs to Vault/MyMory only after user approval.
6. Add provider-specific scheduling later, starting with Zoom only if the user
   wants calendar meeting creation inside Everywear.
