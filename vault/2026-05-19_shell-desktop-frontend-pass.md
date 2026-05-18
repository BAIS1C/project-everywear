# 2026-05-19 Shell Desktop Frontend Pass

Source of truth: `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web`.

Reference files consulted:

- `src/shell/EverywearShell.tsx`
- `src/shell/IconGrid.tsx`
- `src/shell/AppIcon.tsx`
- `src/shell/Taskbar.tsx`
- `src/shell/Window.tsx`
- `src/shell/useWindowManager.ts`
- `src/shell/appRegistry.ts`
- `src/shell/SkinToggle.tsx`
- `src/styles/everywear/tokens.css`
- `src/styles/everywear/components.css`

Completed chunk: four-theme cleanup.

- Everywear OS now exposes `light`, `classic`, `refined`, and `terminal` as the four user-facing shell themes.
- `ThemeContext` keeps existing `mode`/`skin` compatibility for applets, but adds `theme` and `setTheme`.
- Light is normalized as its own theme instead of a skin variant, preventing stale dark skin settings from leaking into light mode.
- Taskbar theme chips and Settings appearance now use the same four-theme list.

Active directive:

- Keep Everywear OS as the base desktop OS.
- Applet icons should come from the shell registry/manifest, not hardcoded S3 Studio lists.
- Local applet engines must still be launched through the existing manifest-backed `launchApplet` path.
- Applet UI should sit inside EWDS shell chrome and continue migrating toward EWDS tokens/components.
- Logs should live under Vault as a Vault section, not as a standalone loose shell panel.
- Do not run cargo unless explicitly approved.

Completed chunk: desktop OS shell behavior.

- `platform/everywear-os/src/shell/ShellLayout.tsx` now models applets and system panels as shell windows over the desktop rather than replacing the desktop with one content pane.
- Window chrome is aligned to the S3 Studio reference at first pass: traffic lights, title/subtitle, active focus styling, maximize toggle, minimize, close, and taskbar restore buttons.
- The desktop icon layer remains manifest-driven through `listApplets()`. System-only desktop icons are Profile, Hardware, Settings, and Vault.
- Local applet engines remain hooked through `launchApplet` for manifest entries with `launch_binary`. Registered frontend-only applets open inline; unregistered frontend-port applets use `HeadlessAppletView`; URL applets open externally.
- Vault contains `Media` and `Logs` sections; logs are no longer treated as an independent shell panel.
- Verification: `npm run build` in `platform/everywear-os` passed. Vite emitted the existing dynamic/static import chunk warning only.
- Cargo was not run.

Completed chunk: browser preview + S3 source-truth correction.

- Added browser-mode transport fallbacks for applet registry, profile, GPU status, and model assessments so `npm run dev` can preview the desktop without Tauri IPC or cargo.
- Fixed the observed preview state where only Profile/Hardware/Settings/Vault appeared: the dev shell now renders the applet registry shape from the `registry.rs` contract.
- Kept NotBuilt applets visible as dimmed/non-launching desktop icons, matching the S3 source-of-truth expectation that future applets still sit on the OS surface.
- Reduced desktop-only system icons to Settings and Vault to better match the S3 desktop reference; Profile/Hardware remain reachable through shell chrome/taskbar/system flows.
- Reworked the idle desktop canvas so `light`, `classic`, `refined`, and `terminal` each render intentionally instead of Light inheriting stale skin state.
- Replaced the large empty Classic brand mark with quieter node metadata over wallpaper texture; Light and Terminal use clock/status HUD surfaces.
- Added a localhost-only `?preview=1` auth bypass for browser/Vite visual QA. It is disabled in Tauri and does not replace the real Everywear ID gate.
- Polished the Settings panel layout after browser QA: content now gets window padding and the four theme choices render in an even four-column row on desktop.
- Cargo was not run.

Completed chunk: morning visual correction from localhost 5173 screenshots.

- Light theme applet icons now keep the dark S3-style particle tile instead of turning into pale low-contrast tiles on the off-white desktop.
- Classic and Refined now use the same centered clock/status HUD composition as Terminal, toned by their active theme tokens.
- The HUD is responsively offset away from the left applet columns so node/status text does not sit underneath desktop icons.
- Cargo was not run.

Completed chunk: S3 folder + per-theme icon sets.

- S3 Studio is now a desktop folder surface instead of a web shortcut. Its child applets are still sourced from the registry/manifest list, then folded into a horizontal concertina tray.
- The root desktop is less cluttered: S3 child apps (`1magen`, `Gener8`, `Vid Studio`, `3nvizen`) live inside the S3 Studio folder, while non-S3 applets and system tools remain on the desktop.
- Settings and Vault desktop controls were raised in contrast so they read on Light and dark themes.
- Applet icons now vary by theme: Classic keeps the animated particle tile, Light uses plain high-contrast SVG icons, Refined uses holographic SVG tiles, and Terminal uses amber console-style SVG tiles.
- Verification: `npm run build` in `platform/everywear-os` passed. The in-app browser rejected localhost navigation under its URL policy, so browser visual QA was not completed in this chunk.
- Cargo was not run.

Completed chunk: icon readability + Refined holo direction.

- Rechecked the S3 Studio source-of-truth icon implementation at `C:\Users\MAG MSI\Project Ace\S3 STUDIO\s3studio-web\src\shell\AppIcon.tsx` and `IconGrid.tsx`.
- Raised desktop icon label size toward the S3 baseline and improved dark-theme label contrast/glow so app names read from the desktop.
- Light icons remain plain SVG, but the glyphs are bolder, simpler, and less cramped inside the 56px S3 footprint.
- Refined icons now move toward the blue hologram-on-plinth concept: brighter cyan-blue hologram body, beam, plinth/base, and larger readable monograms.
- Verification: `npm run build` in `platform/everywear-os` passed. Cargo was not run.

Completed chunk: projected holograph icon correction.

- Refined icons now more closely follow the provided holographic icon pack reference: dark oval plinth, cyan ring, upward projection beam, line-glyph silhouette, and sparkle marks.
- Terminal icons use the same projected-plinth construction in amber, matching the S3 Studio terminal family direction instead of flat framed boxes.
- The S3 Studio folder, Settings, and Vault now use the shared themed icon renderer, so they visually belong with the applet icons across Classic, Refined, Terminal, and Light.
- Center monograms were enlarged and stroked for legibility on dark themes.
- Verification: `npm run build` in `platform/everywear-os` passed. Cargo was not run.
