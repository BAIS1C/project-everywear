# Layer U OSINT Widgetization Canon

Date: 2026-05-23

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

## Naming Canon

- **My Mait** is the user-facing Everywear name for the local MAIT/agent applet.
- `kasai` remains the internal runtime, applet id, binary/process namespace, and Sean's personal/in-game name.
- User-facing launcher labels, settings, and applet titles should say **My Mait**. Technical docs can write `My Mait (kasai runtime)`.

## First Implementation Target

- Add `layeru-osint` as a `FrontendInline` launcher entry.
- Embed `http://127.0.0.1:3117/worldview` as the compact map/flights/layers window.
- Read Project SON health/data through a small bridge and hook.
- Patch Project SON CORS so Everywear can read `/api/health`, `/api/data`, and `/api/sweep`.
- Keep the initial applet modular, then split panes out as they grow.
