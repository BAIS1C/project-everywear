# Vault Note: MyMory + Kasai Compatibility Pass

Date: 2026-05-24

## Scope

Checked Project MyMory after the 2026-05-24 MKV layer additions and wired Everywear shell compatibility for the portable Kasai UI.

## Findings

- Project MyMory exists at `C:\Users\MAG MSI\Project Mymory`.
- Active wings are `strands`, `uddin`, `claude`, `ace`, `fintrek`, and `mymory`.
- The 2026-05-24 additions define MKV-L0 raw evidence, MKV-L1 atoms, MKV-L2 scenarios, and MKV-L3 canon.
- Graph projection artifacts exist under `_graph/mkv_projection.json` and `_graph/mkv_projection.mmd`.
- The Everywear Kasai UI expected `get_engine_status`, `send_message`, `list_installed_skills`, `list_watched_projects`, and `get_mymory_status`, but shell IPC previously only exposed `kasai_*` command names.

## Compatibility Decision

Everywear shell now exposes portable Kasai command aliases that adapt to the existing local Kasai IPC runtime. This keeps the Kasai UI usable in shell/Tauri mode and does not require MyMory to depend on a specific model provider.

`MYMORY_ROOT` can override the default `~/Project Mymory` root for external API LLM adapters, local Kasai, or future applet installs. The shell status surface reports the vault root, detected wings, markdown count, memory layers, schema template, and graph projection paths.

## Spawn Contract Addendum

The shell now treats the Kasai applet spawn environment as part of the formal local-agent contract:

- `EVERYWEAR_CMD_PORT` and `EVERYWEAR_IPC_SECRET` are shell-owned IPC bootstrap values.
- `EVERYWEAR_MODEL_PRIMARY`, `EVERYWEAR_MODEL_ENCODER`, and `EVERYWEAR_MODEL_VAE` carry resolved GGUF paths.
- `EVERYWEAR_VRAM_MB` carries total detected VRAM so Kasai can derive its local VRAM tier.
- `EVERYWEAR_VAULT_DIR` points at `~/.everywear/vault` for process-local vault/index state.
- `EVERYWEAR_MAIT_DIR` points at `~/.everywear/mait` for MAIT store state.
- `EVERYWEAR_LICENCE_TIER` maps shell tiers into the applet contract: `demo`, `local`, `local_full`, or `pro`.

Kasai capability advertisement now includes top-level `applet_id`, `engine_id`, `capabilities`, and `slots` while keeping the legacy `engines[]` envelope for shell registry compatibility. IPC events accept canonical `kasai://tool-call/update`, `kasai://tool-call/complete`, `kasai://slot-event`, and `kasai://reasoning-trace` names.

## Boundary

MyMory remains an Obsidian/MKV knowledge vault. Everywear's media Vault remains the generated media library. Kasai can read/status MyMory through the compatibility layer, but write/mutation tools still need the approved skill/tool runtime before being treated as live agency.

## Referenced By

- [[2026-05-24_everywear-vault-cross-applet-ai-repository-canon|Everywear Vault Cross-Applet AI Repository Canon]] (2026-05-24)
