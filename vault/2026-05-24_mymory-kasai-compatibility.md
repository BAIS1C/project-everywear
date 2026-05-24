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

## Boundary

MyMory remains an Obsidian/MKV knowledge vault. Everywear's media Vault remains the generated media library. Kasai can read/status MyMory through the compatibility layer, but write/mutation tools still need the approved skill/tool runtime before being treated as live agency.
