# 3nvizen

`3nvizen` is the Everywear local-video applet for Creator Pro and standalone use.

## Canon

- `3nvizen` owns local video generation.
- `1magen` creates anchor keyframes.
- AI Director owns SAPI-routed shot planning and continuity state.
- The baseline local workflow is sequential segment chaining.
- Auto lip syncing is important enough to be treated as a first-class workflow patch.

## Baseline Local Pipeline

1. AI Director splits the song into shot segments.
2. `1magen` creates the first anchor frame for segment 1.
3. `3nvizen` generates segment 1 from:
   - segment prompt
   - audio slice
   - starting frame
4. `3nvizen` extracts the last frame of segment 1.
5. The last frame becomes the first frame of segment 2.
6. Repeat until the song is complete.
7. FFmpeg concatenates segments and muxes the master audio.

This is the continuity-preserving local music-video path.

## Runtime Policy

The preferred local runtime order is:

1. Use a direct local runtime only if it supports the real required feature set:
   - image-to-video
   - audio-conditioned generation
   - sequential segment continuity
   - first-frame / last-frame chaining
   - lip-sync capable patch workflows
2. If the GGUF route cannot reliably provide that full path, the canonical local implementation becomes a managed Python sidecar using the official LTX runtime and safetensor weights.

For now, the sidecar path is the safer baseline.

## Sidecar Contract

The shell should treat `3nvizen` as a server-backed applet.

### Core endpoints

- `GET /health`
  Returns runtime status, GPU info, model readiness, and loaded patch list.
- `POST /api/v1/models/ensure`
  Ensures the selected local model pack is present and verified.
- `POST /api/v1/segments/generate`
  Generates one local video segment and returns paths plus metadata.
- `POST /api/v1/segments/extract-last-frame`
  Extracts the final frame of a generated segment.
- `POST /api/v1/patches/lipdub`
  Applies lip-synced multilingual dubbing to an existing generated segment or video.

### `POST /api/v1/segments/generate`

Request body:

```json
{
  "project_id": "creator-pro-song-001",
  "segment_index": 0,
  "prompt": "A singer turns toward camera and starts the first line under blue neon rain.",
  "negative_prompt": "flicker, wrong gaze, duplicated limbs, broken hands",
  "width": 960,
  "height": 540,
  "fps": 24,
  "duration_ms": 5000,
  "audio_path": "C:/path/to/audio/segment-000.wav",
  "start_frame_path": "C:/path/to/frames/segment-000-start.png",
  "prior_segment_last_frame_path": null,
  "seed": 42,
  "continuity_notes": [
    "keep singer facing left of frame",
    "carry forward wet jacket and blue backlight"
  ]
}
```

Response body:

```json
{
  "job_id": "seg_00001",
  "status": "queued"
}
```

### Segment output contract

Completed jobs should return:

- `video_path`
- `preview_path`
- `last_frame_path`
- `actual_duration_ms`
- `fps`
- `width`
- `height`
- `seed`
- `warnings`

## Lip-Sync Patch

Lip syncing is not optional polish. It is part of the serious music-video toolset.

That means `3nvizen` should support a dedicated patch workflow with:

- speaker transcript or lyric line input
- translation input for multilingual variants
- source audio reference tokens
- optional emotion cues such as `laughing`, `whispering`, `shouting`
- patch output that preserves identity and broad scene continuity while adapting mouth motion and lower-face expression

This should ship as a `patch` workflow, not as a separate app.

## Why Not ComfyUI

We are not cloning the ComfyUI node graph experience.

We only borrow the useful principles:

- two-stage generation where needed
- audio/video co-conditioning
- multiple guide images
- frame-count and resolution rules
- lip-sync patches as specialized workflows

The runtime and UX stay Everywear-native.
