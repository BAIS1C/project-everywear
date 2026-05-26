# 2026-05-26 Kasai + 1magen Local Image Generation Skill

## Source Reference

Reference plugin:

`https://github.com/aviz85/claude-skills-library/tree/main/plugins/image-generation`

The reference is useful for its agent-facing policy:

- always use an explicit destination
- support text-to-image
- support reference image editing through explicit assets
- expose aspect ratio and quality choices
- keep defaults stable unless the user asks for a different format
- include prompt policy helpers such as RTL/Hebrew handling and "wow mode"

Its cloud providers are not the Everywear path. The reference uses Gemini,
fal.ai, and xAI/Grok-style provider concepts. Everywear should route this to
local 1magen.

## Decision

Build the image-generation skill as a Kasai/My Mait orchestration layer over
1magen.

Do not use:

- Gemini API
- fal.ai
- xAI/Grok image or video APIs
- provider API keys

Use local 1magen:

- Z-Image Turbo model stack
- local model provisioning through Everywear
- 1magen Tauri commands for generation/edit/save
- Everywear Vault for durable generated-image storage

## Current 1magen Surface

1magen already exposes:

- `get_status`
- `list_models`
- `get_recommended_stack`
- `get_default_output_dir`
- `download_model`
- `load_model`
- `unload_model`
- `generate_image`
- `edit_image`
- `save_image`

The applet UI already supports:

- prompt
- negative prompt
- resolution preset
- output directory
- source image path
- seed
- auto-save to Vault

The shell already has:

- `vault_register_image`
- Vault image thumbnails
- image metadata indexing

## Skill UX

User phrases:

- "make an image of..."
- "generate a poster..."
- "create a square avatar..."
- "turn this reference into..."
- "make this more cinematic"
- "save it to the vault"

Kasai should ask for clarification only when required:

- missing prompt
- unsafe/ambiguous file destination
- user references an asset that is not selected or resolvable
- user asks for format-specific output without enough detail

## Command Contract Draft

Kasai-facing tool names:

- `image_generate`
- `image_edit`
- `image_status`
- `image_save_to_vault`

Draft request:

```json
{
  "prompt": "cinematic portrait of Kasai",
  "negative_prompt": "text, watermark, blurry",
  "aspect": "3:2",
  "quality": "standard",
  "destination": "managed",
  "reference_assets": [],
  "seed": -1,
  "save_to_vault": true
}
```

Draft response:

```json
{
  "status": "complete",
  "file_path": "...",
  "vault_item_id": "...",
  "width": 1536,
  "height": 1024,
  "seed": 42,
  "model_key": "z-image-turbo-q4km",
  "mode": "text_to_image"
}
```

## Aspect And Resolution Policy

Keep a stable default. The reference plugin defaults to 3:2; 1magen currently
uses its own resolution presets. The integration should define a shared mapping:

- `3:2`: default horizontal image/poster draft
- `1:1`: avatar/profile/social square
- `2:3`: vertical poster
- `9:16`: story/reel/mobile
- `16:9`: header/thumbnail/wide scene

Kasai should not invent a different aspect ratio unless the user asks.

## Reference Asset Policy

Reference assets must be explicit.

Allowed sources:

- user-selected file path
- current 1magen source image
- selected Vault image
- explicit path supplied by the user

Disallowed:

- silently grabbing arbitrary local files
- silently attaching screenshots
- uploading assets to cloud providers

## Quality Policy

Replace cloud-provider "cheap" semantics with local model-stack semantics:

- `standard`: prefer the lighter Z-Image stack, currently Q4_K_M.
- `quality`: prefer Q8 when hardware and model availability allow it.
- `draft`: can use lower resolution/steps but still local.

Everywear shell/1magen should own final model selection based on VRAM and
download state.

## Vault Policy

For agent-generated images, default to an explicit save path or an Everywear
managed output path, then optionally register to Vault.

Vault metadata should include:

- title
- prompt
- negative prompt
- generation params
- model key
- seed
- dimensions
- tags: `1magen`, `image`, optional user/project tags

## Prompt Policy Helpers

Prompt expansion belongs in Kasai before job submission:

- Hebrew/RTL text: prepend an RTL layout instruction when the user asks for
  Hebrew text in-image.
- "wow mode": expand with cinematic/VFX language only when the user asks for
  maximum impact.
- Preserve user intent; do not force a house style onto every request.

## Video Boundary

The reference plugin also describes video generation. Do not map that to
1magen. Route image-to-video or text-to-video requests to Vid/3nvizen/AI
Director later.

## Implementation Path

1. Add a `local-image-generation` or `1magen-create` skill card to Kasai.
2. Add shell/Kasai tool schemas for `image_generate`, `image_edit`,
   `image_status`, and `image_save_to_vault`.
3. Reuse 1magen command payloads where possible.
4. Add managed destination-path creation and collision avoidance.
5. Register generated output through `vault_register_image` when requested.
6. Add tests around aspect mapping, explicit reference-asset validation, and
   destination path collision behavior.
