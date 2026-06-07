# CODEX PROMPTPACK: Everywear Full-System User Tour (Computer Use)

Date: 2026-06-06 SGT
Location: C:\Users\MAG MSI\Project Everywear
Dispatched by: Claude Cowork (kasai-executive T1 dispatch)
Mode: OBSERVE-ONLY user simulation. You drive the real app with computer use.
Copy everything below the line into a Codex session with desktop control.

---

You are Codex with computer use on Sean's Windows machine (RTX 5090, 32GB VRAM).
You are playing THREE roles simultaneously:

1. A FIRST-TIME USER experiencing Everywear for the first time, slowly.
2. A QA TESTER who pokes every element and files bugs through the app's own
   bug-reporting flow.
3. A TUTORIAL AUTHOR drafting the onboarding script for the ENTIRE system,
   in the exact format of the existing draft at
   `screenshots/2026-05-29-everywear-os-themes-tour/tutorial-script-draft.md`
   (spotlight target / tooltip copy / required action / deterministic
   completion condition / screenshot), extended from themes-only to every
   surface. Read that file BEFORE starting; it is your output template.

## HARD RULES

- NO CODE EDITS. This is an assessment run. Zero exceptions. Bugs get
  reported and logged, never fixed mid-tour.
- NO PURCHASES, no payment flows, no real money surfaces. The logged-in demo
  account behaves as a Pro-level grant; use it as-is.
- NO MODEL DOWNLOADS in Educ8. Probe its buttons, record what each one does
  or claims to do, screenshot, move on. (Gener8/DAW model downloads that the
  app initiates as part of normal flow ARE allowed; that is the test.)
- PATIENCE IS THE METHOD. Model loads and switches can take 30s to several
  minutes. After any action that triggers loading, WAIT for the status
  indicator to settle before judging or clicking again. Never spam-click.
  If a spinner runs >5 minutes with no progress signal, that is a bug:
  screenshot, report, move on.
- One surface at a time. Finish a screen's checklist before leaving it.

## PHASE 0: PREFLIGHT (terminal, before any UI)

1. `cd C:\Users\MAG MSI\Project Everywear`, `git log --oneline -5`,
   `git status --porcelain`. Record the state in your report. A My Mait
   settings stream may have landed after `c27c132`; note whatever HEAD is.
   Do NOT commit, stash, or otherwise touch the tree.
2. Find the canonical launch path: check WIKI.md and PROJECT_STATE.md for the
   shell launch command. Prefer the existing green debug build
   (`cargo build -p everywear-os` passed 2026-06-06 12:48 SGT); rebuild only
   if launch fails. Remember: gener8.exe must be SHELL-LAUNCHED; it exits
   without `EVERYWEAR_CMD_PORT`. Never launch sidecars directly.
3. Create `screenshots/2026-06-06-everywear-full-tour/`. Every screenshot
   goes there, named `{NN}-{surface}-{state}.png` (e.g.
   `04-mymait-green-dot.png`). Number sequentially so the tour is replayable
   in order.

## PHASE 1: SHELL AND DESKTOP CHROME

Launch the shell. Then, slowly:

- First desktop: clock/HUD, icon rail, taskbar. Screenshot the virgin state.
- Settings: themes, accents, chrome density, wallpaper intensity, bevel,
  traffic lights, surface treatment. Toggle each, screenshot representative
  states, confirm nothing breaks product labels.
- S3 folder tray: open, confirm it renders above the icon column, note
  locked/unlocked badges per entitlement.
- Bug report button: open the BugReportModal once on a HEALTHY screen to
  document the flow itself (fields, clipboard fallback, what it captures).
  Screenshot. Close without submitting garbage.

## PHASE 2: MY MAIT (kasai)

This clears the owed desktop acceptance checklist. Verify each, screenshot each:

- Green dot status indicator present and truthful
- Opens INLINE in the shell; no Edge/browser page spawns
- No `KASAI_NOT_ACTIVE` error anywhere in the flow
- Status pill reflects real runtime state (not hardcoded LIVE)
- Send a real chat message; wait for the model; record round-trip behavior
- Tool-call cards: if any tool calls render, screenshot; malformed-payload
  guard should fail closed, not crash
- If the new settings surface landed (model preference, residency policy,
  VRAM badge, companion state): exercise every control, screenshot each state
- MyMory status rail: note what it claims vs reality

## PHASE 3: EDUC8 (probe only, NO downloads)

Open it. Map every button, menu, and screen. For each control: what does it
say it does, what happens on click, where does it dead-end without a
download. Screenshot each distinct screen. Decline/cancel any download
prompt and record exactly how the decline path behaves. That decline path IS
a finding.

## PHASE 4: GENER8 4EVER → MAKE A SONG

As a user would:

- Open Gener8 from the S3 folder. Wait for engine health.
- Walk the create panel: every input, dropdown, slider, toggle. Confirm the
  model dropdown shows product labels only (Song Model / Fast Song Model /
  Pro Model), never raw GGUF/quant names. Screenshot the dropdown.
- Generate a full song from a text prompt. Time it. Wait for completion.
- Play it back. Check library/vault registration. Screenshot the result.

## PHASE 5: GENER8 PRO SURFACES

- Switch to a Pro model. WAIT through the full model switch; record how the
  UI communicates progress. This is a known slow path; that is the point.
- Pack status: if a Pro Model banner/install surface appears, exercise it and
  record what `pack-status` reports through the UI. This clears the owed
  shell-launched pack route smoke.
- Reference/Cover: upload a short audio file as Reference, generate. Then
  Cover. Verify mode-switching does not contaminate the other slot (the
  stale-slot bug was fixed 05-27; confirm it stays fixed). Screenshots.
- 75-step generation if exposed: run once, time it, screenshot.

## PHASE 6: VID STUDIO → MAKE A VIDEO

- Open the video flow from the song you made in Phase 4.
- Walk every preset, visualizer, text/subtitle control, settings panel.
  Screenshot each preset's preview at least once.
- Render and EXPORT a real video. This is the owed export-parity smoke for
  the package worker path: confirm the export completes, the file exists on
  disk, plays, and registers in the Vault with metadata. Record duration.

## PHASE 7: DAW → STEM SEPARATION

- Open the DAW route. Load the Phase 4 song.
- Run stem separation. Wait it out. Verify stems are real separations, not
  clones of the source (the SFTTurbo50 mislabel produced clone-stems before;
  listen/check waveforms differ per stem). Screenshot the stem view.
- Probe remaining DAW controls methodically; screenshot each panel.

## PHASE 8: ANY SURFACE NOT YET TOUCHED

1magen, 3nvizen, AI Director, Character Studio/Avatar, Loom-wire surfaces,
anything in the icon rail not covered above: open each, screenshot, probe
top-level controls only, note entitlement gating. No deep dives, no
downloads.

## BUG PROTOCOL (every time something breaks)

1. Screenshot the broken state immediately (before dismissing anything).
2. Open the in-app bug report flow and file it FROM the broken surface; the
   reporting flow itself is under test. Screenshot the filled modal. Note
   whether capture/clipboard worked.
3. Log in your findings doc: surface, repro steps, expected vs actual,
   screenshot refs, severity (BLOCKER blocks the tour / MAJOR breaks a
   feature / MINOR cosmetic).
4. If a BLOCKER stops a phase: do not fix, do not force. Note it, attempt
   one reasonable workaround (relaunch surface, not reinstall), and continue
   with the next phase.

## DELIVERABLES (write these, in the project root)

1. `TUTORIAL_SCRIPT_FULL_SYSTEM_2026-06-06.md`: the tutorial-author output.
   Same table format as the themes draft (target / tooltip / action /
   completion / screenshot), one section per Phase above, written as the
   onboarding a brand-new user would follow across the WHOLE system. Where a
   stable `data-tour` attribute is missing on a control a tutorial step
   needs, list it in a "data-tour gaps" appendix; do not add it to code.
2. `QA_TOUR_FINDINGS_2026-06-06.md`: every bug with severity, every timing
   measurement (model load, switch, generation, render, separation), every
   dead end, plus a one-table verdict against the handoff checklist items:
   green dot, inline open, no Edge page, no KASAI_NOT_ACTIVE, truthful pill,
   pack-status smoke, export parity, character-studio visual QA, Educ8 probe.
3. Append a timestamped SGT section to PROJECT_STATE.md: tour ran, verdict
   summary, links to the two docs and the screenshot folder. Append-only.
4. Rollout summary in `.codex/memories` (this was missed last pass; do not
   miss it again).

## FINAL REPORT STRUCTURE

- Handoff checklist verdict table (item / PASS / FAIL / BLOCKED+why)
- Bug count by severity, with the single worst finding first
- Timing table (every wait you measured)
- Tutorial coverage: which surfaces have full scripts vs gaps
- Screenshot index
