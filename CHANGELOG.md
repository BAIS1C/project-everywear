# Changelog

All notable changes to Everywear OS. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are SGT
(UTC+8). The project is pre-GA; everything below ships under `0.1.0`
pre-release iterations. Deeper technical detail per entry lives in the
WIKI.md current-state notes (version refs given) and CONTEXT.md.

This file supersedes `CHANGELOG.log` as the canonical changelog from
2026-06-07 onward; the old log is retained for history.

## [Unreleased]

### Planned
- 1magen full Everywear port: shell command bridge + EWDS layout
- Layer U EWDS port with SON start-local affordance
- Educ8 download workflow rebuild around visible learner/parent actions
- Avatar Studio install-pack provisioning (size/checksum/receipt, offline verify)
- Module splits: ShellLayout, VideoGeneratorModal, KasaiCore
- Pre-release auth hardening: Supabase JWKS verification, entitlement claims from verified tokens

## [2026-06-07] Visual bugfix repair pass + local asset doctrine (WIKI v1.1.29-v1.1.30)

### Fixed
- Vault black screen: VaultPanel mounted LibraryView without ShellAudioProvider and without an error boundary; both added, AppletErrorBoundary exported and reused with remount-key Retry.
- Vid Studio never used NVENC: no caller ever booted the shared encoder sidecar. The render modal now acquires it on open, retry-polls health, and releases on close.
- Vid export "Failed to load video encoder" + panel stuck at "Rendering frames 0%": WASM core fetch was CSP-blocked (unpkg.com missing from connect-src) and a silent return leaked exporting state. CSP fixed, state reset added, visible fallback explanation added.
- My Mait claimed to be a cloud service while the side rail showed local models: the chat job carried no system prompt. The shell now injects detected GPU, loaded slots, and Everywear Vault status into every chat turn; the runtime single-model path reads it too.
- My Mait settings unreachable in-shell: MyMaitSettings mounted in KasaiCore (header gear + clickable model cards, full-pane view).
- Strands Nation applet could not load the live site: frame-src now allows strandsnation.xyz; remote applet windows gained an open-in-browser control.
- Window chrome showed READY over offline/broken content: runtime label now consumes applet health; new `everywear:applet-status` self-report event; Layer U wired with an offline Retry control.
- Avatar Studio black surface with broken icons: UI chrome assets now bundle via Vite; manifest failures surface a visible error + Retry. Root cause: runtime CDN prefix returned 404 on everything.
- Educ8 leaked internal donor language (Loom, My Maits Lite, NOMAD): user-facing copy reframed as a home-education product; internal status panels gated behind a dev flag.
- S3 tray truncated "AI Director"; tray slots widened with two-line labels.
- Inline-mounted 1magen errored "Command get_default_output_dir not found": command bridged in the shell.

### Added
- Bug report modal: "Save to this computer only" target backed by new shell command `save_bug_report` (writes ~/.everywear/reports/), safe for unattended QA.
- S3 suite single-active lifecycle: opening one suite applet closes the previous one; handoff context survives via intentBus/Vault.
- Shell command `get_character_studio_asset_root`: strictly local Avatar Studio asset resolution (provisioned data dir, bundled resources, repo tree).

### Changed
- DOCTRINE (Sean-locked): Avatar Studio assets are local. Runtime R2/CDN streaming vetoed; remote storage may only ever serve as a one-time install-pack source with local receipts. CDN URL purged from env, CSP entry removed, R2 upload script hard-deprecated.
- 1magen and 3nvizen moved from the S3 Studio folder to desktop-level applets (entitlement gating unchanged).

## [2026-06-06] Educ8 rename, video-modal split, full-system audit (WIKI v1.1.27-v1.1.28)

### Changed
- Free education applet rebranded Loom -> Educ8 (brand + Tier A code surface; wire id stays `loom`).
- VideoGeneratorModal types/presets split out; duplicate Gener8 video worker deprecated.

### Added
- Kasai operating skills locked (kasai-executive arbitration, kasai-swarm parallelization) and decision ledger established in the MyMory vault.
- Full-system visual audit (preview fallback after Computer Use blocker): findings doc, tutorial script draft, screenshot tour.

## [2026-06-05] My Mait integration + applet install doctrine (WIKI v1.1.22-v1.1.26)

### Added
- My Mait shell runtime integration: shell-owned model lifecycle, settings/residency IPC, VRAM badge, donor skill catalog, EWDS skill glyphs.
- Applet install assessment doctrine locked: shell assessment first, shell-owned install with visible receipt, runtime launch third.
- Character Studio vendored as Avatar Studio (package, manifest, asset base plumbing).

### Fixed
- DAW stem Pro Model readiness at the route/alias layer (`pro_base` -> `better_models`).

## [2026-06-01 .. 2026-06-02] Auth refactor + theme work

### Changed
- Neutral identity/entitlement path (`active_tier()`, `user_entitlements`) consolidated; legacy S3 subscription overrides bridged for owner QA (local bypass flagged as release blocker).
- EWDS Obsidian-family theming and OG card pass.

## [2026-05-26 .. 2026-05-30] Gener8 split, vault repair, EWDS-v2 (WIKI v1.1.5-v1.1.20)

### Added
- Gener8 split into Gener8 4ever / Gener8 Pro launcher entries on one shared bundle; single `vid` applet as the video handoff target.
- EWDS-v2 additive theme family (Graphite, Anodized, Carbon; bevel/recessed utilities; holographic desktop icons).
- Identity, Vault, Entitlement, and engine migration contract (Phases 1-3.5); headless release binaries built for all active targets.

### Fixed
- Gener8 Vault repair: library playback wiring, silent player (asset CSP origin), Loom manifest parse, everything-locked owner identity.
- S3 folder tray occlusion.

## [2026-05-24] AIO architecture accepted

- Gener8 AIO accepted as a first-party local Everywear applet target; standalone desktop shell line superseded. `s3studio-web` remains the hosted/web product source. Everywear Vault defined as the Library source of truth.
