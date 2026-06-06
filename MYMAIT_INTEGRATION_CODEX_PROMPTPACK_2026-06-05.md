# My Mait Integration — Codex Prompt Pack

Location: C:\Users\MAG MSI\Project Everywear
Authored: 2026-06-05 SGT (Claude Cowork session, integration-gate follow-on)
Goal: complete the My Mait (internal id `kasai`) integration into Everywear to beta-green.
Predecessor packs: GENER8_SPLIT_CODEX_PROMPTPACK_2026-05-30.md (format + footgun precedent).

---

## 0. Binding protocol (read first, no exceptions)

1. READ PROJECT_STATE.md in full. The surgical patch loop there is binding: one
   hypothesis, smallest patch, named verification, update PROJECT_STATE.md after
   every patch. No refactors, no renames, no architecture "improvements".
2. READ the WIKI.md sections covering the file you are about to touch BEFORE
   touching it. Relevant addenda: "My Mait Agent Hub Surface Port" (2026-05-28),
   "Kasai Short Creation + EWSD Provider" (2026-05-27), and the My Mait LOCKED
   block in PROJECT_STATE.md §CANONICAL APPLET GATES.
3. Serde casing footgun (Gener8 split, DO NOT REPEAT): Rust structs crossing the
   Tauri boundary carry `#[serde(rename_all = "camelCase")]`; TS reads camelCase.
   Mismatch does not error, it silently yields `undefined` and permissive
   fallbacks. If browser works and desktop does not (or vice versa), suspect
   serde casing before product logic.
4. Fail closed: a locked/null/unreadable manifest must show a visible bug state,
   never fall back to permissive defaults.
5. A green `npm run build` proves NOTHING about shell/Tauri/Rust behaviour.
   Shell-layer changes require `cargo build -p everywear-os` + relaunch.
6. ONE applet per agent. Do not touch Gener8 collision hotspots
   (CreatePanel.tsx, the two registries) except where a phase explicitly names them.
7. Codex degraded mode: no vault MCP. Vault reads fall through to filesystem
   grep/read against C:\Users\MAG MSI\Project Mymory if mounted; else flag the
   gap and proceed.

---

## 1. Current state (verified 2026-06-05, integration gate signed off)

WORKING (do not re-litigate, do not refactor):
- MKV bridge: KasaiCore consumes `get_mymory_status` + `list_watched_projects`.
  Live status, root path, 2,191 md files, L0-L3 layers, graph projection,
  schema, Project MyMory handoff all render.
- Recall / Remember / Graph visible in the My Mait skill rail.
- One non-mutating Vault path proven: MyMory Recall prepare flow with Backing
  Vault live.
- Greens on: `mkv_memory` registered smoke (fresh), eval:served-path,
  eval:rank-quality, eval:source-expansion (20/20), build kasai-applet,
  build everywear-os, `cargo check -p everywear-kasai`,
  `cargo build -p everywear-os`, browser preview smoke at
  `http://127.0.0.1:5174/?preview=1`.
- Changed files that pass: `applets/kasai/src/shell/KasaiCore.tsx`,
  `applets/kasai/src/lib/transport.ts`.

NOT DONE (this pack's scope):
- True desktop (Tauri) runtime user-flow acceptance. Everything above was
  browser-preview or build-level. PROJECT_STATE.md parity map still says
  `kasai (My Mait) | KasaiCore | SMOKE-PENDING`.
- My Mait entitlement cleanup (PROJECT_STATE punch items 9, 10, 11, 13).
- Graphical tooling integration: tool calls surfaced live in the UI during a
  real runtime session (ToolCallCard.tsx and SlotStatusPanel.tsx exist; they
  need to be proven against the real runtime, not preview).

OUT OF SCOPE (do not touch):
- Trading Post storefront (punch item 12; scoped, not built, own task).
- mait crate `strands-avatar-v1` receiving end in Kasai (wiki "Still pending");
  personality/appearance import is a separate pack after Character Studio port.
- Auth hardening / JWT verification (pre-push release blocker, separate track).
- Steam packaging. Months away. See §2 entitlement note only.

File inventory (current, read each in full before editing):
- `applets/kasai/src/shell/KasaiApp.tsx` (15 ln), `KasaiCore.tsx` (866 ln),
  `SlotStatusPanel.tsx` (118 ln), `ToolCallCard.tsx` (203 ln)
- `applets/kasai/src/lib/transport.ts` (285 ln)
- `applets/kasai/src-tauri/src/`: audit.rs, inference.rs, main.rs, runtime.rs,
  runtime_ipc.rs, short_creator.rs, slot_manager.rs, types.rs
- Shell side: `platform/everywear-os/src/lib/transport.ts` (registry),
  `shell/AuthContext.tsx` (Lite/Full cleanup target)
All module sizes are inside the 4k-line context budget. No splits required.

---

## 2. Locked product decisions (Sean authority, 2026-05-30 + 2026-06-05)

- My Mait is SINGULAR, display name "My Mait". Internal id stays `kasai`
  (KasaiCore, @applets/kasai), never user-facing. No Lite/Full split.
- FREE, untiered. Default starter personality. Orchestration chassis that runs
  AI Director + Loom invisibly (the names never surface in My Mait UI).
- Model selection is VRAM-gated at install (model_manager::ModelResolver),
  NOT a paywall, NOT a tier flag.
- Monetization = Trading Post owned-shard inventory (NFT-shaped, creator +
  provenance). Content-ownership axis, independent of license tier.
- Entitlement SOURCE axis (2026-06-05): entitlements are `(tier, source)`,
  source ∈ { beta-grant, direct-purchase, steam-purchase }. Beta launches
  direct with tier 2/3 tooling comped (beta-grant). Steam full release sells
  Gener8 Pro ONLY; Creator Pro stays direct. Do not hardcode tier without
  source anywhere new; do not build Steam logic now, just don't paint the
  schema into a corner. Gate VISIBILITY by source where it matters later.

---

## 3. Strategic spine

The acceptance pass comes FIRST and everything else is driven by what it
exposes. Do not build speculative tooling UI. The loop is: run the real
desktop flow, record pass/fail per step, patch the smallest failing link,
re-run. The graphical tooling work (P2) gets its acceptance criteria from P1
failures, not from imagination. Entitlement cleanup (P3) is bounded,
mechanical, and independent; it lands after the runtime is proven so a
regression there cannot be confused with an entitlement bug.

Execution order is dependency-correct: P0 orientation → P1 desktop acceptance
→ P2 tooling surfacing → P3 entitlement cleanup → P4 VRAM resolver → P5
display rename → P6 AI Director invisibility audit → P7 closeout. Ship P1
before touching P2+.

---

## P0 — Orientation (read-only, no edits)

Read, in order: PROJECT_STATE.md (full), WIKI.md My Mait/Kasai addenda
(2026-05-27, 2026-05-28 sections), this pack, then every file in
`applets/kasai/src/` and `applets/kasai/src-tauri/src/` you intend to touch.
State in chat which wiki sections you referenced. If the code on disk
disagrees with the wiki, FLAG it before any edit.

Exit: a one-paragraph statement of the call chain for applet launch:
shell launcher → registry entry → KasaiApp mount → KasaiCore → transport.ts
invoke surface → runtime_ipc.rs → runtime.rs/slot_manager.rs. Inputs/outputs
per link. No edits until this is written.

## P1 — Desktop runtime acceptance pass (the gate)

Build and launch the REAL desktop runtime (`cargo build -p everywear-os` +
relaunch; the dev exe is unpackaged, use F12 console for WebView evidence).
Execute and record WORKING/BROKEN for each step:

1. Launch My Mait from the shell launcher (not a direct route).
2. Engine slots: slot status renders truthfully (SlotStatusPanel vs
   slot_manager.rs ground truth; Big/Small swap state).
3. MyMory status: live/fresh badge, root path, file count, layers, graph
   projection, schema, watched projects.
4. Recall: prepare flow against the live vault (non-mutating, as proven in
   preview, now on desktop).
5. Remember: one append-path dry-run if a non-mutating mode exists; if the
   only path mutates the vault, STOP and ask Sean before writing anything
   to C:\Users\MAG MSI\Project Mymory.
6. Tool calls: at least one ToolExecutor invocation visible end to end.
7. One handoff: Vault handoff (or AI Director handoff) completes without
   surfacing internal names.

Record results as a table in PROJECT_STATE.md (convert the kasai
SMOKE-PENDING row). Patch failures one at a time per the surgical loop.
Suspect serde casing first for any preview-works/desktop-fails delta.

Exit: all seven steps WORKING on desktop, or each BROKEN step has a filed
hypothesis + smallest-patch entry in PROJECT_STATE.md.

## P2 — Graphical tooling integration

Scope is ONLY what P1 exposed plus these known seams:
- ToolCallCard renders every tool invocation from the live runtime stream
  (not just mocked/preview shapes): name, args summary, status, duration,
  error state. Fail closed on malformed events (visible error card, never
  silent drop).
- Skill rail actions (Recall/Remember/Graph) wired to real invocations with
  visible in-flight state.
- Slot status reflects live swap events during a tool-using session.
No new visual systems, no EWDS token work beyond using existing tokens, no
new dependencies. If a tooling gap requires a Rust-side event you don't
have, add the smallest event emission in runtime_ipc.rs with camelCase serde
and verify with cargo build + relaunch.

Exit: a desktop session where Sean can watch a tool call happen, see the
slot state move, and complete a Recall, all graphically. Re-run the P1 table;
no regressions.

## P3 — Entitlement cleanup (punch item 9, My Mait scope)

In `platform/everywear-os/src/shell/AuthContext.tsx` and anywhere
`mymaits_lite_runtime` / `mymaits_full` appear: collapse to a single free
base. Remove Lite/Full branching. My Mait is FREE and untiered; it must
never appear Locked for any signed-in identity. Introduce the owned-shard
inventory STUB only (type + empty inventory on the content-ownership axis,
`(tier, source)` aware) — no Trading Post UI.
Gates must agree across transport.ts + registry.rs + applet.toml +
AuthContext (drift here is the recurring "Locked" bug class).

Exit: grep shows zero live references to mymaits_lite_runtime/mymaits_full
outside Loom's hidden teacher-agent usage (Loom keeps its headless runtime;
do NOT break Loom). `npm run build --workspace everywear-os` +
`cargo check -p everywear-os` + desktop relaunch, My Mait still launches free.

## P4 — VRAM model assignment (punch item 10)

Register My Mait base-LM requirements with model_manager::ModelResolver so
the model is resolved at install/launch by VRAM, not by tier. No paywall
semantics anywhere in this path.

Exit: resolver returns a model on this machine (RTX 5090/32GB) and the
chosen model is logged at load (one-line model-load log; ties to the P3ii
observability carry).

## P5 — Display rename (punch item 11)

"My Maits" → "My Mait", user-facing strings ONLY. Internal `kasai` id,
file names, applet ids, CSS classes unchanged. Grep for user-visible
"My Maits" across applets/ and platform/; patch strings; nothing else.

Exit: no user-facing plural remains; builds green.

## P6 — AI Director invisibility audit (punch item 13)

Verify the free My Mait orchestrates AI Director without surfacing the name
in any My Mait UI string, toast, error, or log line visible to the user.
Heavy compute stays gated at execution (existing gates; do not loosen).

Exit: a desktop session exercising a Director-backed flow shows no
"AI Director" string in My Mait UI.

## P7 — Closeout

1. Update PROJECT_STATE.md: punch items 9, 10, 11, 13 marked done with fix
   notes; kasai parity row WORKING; new carries recorded, none deleted.
2. Update WIKI.md with a dated addendum: "My Mait Desktop Integration
   2026-06-XX" covering what changed, verification evidence, and the
   `(tier, source)` entitlement note. Append, never overwrite.
3. Flag for the next Cowork session: vault filing owed for the 2026-06-05
   integration gate + this pack's outcomes (Sean deferred filing until the
   build works; the tally is in this file and PROJECT_STATE.md).

---

## Acceptance bar for the whole pack

My Mait launches from the Everywear shell on the real desktop runtime as a
free, untiered applet; slots, MyMory status, Recall/Remember/Graph, visible
tool calls, and one Vault handoff all work graphically; Lite/Full is gone;
the model is VRAM-resolved; no internal names (kasai, AI Director, Loom)
surface in user-facing UI. Every patch followed the surgical loop and
PROJECT_STATE.md tells the truth at the end.
