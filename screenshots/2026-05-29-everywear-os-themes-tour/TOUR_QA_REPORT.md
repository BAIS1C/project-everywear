# Everywear OS Tour QA - 2026-05-29

Project location: `C:\Users\MAG MSI\Project Everywear`

## Scope

Bedtime runtime material pass for Everywear OS:

- Capture desktop themes and icon variants.
- Capture top-level applet surfaces.
- Exercise obvious tabs, filters, taskbar controls, and first tutorial targets.
- Plan the tutorial guide from current code and runtime truth.

## Runtime Boundary

- Tested `C:\Users\MAG MSI\Project Everywear\target\debug\everywear-os.exe`.
- Captured through the real Tauri WebView2 page at `http://tauri.localhost/`.
- WebView2 DevTools was enabled on `127.0.0.1:9222` for deterministic screenshots.
- No source edits, rebuilds, migrations, or bug fixes were applied during this pass.

## Product Truth

Working:

- The debug exe launches and renders the shell.
- Theme and icon matrix was captured for Light, Classic, Refined, Terminal, Graphite, Anodized, and Carbon.
- EWDS-v2 icon/chrome variants were captured for cut, rounded, square, left traffic lights, and right traffic lights.
- Settings opens and exposes theme, accent, density, widget surface, and related appearance controls.
- Vault opens with real indexed media: 626 items, 615 audio, 11 videos, 96 stems, roughly 2.9 GB.
- My Mait opens and looks like the strongest current first-run teaching surface.
- Layer U OSINT opens and clearly explains the Project SON offline boundary.

Broken or stale:

- S3 family child launchers still show `LOCKED` under the owner account in the runtime.
- Clicking some locked S3 children also flips the center HUD into `launch error / engine handoff failed`.
- Strands Nation did not visibly open an internal browser/iframe in this run.
- Vault Videos still renders dense list rows, not the larger tiled gallery called for in latest QA canon.
- Runtime Loom still leaks `PROJECT NOMAD TO EVERYWEAR RUST`, despite current source using public education copy.
- Runtime Character Studio still shows `NFT Mint` and `On-chain Blank minting`, despite current source replacing that with `Blank Export Kit`.
- That last pair is a built-bundle staleness problem: `applets\loom\dist\index.js` and `applets\character-studio\dist\index.js` still contain the old copy. The source files are ahead of the running bundle.

## Screenshots

Evidence folder:

`C:\Users\MAG MSI\Project Everywear\screenshots\2026-05-29-everywear-os-themes-tour`

Key files:

- `manifest.md` is the human-readable screenshot index.
- `theme-*-01-desktop.png` and `theme-*-02-s3-folder-open.png` are the theme matrix.
- `icon-combo-*.png` covers desktop icon/chrome variants.
- `app-*-graphite.png`, `vault-*`, `layeru-*`, `mymait-*`, `loom-*`, and `character-*` cover applet surfaces.

## Code-Informed Tutorial Map

Relevant wiki sections referenced:

- `WIKI.md` EWDS-v2 Additive Theme Family, desktop icon canon, setup wizard/concierge direction, and applet inventory.
- `ARCHITECTURE.md` desktop shell, applet manifest, lifecycle, GPU/VRAM arbitration, and applet contract sections.

Relevant source surfaces:

- Shell desktop and taskbar: `platform/everywear-os/src/shell/ShellLayout.tsx`
- Applet route map: `platform/everywear-os/src/components/AppletViewRouter.tsx`
- Settings controls: `platform/everywear-os/src/panels/SettingsPanel.tsx`
- Vault library controls: `applets/gener8/web/src/views/LibraryView.tsx`
- My Mait controls: `applets/kasai/src/shell/KasaiCore.tsx`
- Layer U OSINT controls: `platform/everywear-os/src/son/LayerUOsintApplet.tsx`
- Loom controls: `applets/loom/src/LoomCore.tsx`
- Character Studio placeholder: `applets/character-studio/src/CharacterStudioPlaceholder.tsx`

## Tutorial Findings

The tutorial should not be a long modal chain. Use short spotlight steps with a target rectangle, one tooltip, and one action per step. Best structure:

1. Desktop basics: center HUD, icon rail, taskbar, Light/Dark toggle.
2. Personal setup: profile, location/weather, theme choice.
3. Appearance controls: theme, accent, chrome density, wallpaper intensity, bevel, traffic-light side, surface treatment.
4. S3 Studio folder: explain grouped applets and locked states before asking the user to click them.
5. Vault: media/log tabs, counts, search, filters, sort, pagination, row actions, delete confirmation.
6. My Mait: skills, composer, `@ SKILL`, `# VAULT`, safety rails, local model slot.
7. Layer U: offline status, Map/Feeds/Sources tabs, Refresh, Pull Live, Reload Map.
8. Loom: phase cards, learner setup, Plan Downloads, Accept Plan, subject tabs, content packs.
9. Avatar Studio: explain placeholder status only after forbidden crypto copy is gone.
10. Recovery controls: window close/minimize/maximize, report problem, crash boundary retry.

## Blockers Before A Real Tutorial Ships

1. Rebuild the applet dist bundles or debug exe so Loom and Character Studio runtime match current source.
2. Fix neutral entitlement/admin override so owner does not see S3 family as locked.
3. Make locked S3 child clicks show a clear explanation, not a launch handoff error.
4. Make Strands Nation open internally or show a first-class blocker explaining why it cannot.
5. Implement the Vault Videos tiled gallery in the runtime bundle.
6. Make My Mait composer automation/manual path visibly accept typed text and run one harmless local prompt.
7. Add tutorial replay/reset state in Settings or Help so this can be tested cleanly.

## Fix List

1. S3 children still show `LOCKED` for the owner account.
2. Some locked S3 clicks produce `launch error / engine handoff failed`.
3. Strands Nation did not visibly open internally.
4. Vault Videos still shows dense rows, not the requested gallery cards.
5. Running bundle is stale for Loom and Character Studio: source is fixed, but runtime still shows `PROJECT NOMAD TO EVERYWEAR RUST` and `NFT Mint`.

## Follow-Up

Next pass should rebuild only after explicit go-ahead, relaunch the exe, recapture Loom, Character Studio, S3 family, Strands Nation, Vault Videos, and one My Mait send flow.

No patches applied.
