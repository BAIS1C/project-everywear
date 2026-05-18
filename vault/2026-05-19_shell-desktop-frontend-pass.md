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
