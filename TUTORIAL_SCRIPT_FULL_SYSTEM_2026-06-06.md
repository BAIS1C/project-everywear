# Everywear Full-System Tutorial Script

Project location: `C:\Users\MAG MSI\Project Everywear`

Run date: 2026-06-07 00:08 SGT

Audit boundary: browser-preview visual pass using `http://127.0.0.1:5173/?preview=1` because Codex Computer Use reported `Computer Use native pipe path is unavailable`. Desktop/Tauri acceptance remains blocked. Theme used: Graphite, current EWDS-v2 Obsidian stand-in. No source code edits.

Format: spotlight target, tooltip copy, required action, deterministic completion condition, screenshot.

## Phase 0: Preflight

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Git state | Record exactly what code is under test before launching. | Run `git log --oneline -5` and `git status --porcelain`. | HEAD and dirty tree recorded in QA report. | n/a |
| 2 | Build receipts | Build the desktop shell, Rust applet exes, and web bundles. | Run Cargo workspace build plus npm workspace builds. | All builds exit 0, warnings only. | n/a |
| 3 | Preview entry | Everywear ID blocks the app without a session. Preview mode is a localhost-only visual QA bypass. | Open `/` then `/ ?preview=1`. | Login gate captured, then shell desktop opens. | `01-shell-preview-entry.png`, `02-shell-preview-bypass-desktop.png` |

## Phase 1: Shell And Desktop Chrome

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Center HUD | This is the home node: clock, local status, inference, network, and weather. | None | User sees shell desktop. | `02-shell-preview-bypass-desktop.png` |
| 2 | Settings icon | Settings controls the visual language and shell preferences. | Click Settings. | Settings window opens. | `03-settings-open.png` |
| 3 | Theme grid | Use Graphite as the current Obsidian-family audit skin. | Click Graphite. | `body[data-skin="graphite"]`, `body[data-mode="dark"]`. | `04-settings-graphite-obsidian-active.png` |
| 4 | S3 folder | S3 Studio groups creator tools. | Click S3 folder. | Tray opens above the icon column. | `05-s3-folder-open-graphite.png`, `22-s3-folder-reopen-graphite.png` |
| 5 | Bug report | Report a problem captures the current surface context. | Open report on My Mait. | Modal opens with description field and Copy/Send actions. | `11-bug-report-modal-mymait-graphite.png` |

## Phase 2: My Mait

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | My Mait icon | My Mait is the local agent hub inside Everywear. | Click My Mait. | Inline shell window opens, no external browser page. | `06-mymait-open-graphite.png` |
| 2 | Loaded slots | The hub shows local model state, but this is not the settings picker. | Inspect right rail. | Shows Qwen3.6 35B-A3B Q4 and Qwen3.5 9B Q8 in preview. | `06-mymait-open-graphite.png` |
| 3 | Chat composer | Ask My Mait a harmless status question. | Type and send message. | Assistant answers after roughly 12.8s total wait in preview. | `08-mymait-chat-draft-graphite.png`, `10-mymait-chat-after-wait-graphite.png` |
| 4 | Settings tab | Settings should expose Models, Residency, Memory, Personality, Pet/Avatar, Safety, and System. | Try to open Settings. | BLOCKED: integrated shell imports `KasaiCore` directly, bypassing `KasaiApp` tabs. | `07-mymait-settings-models-graphite.png` |

## Phase 3: Educ8

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Educ8 icon | Educ8 is the source-only education surface in this build. | Click Educ8. | Educ8 opens with IGCSE Teacher Pack. | `13-educ8-open-graphite.png` |
| 2 | Plan Downloads | Planning must show intent before any download. | Click Plan Downloads. | Plan state updates. | `14-educ8-plan-downloads-graphite.png` |
| 3 | Accept Plan | Accepting should only accept manifest review. | Click Accept Plan. | Copy says 6 items accepted for download review. | `15-educ8-accept-plan-graphite.png` |
| 4 | Download boundary | Download must stay safe during probe-only audit. | Do not click Download. | Finding: Download becomes enabled after Accept Plan. | `15-educ8-accept-plan-graphite.png` |

## Phase 4: Gener8 4ever

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Gener8 4ever tray item | Gener8 4ever is the song-only creator entry. | Click from S3 folder. | Applet opens in shell preview. | `23-gener8-4ever-open-graphite.png` |
| 2 | Creative Controls | Product labels must hide raw model/quant names. | Open Creative Controls. | Song-mode controls visible; no raw GGUF/quant label visible. | `24-gener8-4ever-create-controls-graphite.png` |

## Phase 5: Gener8 Pro

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Gener8 Pro tray item | Gener8 Pro exposes Reference and Cover. | Click from S3 folder. | Reference/Cover surface opens. | `25-gener8-pro-open-graphite.png` |
| 2 | Pro model copy | Pro controls should use product labels. | Inspect copy. | Uses "Pro capability model"; no raw quant visible. | `25-gener8-pro-open-graphite.png` |

## Phase 6: Vid Studio

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Vid Studio Pro | Vid creates visualizers from songs. | Click from S3 folder. | Empty state opens. | `26-vid-studio-pro-open-graphite.png` |
| 2 | Empty state | User needs a song before video creation. | Inspect state. | "No songs yet" and "Select a song to create a video" visible. | `26-vid-studio-pro-open-graphite.png` |

## Phase 7: DAW

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | S3 tray scroll | DAW is off-screen in the horizontal tray. | Scroll tray right. | DAW and 3nvizen become visible. | `28-s3-folder-scrolled-right-graphite.png` |
| 2 | DAW | DAW is stem-first until audio is loaded. | Click DAW. | DAW opens with Upload Audio File and disabled Timeline. | `30-daw-open-corrected-graphite.png` |

## Phase 8: Other Surfaces

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Avatar Studio | Avatar Studio is the Character Studio mount for Strands Blanks. | Click Avatar Studio. | Surface opens with Avatar/Character Studio strings. | `18-avatar-studio-open-graphite.png` |
| 2 | Layer U OSINT | Layer U shows public-source OSINT through Project SON. | Click Layer U. | Offline SON boundary visible. | `19-layeru-open-graphite.png` |
| 3 | Layer U feeds | Feeds should explain offline state. | Click feeds. | Feeds tab selected. | `20-layeru-feeds-tab-graphite.png` |
| 4 | Layer U sources | Sources should expose posture and health. | Click sources. | Sources tab selected. | `21-layeru-sources-tab-graphite.png` |
| 5 | AI Director | AI Director is a creator-planning route. | Click AI Director. | Disabled Draft Plan and sample shot plan visible. | `27-ai-director-open-graphite.png` |
| 6 | 3nvizen | 3nvizen should fail closed when sidecar is offline. | Click 3nvizen. | LTX sidecar offline, Generate disabled. | `31-3nvizen-open-graphite.png` |
| 7 | 1magen | 1magen should expose image generation without raw machine detail. | Click 1magen. | Prompt surface opens, Generate disabled while model prepares. | `32-1magen-open-graphite.png` |

## Data-Tour And Accessibility Gaps

| Gap | Impact | Evidence |
|---|---|---|
| S3 folder tray entries are generic text, not buttons. | Tour automation needs coordinates instead of stable targets. | `22-s3-folder-reopen-graphite.png` |
| My Mait settings tab is absent in integrated shell route. | Models/residency settings tutorial cannot run. | `07-mymait-settings-models-graphite.png` |
| Vault panel can blank the preview without a visible error boundary. | Tutorial cannot teach recovery or continue gracefully. | `16-vault-open-graphite.png`, `16-vault-open-graphite.console.json` |
| Educ8 Download becomes enabled after Accept Plan. | Probe-only flow risks accidental download. | `15-educ8-accept-plan-graphite.png` |

