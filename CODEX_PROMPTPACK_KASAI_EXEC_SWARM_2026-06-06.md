# CODEX PROMPTPACK: Everywear Stabilization Pass (Kasai Executive + Swarm)

Date: 2026-06-06 SGT
Location: C:\Users\MAG MSI\Project Everywear
Branch: phase2/character-studio-absorption
Dispatched by: Claude Cowork (kasai-executive T1 dispatch)
Mode: EXECUTE. Single prompt, full pass. Copy everything below the line into Codex.

---

You are Codex operating on C:\Users\MAG MSI\Project Everywear under two governing
disciplines. If the kasai-executive and kasai-swarm skills are installed in your
environment, load them; the compressed doctrine below binds either way.

## DOCTRINE A: EXECUTIVE (tier arbitration)

Classify every decision you face into a tier BEFORE acting:

- T0 AUTO: bugfixes, formatting, commits, doc/wiki sync, .gitattributes, anything
  already answered by PROJECT_STATE.md or WIKI.md. Just do it, log one line.
- T1 BOUNDED: technical choices inside locked architecture (module boundaries,
  split seams, import paths, retry strategy). Decide, execute, log the decision
  and rationale in your final report.
- T2 STOP: anything that changes launch contracts, entitlements, tier/pricing
  semantics, public-facing surfaces, or deletes >50 lines of code whose parity is
  unverified. Surface it in the final report as a decision card; do NOT execute.
- LOCKED CANON (do not touch, do not "fix"):
  - kasai registry entry = BinaryLocal, launch_binary = Some("everywear-kasai"),
    frontend_port = None, in BOTH registry.rs and transport.ts. If a build error
    tempts you to flip it back to FrontendInline, STOP: that is the exact drift
    this pass exists to bury. Fix forward within the contract.
  - gener8-4ever has launch_binary = None. Do not reassign the kasai binary to it.
  - Canonical pack id pro_base, manifest alias better_models. Keep the alias boundary.
- Registry files (registry.rs, transport.ts) are the documented one-agent collision
  hotspot. Read both in full before any write; never edit them in a parallel lane.

## DOCTRINE B: SWARM (parallel decomposition)

- Decompose before executing. Serial gates are explicit and honored: git commits
  and registry edits are SERIAL, always.
- Parallel work requires disjoint write ownership: two lanes never write the same
  file or directory. Builds may run concurrently where the toolchain allows.
- Wiki-first: before editing any module, read its section in WIKI.md and
  docs/wiki/. State which section you referenced. Update the wiki in lockstep
  with the code, never after "everything is done".

## CONTEXT (read these first, in this order)

1. PROJECT_STATE.md (top 4 sections, all dated 2026-06-05)
2. OODA_REPORT_2026-06-05.md (the punch list this pass executes)
3. WIKI.md launcher table + docs/wiki/gener8/modal.md + docs/wiki/packages/video-modal.md

Known starting state: ~68 dirty files, last commit 5c7dede (2026-06-03), three
workstreams tangled in one tree. The kasai registry restore (06-05 22:45 SGT) is
in that dirty tree, unbuilt and unverified.

---

## PHASE 0: SAFETY (serial)

1. `git status` and confirm branch phase2/character-studio-absorption.
2. Do NOT stash, reset, or clean anything. The commits in Phase 1 ARE the backup.
3. After Phase 1 completes: `git tag checkpoint/2026-06-06-pre-swarm`.

## PHASE 1: COMMIT THE TREE (serial gate)

Partition the dirty files into three logical commits. Use `git add -p` discipline
where a single file spans streams. Partition heuristics:

- COMMIT 1 "My Mait integration": ShellLayout/KasaiCore/SlotStatusPanel/ToolCallCard,
  BugReportModal, MyMory status rail, naming-singularization touches, transport.ts
  My Mait/kasai UI bits, 3nvizen runtime_ipc.rs if it belongs to the run-state work.
- COMMIT 2 "Gener8 Phase B + pack routes + registry truth": video-modal package
  changes, gener8 modal wrapper, shim.rs pack-status/install-pack, applet.toml,
  registry.rs + transport.ts registry entries (kasai restore, 1magen BinaryLocal,
  entitlement changes), ai_director/mod.rs, PROJECT_STATE.md, WIKI.md.
  BEFORE this commit: update the WIKI.md launcher table so it matches the on-disk
  registry state (kasai BinaryLocal contract, 1magen BinaryLocal binary `onemagen`
  port 3002, loom/s3studio required_entitlements emptied). Bump WIKI version with
  a dated current-state note. The wiki and the code must agree at the commit boundary.
- COMMIT 3 "character-studio CSS/CRLF normalization": all character-studio
  *.module.css line-ending noise, plus a new `.gitattributes` entry
  (`*.module.css text eol=lf` or repo-consistent equivalent) so this never
  pollutes a diff again.

Untracked icons/screenshots/docs: add to the commit they belong to if clearly
owned; otherwise leave untracked and list them in the final report. After the
three commits the working tree must be clean except deliberate leftovers.

## PHASE 2: BUILD + VERIFY (parallel where toolchain allows)

Run, capture exit codes and tail output:

- `cargo build -p everywear-os`
- `cargo check -p gener8`
- `npm run build --workspace @everywear/video-modal`
- `npm run build --workspace @everywear/gener8-web`
- `npm run build --workspace @everywear/vid-web`
- `npm run build --workspace everywear-os`

If anything fails: fix forward (T0/T1 only), one edit per confirmed read, amend
into the owning commit or add a fixup commit. Re-run until green.

Then runtime, as far as automatable headlessly:
- Launch the shell build if a non-interactive launch is possible; otherwise skip.
- Hit `GET http://127.0.0.1:3001/api/health` and `/api/engine/pack-status` if the
  gener8 shim can be started; record responses.
- Produce a HUMAN HANDOFF CHECKLIST for Sean (the visual items you cannot prove):
  green dot, kasai inline open, no Edge page, no KASAI_NOT_ACTIVE, truthful
  status pill, video export parity, character-studio visual QA.

## PHASE 3: SWARM LANES (after Phase 2 is green; disjoint ownership)

Run as parallel sessions if your harness supports it, else serially A then B.
Neither lane touches registry.rs, transport.ts, or the other lane's directories.

### LANE A: videoRenderWorker dedup
Owns: `applets/gener8/web/src/workers/`, `packages/video-modal/src/workers/`.
1. Diff the two copies (1,060 vs 1,059 lines, hashes already diverged). Identify
   every divergent hunk and decide which side is correct; the package copy is the
   intended survivor.
2. Reconcile divergence INTO the package copy. Point any remaining gener8 imports
   at the package worker.
3. Delete the applet copy ONLY after: builds green + a worker-path smoke (or, if
   no runtime smoke is possible, mark deletion as a T2 card and leave the file
   with a deprecation header comment instead).
4. Update docs/wiki/packages/video-modal.md. Own commit.

### LANE B: VideoGeneratorModal split
Owns: `packages/video-modal/src/components/` (and new sibling module dirs inside
the package).
1. Read docs/wiki/gener8/modal.md and the current ~3,349-line
   `packages/video-modal/src/components/VideoGeneratorModal.tsx`.
2. Behavior-preserving split, public API and props UNCHANGED, along the seams
   already named in PROJECT_STATE: (a) types/presets/default-config, (b)
   render/export pipeline hooks, (c) media controls, (d) text/subtitle controls,
   (e) settings panels. Target: no resulting file over ~8k tokens (~2k lines).
3. Update the wiki module map BEFORE the code split lands (wiki-first applies to
   splits). Builds green. Own commit.

## PHASE 4: CLOSE-OUT (serial)

1. Append a timestamped SGT section to PROJECT_STATE.md: what landed, commit
   hashes, build receipts, what remains owed. Append-only, never rewrite history.
2. Bump WIKI.md version with a dated note covering Lanes A and B.
3. Write a rollout summary into `.codex/memories` (the missing afternoon summary
   on 06-05 is the documented cause of the registry collision; do not repeat it).
4. FINAL REPORT, in this exact structure:
   - Commits: hash + one-line each
   - Builds: command + exit code each
   - T1 decisions made (decision + rationale, one line each)
   - T2 cards surfaced (CARD / CONTEXT / RECOMMEND / REVERSAL format)
   - Human handoff checklist (visual/runtime items for Sean)
   - Anything skipped and why

## STANDING CONSTRAINTS

- SGT (UTC+8) timestamps everywhere.
- Never delete or rewrite prior PROJECT_STATE/WIKI/context entries.
- No edits to files you have not read in this session.
- shell.css (10.3k tokens) is OUT OF SCOPE this pass; note it, do not touch it.
- If you lose position in a file or flow, say so and re-read; do not guess.
