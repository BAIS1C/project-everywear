# 2026-05-22 Gener8 Riff DAW Add Layer

Decision: ACE `lego` should remain an internal model task name. The Everywear
platform should expose it as **Add Layer**.

Platform explanation:

- Add Layer takes existing audio context from the DAW and generates one new
  compatible instrument layer.
- It is for "add bass to this drum loop", "add synth over this chord loop", or
  "add percussion to this groove".
- It is not the default standalone riff generator.
- It is not stem separation.
- It is not full-track generation.
- It is not a replacement for the current DAW.

Architecture:

- Keep the current DAW format and timeline.
- Add a Riff Bank / Generate Samples section underneath the DAW.
- Add a bar ruler and phrase grid above the timeline.
- Use restricted Text2Music for standalone riff generation first.
- Use ACE Lego only for context-aware Add Layer generation after a source
  region, loop range, or mixdown exists.
- Store both standalone riffs and added layers as `RiffAsset` records.
- Keep timeline placement as existing audio `Region` entries.

Naming:

- User-facing feature: `Add Layer`
- Action label: `Generate Layer`
- Internal ACE task: `lego`
- API route: `/api/riffs/generate-layer`
- Internal feature id: `context_layer_generation`

Model rule:

- Standalone riff: ACE Text2Music, turbo first, future Text2Samples LoRA if
  available.
- Add Layer: ACE Lego, base/SFT model required, source audio required.
- Fix a generated section: ACE Repaint.
- Restyle an existing riff: ACE Cover/Remix.

Implementation scaffold written to:

- `docs/gener8-riff-daw-todo.md`
- Related architecture doc: `docs/gener8-riff-daw-architecture.md`

Recommended first slice:

1. Bar ruler.
2. Lower Riff Bank panel.
3. Restricted standalone Generate Riff.
4. Riff metadata storage.
5. Send generated riff to timeline.
6. Add Layer from selected region using ACE Lego.

