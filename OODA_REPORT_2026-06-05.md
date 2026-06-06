# OODA Decision Report: Project Everywear

Location: `C:\Users\MAG MSI\Project Everywear`
Timestamp: 2026-06-05T22:00+08:00 SGT
Branch: `phase2/character-studio-absorption`
Mode: assessment-only; no code edits made

## OBSERVE

- 382 source files (rs/ts/tsx/py/css, excluding node_modules, target, .fallow, DESIGN WORK), ~422,600 estimated tokens total.
- Budget buckets: 323 files at or under 2k tokens, 54 at 2k to 8k, 5 on the 8k to 16k watch list, ZERO files over the 16k split ceiling. Structurally healthy post-split shape.
- Watch list (8k to 16k):
  1. `packages/video-modal/src/components/VideoGeneratorModal.tsx`: 3,672 lines, ~14.7k tokens, closest to ceiling
  2. `platform/everywear-os/src/styles/shell.css`: 2,578 lines, ~10.3k
  3. `applets/gener8/src-tauri/src/shim.rs`: 2,311 lines, ~9.2k (grew today with pack routes)
  4. `applets/gener8/web/src/components/CreatePanel.tsx`: 2,187 lines, ~8.7k
  5. `applets/gener8/web/src/components/studio/StemStudio.tsx`: 2,089 lines, ~8.4k
- Git state: last commit `5c7dede` 2026-06-03. ALL of today's work is uncommitted: 36 modified files, +1,135 / −4,824, plus untracked icons, screenshots, and two MyMait docs.
- Wiki census: WIKI.md bumped v1.1.21 → v1.1.25 today with three dated current-state notes; `docs/wiki/gener8/modal.md`, `split-architecture.md`, `packages/video-modal.md` updated in lockstep with the code. PROJECT_STATE.md appended with a timestamped MyMait section. Wiki discipline on the gener8 stream is genuinely good.

## ORIENT: today's Codex work (two streams)

### Stream A, morning: My Mait integration (report filed 12:03 SGT)
- KasaiCore run-state UI, fail-closed tool-call normalization, ToolCallCard malformed-payload guard, SlotStatusPanel live events, MyMory status rail.
- Naming cleanup to singular "My Mait" verified clean by independent grep (no `My Maits` / Lite / Full in applet or shell source).
- ShellLayout titlebar status now derived from runtime state instead of hardcoded LIVE.
- BugReportModal clipboard fallback for WebView.
- Quality of the UI work: consistent with the report's claims as far as source inspection goes. Builds were claimed green on Windows; not re-verifiable from this sandbox.

### Stream B, afternoon: Gener8 Phase B + DAW pack fix
- `applets/gener8/web/src/components/VideoGeneratorModal.tsx` gutted from ~4,400 lines to a 74-line wrapper re-exporting `@everywear/video-modal`. This is the bulk of the −4,824.
- `shim.rs` gained `/api/engine/pack-status` and `/api/engine/install-pack` with `pro_base` ↔ `better_models` aliasing for the DAW stem-extraction Pro Model bug.
- Wiki updated for both. Runtime smoke and real model download explicitly owed.

## ORIENT: drift findings

### CRITICAL: kasai launch contract contradicts every document that describes it
On disk, BOTH registries (`platform/everywear-os/src-tauri/src/registry.rs` line ~324 and the `BROWSER_APPLET_REGISTRY` mirror in `platform/everywear-os/src/lib/transport.ts`) define kasai as:

```
launch_kind: FrontendInline, launch_binary: None, frontend_port: None
```

The progress report (12:03 SGT), today's PROJECT_STATE.md append, and the WIKI.md launcher table all state the locked contract: `BinaryLocal`, `launch_binary = everywear-kasai`, no frontend_port. The report's own caution: "Do not convert My Mait to pure FrontendInline. That breaks Kasai activation."

Verified consequence in `ShellLayout.tsx` launch flow: FrontendInline + registered applet short-circuits to `openShellWindow(inline)` and never calls `requestAppletSwitch`. KasaiCore and the kasai transport contain no self-activation call. So the on-disk state reproduces `KASAI_NOT_ACTIVE` exactly as the user observed.

`registry.rs` mtime is 18:46 SGT, six hours AFTER the report. The documented "final correction" was either never applied or was clobbered by the afternoon pass. The wiki is currently truth and the code is fiction; rating: critical drift on this module.

### CRITICAL-adjacent: suspected misplaced edit
`gener8-4ever` now carries `launch_binary: Some("everywear-kasai")` in both registries. It is FrontendInline, so the field is inert in the launch path, and no document anywhere ties the kasai binary to gener8-4ever. This looks like the kasai binary assignment landing on the wrong `AppletEntry` during registry churn. Strong signal the afternoon registry edit was a botched application of the morning's intended fix.

### Undocumented registry changes (major drift)
- `1magen`: FrontendInline → BinaryLocal (binary `onemagen`, port 3002). Plausible, but not reflected in the WIKI launcher table.
- loom/s3studio entry: `required_entitlements` emptied. Consistent with the FREE-tier line in PROJECT_STATE, so likely intentional, but the wiki table was not updated.

### Duplicate logic
`videoRenderWorker.ts` exists in both `applets/gener8/web/src/workers/` (1,060 lines) and `packages/video-modal/src/workers/` (1,059 lines) and the copies have ALREADY diverged (different hashes). Phase B was supposed to be package parity; this is the next drift seed.

### Hygiene
- CRLF noise on 10 character-studio CSS files polluting every diff; needs `.gitattributes` coverage or one normalization commit.
- Two days of multi-stream work uncommitted on a branch named for a third workstream.

## DECIDE

### Critical (fix before anything else)
1. Restore the kasai contract in BOTH registries: `BinaryLocal`, `launch_binary = Some("everywear-kasai")`, `frontend_port: None`. Remove `launch_binary` from `gener8-4ever` unless there is a deliberate shared-runtime decision, in which case document it first.
2. Re-run the desktop acceptance checklist from the progress report after the fix (green dot, inline open, no Edge page, no KASAI_NOT_ACTIVE, truthful status pill).

### High (before next edit session)
3. Commit. Split into three commits: My Mait integration, Gener8 Phase B + DAW pack routes, character-studio CSS/CRLF normalization. An uncommitted 36-file working tree spanning three workstreams is unrecoverable-mistake territory.
4. Update the WIKI launcher table for the 1magen and entitlement changes so the table matches whatever registry state lands.

### Medium (schedule)
5. Consolidate `videoRenderWorker.ts` into the package; delete the applet copy once export side-effect parity is verified.
6. Plan the split of `packages/video-modal/VideoGeneratorModal.tsx` (14.7k tokens) before the next feature lands in it. Natural boundaries: render/export pipeline vs form/preview UI.
7. Owed runtime proofs: gener8 pack-status route smoke with shim on 3001, video export parity, character-studio visual QA.

### Low (backlog)
8. `shell.css` at 10.3k tokens; carve per-surface partials at next styling pass.
9. CRLF normalization commit + `.gitattributes` entry for `*.module.css`.

## ACT

Assessment-only per protocol. The critical fix is a four-line change across two files; proposed diff ready on confirmation. MyMory vault is not mounted this session; this report should be filed to the vault at the next vault-mounted session.
