# Gener8 Riff DAW Architecture

Date: 2026-05-22

## Goal

Keep the current Gener8 DAW intact and add an eJay-like generated riff/sample
section underneath the existing timeline. The top timeline becomes bar-aware:
imported stems, generated riffs, microphone recordings, and future MIDI regions
all line up against a visible bar/phrase ruler.

The product shape is:

- Existing DAW stays the main arrangement surface.
- A new Riff Bank panel sits underneath the DAW.
- Riff generation is restricted to one generated audio stem at a time.
- Generated riffs are short, loopable building blocks: 4, 8, 16, or 32 bars.
- Imported stems are analyzed and aligned to the bar grid.
- Future microphone and MIDI capture land into the same timeline model.

## Current Everywear DAW Baseline

The current Gener8 DAW is already a functional audio-region engine:

- `DawProject` has tempo, time signature, tracks, audio regions, loop range, and
  generation history.
- `Track` owns audio `Region` entries.
- `Region` is time based in milliseconds, with audio refs, offsets, fades, and
  optional generation DNA.
- `TransportState` already computes bar/beat/tick from milliseconds, tempo, and
  time signature.
- `shim/daw.rs` exposes routes for init, play, pause, stop, seek, loop,
  add/move/resize/split/delete region, import stems, and waveform peaks.
- `beats` already analyzes imported audio with Symphonia plus aubio and returns
  BPM, beats, downbeats, sections, and duration.

This means the first version should not replace the DAW model. It should add:

- A bar ruler UI.
- A shared bar-grid conversion layer.
- Riff/sample metadata.
- Riff bank storage.
- New frontend panels and drag/drop actions.

## What To Borrow From openDAW

The `C:\Users\MAG MSI\Project Claude\openDAW` checkout has mature DAW concepts
that are useful as references, not as direct styling imports.

Borrow these ideas:

- `TimeAxis`: canvas-rendered bar/beat ruler with cursor and end marker.
- `TimelineHeader`: compact toolbar with snap, follow cursor, and visibility
  controls.
- `SnapSelector`: explicit snap unit control.
- Audio capture model: `CaptureAudio`, `RecordAudio`, input device selection,
  monitoring modes, and latency-aware recording.
- MIDI capture model: `CaptureMidi`, retroactive "Capture MIDI", WebMIDI input,
  software keyboard, note region commit flow.
- Note editor model: `NoteRegion`, `NoteEvent`, piano roll, scale display.
- Soundfont direction: compact internal instrument playback rather than VST
  dependency.
- Audio editing direction: transient markers and warp markers as a later phase.

Do not borrow:

- openDAW's whole box graph.
- Its visual system wholesale.
- Its full audio engine in one migration.

Everywear should keep EWDS and implement smaller equivalents that match the
existing Rust/Tauri shim.

## Bar And Phrase Grid

Add a small grid module on both backend and frontend.

Concepts:

- `beats_per_bar = time_signature[0]`
- `ms_per_beat = 60000 / tempo_bpm`
- `ms_per_bar = ms_per_beat * beats_per_bar`
- `bars_to_ms(bars, tempo_bpm, time_signature)`
- `ms_to_bar_beat_tick(ms, tempo_bpm, time_signature, ppqn = 960)`
- `snap_ms_to_bar(ms, mode)`
- `snap_ms_to_beat(ms, mode)`

Start with constant tempo. The project already has `tempo_automation`, but the
current playback and mixer path are time based, so variable tempo should be a
later migration.

UI:

- Add a top `BarRuler` above the existing timeline.
- Render numbered bars and lighter beat subdivisions.
- Draw phrase bands every 4 or 8 bars.
- Let users set visible snap: off, beat, bar, 4 bars, 8 bars.
- Use EWDS controls, not openDAW's Sass/UI.

Backend:

- Add `/api/daw/grid` returning tempo, time signature, ms per beat, ms per bar,
  and visible phrase markers for a requested time window.
- Add optional `snap` support to move/resize/add region routes, or keep snap in
  the frontend first and normalize backend later.

## Imported Stem Alignment

Imported stems should appear cleanly against the bar ruler.

V1 behavior:

1. Decode audio and read duration.
2. Run beat analysis with the existing `/api/beats`.
3. Estimate BPM and downbeats.
4. Compare detected BPM to project tempo.
5. Place stem at bar 1 by default.
6. Compute nearest whole-bar duration from project tempo.
7. If drift is small, trim visual region end to the nearest bar and apply a tiny
   fade.
8. If drift is large, mark the region "needs warp" instead of pretending it is
   aligned.

V1 should avoid destructive time-stretching. It can snap starts/ends and show
warnings. V2 can add openDAW-style warp markers.

V2 behavior:

- Add transient markers.
- Add warp markers.
- Time-stretch stem playback to project tempo.
- Store `source_bpm`, `analysis_confidence`, `bar_count`, and warp map on the
  region.

## Riff Bank Panel

Place the new section underneath the DAW arrangement, not instead of it.

Layout:

- Top: existing timeline/DAW.
- Middle: transport remains available.
- Bottom: `RiffBankPanel`.

`RiffBankPanel` tabs:

- Generate
- Bank
- Mic
- MIDI, later

Generate tab:

- Prompt field.
- Riff type segmented control: drums, bass, chords, lead, texture, full groove.
- Bars selector: 4, 8, 16, 32.
- BPM, key, time signature inherited from project by default.
- Seed control.
- Generate variations count.
- Generate button.

Bank tab:

- Generated riff cards with waveform, bars, BPM, key, type, seed.
- Preview button.
- Drag to timeline.
- Send to selected track.
- Regenerate like this.

This is the eJay inversion: instead of shipping a huge static sample bank, the
bank grows from local generation.

## Riff Data Model

Add riff metadata without disturbing `Region`.

New type:

```rust
pub struct RiffAsset {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub normalized_prompt: String,
    pub audio_ref: String,
    pub resolved_path: Option<PathBuf>,
    pub created_at: String,
    pub duration_ms: u64,
    pub bar_count: u32,
    pub bpm: f64,
    pub key_scale: String,
    pub time_signature: [u32; 2],
    pub riff_type: String,
    pub seed: Option<i64>,
    pub ace_task_type: String,
    pub ace_model: String,
    pub analysis_bpm: Option<f64>,
    pub loop_start_ms: u64,
    pub loop_end_ms: u64,
    pub tags: Vec<String>,
}
```

Storage:

- Store generated riff audio under a local Gener8 riff folder.
- Store metadata in a JSON manifest or SQLite later.
- Region placement can keep using `audio_ref`, while `generation_dna` points to
  the riff asset id or serialized riff generation params.

## Restricted Riff Prompting

Riff generation must not expose the full song-generation surface.

Hard constraints:

- One mixed stereo stem only.
- Instrumental by default.
- No vocals, no lyrics, no spoken words unless a later explicit vocal-riff mode
  exists.
- No intro, verse, chorus, bridge, outro, or full-song arrangement.
- No fade-in or fade-out requested from the model.
- Stable groove, loopable cadence.
- Target exactly 4, 8, 16, or 32 bars.
- Duration derived from bars, BPM, and time signature.

Prompt wrapper:

```text
Generate a seamless instrumental music loop.
One mixed stereo stem only.
No vocals, no lyrics, no spoken words.
No intro, verse, chorus, bridge, outro, or full-song structure.
No fade-in, no fade-out, no ending cadence.
Keep a stable groove for looping.
Target: {bars} bars, {bpm} BPM, {key_scale}, {time_signature}.
Primary musical role: {riff_type}.
User description: {user_prompt}
```

Because ACE-Step API duration is commonly documented in the 10 to 600 second
range, 4-bar loops at some tempos may be shorter than the model's lower bound.
Generate at the minimum safe duration, then analyze and trim to the exact bar
window.

## Which ACE Task To Use

Use task types deliberately:

### Text2Music

Best default for first riff generation.

Use for:

- Prompt to standalone riff.
- No existing audio context.
- Fast candidate generation.
- Turbo model where available.

Settings:

- `task_type = "text2music"`
- `lyrics = "[Instrumental]"`
- `duration = bars_to_seconds(...)`, clamped to model minimum
- `bpm`, `keyscale`, `timesignature` supplied by project
- `thinking = false` when we want strict direct control
- `thinking = true` only when letting the LM enrich vague prompts

### Text2Samples LoRA

Best future target if available in our ACE runtime.

Use for:

- More sample-pack-like outputs.
- Less song-shaped structure.
- Instrument loops, one-shots, effects, and production elements.

This is probably the best fit for the eJay riff bank, but it depends on whether
the installed ACE server supports the LoRA path.

### Lego

Not the default riff generator.

Lego means: give ACE an existing audio context and ask it to generate a specific
instrument track that fits that context. It is for adding a layer, not for
creating the first free-standing loop.

Use Lego for:

- "Add bass to this drum loop."
- "Add guitar over this chord loop."
- "Generate a synth layer that follows the current backing."

Constraints:

- Official docs describe it as base/SFT model only, not default turbo.
- It needs `src_audio`.
- It needs a track instruction such as "Generate the bass track based on the
  audio context:".
- It outputs a single specific track in context.

### Repaint

Use for fixing a bad part of an otherwise good generated riff.

Examples:

- Regenerate the final bar.
- Remove a bad fill.
- Smooth a loop boundary.

### Cover/Remix

Use for style variations of an existing riff while preserving some structure.

### Complete

Use for arranging around partial material. Not a v1 riff-bank default.

## AI Model Roles

Current local model roles around ACE:

- DiT music model: synthesizes the audio.
- Turbo DiT: fastest, best default for short text-to-riff candidates.
- Base/SFT DiT: required for advanced tasks like Lego, Extract, Complete.
- 5Hz LM: plans metadata, captions, lyrics, and audio codes. Useful for vague
  prompts, but should be bypassed or constrained when exact riff mode matters.
- VAE/DCAE or codec layer: audio/latent encoding and decoding.
- Text encoder: prompt conditioning.

Current Everywear/non-ACE roles:

- aubio beat analysis: already used for BPM/beats/downbeats.
- Symphonia decode: already used for audio read/analysis.
- Future htdemucs-style stem separation: openDAW has htdemucs assets; use only
  if we want local separation inside Gener8.
- Future tempo CNN: openDAW ships tempo-cnn assets; evaluate later against our
  current aubio path.

## Microphone Input

Yes, there is clear scope for microphone input.

V1:

- Add `Mic` tab in the Riff Bank panel.
- Use browser `getUserMedia` from the frontend or Tauri audio capture from the
  backend.
- Keep UX small: choose input device, arm, monitor, record, stop.
- Save recording as an audio asset.
- Analyze beats.
- Send to timeline as an audio region.

Borrow from openDAW:

- Input device menu.
- Armed capture state.
- Monitoring off/direct/effects concept.
- Latency-aware region placement.

V1 should not implement full multitrack recording. It should capture a riff or
sample into the bank.

V2:

- Punch-in recording into selected region.
- Loop takes.
- Count-in.
- Input gain and monitoring routing.

## MIDI And Piano Roll

Yes, but it is a separate feature family from ACE audio riff generation.

Important distinction:

- ACE generates audio.
- MIDI is symbolic note/control data.
- Converting ACE audio to MIDI is possible but lossy and instrument-dependent.

Best path:

1. Add native note data to the Gener8 DAW model.
2. Add a piano roll view.
3. Add WebMIDI and software-keyboard capture.
4. Add internal instruments so MIDI can play without a VST.
5. Later add text-to-MIDI or audio-to-MIDI helpers.

New model additions:

```rust
pub struct NoteRegion {
    pub id: String,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub loop_duration_ms: u64,
    pub notes: Vec<NoteEvent>,
    pub instrument_ref: Option<String>,
}

pub struct NoteEvent {
    pub position_ticks: u32,
    pub duration_ticks: u32,
    pub pitch: u8,
    pub velocity: f32,
}

pub struct Instrument {
    pub id: String,
    pub kind: String, // sampler, wavetable, simple_synth, soundfont_program
    pub preset: String,
}
```

Rendering options:

- V1: simple built-in synth or sample-based instrument.
- V2: compact SoundFont program, borrowing openDAW's direction.
- Later: VST/plugin hosting, but this is not needed for the first MIDI feature.

Text-to-MIDI:

- Use a small LLM or constrained generator to output note events as JSON or MIDI.
- Render the MIDI through the internal instrument.
- This is better than asking ACE for audio and trying to reverse it to MIDI.

Microphone-to-MIDI:

- For monophonic humming or singing: pitch detection to notes.
- For polyphonic piano/guitar: use a dedicated audio-to-MIDI model later.
- Keep this separate from riff audio generation.

## Implementation Phases

### Phase 1: Bar Grid And Riff Bank Skeleton

- Add bar-grid helper functions in frontend and backend.
- Add `BarRuler` above current DAW.
- Add `RiffBankPanel` underneath current DAW.
- Add riff metadata type and local manifest.
- Add "send riff to timeline" using existing `/api/daw/add-region`.
- Do not change playback engine yet.

### Phase 2: Restricted ACE Riff Generation

- Add `/api/riffs/generate`.
- Normalize prompt through the hard wrapper.
- Use ACE `text2music` first.
- Force instrumental mode.
- Derive duration from bars.
- Generate candidate variations.
- Analyze result with existing beats endpoint.
- Trim/snap/fade to the requested bar window.
- Store as `RiffAsset`.

### Phase 3: Stem And Riff Grid Alignment

- Run analysis on imports.
- Add region alignment metadata.
- Add warnings for drift.
- Add snap-to-bar move/resize.
- Add project-level phrase markers.

### Phase 4: Lego Layering

- Add "Generate layer from selection".
- Selection provides `src_audio`.
- Use base/SFT model and ACE Lego.
- Track choices: drums, bass, guitar, keyboard, synth, strings, brass, woodwinds,
  vocals, backing vocals, percussion, fx.
- Result goes into riff bank and can be placed on timeline.

### Phase 5: Mic Capture

- Add microphone permission/device selection.
- Record a short sample/riff into the bank.
- Analyze and bar-align.
- Send to timeline.

### Phase 6: MIDI And Internal Instruments

- Add note tracks/regions/events.
- Add software keyboard/WebMIDI capture.
- Add piano roll.
- Add simple internal synth or sample instrument.
- Add MIDI import/export.
- Add text-to-MIDI as a separate generator mode.

### Phase 7: Warp Markers And Time Stretch

- Add transient markers.
- Add warp markers.
- Add non-destructive time stretching.
- Align imported stems to bars without destructive edits.

## Risks

- ACE may produce song-like endings unless prompts and post-processing are strict.
- ACE BPM/duration controls are guidance, not sample-accurate commands.
- 4-bar loops can be shorter than ACE's documented API minimum duration.
- Lego requires base/SFT model support and source audio; it is not a general
  first-riff generator.
- MIDI support requires new note-region playback, not just UI.
- Microphone recording needs permission and latency handling.

## Recommendation

Build the bar ruler and Riff Bank first. Use ACE text2music in restricted mode
for standalone riff candidates. Add Lego only after the DAW can select an
existing region/mix as context. Add MIDI as a parallel internal-instrument path,
not as a dependency of the riff bank.

