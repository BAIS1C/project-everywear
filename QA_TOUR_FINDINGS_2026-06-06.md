# Everywear Full-System QA Tour Findings

Project location: `C:\Users\MAG MSI\Project Everywear`

Run date: 2026-06-07 00:08 SGT

Audit boundary: visual/browser-preview audit only. Codex Computer Use failed twice with `Computer Use native pipe path is unavailable`, so no real desktop window automation, file dialogs, shell-launched sidecar verification, real generation, export, or stem separation was possible. The preview used the documented localhost-only `?preview=1` bypass and Graphite as the current Obsidian-family theme.

## Preflight

| Check | Result |
|---|---|
| `git log --oneline -5` | HEAD `c27c132 Record Everywear stabilization closeout`; previous `79e5544`, `150d379`, `8bf0800`, `8dcb938`. |
| `git status --porcelain` | Dirty tree before audit; existing modified and untracked files were left untouched except required documentation receipts. |
| `cargo build -p everywear-os` | PASS, warnings only. |
| `cargo build` | PASS, compiled shell plus `onemagen`, `gener8`, `everywear-kasai`, `everywear-3nvizen`; warnings only. |
| `npm run build --workspace @everywear/ewds` | PASS. |
| `npm run build --workspace @everywear/video-modal` | PASS. |
| `npm run build --workspace onemagen` | PASS. |
| `npm run build --workspace @everywear/3nvizen` | PASS. |
| `npm run build --workspace kasai-applet` | PASS. |
| `npm run build --workspace @everywear/educ8` | PASS. |
| `npm run build --workspace @everywear/gener8-web` | PASS, chunk warning. |
| `npm run build --workspace @everywear/vid-web` | PASS. |
| `npm run build --workspace @everywear/character-studio` | PASS, Sass/Three warning debt only. |
| `npm run build --workspace everywear-os` | PASS, Sass/chunk/dynamic import warnings. |

## Handoff Checklist Verdict

| Item | Verdict | Evidence |
|---|---|---|
| Green dot status indicator | BLOCKED desktop | Browser preview shows green dots and loaded slots, but desktop Computer Use was unavailable. |
| My Mait opens inline, no Edge page | PREVIEW PASS, desktop BLOCKED | `06-mymait-open-graphite.png`; real Tauri acceptance not run. |
| No `KASAI_NOT_ACTIVE` | PREVIEW PASS, desktop BLOCKED | No `KASAI_NOT_ACTIVE` observed in preview; real desktop not run. |
| Truthful My Mait status pill | PARTIAL | Preview reports loaded slots and VRAM. It cannot prove shell runtime truth. |
| My Mait local model detection/selection | FAIL in integrated shell | Shell route imports `KasaiCore` directly and bypasses `KasaiApp`, so `MyMaitSettings` model groups are not reachable in-shell. |
| MyMory status rail | PREVIEW PASS | My Mait shows Everywear Vault live and backing path in preview. |
| Pack-status smoke | BLOCKED desktop | Requires shell-launched Gener8 sidecar and Tauri IPC. |
| Video export parity | BLOCKED | No generated song in preview; Vid empty state blocks export. |
| Character Studio visual QA | PREVIEW PASS | Avatar Studio renders with Character/Avatar strings; warnings only. |
| Educ8 probe | PARTIAL | Opens and plan/accept works; Download becomes enabled after Accept Plan, not clicked. |

## Bugs By Severity

| Severity | Count |
|---|---:|
| BLOCKER | 2 |
| MAJOR | 3 |
| MINOR | 4 |

## Findings

### BLOCKER: Computer Use unavailable, desktop acceptance could not run

Surface: audit harness

Repro:
1. Load Computer Use runtime via Codex node tool.
2. Retry after reset and wait.

Expected: `sky.list_apps()` can enumerate Windows apps and launch `target\debug\everywear-os.exe`.

Actual: tool returns `Computer Use native pipe path is unavailable` twice.

Evidence: session tool output, no screenshot because the desktop control pipe never opened.

Impact: All real Tauri, file dialog, sidecar, model load, export, and stem separation acceptance remains unproven.

### BLOCKER: Vault preview blanks the app

Surface: Vault panel

Repro:
1. Open preview shell.
2. Click Vault.

Expected: Vault media/logs surface or a friendly preview fallback.

Actual: viewport becomes blank black; DOM snapshot is empty.

Console:
- `[Vault] Search failed: TypeError: Cannot read properties of undefined (reading 'invoke')`
- `[Vault] Stats failed: TypeError: Cannot read properties of undefined (reading 'invoke')`
- `Error: useShellAudio must be used within ShellAudioProvider`

Evidence: `16-vault-open-graphite.png`, `16-vault-open-graphite.console.json`.

### MAJOR: Integrated My Mait shell route bypasses settings/model picker

Surface: My Mait

Repro:
1. Open My Mait inside shell preview.
2. Look for Hub/Settings tabs or model group controls.

Expected: `KasaiApp` wrapper exposes Hub and Settings, including Models, Residency, Memory/Vault, Personality, Pet/Avatar, Safety, and System.

Actual: `AppletViewRouter.tsx` imports `@applets/kasai/src/shell/KasaiCore` directly, bypassing `KasaiApp`. The UI shows model status but not model group selection.

Evidence: `06-mymait-open-graphite.png`, `07-mymait-settings-models-graphite.png`; source read `platform/everywear-os/src/components/AppletViewRouter.tsx`.

Impact: Sean's local model inventory cannot be selected from the integrated My Mait surface. Existing loaded slots are visible, but model discovery/selection is not user-reachable.

### MAJOR: Educ8 Download becomes enabled after Accept Plan

Surface: Educ8

Repro:
1. Open Educ8.
2. Click Plan Downloads.
3. Click Accept Plan.

Expected: Probe-only audit path keeps Download disabled or requires explicit manifest/URL review before enabling.

Actual: DOM no longer marks Download disabled after Accept Plan. I did not click it.

Evidence: `13-educ8-open-graphite.png`, `14-educ8-plan-downloads-graphite.png`, `15-educ8-accept-plan-graphite.png`.

### MAJOR: S3 folder applet entries are not accessible buttons

Surface: S3 Studio tray

Expected: Each applet tile should be a stable button/target for tutorial automation.

Actual: DOM exposes app names as generic text inside `group "S3 Studio apps"`, forcing coordinate clicks.

Evidence: `22-s3-folder-reopen-graphite.png`, `28-s3-folder-scrolled-right-graphite.png`.

### MINOR: No literal Obsidian theme exists

Surface: Settings

Expected: An Obsidian theme if that is the desired audit skin.

Actual: Available skins are `classic`, `refined`, `terminal`, `graphite`, `anodized`, `carbon`. Graphite was used as the current Obsidian-family stand-in.

Evidence: `03-settings-open.png`, `04-settings-graphite-obsidian-active.png`.

### MINOR: Gener8 preview emits Vault transport errors

Surface: Gener8 4ever

Actual: Gener8 mounts, but preview console shows Vault provider errors because Tauri `invoke` is undefined in browser preview.

Evidence: `23-gener8-4ever-open-graphite.png`.

### MINOR: Avatar Studio warning debt

Surface: Avatar Studio

Actual: Renders in preview, but console reports `THREE.Clock` and `RGBELoader` deprecation warnings.

Evidence: `18-avatar-studio-open-graphite.png`.

### MINOR: DAW/3nvizen/Vid/1magen empty states block deep flows

Surface: Creator applets

Actual: All mount in preview, but deep flows require a real song/audio file, sidecar, or model load.

Evidence: `26-vid-studio-pro-open-graphite.png`, `30-daw-open-corrected-graphite.png`, `31-3nvizen-open-graphite.png`, `32-1magen-open-graphite.png`.

## Timing Measurements

| Action | Time |
|---|---:|
| Vite preview startup | 195 ms reported by Vite. |
| My Mait first response after send | About 12.8 s total wait; first 2.8 s showed no answer, after another 10 s answer appeared. |
| Educ8 open wait | 1.8 s. |
| Avatar Studio open wait | 2.5 s. |
| Gener8 4ever open wait | 5.0 s. |
| Gener8 Pro open wait | 5.0 s. |
| Vid Studio open wait | 3.5 s. |
| AI Director open wait | 2.5 s. |
| DAW open wait | 3.5 s. |
| 3nvizen open wait | 3.0 s. |
| 1magen open wait | 3.0 s. |

## Surface Coverage

| Surface | Coverage | Verdict |
|---|---|---|
| Shell desktop | Visual preview | PASS preview. |
| Settings/theme | Visual preview | PASS, Graphite selected. |
| S3 folder | Visual preview | PARTIAL, applet entries need accessible targets. |
| Bug report modal | Visual preview | PASS open/close, no submission. |
| My Mait | Visual preview | PARTIAL, chat/status works, settings/model picker hidden by route. |
| Educ8 | Probe-only preview | PARTIAL, Download enabled after Accept Plan. |
| Vault | Preview | BLOCKER, blank crash. |
| Avatar Studio | Preview | PASS visual mount, warning debt. |
| Layer U OSINT | Preview | PASS offline boundary. |
| Gener8 4ever | Preview | PARTIAL, controls visible, no real generation. |
| Gener8 Pro | Preview | PARTIAL, Reference/Cover visible, no upload/generation. |
| Vid Studio | Preview | BLOCKED by no songs. |
| AI Director | Preview | PASS top-level. |
| DAW | Preview | BLOCKED by no audio file and no desktop model route. |
| 3nvizen | Preview | PASS fail-closed offline sidecar. |
| 1magen | Preview | PARTIAL, prompt surface visible, generation disabled while model prepares. |

## Screenshot Index

All artifacts live in `C:\Users\MAG MSI\Project Everywear\screenshots\2026-06-06-everywear-full-tour`.

| File | Description |
|---|---|
| `01-shell-preview-entry.png` | Everywear ID gate. |
| `02-shell-preview-bypass-desktop.png` | Preview desktop. |
| `03-settings-open.png` | Settings open. |
| `04-settings-graphite-obsidian-active.png` | Graphite active. |
| `05-s3-folder-open-graphite.png` | S3 folder open. |
| `06-mymait-open-graphite.png` | My Mait hub. |
| `07-mymait-settings-models-graphite.png` | Failed settings hunt, still hub. |
| `08-mymait-chat-draft-graphite.png` | My Mait message draft. |
| `09-mymait-chat-response-graphite.png` | Post-send early state. |
| `10-mymait-chat-after-wait-graphite.png` | My Mait response after wait. |
| `11-bug-report-modal-mymait-graphite.png` | Bug report modal. |
| `12-after-bug-modal-close-graphite.png` | Modal closed. |
| `13-educ8-open-graphite.png` | Educ8 open. |
| `14-educ8-plan-downloads-graphite.png` | Educ8 plan. |
| `15-educ8-accept-plan-graphite.png` | Educ8 accepted plan. |
| `16-vault-open-graphite.png` | Vault blank screen. |
| `16-vault-open-graphite.console.json` | Vault console errors. |
| `17-reloaded-after-vault-crash-graphite.png` | Recovered shell. |
| `18-avatar-studio-open-graphite.png` | Avatar Studio. |
| `19-layeru-open-graphite.png` | Layer U map/offline. |
| `20-layeru-feeds-tab-graphite.png` | Layer U feeds. |
| `21-layeru-sources-tab-graphite.png` | Layer U sources. |
| `22-s3-folder-reopen-graphite.png` | S3 tray. |
| `23-gener8-4ever-open-graphite.png` | Gener8 4ever open. |
| `24-gener8-4ever-create-controls-graphite.png` | Gener8 controls. |
| `25-gener8-pro-open-graphite.png` | Gener8 Pro. |
| `26-vid-studio-pro-open-graphite.png` | Vid empty state. |
| `27-ai-director-open-graphite.png` | AI Director. |
| `28-s3-folder-scrolled-right-graphite.png` | S3 tray scrolled. |
| `29-daw-open-graphite.png` | Mistargeted click state. |
| `30-daw-open-corrected-graphite.png` | DAW open. |
| `31-3nvizen-open-graphite.png` | 3nvizen offline sidecar. |
| `32-1magen-open-graphite.png` | 1magen open. |

