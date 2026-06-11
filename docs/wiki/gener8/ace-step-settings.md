# ACE-Step Settings Reference (Client-Side Ground Truth)

Created: 2026-06-11T23:55+08 SGT (Claude Cowork session, smoke-test triage)
Location: C:\Users\MAG MSI\Project Everywear\docs\wiki\gener8\ace-step-settings.md
Status: CLIENT SIDE COMPLETE. SERVER SIDE PENDING (ace-server fork source lives in
C:\Users\MAG MSI\Project Ace, "BASIC STEP STUDIO"; not mounted this session).
Purpose: single source of truth for every parameter the Gener8 stack sends to ace-server,
so the snap-to / cover-strength behavior can be fixed against facts, not memory.

## Pipeline

UI (applets/gener8/web) -> payload builder -> services/api.ts -> Rust shim
(applets/gener8/src-tauri/src/shim.rs, lines ~889-1526) -> HTTP POST /synth
(or /synth?format=wav24) on ace-server. Shell owns ace-server lifecycle.

## Core synth parameters

| Param (wire key) | Defined | Default | Range / step | Notes |
|---|---|---|---|---|
| inference_steps | CreatePanel.tsx:459, shim.rs:1373 | 8 turbo / 50 base | 1-60 | Clamped to manifest stepCeiling: 12 (gener8-4ever), 75 (gener8-pro). Clamp fn CreatePanel.tsx:505-516 |
| guidance_scale | CreatePanel.tsx:454, shim.rs:1374 | 7 fallback; 1.0 base; 7.5 turbo | xl-base: 1.0-15.0 step 0.5; turbo/song: 0.5-1.5 step 0.1 | UI = "Style Influence" slider, CreatePanel.tsx:1660-1686. Linear, model-aware range, NO snapping |
| shift | CreatePanel.tsx:461, shim.rs:1375 | 2.0 / 3.0 turbo / 1.0 base | cap 1.0-5.0; turbo 2.0-4.0; song 0.5-2.5 | UI = "Weirdness". Auto-switches infer_method to sde above 3.5 (turbo) / 4.2 (cap) / 2.2 (song) |
| infer_method | CreatePanel.tsx:460, shim.rs:1369 | ode | ode \| sde | |
| synth_batch_size | CreatePanel.tsx:452, shim.rs:1376 | 2 turbo / 1 base | 1+ | |
| duration | CreatePanel.tsx:451, shim.rs:1208-1212,1371 | -1 (auto -> 180s) | seconds | |
| seed | CreatePanel.tsx:456, shim.rs:1186,1372 | -1 random | -1 or >=0 | randomSeed toggle CreatePanel.tsx:1754-1775 |
| synth_model | shim.rs:1284-1295,1357 | st.preferred_dit | model name | manifest lockedModel: song (4ever) / pro |

## Cover / reference mode (the snap-to battleground)

| Param | Defined | Default | Range | Notes |
|---|---|---|---|---|
| audio_cover_strength | ProAudioModePanel.tsx:318, useProAudioMode.ts:13,32, shim.rs:1337-1342,1382 | 1.0 | 0.0-1.0 step 0.05 | UI = "Source Influence" %. LINEAR passthrough, no client-side snapping or thresholds |
| cover_noise_strength | shim.rs:1340-1342,1383 | 0.0 | 0.0-1.0 | NOT exposed in UI, always 0.0 |
| task_type | proPayloadBuilder.ts:55,62,69, shim.rs:1367 | text2music | text2music \| cover \| cover-nofsq | mode=cover with NO reference audio silently becomes cover-nofsq |
| audio / ref_audio | shim.rs:1365,1401-1443 | empty | base64 or multipart binary | source resolved to bytes before send |
| repainting_start/end | CreatePanel.tsx:473-474, shim.rs:1343-1348 | 0.0 / -1 | seconds | RepaintRangeSlider CreatePanel.tsx:191-283 |
| repaint_strength | shim.rs:1349-1351,1386 | 1.0 | 0.0-1.0 | not exposed in UI |

## LM-layer parameters

lm_model (shim.rs:1358), lm_temperature 0.85 (CreatePanel.tsx:465), lm_cfg_scale 2.0,
lm_top_k 0, lm_top_p 0.9, lm_batch_size 1, lm_negative_prompt "NO USER INPUT",
use_cot_caption false turbo / true base (shim.rs:1196-1199). None validated/clamped in shim.

## Metadata / misc

prompt->caption (shim.rs:1299-1302), lyrics, style (Style Assist enhancer hits
/api/generate/format, CreatePanel.tsx:744-778), bpm, keyscale, timesignature,
vocal_language (50+ codes), audio_format mp3|flac (wav24 endpoint), bulkCount
(CreatePanel.tsx:453, client-side loop firing N independent jobs), get_lrc (pro-gated),
audioCodes for extract/lego/complete tasks, track/trackName for stems.

## FINDINGS (2026-06-11 smoke test)

1. There is NO snap-to or quantization logic anywhere client-side. Source Influence 65/70/75%
   reach the shim as 0.65/0.70/0.75 linearly.
2. Therefore the observed cliff (75% = output identical to source, 70% = near-total rewrite,
   65% = source ignored) is SERVER-SIDE or model-semantic: inside the ace-server fork
   (Project Ace, BASIC STEP STUDIO) or ACE-Step 1.5's own ref-strength handling. The fix
   cannot be made in this repo alone. ACTION: mount Project Ace, grep the server's handling
   of audio_cover_strength / ref_audio_strength / retake-variance, append the server half here.
3. Suspect adjacent to the cliff: task_type silently downgrades cover -> cover-nofsq when
   reference audio is absent (proPayloadBuilder.ts:69); verify which path Sean's cover runs hit.
4. cover_noise_strength is hardcoded 0.0 and hidden; if the server expects it nonzero for
   partial covers, that alone could produce all-or-nothing behavior.
5. UI default audio_cover_strength = 1.0 (100% source) — defensible for "cover" but means the
   first user touch of the slider is a leap into the unmapped middle of the range.
6. Shim performs no range validation on LM params or strengths; out-of-range values pass through.

## Mismatch flags

- guidance_scale UI range derived from loaded-model name pattern (CreatePanel.tsx:605-681);
  backend model swap without reload desyncs the slider range.
- Repaint controls render regardless of task_type support; shim does not reject mismatches.

## SERVER SIDE GROUND TRUTH (added 2026-06-12T00:35+08 SGT)

Source: C:\Users\MAG MSI\Project S3StudioGener8\S3 STUDIO\acestep.cpp (original working
tree, per Sean). Key mechanics:

- audio_cover_strength (request.h:46): "fraction of DiT steps using source context".
  pipeline-synth-ops.cpp:530: cover_steps = (int)(num_steps * cover_strength), then the
  context switches to SILENCE for the remaining steps (Context-Silence switching).
- THE CLIFF EXPLAINED: integer truncation quantizes the slider into 1/num_steps buckets.
  On turbo at 8 steps: 75% -> 6 source-steps, 70% -> 5; one bucket = drastic output change.
  On xl-base at 50 steps: 2% buckets -> smooth. Unqualified cover requests were being
  dispatched to turbo (preferred_dit never selects xl-base; same bug that broke stem
  extraction); fixed 2026-06-12 in shim.rs (route base-only tasks to installed xl-base dit).
- extract/lego/complete force audio_cover_strength=1.0 internally (pipeline-synth.cpp:431-449).
- cover_noise_strength default 0.0 (request.cpp:39); logged at request.cpp:412.
- The ORIGINAL s-gener8 shim carried a model-resolution layer the Everywear migration
  dropped: resolve_dit_filename, "xl-base masquerade" rejection (stale SFTTurbo50 file named
  base-Q8_0), task-aware model gating (original shim.rs:594-1917). The Everywear shim's
  preferred_dit fallback replaced it and silently broke every base-only task. Consider
  porting the masquerade guard.

UI FOLLOW-UP (open): surface the quantization honestly — display source influence as
"N of M steps hear the source" so users see the real granularity instead of a fake-smooth %.
