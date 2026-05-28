# 2026-05-26 My Maits Local Live Transcription Skill

## Source Reference

Reference plugin:

`https://github.com/aviz85/claude-skills-library/tree/main/plugins/live-transcribe`

The reference plugin is useful because it defines a simple agent workflow:
start microphone transcription, let the agent read a live-updating transcript
file, and stop through chat, voice phrase, or sentinel file. Its implementation
uses ElevenLabs Scribe realtime WebSocket, but Everywear should not copy that
provider dependency.

## Decision

Build this as a Kasai/My Mait local skill, not a cloud STT integration.

Use the reference plugin's interaction contract:

- `start`
- `read`
- `stop`

Replace the ElevenLabs API path with local speech-to-text:

- preferred candidates: `whisper.cpp`, `faster-whisper`, or `whisper-rs`
- no API key
- no cloud transcript upload
- local model selection based on hardware and tier

## Why This Fits Kasai

Kasai already has:

- a portable skill list surface in the shell compatibility layer
- `ToolExecutor` dispatch with shell-call and filesystem paths
- local model/runtime ownership through the Everywear shell
- MyMory compatibility for durable notes and user-approved memory writes

Live transcription should become a local skill that Kasai can orchestrate, not a
random shell script hidden outside the app.

## Desired UX

User phrases:

- "start live transcription"
- "transcribe what I say"
- "what did I say?"
- "read the transcript"
- "stop transcription"

Voice stop phrase:

- "ok stop transcribing"
- add localized variants later

Runtime behavior:

- capture microphone audio
- stream or batch chunks into local STT
- write committed transcript text to a live transcript file
- expose partial/current status to Kasai
- stop gracefully from chat, tool call, or stop sentinel
- optionally play local start/stop/reminder audio cues

## Everywear Storage Contract

Do not use `/tmp` as the product path except in dev-mode fallback.

Recommended session root:

`<Everywear data>/kasai/transcription/sessions/<session_id>/`

Files:

- `transcript.txt`
- `status.json`
- `stop.signal`
- `capture.wav` or segmented PCM/WAV chunks if recording is enabled
- `events.jsonl` for debugging and recovery

Final outputs:

- transcript can be appended to MyMory after explicit user approval
- captured audio can be registered into Everywear Vault as `local_audio`

## Local Engine Options

### Fast Implementation

Python sidecar:

- `sounddevice` for microphone capture
- `numpy` for PCM chunks
- `faster-whisper` for local transcription
- `rapidfuzz` for fuzzy stop phrase detection

Pros: fastest to prototype.

Cons: packaging and CUDA/runtime dependency management must be cleaned up before
shipping.

### Product Implementation

Rust/sidecar hybrid:

- `cpal` for capture
- local ring buffer and WAV/PCM session writer
- `whisper.cpp` or `whisper-rs` worker for transcription
- shell-owned process lifecycle and health status

Pros: better Everywear fit, cleaner local packaging, predictable lifecycle.

Cons: more work before first demo.

## Command Contract Draft

Shell or Kasai commands:

- `transcription_start({ language?, model?, device_id?, save_audio? })`
- `transcription_status({ session_id? })`
- `transcription_read({ session_id?, tail_chars? })`
- `transcription_stop({ session_id?, force? })`

Return shape:

```json
{
  "status": "running",
  "session_id": "tx-...",
  "transcript_path": "...",
  "started_at": "...",
  "words": 0,
  "engine": "local-whisper"
}
```

## Integration Notes

- Add a `local-live-transcribe` skill card to `list_installed_skills`.
- Add a dedicated `TranscriptionTool` branch in Kasai's tool executor, or route
  through shell commands if microphone permissions belong to the shell.
- Keep microphone permission UI explicit.
- Avoid shelling out as the primary API once productized.
- Let Kasai read transcript state through structured commands rather than raw
  filesystem paths.

## Non-Goals

- No ElevenLabs API.
- No cloud speech-to-text.
- No cloud TTS for cues.
- No automatic MyMory writes without user approval.
- No always-on background recorder without an obvious active indicator.

## Next Pass

1. Decide Python prototype vs Rust product-first path.
2. Add `local-live-transcribe` to Kasai's skill list as `planned` or `idle`
   depending on whether the sidecar exists.
3. Implement the local session directory and status file contract.
4. Prototype microphone capture and local Whisper transcription.
5. Wire `start/read/stop` into Kasai's tool execution path.
