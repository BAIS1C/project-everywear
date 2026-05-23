# Gener8 Riff DAW TODO

Date: 2026-05-22

## Naming Decision

ACE calls the task `lego`. Everywear should not expose that name to users.

User-facing name:

- **Add Layer**

Action labels:

- **Generate Layer**
- **Add Bass Layer**
- **Add Drum Layer**
- **Add Synth Layer**
- **Add Guitar Layer**

Internal names:

- ACE task type: `lego`
- API route: `/api/riffs/generate-layer`
- Metadata field: `ace_task_type = "lego"`
- Internal feature id: `context_layer_generation`

Rationale:

- "Lego" is an implementation metaphor, not a production workflow.
- "Add Layer" describes exactly what happens: the user has existing audio, and
  the model creates one compatible new instrument layer.
- It matches common producer language: drums, bass, chords, lead, texture, FX
  are all layers.

## Platform Explanation: What ACE Lego Does

In Everywear terms, ACE Lego means **Add Layer from Context**.

It takes an existing audio source, such as a drum loop, chord loop, vocal line,
or rough backing track, and generates one new isolated instrument layer that
fits the source musically.

Examples:

- User selects a drum loop and asks for bass.
- User selects a chord loop and asks for a lead synth.
- User selects a vocal recording and asks for strings.
- User selects a rough groove and asks for percussion.

What it is:

- A context-aware single-layer generator.
- A way to build a track one part at a time.
- A later-stage DAW tool after at least one audio region exists.
- Best for adding a specific missing musical role.

What it is not:

- Not the default standalone riff generator.
- Not a sample-bank generator.
- Not stem separation.
- Not a full mix generator.
- Not a replacement for the current DAW timeline.

Model constraints:

- Uses ACE `task_type = "lego"`.
- Requires `src_audio`.
- Requires a track instruction like `Generate the bass track based on the audio
  context:`.
- Official ACE docs describe it as base/SFT-model only, not the default turbo
  model.
- Available track roles include vocals, backing vocals, drums, bass, guitar,
  keyboard, percussion, strings, synth, FX, brass, and woodwinds.

## Feature Placement

The current DAW stays the primary arrangement surface.

The lower Riff Bank section should have these tabs:

- Generate Riff
- Riff Bank
- Add Layer
- Mic
- MIDI, later

`Generate Riff` creates a standalone one-stem loop from text.

`Add Layer` uses the selected timeline audio as context and generates one new
compatible layer.

## Add Layer Workflow

1. User selects one audio region, a loop range, or a temporary DAW mixdown.
2. User opens the lower `Add Layer` tab.
3. UI shows the detected source context:
   - source length in bars
   - project BPM
   - key if known
   - time signature
4. User chooses the target layer role:
   - drums
   - bass
   - guitar
   - keyboard
   - percussion
   - strings
   - synth
   - FX
   - brass
   - woodwinds
   - vocals, later/explicit only
   - backing vocals, later/explicit only
5. User enters a short layer prompt.
6. Backend creates or resolves `src_audio`.
7. Backend calls ACE with `task_type = "lego"`.
8. Result is stored as a `RiffAsset`.
9. Result appears in the Riff Bank.
10. User previews it, drags it to the timeline, or sends it to a new track.

## Prompt Template

Internal instruction:

```text
Generate the {track_name} track based on the audio context:
```

Caption wrapper:

```text
Create one isolated {track_name} layer that fits the provided source audio.
Match the source rhythm, tempo, phrase length, and harmonic movement.
Do not generate a full mix.
Do not include unrelated instruments.
Do not add intro, outro, verse, chorus, or full-song structure.
Keep the layer loopable across the selected bar range.
User description: {user_prompt}
```

Vocal tracks should remain disabled by default until the product has explicit
vocal permissions and UX, because the main Riff Bank promise is instrumental
production building blocks.

## Backend Scaffold

Add routes:

- `POST /api/riffs/generate`
- `POST /api/riffs/generate-layer`
- `GET /api/riffs`
- `GET /api/riffs/{id}`
- `POST /api/riffs/{id}/send-to-timeline`
- `DELETE /api/riffs/{id}`

`/api/riffs/generate`:

- standalone restricted text-to-riff
- ACE task: `text2music`
- no source audio

`/api/riffs/generate-layer`:

- context-aware layer generation
- ACE task: `lego`
- requires source region, source loop range, or source file path

Request sketch:

```json
{
  "source": {
    "kind": "region",
    "region_id": "region-id"
  },
  "track_name": "bass",
  "prompt": "warm rolling sub bass with syncopated movement",
  "bars": 8,
  "bpm": 132,
  "key_scale": "F minor",
  "time_signature": [4, 4],
  "seed": 12345
}
```

Response sketch:

```json
{
  "riff_id": "riff-id",
  "status": "queued",
  "ace_task_type": "lego",
  "display_task": "Add Layer"
}
```

## Data Model Scaffold

Extend the riff metadata architecture with context fields:

```rust
pub struct RiffAsset {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub normalized_prompt: String,
    pub audio_ref: String,
    pub duration_ms: u64,
    pub bar_count: u32,
    pub bpm: f64,
    pub key_scale: String,
    pub time_signature: [u32; 2],
    pub riff_type: String,
    pub seed: Option<i64>,
    pub ace_task_type: String,
    pub display_task: String,
    pub source_context: Option<RiffSourceContext>,
}

pub struct RiffSourceContext {
    pub kind: String, // region, loop_range, mixdown, file
    pub source_ref: String,
    pub source_start_ms: u64,
    pub source_end_ms: u64,
    pub source_bar_count: u32,
    pub source_bpm: Option<f64>,
    pub source_key_scale: Option<String>,
}
```

Timeline regions should continue using the existing audio `Region` model. The
new `RiffAsset` metadata describes provenance and generation behavior; it does
not replace regions.

## Frontend Scaffold

Components:

- `RiffBankPanel`
- `GenerateRiffTab`
- `RiffBankTab`
- `AddLayerTab`
- `MicCaptureTab`
- `RiffCard`
- `BarRuler`
- `SnapSelector`

`AddLayerTab` states:

- No source selected.
- Source selected and ready.
- Source too long; ask user to pick a loop range.
- Source has uncertain BPM; allow override.
- Base/SFT model unavailable; show disabled state.
- Generating.
- Generated candidates ready.

UI rules:

- Use EWDS controls and tokens.
- Keep cards compact.
- Use icons for preview, send-to-timeline, regenerate, delete.
- Do not introduce openDAW visual styling wholesale.

## DAW Integration Tasks

- [ ] Add bar-grid helper module.
- [ ] Add `BarRuler` above current timeline.
- [ ] Add snap modes: off, beat, bar, 4 bars, 8 bars.
- [ ] Add lower `RiffBankPanel` without removing existing DAW controls.
- [ ] Add Riff Bank manifest/storage.
- [ ] Add standalone `/api/riffs/generate`.
- [ ] Add `/api/riffs/generate-layer`.
- [ ] Add source context resolver for selected region.
- [ ] Add temporary mixdown path for loop-range context.
- [ ] Store generated layer as `RiffAsset`.
- [ ] Send generated layer to a new or selected DAW track.
- [ ] Add analysis and whole-bar trim/fade pass.
- [ ] Mark generated layers with `display_task = "Add Layer"`.
- [ ] Keep `ace_task_type = "lego"` internal only.

## Model Selection Rules

Standalone generated riff:

- Default: ACE Text2Music.
- Preferred model: turbo where quality is acceptable.
- Future: Text2Samples LoRA if available.

Add Layer:

- Default: ACE Lego.
- Required model: base/SFT.
- Requires source audio.
- Falls back to disabled state if base/SFT is unavailable.

Fix bad section:

- ACE Repaint.

Restyle existing riff:

- ACE Cover/Remix.

Stem isolation:

- ACE Extract or a local separation model, but this is not the Add Layer path.

## Open Questions

- Should Add Layer source context use the selected region only in v1, or also
  support current loop range mixdown?
- Do we ship base/SFT model by default, or make Add Layer an optional advanced
  capability when the model is installed?
- Should generated layers automatically create a new timeline track, or land in
  the Riff Bank first every time?
- Should vocal/backing-vocal layers be hidden until a dedicated vocal safety and
  licensing UX exists?
- Should Add Layer preserve exact source bar count even if ACE returns a longer
  file, by trimming to source phrase length?

## Recommended First Slice

Build these first:

1. `BarRuler`
2. `RiffBankPanel`
3. Standalone restricted `Generate Riff`
4. Riff metadata storage
5. Send riff to timeline

Then build Add Layer:

1. selected-region source context
2. base/SFT availability check
3. `generate-layer` route
4. ACE Lego call
5. Riff Bank candidate result
6. send layer to timeline

