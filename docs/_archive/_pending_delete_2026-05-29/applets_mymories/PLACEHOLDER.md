# applets/mymories — Placeholder

**Status (2026-05-29):** placeholder slot, NOT a working npm workspace.

This directory holds the future Mymories applet (personal knowledge / memory
management surface, RAG-backed). The shell registry already declares the
applet with:

- `id: "mymories"`
- `status: AppletStatus::NotBuilt`
- `launch_kind: AppletLaunchKind::Placeholder`
- `launch_binary: Some("mymories")`
- `frontend_port: 3005`
- `min_vram_mb: 4096`
- tags: knowledge, memory, rag

See `platform/everywear-os/src-tauri/src/registry.rs`.

## Why this directory exists

Kept as a slot to preserve intent without forcing npm to attempt installation.
Removed from root `package.json` workspaces on 2026-05-29 because the directory
has no `package.json` and was blocking workspace installs.

## To activate

1. Scaffold a Tauri applet here (mirror `applets/1magen` or `applets/3nvizen`).
2. Re-add `"applets/mymories"` to root `package.json` workspaces.
3. Re-add `"applets/mymories/src-tauri"` to root `Cargo.toml` workspace members.
4. Implement the `mymories` binary surface the registry expects.
5. Update WIKI.md applet inventory.

## Related canonical surfaces

- MyMory Knowledge Vault (Obsidian-backed, source of truth):
  `C:\Users\MAG MSI\Project Mymory`
- Mymories Chrome extension reference: vault notes
  `claude/2026-01-28_mymories-chromeextension_*.md`

Last updated: 2026-05-29 SGT.
