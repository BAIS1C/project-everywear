# Layer U OSINT Widgetization Canon

Date: 2026-05-23
Updated: 2026-05-24

This note supersedes older Everywear references that call the free OSINT platform surface "Project Son" in user-facing product copy.

## Canon

- **Layer U OSINT** is the Everywear-facing name for the widgetized Project SON capability suite.
- **Project SON** remains the source repo/service name: `C:\Users\MAG MSI\Project SON`.
- The worldview map, flights, and map layers belong in a compact Everywear applet window, not on the desktop wallpaper layer.
- RSS/news feeds and served YouTube/video links belong as companion panes beside the map.
- Desktop widgets may show ambient status, brief, posture, or source-health summaries only.
- Module sizing follows the context-window rule: target under 400 LOC per TS/JS module, warn above 1,000 LOC, fail above 4,000 LOC or if fetch, transform, render, and lifecycle are fused.
- EWDS cut corners remain the default widget/window surface. Soft rounded and glass treatments are customizable setting variants.
- Built-in music player and full browser are free platform-candidate launcher surfaces for the agentic OS, not paid applet-tier features.
- As of 2026-05-24, widget surface variants are named **Cut**, **Rounded**, and **Square**. They must affect the widget boxes/panels themselves, not only buttons. Legacy stored values migrate as `soft -> rounded` and `glass -> square`.
- Icon polish direction is lower-glow and glassier. Classic icons should read as glass desktop objects; Refined/Terminal keep projected plinth geometry with restrained halo.
- Weather is metric-first: Celsius, km/h, and mm.

## Naming Canon

- **My Mait** is the user-facing Everywear name for the local MAIT/agent applet.
- `kasai` remains the internal runtime, applet id, binary/process namespace, and Sean's personal/in-game name.
- User-facing launcher labels, settings, and applet titles should say **My Mait**. Technical docs can write `My Mait (kasai runtime)`.

## First Implementation Target

- Done: `layeru-osint` exists as a `FrontendInline` launcher entry in the native registry and browser-preview registry.
- Done: `LayerUOsintApplet` embeds `http://127.0.0.1:3117/worldview` as the compact map/flights/layers window and shows local panes for posture, feeds, sources, refresh, pull live, and reload map.
- Done: Everywear reads Project SON health/data through `sonBridge.ts` and `useLayerUOsint.ts`.
- Done: Project SON CORS was patched so Everywear can read `/api/health`, `/api/data`, and `/api/sweep`.
- Keep splitting panes out of `LayerUOsintApplet.tsx` as they grow; the current module is intentionally context-sized.

## Stale Runtime Note

If the live desktop does not show Layer U OSINT while screenshots still show old cues such as `Kasai` instead of **My Mait** or Fahrenheit weather, do not infer that the registry/app architecture failed. Diagnose stale runtime first:

1. Stop the running native shell.
2. Run `npm -w everywear-os run build`.
3. Run `cargo build -p everywear-os`.
4. Restart Everywear from the rebuilt native binary or dev runner.
