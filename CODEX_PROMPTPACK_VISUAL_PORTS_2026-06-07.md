# Codex Promptpack: Remaining Visual Ports + Module Splits

Project location: C:\Users\MAG MSI\Project Everywear
Created: 2026-06-07 (SGT), by Claude Cowork repair session
Source: 2026-06-07_everywear_visual_bugfix_handoff_for_claude.md (surgical fixes landed; this pack covers the large ports that were out of single-session scope)
Discipline: wiki-first (WIKI.md v1.1.29), context-protocol budgets, one lane per session.

## Already landed (do not redo, see WIKI v1.1.29 note)

Taxonomy (1magen/3nvizen to desktop, S3 single-active suite), Vault black screen, Vid NVENC acquire/retry/release + render state reset + CSP, My Mait system-prompt injection + settings mount, Strands frame-src, status truthfulness channel, tray labels, bug report local save, Educ8 donor-copy purge, Avatar Studio bundled UI chrome + error/loading states, shell get_default_output_dir.

## Lane 1: 1magen full Everywear port

Problem: raw/default form UI, controls jammed left, dead area, browser-native controls. The UI is inline-mounted in the shell webview, so all ten 1magen Tauri commands (get_status, list_models, get_recommended_stack, download_model, load_model, unload_model, generate_image, edit_image, save_image, get_default_output_dir) hit the SHELL process. Only get_default_output_dir is bridged so far.

Work:
1. Decide command routing: either (a) shell-side proxy commands forwarding to the onemagen process over applet-ipc ExecuteJob (matches kasai_forward_chat pattern in platform/everywear-os/src-tauri/src/commands/kasai.rs), or (b) stop inline-mounting and embed 1magen's own frontend (port 3002) via HeadlessAppletView. (a) preserves shell-native look; (b) is faster. Recommend (a) for consistency with the My Mait pattern.
2. EWDS layout pass over applets/1magen/src: shared @everywear/ewds tokens, ew-btn/ew-panel idioms, no browser-native form controls, fill the dead area with preview/queue panes.
3. Enforce model unload on close/switch (hard rule): verify the shell purge cycle fires for 1magen and VRAM returns; preserve the lifecycle toasts.

## Lane 2: Layer U EWDS port + SON dependency UX

Files: platform/everywear-os/src/son/LayerUOsintApplet.tsx (+ useLayerUOsint.ts, sonBridge.ts, styles/layer-u-osint.css).
Landed already: offline Retry button, everywear:applet-status self-report.
Remaining: real EWDS layout (current sparse scaffold, huge dead map panel, thin sidebar), a start-local affordance (launch/start SON server on port 3117 if installed, or guide install), and a proper offline visual state for the map pane instead of a dead iframe.

## Lane 3: Educ8 workflow controls

Accessibility exposes Plan Downloads / Accept Plan / Download, but the visible flow strands users on "Plan first" chips. Rebuild the flow around visible learner/parent actions; keep explicit manifest/size/checksum/accept gates before any download. Files: applets/educ8/src/Educ8Core.tsx (donor copy already purged; respect SHOW_DEV_STATUS gating).

## Lane 4: Avatar Studio local asset provisioning (SOURCE-LANDED 2026-06-07, runtime QA owed)

DECISION (Sean, 2026-06-07): runtime CDN streaming is the wrong architecture; it fails the
local-first gate. Character assets must be local. Do NOT build the applet around
assets.everywear.id at runtime.

Work:
1. DONE source-side: treat the ~722 MB character asset payload (applets/character-studio/public/character-assets
   et al.) as a shell-provisioned install pack per the applet install doctrine
   (CONTEXT_APPEND_APPLET_INSTALL_DOCTRINE_2026-06-05.md): shell assessment first, visible
   install with receipt, stored under everywear_paths::data_dir("character-studio"). Interim
   implementation resolves local app data, Tauri resources, or the repo public tree through
   Tauri's asset protocol without copying the large payload into frontend dist.
2. DONE source-side: `AppletViewRouter.tsx` sets `/cs-assets` in dev; production asks the
   shell for `get_character_studio_asset_root` and converts the returned local path with
   convertFileSrc. The 2026-06-07 bundled UI chrome fix stays as-is.
3. Download origin for the one-time install pack is an implementation detail (R2 as dumb file
   host, GitHub release, etc.); it must never be a runtime dependency. Add checksum + size to
   the install receipt.
4. DONE source-side: removed https://assets.everywear.id from connect-src in tauri.conf.json.
5. Verify trait loading past the Landing page fully offline in a production build.

## Lane 5: Module splits (context budget)

- platform/everywear-os/src/shell/ShellLayout.tsx (~2600 lines): split window manager, desktop/launcher surface, and panels into separate modules. Wiki module map first.
- packages/video-modal/src/components/VideoGeneratorModal.tsx (~3500 lines): continue the v1.1.28 split plan (render state machine and encoder capability layer are prime extraction candidates; both were touched 2026-06-07).
- applets/kasai/src/shell/KasaiCore.tsx (~1021 lines): extract Sidebar/RightPane (flagged 2026-06-07).
- applets/character-studio: App.jsx and CharacterManifestData.js over soft budget.

## Non-negotiables carried forward

- No model resident when its applet is inactive.
- No READY status over broken/offline content; use the everywear:applet-status event.
- No Loom/My Maits donor copy user-facing.
- Installed-user vault (Documents\Everywear Vault) stays separate from Project Mymory developer semantics.
- No NFT/crypto language on public Everywear surfaces.
