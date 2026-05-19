# EWDS Desktop Context

Last updated: 2026-05-19

This is the current desktop canon for Everywear OS. It supersedes the older dock/sidebar mockups in the Strands design folder where they conflict.

## Source Of Truth

- Runtime shell: `platform/everywear-os/src/shell/ShellLayout.tsx`
- Desktop icon renderer: `platform/everywear-os/src/components/AppletIcon.tsx`
- Desktop icon CSS canon: `packages/ewds/src/css/icons.css`, section `EWDS DESKTOP ICON FAMILY`
- Shell desktop CSS: `platform/everywear-os/src/styles/shell.css`
- Visual reference: `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web`
- Accepted preview pass: Everywear OS on `localhost:5173/?preview=1`, 2026-05-19

## Desktop Model

Everywear OS is a desktop OS surface, not a landing page and not a web dashboard.

- The desktop is always present as the base layer.
- Applets open as desktop windows or shell-hosted applet views above the desktop.
- Applet inventory comes from the manifest/registry. Do not hand-place applets in design mocks unless the mock is explicitly illustrative.
- S3 Studio is a desktop folder, not a web shortcut. It expands horizontally into its child applets.
- Settings and Vault are system icons on the desktop and use the same themed icon renderer as applets.
- Profile and hardware are available through shell chrome/taskbar flows rather than cluttering the desktop icon rail.
- The center desktop HUD is live system information: clock, node, inference/model state, and network state.

## Themes

The shell has four user-facing themes:

- Light: off-cream daytime desktop, plain high-contrast SVG icon tiles.
- Classic: dark cyan S3-style particle jewel desktop.
- Refined: dark cyan/steel-blue holographic desktop with calmer surfaces.
- Terminal: dark amber terminal desktop with sharp industrial treatment.

Desktop icon treatments change by theme, but the app identity, grid footprint, label behavior, and launch/status states remain consistent.

## Icon Canon

The desktop icon family is locked in EWDS.

- Footprint: 56px desktop glyph inside an 88px by 96px desktop icon slot.
- App identity must be readable at desktop scale.
- Labels must be readable without zooming; avoid tiny center text and tiny under-icon labels.
- Classic uses the S3 particle jewel language with oversized center monograms, matching the S3 Studio `S3` scale.
- Refined uses a cyan holographic projection from an oval plinth.
- Terminal uses the same projected-plinth construction in amber.
- Light uses a plain high-contrast SVG tile.
- System and folder icons use the same themed renderer as applets.

Projection anatomy for Refined and Terminal:

1. Plinth at the bottom.
2. Beam projects upward from the plinth.
3. Glyph sits on the beam.
4. The beam must not cross or obscure the monogram or silhouette face.
5. Sparkles are subtle motion around the projection, not noisy decoration.

## S3 Studio Folder

S3 Studio is a folder/accordion on the desktop.

- It sits as a normal desktop icon.
- It expands horizontally into a tray/concertina.
- Current child applets: `1magen`, `gener8`, `vid`, `3nvizen`.
- Child applets still come from the registry and keep their normal health/launch states.
- The folder reduces desktop clutter and keeps S3-family tools grouped.

## Center Desktop HUD

The center HUD is a live OS readout.

- The Inference card must not say placeholder text like `detecting...` when better state is known.
- Idle state reports backend/standby information.
- Opening an applet changes the card to opening state.
- Switching between model-backed applets can show `purging models` while VRAM/model cleanup is in progress.
- Ready state reports `model loaded` with the best available model label.
- Model labels resolve in this order: `recommended_primary_model`, `recommended_group`, then applet engine type fallback.
- Browser preview may fall back to engine type because Tauri model lifecycle events are not available.

## Applet Engine Hookup

Applet UI should match EWDS, but applets still own their local engines.

- The shell launches applets through the runtime bridge when available.
- Model-backed applets should surface lifecycle state to the shell so the desktop HUD can reflect loading, purging, ready, and error states.
- EWDS should define the visual contract; the registry/engine runtime should define what applets exist and what they can run.

## Design Folder Sync

Mirrored context files live in:

- `C:\Users\MAG MSI\Project Strands\claude design\everywear\EWDS-DESKTOP-CONTEXT.md`
- `C:\Users\MAG MSI\Project Strands\claude design\character-studio-ewds\EWDS-DESKTOP-CONTEXT.md`
- `C:\Users\MAG MSI\Project Strands\claude design\s3-studio-redesign\EVERYWEAR-DESKTOP-CONTEXT.md`

When updating EWDS desktop behavior, update those design-context files and the vault note in the same pass.
