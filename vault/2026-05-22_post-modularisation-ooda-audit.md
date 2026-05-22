# OODA Decision Report - Everywear OS, post-Codex modularisation pass

**Date:** 2026-05-22 SGT
**Scope:** Commit `4e7507b` "modularisation pass" plus uncommitted working tree
**Method:** Wiki-first gate (`CONTEXT.md`, `ARCHITECTURE_MODULES_2026-05-21.md`, `OODA_AUDIT_2026-05-19.md`, `WIKI.md`), file census, git diff/status, sha256 dedup check, importer trace
**Verdict:** Codex executed the structural splits faithfully. Drift is in the wiki layer, in stray artefacts, and in two operational decisions Codex made silently.

---

## Observe - what changed

The commit is large (64 files, +9,903 / -14,909) and disciplined. Codex executed four of the section 4 splits from the architecture doc:

`platform/everywear-os/src-tauri/src/lib.rs` shrank from 2,312 lines (about 28k tokens) to 1,358 lines (about 5k tokens). The carved-out command groups live under `src-tauri/src/commands/` (`system`, `gpu`, `profile`, `wallet`, `discourse`, `kasai`, `applet`, `vault`, `model`, `video_encoder`, `migration`, `registry`, `platform`). `AppState` and panic-crash plumbing moved cleanly to `state.rs` and `crash.rs`. The Tauri `generate_handler!` registration is intact and now references commands via their new paths. This is exactly the section 4.1 plan.

`applets/gener8/src-tauri/src/shim.rs` shrank from 1,768 lines to 1,009 lines. The DAW route group is now in `shim/daw.rs` (754 lines, about 3k tokens) and gets folded back via `.merge(daw::routes())`. This is partial execution of section 4.2. The audio/library/playlists/director/video/settings/shell route groups in section 4.2 are still inside `shim.rs`. But `shim.rs` is now under the 16k code ceiling, so the gate is technically satisfied.

`packages/video-modal/` was created and Phase B of section 4.3 landed in one go, not the proposed two-phase rollout. Both applet `VideoGeneratorModal.tsx` files are now 23-25 line wrappers that import `@everywear/video-modal` and inject applet-specific bits: auth tier on both, vault video registration on Gener8 only. Worker, `lrcParser`, `silhouetteEngine`, and canvas visualizers all migrated into the package. `applets/vid/web/src/workers/videoRenderWorker.ts` (1,059 lines) was deleted.

Skills are in-tree (`skills/context-protocol/SKILL.md`, `skills/ooda-codebase/SKILL.md`) plus packaged `.skill` zips at root.

`CONTEXT.md` Pass 4/5/6 logs confirm Codex ran `cargo check -p everywear-os`, `cargo check -p gener8`, and `npm run build` on the three affected workspaces and they all passed.

## Orient - what is wrong

### 1. Wiki drift - protocol violation

The context-protocol skill says wiki moves with code, no exceptions. `WIKI.md` got 22 lines of changes: the section 4 directive bullets added on 2026-05-21, but nothing about the actual split. The new module surface is undocumented: zero hits for `commands/(system|gpu|...)`, zero hits for `shim/daw`, zero hits for `state.rs`/`crash.rs`, and only the directive-level mention of `packages/video-modal`. The `docs/wiki/` per-module tree from section 4.10 was never created.

Acceptance criterion section 9 in `ARCHITECTURE_MODULES_2026-05-21.md` says every module unit has a wiki page filled per the Module Contract Template, even if some fields are TBD. This is not met. This is the exact failure mode the protocol exists to prevent: agent edits code, does not update wiki, next session works off a fictional reference.

### 2. Triplicate orphans

`silhouetteEngine.ts` (372 lines) and `lrcParser.ts` (128 lines) now exist in three identical sha-matched copies:

- `packages/video-modal/src/lib/`
- `applets/gener8/web/src/lib/`
- `applets/vid/web/src/lib/`

Importer trace confirms no file in either applet still imports the local copies. They are pure orphans. Easy delete. Same risk pattern as the section 13.3 inventory: dedup that stops halfway is worse than no dedup because future edits will diverge silently.

### 3. CI deleted, not committed

`.github/workflows/ci.yml` (97 lines, full Windows + macOS Rust + Node matrix with CUDA toolkit setup) is deleted in the working tree but never committed. Codex does not explain it. Either it was intentional, replacing the workflow with something better, and the new file is missing; or it was unintentional and should be restored. Per `CONTEXT.md`, do not revert existing edits unless explicitly asked. This needs an operational call before either restoring or finalising the deletion.

### 4. `package-lock.json` deleted in the commit

`package-lock.json` was deleted in the commit (-3,243 lines). That file is the reproducibility floor. Without it, `npm ci` is impossible and `npm install` produces non-deterministic trees. If Codex regenerated it, it did not commit the new one. This needs to be regenerated and recommitted before the next clean clone.

### 5. Repo-root debris committed

`zi3eEsLn` and `ziZlXLhO` at repo root are zip archives. `unzip -l` shows they contain `SKILL.md` plus `references/` plus `scripts/` for the context-protocol and ooda-codebase skills, identical to the `.skill` files already committed. These look like Cowork temp-file artefacts that escaped. `.gitignore` has no rule for them.

Same applies to the six `__pycache__/*.pyc` files in `applets/3nvizen/.../ltx-runtime/` committed in the same pass. They should be ignored.

### 6. Unstaged diffs are EOL phantom churn, not real changes

Six files showed diffs that were line-ending only (`LF` <-> `CRLF`). The `git diff` on `videoRenderWorker.ts` was 2,118 lines but `cat -A` showed the content was byte-identical; `file` confirmed CRLF. This is the exact desync flagged in `CONTEXT.md`: the edit tool writes one EOL on the Windows filesystem while bash sees another. A checkout of only those paths would collapse the phantom diffs, leaving the real changes, but that should be done deliberately.

### 7. Splits Codex did not execute

Still on the to-do list from sections 4 and 8:

- `slot_manager.rs` (Kasai): still 1,019 lines, about 4k tokens. Under ceiling, so not urgent.
- `launcher.rs`: still 925 lines, about 3.7k tokens. Under ceiling.
- `local_discovery.rs`: still 1,092 lines, about 4.4k tokens. Under ceiling but in the warning band.
- `gpu.rs`: still 796 lines. Under ceiling.
- `ShellLayout.tsx`: still 1,020 lines, about 4k tokens. Under ceiling.
- `shell.css`: not split.
- `WIKI.md`: not split into `docs/wiki/*`; this is the big one. It is still 2,744 lines, about 28k tokens, well over the doc ceiling.
- `MIGRATION_ARCHITECTURE.md`: not archived.
- `shim.rs` internal split is incomplete: engine, inference, audio, library, playlists, director, video, settings, shell route groups remain in `shim.rs`.

These are not blockers. The gate items are done. They are the medium-priority backlog.

## Decide - prioritised punch list

### Critical - do today before any further code touches

1. **Wiki update for the four landed splits.** Either rewrite the relevant `WIKI.md` sections to describe the new `commands/`, `shim/`, `packages/video-modal/`, `state.rs`, and `crash.rs` layout, or scaffold `docs/wiki/shell/core.md`, `docs/wiki/shell/commands-*.md`, `docs/wiki/gener8/shim.md`, `docs/wiki/gener8/modal.md`, and `docs/wiki/vid/modal.md` per the Module Contract Template in section 5. Recommendation: scaffold `docs/wiki/` now and leave root `WIKI.md` as the legacy doc until section 4.10 runs. Without this, the next agent session will hallucinate the old layout.
2. **Decide and act on `.github/workflows/ci.yml`.** Restore with `git restore .github/workflows/ci.yml` or finalise the deletion with a replacement workflow. CI matters more after a structural pass, not less.
3. **Regenerate and commit `package-lock.json`.** Run `npm install` at the workspace root in the real Windows environment, then commit the lockfile.

### High - this week

4. **Delete the orphan triplicates.** Remove `applets/{gener8,vid}/web/src/lib/silhouetteEngine.ts` and `applets/{gener8,vid}/web/src/lib/lrcParser.ts`. Confirmed zero importers; safe to remove.
5. **Remove debris.** Remove `zi3eEsLn`, `ziZlXLhO`, and all `__pycache__/*.pyc` under `applets/3nvizen/.../ltx-runtime/`. Add `.gitignore` rules: `__pycache__/`, `*.pyc`, and a pattern for Cowork temp zips, or delete and monitor.
6. **Resolve the EOL desync.** Decide on a `.gitattributes` policy (`* text=auto` with explicit `eol=lf` on CRLF-sensitive paths) and run a one-time normalisation, or commit to all-CRLF on Windows and configure the edit tool accordingly.

### Medium - when convenient

7. **Complete section 4.2 shim split.** Extract remaining route groups: audio, library, playlists, director, video, settings, shell, engine, inference, vram. `shim.rs` is under ceiling but one feature away from re-bloating.
8. **Execute section 4.10 WIKI.md split.** Per the architecture doc, this is the lowest-risk step because no code is touched. Doing it now also fixes finding 1.
9. **Archive `MIGRATION_ARCHITECTURE.md`** to `docs/archive/`.

### Low - backlog

10. **Sections 4.4-4.9 remaining splits.** `slot_manager`, `launcher`, `local_discovery`, `gpu`, `ShellLayout`, and `shell.css`. Touch when those files grow or when they are next edited.
11. **Phase 2 cratification** per section 12, only after wiki is current and the medium items are done.

---

## What Codex got right

The structural execution is clean. The four files that were 4x and 1.75x over the code ceiling now all fit. Build verification was run after each pass and recorded. The vault note at `vault/2026-05-22_context-bounded-migration-modularisation.md` is the right shape: six dated passes, each with files-touched plus verification commands. The skills got pulled into the repo so future agents have local protocol references. The Phase B hoist, modal to package, was the right call even though the doc proposed Phase A first; the two applet copies had already drifted at byte 756, and every day they lived apart was compounding.

If we strip the noise, the only real footguns Codex left are the wiki not moving with the code, four orphan files, and the lockfile deletion. These are quick fixes, not architectural problems.

## Proposed next move

Recommended focused pass:

1. Scaffold `docs/wiki/` per the Module Contract Template for the four landed splits. No code touched.
2. Delete the four orphan triplicates and the repo-root debris, then fix `.gitignore`.
3. Propose `.gitattributes` to kill EOL churn.

The `.github/workflows/ci.yml` and `package-lock.json` calls are operational decisions and should be explicitly approved before mutation.

## Action Follow-up - 2026-05-22

The repair pass was executed after user confirmation:

- Scaffolded `docs/wiki/` Module Contract pages for the landed shell, Gener8, Vid, and `packages/video-modal` splits.
- Deleted the applet-local orphan copies of `lrcParser.ts` and `silhouetteEngine.ts`; only the `packages/video-modal` copies remain imported.
- Deleted root Cowork temp archives `zi3eEsLn` and `ziZlXLhO`.
- Deleted tracked Python bytecode under the 3nvizen sidecar and the OODA skill script cache.
- Added `.gitignore` rules for `__pycache__/`, `*.py[cod]`, Python `$py.class` files, and root Cowork temp archive names.
- Added `.gitattributes` with LF normalization for source/docs plus binary rules for assets, archives, `.skill`, and `.pyc`.
- Restored `.github/workflows/ci.yml` because there was no replacement workflow.
- Regenerated root `package-lock.json` with `npm install --package-lock-only`.

Verification:

- `npm run build --workspace @everywear/video-modal` passed.
- `npm run build --workspace @everywear/gener8-web` passed with existing Vite/module-type warnings.
- `npm run build --workspace @everywear/vid-web` passed.
- `git diff --check` passed.

## Sources

- `CONTEXT.md` - workspace state and Pass 1-6 log
- `ARCHITECTURE_MODULES_2026-05-21.md` - modularisation plan Codex worked from
- `OODA_AUDIT_2026-05-19.md` - prior baseline
- `vault/2026-05-22_context-bounded-migration-modularisation.md` - Codex pass log
