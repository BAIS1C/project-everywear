# Gener8 Overnight Acceptance - Codex Moving To The Sun

Date: 2026-05-27
Owner: Codex

## Request

Run the rebuilt Everywear OS debug app overnight, test Gener8 plain generation,
Reference, and Cover using:

`G:\Studio Spaceman\Imael Angel - I'm Moving To The Sun (Dj Kenzo Remix).mp3`

Use fresh Codex-marked output names, progressive house direction, structured
lyrics, and record the result in the wiki/Vault.

## Prompt Material

Style direction used:

`melodic progressive house, hypnotic rolling groove, deep sidechained bass, warm analog low end, airy plucked arps, cinematic pads, evolving chord stabs, spacious reverb tails, restrained female vocal, late-night club tension, euphoric sunrise lift, 124 bpm, 4/4, clean wide stereo mix, no big-room EDM drop, no trap, no dubstep`

Original lyrics used instead of quoting online lyrics:

```text
[Intro 16 bars]
Instrumental: filtered kick, sub pulse, distant vocal chops, rising noise.

[Verse]
I was counting lights across the water
Every signal pulling me awake
Static on the line became a calling
Now the dark is starting to break

[Chorus]
We keep moving to the sun
Past the edge of what we know
Every heartbeat on the run
Turns the night to gold

[Bridge]
Hold the breath before the morning
Let the bassline carry us through

[Drop]
Instrumental: rolling bass, plucked arps, wide pads, vocal echo.

[Break]
When the shadows come undone
We are moving to the sun
```

## Results

- Rebuilt debug app path:
  `C:\Users\MAG MSI\Project Everywear\target\debug\everywear-os.exe`.
- ACE server was already running locally on `127.0.0.1:8080`.
- Source file existed and was readable.
- Plain text-to-music job completed. Output:
  `C:\Users\MAG MSI\Project Everywear\target\overnight-gener8\codex-moving-to-the-sun-plain.mp3`.
- Reference job completed with the supplied MP3 as `ref_audio`. Output:
  `C:\Users\MAG MSI\Project Everywear\target\overnight-gener8\codex-moving-to-the-sun-reference.mp3`.
- Cover job completed with the supplied MP3 as `audio` and `task_type=cover-nofsq`.
  Output:
  `C:\Users\MAG MSI\Project Everywear\target\overnight-gener8\codex-moving-to-the-sun-cover.mp3`.
- Plain and Reference outputs were 18 seconds for quick acceptance.
- Cover output was full source length, approximately 220.896 seconds, even
  though the test requested a short duration.

## Vault Registration

Generated files were copied to:

- `C:\Users\MAG MSI\Documents\Everywear Vault\Audio\Codex - Moving to the Sun - plain text2music.mp3`
- `C:\Users\MAG MSI\Documents\Everywear Vault\Audio\Codex - Moving to the Sun - reference test.mp3`
- `C:\Users\MAG MSI\Documents\Everywear Vault\Audio\Codex - Moving to the Sun - cover remix test.mp3`

The normal legacy import receipt did not index those root audio files, so a
direct local registration example was added:

`platform/everywear-os/src-tauri/examples/vault_register_audio_files.rs`

After registering those files, `cargo run -p everywear-os --example vault_stats`
reported:

- `all=626`
- `audio=615`
- `gener8_song=93`
- `reference=105`
- `cover_source=66`
- `stem=96`
- `video=11`

The three Codex "Moving to the Sun" outputs appear at the top of the
`gener8_song` stats output.

## UI Findings

- Vault loaded real media and showed correct named videos and references.
- Vid Studio initially showed named Codex library entries, including
  `Harbour of Static (Codex)`, `Sleep Circuit (Codex)`, `Codex Song`, and
  `Moonlit Packet Loss (Codex)`.
- Native shell navigation/window controls became blocked while moving between
  Vault, Gener8, and Vid Studio. The overnight acceptance therefore used the
  local engine API after UI interaction became unreliable.
- Because of that UI blocker, the requested 1magen-to-Vid-Studio background and
  particle/text composition was not completed in this pass.

## Follow-Ups

1. Repair shell/window navigation so Vault, Gener8, and Vid Studio cannot trap
   the user away from Home.
2. Route generated Gener8 outputs through typed Vault registration immediately,
   rather than relying on manual copy/import.
3. Decide whether Cover should honor requested short test duration or always
   follow the source track length.
4. Re-test 1magen image creation and Vid Studio background/particle authoring
   after shell navigation is fixed.
