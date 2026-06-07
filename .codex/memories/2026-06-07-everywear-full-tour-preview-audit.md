# Rollout Summary: Everywear Full-System Preview Audit

Project location: `C:\Users\MAG MSI\Project Everywear`

Timestamp: 2026-06-07 00:08 SGT

## Scope

- User requested an overnight hands-on visual/computer-use audit with regular screenshots and Obsidian theme.
- Computer Use was unavailable in Codex desktop: `Computer Use native pipe path is unavailable` after reset and retry.
- Ran degraded browser-preview visual audit at `http://127.0.0.1:5173/?preview=1`.
- Used Graphite as current Obsidian-family skin because no literal Obsidian skin exists.

## Preflight

- `cargo build -p everywear-os`: PASS, warnings only.
- `cargo build`: PASS, compiled shell and Rust applet exes.
- npm workspace builds: PASS for EWDS, video-modal, 1magen, 3nvizen, kasai-applet, Educ8, Gener8 web, Vid web, Character Studio, and Everywear OS.
- Git HEAD before docs: `c27c132 Record Everywear stabilization closeout`.
- Tree was dirty before audit; source files were not edited.

## Evidence

- Screenshots: `C:\Users\MAG MSI\Project Everywear\screenshots\2026-06-06-everywear-full-tour`
- QA report: `C:\Users\MAG MSI\Project Everywear\QA_TOUR_FINDINGS_2026-06-06.md`
- Tutorial script: `C:\Users\MAG MSI\Project Everywear\TUTORIAL_SCRIPT_FULL_SYSTEM_2026-06-06.md`

## Key Findings

- BLOCKER: Desktop/Tauri acceptance could not run because Computer Use pipe was unavailable.
- BLOCKER: Vault preview blanks the app. Console shows `useShellAudio must be used within ShellAudioProvider` and undefined Tauri `invoke` in Vault transport.
- MAJOR: Integrated My Mait route imports `KasaiCore` directly, bypassing `KasaiApp`, so My Mait Settings and model group selection are not reachable in shell.
- MAJOR: Educ8 `Download` becomes enabled after `Accept Plan`; not clicked during probe-only audit.
- MAJOR: S3 tray applets are visually clickable but exposed as generic text, not stable buttons.
- My Mait hub reports loaded slots in preview: Qwen3.6 35B-A3B Q4 and Qwen3.5 9B Q8, 29.7/32 GB, but selection/discovery UI is hidden by the route bug.

## Next Gate

Run the same audit in real desktop/Tauri once Computer Use is available, or hand it to a harness with working Windows UI automation. Priority fixes before retest:

1. Route integrated `kasai` through `KasaiApp` instead of `KasaiCore`.
2. Wrap Vault preview with `ShellAudioProvider` or add a safe preview fallback/error boundary.
3. Keep Educ8 Download disabled until explicit manifest/URL/size/checksum review is visible.
4. Add stable buttons/data-tour targets for S3 tray entries and My Mait settings tabs.

