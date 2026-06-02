# Character Studio assets

These asset directories are **gitignored** (see `../.gitignore`) and are never
committed. The app loads them at runtime by URL through `VITE_ASSET_PATH`
(see `.env.development` / `.env.production`).

| Dir                 | Size  | Source                                  | Committed? |
|---------------------|-------|-----------------------------------------|------------|
| `ktx2/`             | ~2.4M | vendored from CharacterStudio-Strands   | no         |
| `hdr/`              | ~6.1M | vendored from CharacterStudio-Strands   | no         |
| `lora-assets/`      | ~21M  | vendored from CharacterStudio-Strands   | no         |
| `sound/`            | ~52M  | vendored from CharacterStudio-Strands   | no         |
| `character-assets/` | ~722M | **NOT vendored - place locally / CDN**  | no         |

## character-assets (~722M)

`character-assets/` was intentionally NOT copied (too large to pipe through the
build sandbox). For local dev, copy it from the upstream repo:

    cp -r "<CharacterStudio-Strands>/public/character-assets" ./character-assets

## Production (download-on-load)

In production nothing here is bundled. Upload the full ~836M asset set
(`character-assets` + `hdr` + `lora-assets` + `sound` + `ktx2` + `manifest.json`)
to the asset CDN and set `VITE_ASSET_PATH` in `.env.production` to that base URL.
The app then fetches everything on demand.
