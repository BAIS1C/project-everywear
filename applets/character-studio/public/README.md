# Character Studio assets

These asset directories are local-first runtime payloads. The Everywear shell
serves them from `/cs-assets` in dev. In Tauri production, the shell resolves a
local asset root and exposes it through Tauri's asset protocol.

Do not point Avatar Studio at a runtime CDN/R2 prefix. Remote storage may be a
one-time install-pack source later, but the running applet must read local files.

| Dir                 | Size  | Source                                  | Committed? |
|---------------------|-------|-----------------------------------------|------------|
| `ktx2/`             | ~2.4M | vendored from CharacterStudio-Strands | local |
| `hdr/`              | ~6.1M | vendored from CharacterStudio-Strands | local |
| `lora-assets/`      | ~21M  | vendored from CharacterStudio-Strands | local |
| `sound/`            | ~52M  | vendored from CharacterStudio-Strands | local |
| `character-assets/` | ~722M | vendored/provisioned local payload    | local |

## character-assets (~722M)

`character-assets/` must exist locally before runtime QA. If this folder is
missing, copy it from the upstream asset source:

    cp -r "<CharacterStudio-Strands>/public/character-assets" ./character-assets

## Production

Production assets must live locally, preferably under
`~/.everywear/data/character-studio/` or bundled as Tauri resources. Future
install-pack work should place the same payload locally with size/checksum
receipts, then point the applet at that local path. Runtime CDN streaming is
not an Everywear Avatar Studio contract.
