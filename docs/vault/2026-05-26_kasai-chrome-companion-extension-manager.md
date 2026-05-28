# Kasai Chrome Companion Extension Manager

Date: 2026-05-26

References checked:

- Chrome Native Messaging:
  https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Chrome `tabCapture`:
  https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Chrome Side Panel:
  https://developer.chrome.com/docs/extensions/reference/sidePanel/
- Chrome Web Store payments deprecation:
  https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/webstore/cws-payments-deprecation/index.md
- Existing local entitlement note:
  `docs/vault/2026-05-18_auth-tier-gating-audit-hybrid-pricing.md`

## Summary

Instead of depending on an Everywear in-app browser for Google/YouTube login,
meeting apps, chat apps, and transcription workflows, build a normal-browser
companion extension.

Kasai becomes the plugin manager and local intelligence layer:

- install/register the native host
- verify entitlement
- receive page/tab/audio/caption events
- run local transcription
- summarize and extract actions
- save memory to Vault/MyMory

The Chrome extension remains a thin capture and control surface inside the
user's normal browser.

## Why This Direction Wins

The user keeps:

- normal Chrome profile
- existing YouTube/Google sign-in
- existing meeting sessions
- existing ChatGPT/Claude/Gemini/chat app sessions
- normal browser security prompts
- normal password manager behavior

Everywear avoids:

- embedded WebView sign-in blocks
- fragile iframe behavior
- trying to become a whole browser too early
- storing third-party cookies inside the app

This is especially useful for transcription and research because most source
material is already open in the user's browser.

## Components

### Chrome Extension

Proposed package name:

`everywear-chrome-companion`

Responsibilities:

- side panel UI for Kasai controls
- extension action button for user-invoked capture
- content scripts for supported pages
- service worker for routing messages
- optional host permissions by domain
- tab audio capture when explicitly activated
- DOM caption/text extraction where available
- native messaging connection to Everywear

### Native Messaging Host

Registered by Everywear desktop.

Responsibilities:

- accept messages only from the allowed extension ID
- forward requests to the local Everywear/Kasai bridge
- stream transcript status back to the extension
- expose installed/entitled capability status
- avoid direct cloud upload unless the user enabled a cloud feature

### Everywear/Kasai Local Host

Responsibilities:

- local STT worker lifecycle
- transcript session storage
- summarization and action extraction
- Vault/MyMory persistence
- entitlement verification
- skill routing
- audit log for capture start/stop

## Capture Modes

### Caption/Text Mode

Preferred where available.

Supported examples:

- YouTube captions
- Google Meet captions
- Zoom web captions
- Teams web captions
- chat app conversation text selected by the user

Benefits:

- lower CPU/GPU cost
- less audio privacy risk
- better timestamps when the site exposes them

### Tab Audio Mode

Use Chrome `tabCapture` after a user action.

Good for:

- meetings without captions
- livestreams
- webinars
- videos without captions

Limitations:

- active tab only unless permissions allow target tab behavior
- must preserve playback to user after capture starts
- not a general whole-system audio recorder

### Manual Selection Mode

User selects page text or a chat range and sends it to Kasai.

Good for:

- ChatGPT/Claude/Gemini summaries
- customer support threads
- research pages
- social posts

## Command Contract

Extension-facing commands:

- `companion_connect({ extension_version, browser, profile_hint? })`
- `companion_status()`
- `companion_start_capture({ tab_id, url, mode, source_kind })`
- `companion_stop_capture({ session_id })`
- `companion_push_caption({ session_id, text, timestamp?, speaker? })`
- `companion_push_audio_chunk({ session_id, chunk, format, timestamp })`
- `companion_push_selection({ url, title, text, metadata? })`
- `companion_read_transcript({ session_id, tail_chars? })`
- `companion_summarize({ session_id, style? })`
- `companion_extract_actions({ session_id })`
- `companion_save_memory({ session_id, destination })`
- `companion_check_entitlement({ feature })`

## Storage Shape

Store sessions under:

`<Everywear data>/kasai/browser-companion/<session_id>/`

Expected files:

- `metadata.json`
- `source.json`
- `transcript.live.txt`
- `transcript.final.txt`
- `events.jsonl`
- optional `audio_chunks/`
- `summary.md`
- `actions.md`
- `memory.md`

## One-Off Payment Model

Do not make browser transcription subscription-only.

Use one-off entitlement packs:

- `browser_companion_basic`
- `meeting_transcriber_pack`
- `youtube_research_pack`
- `chat_app_memory_pack`
- `creator_research_pack`
- `team_commercial_license`

Chrome Web Store payments are deprecated, so checkout should happen through the
Everywear account/payment stack, likely the same Lemon Squeezy/Supabase
entitlement direction already captured for Gener8.

The extension should not be the payment authority. It asks Everywear:

`companion_check_entitlement({ feature })`

Everywear answers with:

- owned/not owned
- trial/dev/manual/source
- feature limits
- checkout URL if not owned

## Product UX

The extension side panel should show:

- connected/disconnected state
- local Kasai host state
- current tab/site support state
- license state
- start/stop capture
- live transcript tail
- summarize
- extract actions
- save to MyMory
- send to Kasai chat

The desktop app should show:

- installed extension status
- native host status
- browser companion entitlements
- recent sessions
- permission/capture audit history

## Guardrails

- Capture must be user-invoked.
- Capture must show an active state.
- Stop must always be visible.
- Do not request broad `<all_urls>` permission in the first pass.
- Do not collect cookies, passwords, tokens, or hidden fields.
- Do not silently read chat apps.
- Do not send private page text to cloud services by default.
- Meeting transcription should remind the user to follow consent laws and
  meeting norms.
- Keep local logs of start/stop events for user trust.

## First Implementation Pass

1. Create a minimal MV3 extension with action button and side panel.
2. Add Native Messaging host registration in Everywear desktop.
3. Implement `companion_connect`, `companion_status`, and
   `companion_check_entitlement`.
4. Support manual selection capture first.
5. Add YouTube caption extraction.
6. Add tab audio capture and local STT.
7. Add meeting-specific capture presets.
8. Add one-off entitlement checks and checkout links.
