# CODEX PROMPTPACK: Everywear QA + Immediate-Fix Loop (Computer Use)

Date: 2026-06-07 SGT
Location: C:\Users\MAG MSI\Project Everywear
Dispatched by: Claude Cowork (kasai-executive T1 dispatch, Sean-directed)
Mode: ITERATIVE FIX-AS-YOU-GO. Supersedes the observe-only mode of
CODEX_PROMPTPACK_FULL_SYSTEM_TOUR_2026-06-06.md for this run. Tour order and
surface checklists from that pack still apply; this pack changes what happens
when something breaks: you fix it NOW, rebuild, and re-verify before moving on.
Copy everything below the line into a Codex session with desktop control.

---

You are Codex with computer use on Sean's Windows machine (RTX 5090, 32GB VRAM).
You are FOUR roles in a loop: first-time user, QA tester, repair engineer,
and verifier. The unit of work is the FIX LOOP, not the tour. The tour is the
bug generator; the loop is the product.

## THE FIX LOOP (run this for every defect found)

1. CAPTURE: screenshot the broken state immediately, before dismissing
   anything. Name it `{NN}-{surface}-broken-{slug}.png`.
2. TRIAGE, two bins only:
   - IN-LOOP: surgical fix. Roughly: touches <= 3 files, no new architecture,
     no new canon (no pricing/tier/naming/positioning), no schema or IPC
     contract redesign, estimated under 30 minutes.
   - PUNCH LIST: everything else. Log it with repro + screenshot in the
     findings doc and CONTINUE THE TOUR. Do not start refactors mid-loop.
3. WIKI-FIRST, ALWAYS, EVEN AT 3AM: before editing, read the WIKI.md section
   (and PROJECT_STATE.md carry list) covering the module. State in your log
   which section you read. Read every file you will touch IN FULL. If the
   wiki contradicts the disk, fix the wiki line in the same commit.
4. FIX: one defect per commit. No drive-by edits, no opportunistic cleanup.
   If the file is over budget (ShellLayout.tsx ~2600 lines, hard ceiling
   VideoGeneratorModal.tsx ~4000+), make the minimal edit and add the file to
   the punch list; do NOT split modules mid-loop.
5. VERIFY BUILD: `cargo check -p everywear-os` (plus the touched crate) and
   `node_modules\.bin\tsc.cmd --noEmit -p platform\everywear-os` (plus the
   touched package tsconfig). Do not use bare `npx tsc`; it has stalled on
   this machine. Red build = fix or revert before anything else.
6. RELAUNCH + RE-VERIFY: rebuild/restart only the surfaces needed, replay the
   EXACT repro steps, screenshot `{NN}-{surface}-fixed-{slug}.png`. The
   broken/fixed screenshot pair is the acceptance artifact.
7. REGRESSION SPOT-CHECK: re-touch any previously-passed surface that shares
   the module you just edited (edited ShellLayout -> recheck desktop chrome,
   windows, tray; edited video-modal -> recheck Gener8 video entry point).
8. COMMIT: `fix(surface): {symptom} -- {root cause}` with the screenshot pair
   referenced in the body. Then log the loop entry (see FIX LEDGER) and
   resume the tour where you left off.

TIME-BOX: 30 minutes per in-loop fix attempt. Expired? `git checkout` the
touched files, demote to punch list, note why, move on. A stuck fix must
never eat the run.

## HARD RULES

- BASELINE COMMIT FIRST (Phase 0). Every fix must be an isolated diff.
- NO PURCHASES, no payment flows, no real money surfaces.
- NO MODEL DOWNLOADS in Educ8 beyond the explicit plan/accept flow under
  test; never accept a multi-GB download without it being the test itself.
- NO architecture changes, no module splits, no dependency additions, no
  canon changes mid-loop. Those are punch-list items.
- NEVER weaken these in a fix: local-first (no runtime CDN/R2 for Avatar
  Studio assets; Sean veto 2026-06-07), no Loom/My Maits donor copy
  user-facing, no READY status over broken content, no resident models for
  inactive applets, installed-user vault stays Documents\Everywear Vault.
- PATIENCE IS THE METHOD: model loads/switches can take minutes. Spinner
  >5 min with no progress signal = defect, enter the fix loop.
- gener8.exe must be SHELL-LAUNCHED (needs EVERYWEAR_CMD_PORT). Never launch
  sidecars directly.
- One surface at a time; one defect per commit; append-only logs.

## PHASE 0: PREFLIGHT

1. Verify Computer Use actually drives the desktop (move mouse, screenshot).
   If the native pipe is unavailable again (2026-06-07 00:08 failure), STOP:
   write the blocker to PROJECT_STATE.md and exit. A preview-only run is not
   acceptable for this pack; fixes need real desktop acceptance.
2. `git log --oneline -3`, `git status --porcelain`. The tree currently
   carries ~41 verified-but-uncommitted files (2026-06-07 repair pass +
   local-asset doctrine). Commit them AS-IS as the baseline:
   `checkpoint: 2026-06-07 visual bugfix handoff repair + local asset doctrine (pre QA-fix-loop)`.
   Do not rebase, do not squash history.
3. Build green before touring: `cargo check -p everywear-os`, shell tsc (see
   loop step 5 for the exact command). Record times.
4. Create `screenshots/2026-06-07-qa-fix-loop/`. Sequential numbering.
5. Launch the shell from the canonical path per WIKI.md/PROJECT_STATE.md.

## PHASE 1: VERIFY THE 2026-06-07 REPAIR PASS (this is the first QA target)

These were fixed in source and compile clean, but NONE have been seen on
glass. Verify each; any failure goes straight into the fix loop:

- Vault opens with content or a visible error + Retry. No black screen.
- 1magen and 3nvizen sit on the desktop, NOT inside S3 Studio; entitlement
  badges still correct.
- Opening Vid (incl. from Gener8 "Create Video") closes the running S3 suite
  applet; song handoff survives.
- Vid render button: sidecar boots (watch for GPU/CPU label, not WASM, within
  ~10s of modal open). Export a real video via NVENC; file exists, plays,
  registers in Vault.
- Force the WASM fallback once if practical (or simulate): no stuck
  "Rendering frames 0%" after an encoder failure; panel stays actionable;
  amber explanation visible.
- My Mait chat: ask "are you local? what models and vault do you have?" The
  answer must agree with the side rail (RTX 5090, Qwen slots, Everywear
  Vault). Settings gear opens; model cards clickable; Use Group works.
- Layer U with SON offline: window chrome shows OFFLINE (not READY), Retry
  control present.
- Avatar Studio: chrome renders (no broken-image icons); if local 3D assets
  resolve via the repo fallback, landing buttons work; manifest failure shows
  the visible error + Retry, not black.
- S3 tray: "AI Director" label fully visible.
- Educ8: no Loom/My Maits/NOMAD language anywhere user-facing.
- Bug report modal: "Save to this computer only" writes to
  ~/.everywear/reports/ and shows the path.
- Strands Nation applet: live strandsnation.xyz loads in the embedded frame;
  open-in-browser control works. If the site refuses framing
  (X-Frame-Options/frame-ancestors), that is a SITE-side punch-list item,
  not an in-loop fix.

## PHASE 2+: FULL TOUR

Run Phases 1-8 of CODEX_PROMPTPACK_FULL_SYSTEM_TOUR_2026-06-06.md (shell
chrome, My Mait, Educ8 probe, Gener8 song, Pro surfaces, Vid export, DAW
stems, remaining surfaces) with the fix loop armed. Differences from the
observe-only pack:

- Educ8: the plan/accept/download flow MAY be exercised end-to-end for the
  smallest available pack if and only if the explicit accept controls
  (manifest/size/checksum) render correctly; that flow is under test.
- The in-app bug report flow is still under test: file at least one report
  via "Save to this computer only" from a real broken surface before fixing
  it, and verify the saved file content.
- Tutorial authoring is OUT OF SCOPE for this run. Fixing replaces it.

## FIX LEDGER (deliverable, the core artifact)

`QA_FIX_LOOP_2026-06-07.md` in the project root. One entry per loop:

```
### {NN}. {surface}: {symptom}
- Severity: BLOCKER / MAJOR / MINOR
- Repro: {steps}
- Root cause: {one or two lines, the actual mechanism}
- Wiki section read: {heading}
- Fix: {files touched} -> commit {hash}
- Verified: {broken png} -> {fixed png}, build green, regression spot-check {surfaces}
- Residue: {anything demoted to punch list}
```

Plus at the end: PUNCH LIST (everything triaged out, with severity and repro),
timing table (loads, switches, renders, separations), and a verdict table for
Phase 1's repair-pass checklist (item / PASS / FIXED-IN-LOOP / PUNCH).

## CLOSEOUT

1. Final build verify + one full relaunch; smoke the three money paths
   end-to-end on the fixed build: song -> video export -> vault playback.
2. Append a timestamped SGT section to PROJECT_STATE.md: run summary, fix
   count by severity, punch list count, link to ledger + screenshots.
3. Rollout summary in `.codex/memories`.
4. Leave the tree COMMITTED (baseline + one commit per fix). No dirty exit.

## FINAL REPORT STRUCTURE

- Phase 1 repair-pass verdict table first (item / PASS / FIXED-IN-LOOP / PUNCH)
- Fix count by severity, worst finding first, with commit hashes
- Punch list (dispatch candidates for the next promptpack)
- Timing table
- Screenshot index (broken/fixed pairs grouped)
