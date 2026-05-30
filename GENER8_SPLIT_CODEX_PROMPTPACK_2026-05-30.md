# Gener8 Split — Status Audit + Codex Prompt Pack

Location: C:\Users\MAG MSI\Project Everywear
Authored: 2026-05-30T10:41+08 SGT
Audited commit: `d027235` feat(gener8): extract Pro audio capability into module
Auditor pass: read-only against applets/gener8/web/src, platform/everywear-os/src, transport.ts registry, CreatePanel.tsx, pro/ module, launcher.

---

## 1. Verdict

Sean's live read was correct: the split has not happened. What Codex shipped on 2026-05-29 is an **in-applet capability extraction**, not the two standalone applets you specified. Reframing this: it is not a bug-fix job, it is an unfinished feature with three live regressions stacked on top. Treating it as "bug fixes" will produce another half-split. The prompts below build the real thing.

### What Codex actually did (commit d027235)

- Created `applets/gener8/web/src/pro/`: `ProAudioModePanel.tsx`, `ProVaultPicker.tsx`, `useProAudioMode.ts`, `entitlementGate.ts`, `proModelResolver.ts`, `proPayloadBuilder.ts`.
- Mounted `ProAudioModePanel` inside `components/CreatePanel.tsx` behind `shouldMountProAudioModule(entitlementResolved, hasTier('gener8_pro'))` (CreatePanel.tsx:1284).
- Added an applet-local `entitlementResolved` flag that resolves the reference/cover pill bounce inside the gener8 React tree.

### What was specified but does NOT exist

- **A. No second applet.** `BROWSER_APPLET_REGISTRY` in `platform/everywear-os/src/lib/transport.ts` registers ONE `gener8` applet (id `gener8`, icon `gener8`) plus `vid`, `ai-director`, `s3studio`, `1magen`. There is no `gener8-pro` and no `gener8-4ever`. The "split" is a tier-gated panel inside a single applet, not two launcher icons.
- **B. The in-frame model toggle is still live.** `CreatePanel.tsx` still ships `selectedModel`/`loadedModel`/`applyModelSwitch`/`handleModelSwitch` and a model switch button (CreatePanel.tsx:1005). The dead `views/CreateView.tsx` also carries a model `<select>` (CreateView.tsx:371-378). This is exactly the same-frame model switching you want gone.
- **C. Two diverging create surfaces.** Live surface = `components/CreatePanel.tsx` (mounted by `Gener8Core.tsx:3`). `views/CreateView.tsx` is **dead code** (imported nowhere; only named in a comment in `SongStoreContext.tsx:10`). CreateView has an inferior static step clamp (min=10/max=200, no per-model logic). It is a drift landmine and must not become the basis for either applet.
- **D. 'song' path still inside the Pro module.** `useProAudioMode.ts` initial mode is `reference`, but the reducer still handles `song`. For a Pro applet that is reference+cover only, that path is dead weight and a leak vector.
- **E. Vid Studio Pro link not built.** `vid` applet exists (`required_entitlements: ['vid_pro']`, tier `creator_studio`) but there is no Gener8-Pro -> Vid-Pro handoff, no watermark-removal / multi-res export surface. The addendum lists the Vid Pro capability extraction as still pending, gated on B3 below.
- **F. No new icons.** `iconGlyph` in `panels/LauncherGrid.tsx` maps `gener8`->`G8`, `vid`->`VD`. No `4ever` glyph, no Pro glyph, no rename.

### The advanced-step clamp (your specific concern)

Mixed result. In the **live** surface (`CreatePanel.tsx`) the clamp is mostly correct: the preset auto-snap is a `useEffect` keyed to `[loadedModel, selectedModel]` (CreatePanel.tsx:635-640) that applies `generationPresetFor(targetModel, 'song')`, and `detectStudioModelKind()` keys off the model name. So it detects the model, not literally the toggle UI.

Two caveats that still bite once you remove the toggle:

1. The generate-time clamp (CreatePanel.tsx:794-800) keys off the **audio mode** (`wantsCapabilityModel = mode === 'reference' || mode === 'cover'`), not the loaded model name. Mode-as-proxy-for-model breaks the moment each applet force-loads one model with a fixed mode.
2. The dead `CreateView.tsx` clamp is purely static. If anyone resurrects it for the split, the clamp regresses to toggle/static.

Conclusion: do not patch the clamp trigger in isolation. Drive it declaratively from the applet manifest (per-launcher-applet, which is the path you floated and the right one).

### Live regressions already logged (from the 2026-05-30 post-extraction addendum), in scope because they block the release build you are testing

- **B1** Folder panel occlusion at narrow widths (`platform/everywear-os/src/styles/shell.css` + folder panel component).
- **B2** Gener8 player broken after extraction (Song-mode `<audio>` wiring / Library route regression).
- **B3** Shell-side `entitlementResolved` missing (`platform/everywear-os/src/shell/AuthContext.tsx`). **Hard prerequisite** for any entitlement-driven two-applet split to resolve without race/bounce.

---

## 2. Strategic spine (read before executing)

Do **not** fork CreatePanel into two ~1,300-line near-twins. Maintaining two copies of that component is how drift like CreateView happened in the first place.

Instead: **one gener8 web bundle, two launcher applets, one declarative capability manifest.** Each launcher entry declares what it is; the bundle reads its launch manifest at boot and configures itself. This:

- kills the in-frame toggle (each applet force-loads its one model; no switch UI),
- makes the step clamp per-applet (declared, not inferred from mode or toggle),
- gives 4ever and Pro independent icons without duplicating the React tree,
- isolates "model switching issues from within the same frame" by construction (there is no second model in the frame to switch to).

Manifest fields to add per applet entry in `transport.ts`:

```
lockedModel:      'song' | 'pro'        // force this model at boot, hide selector
allowedAudioModes: ('song'|'reference'|'cover')[]
stepCeiling:       number               // advanced-steps clamp for this applet's model
vaultScope:        'full' | ...         // 4ever = full
vidTarget:         'vid' | 'vid_pro'    // which Vid applet the Create flow links to
```

Execution order is dependency-correct: wiki first (codebase protocol hard gate), then B3 (entitlement prerequisite), then manifest, then bundle wiring, then per-applet config, then Vid Pro, then regressions, then icons. Ship P0-P3 before touching P4+.

---

## 3. Codex prompt pack

Each prompt is self-contained, wiki-first, single-concern, with an explicit verification gate. Hand them to Codex one at a time, in order. Do not batch. Do not let Codex skip the wiki read or the verify step.

---

### P0 — Wiki first: define the two-applet architecture (NO code edits)

```
Read docs/wiki/gener8/ (modal.md, shim.md, vault-library.md), WIKI.md gener8 section,
and ARCHITECTURE.md. Do NOT edit any .ts/.tsx/.rs yet.

Document the target architecture for splitting Gener8 into two standalone launcher
applets sharing one web bundle:
  - gener8-4ever: free text-to-song. Locked to the song model. No model selector.
    Audio modes: song only. Full vault access. Links Create -> Vid Studio (standard).
  - gener8-pro: locked to the pro/capability model. No model selector. Audio modes:
    reference + cover only (no song). Links Create -> Vid Studio PRO.

Define the applet capability manifest contract (lockedModel, allowedAudioModes,
stepCeiling, vaultScope, vidTarget) as the single source of per-applet behaviour.
Add a Mermaid pipe-diagram: launcher entry -> launch manifest -> gener8 bundle boot
-> model force-load -> CreatePanel config. Flag that views/CreateView.tsx is dead code
to be quarantined (P7).

Write this as a new section in WIKI.md and a new docs/wiki/gener8/split-architecture.md.
Output the diff for review. No code edits in this prompt.
```
Verify: human review of the wiki diff. Nothing builds yet; that is correct.

---

### P1 — Shell-side `entitlementResolved` (B3, prerequisite)

```
Wiki ref: the AuthContext / entitlement section of WIKI.md and CONTEXT.md section 7
(vault boundary). Read platform/everywear-os/src/shell/AuthContext.tsx IN FULL before
editing. Read the applet-local entitlementResolved pattern in
applets/gener8/web/src/context/AuthContext.tsx for parity.

Add an entitlementResolved flag to the SHELL AuthContext that gates until the shell has
resolved the user's tier/entitlements. Propagate it through the auth IPC contract that
feeds applet boot, so a launched applet receives a settled entitlement state, not a
racing one. Do not remove the existing local-owner bypass in this prompt; just stop the
race. State the full auth call chain (shell AuthContext -> IPC -> applet AuthContext) in
your response before editing.

One file focus: platform/everywear-os/src/shell/AuthContext.tsx plus the IPC contract it
feeds. One edit per confirmed link in the chain.
```
Verify: `cargo check -p everywear-os`; `npm run build --workspace`; launch `target/release/everywear-os.exe`, confirm gener8 applet mounts with no reference/cover pill bounce and no auth flES flicker.

---

### P2 — Register two applets + manifest fields + icons

```
Wiki ref: docs/wiki/gener8/split-architecture.md (from P0). Read
platform/everywear-os/src/lib/transport.ts (BROWSER_APPLET_REGISTRY) and
platform/everywear-os/src/panels/LauncherGrid.tsx (iconGlyph) IN FULL first.

In transport.ts: add the capability manifest fields (lockedModel, allowedAudioModes,
stepCeiling, vaultScope, vidTarget) to the AppletEntry type. Replace the single 'gener8'
entry with TWO entries:
  - id 'gener8-4ever', name 'Gener8 4ever', icon 'gener8-4ever',
    required_tier 'gener8', lockedModel 'song', allowedAudioModes ['song'],
    stepCeiling <song ceiling>, vaultScope 'full', vidTarget 'vid'.
  - id 'gener8-pro', name 'Gener8 Pro', icon 'gener8-pro',
    required_tier 'gener8_pro', lockedModel 'pro', allowedAudioModes ['reference','cover'],
    stepCeiling <pro ceiling>, vidTarget 'vid_pro'.
Keep a legacy 'gener8' -> 'gener8-4ever' id alias so existing launch paths do not 404.

In LauncherGrid.tsx iconGlyph: add glyphs for the two new ids (4ever rename, distinct Pro
glyph). Update the grouped Set and any byId lookups that referenced 'gener8'.

Do NOT change CreatePanel behaviour yet; this prompt only registers applets + manifest +
icons. List every byId('gener8') / 'gener8' string-literal site you touched.
```
Verify: `npm run build --workspace`; launcher shows two distinct gener8 icons; both launch without crash (behaviour identical for now).

---

### P3 — Bundle reads manifest, force-loads locked model, removes the in-frame toggle

```
Wiki ref: split-architecture.md model-lock section. Read
applets/gener8/web/src/shell/applets/Gener8Core.tsx and
applets/gener8/web/src/components/CreatePanel.tsx IN FULL first. Map the model-switch
call chain: handleModelSwitch -> applyModelSwitch -> engineApi.init, plus the
loadedModel useEffect at CreatePanel.tsx:635-640. Write the chain out before editing.

Make the gener8 bundle read its launch manifest (lockedModel, allowedAudioModes,
stepCeiling) at boot. When lockedModel is set:
  - force engineApi.init to the resolved model for that lock at mount,
  - HIDE the model selector and the model switch button (CreatePanel.tsx:1005),
  - remove applyModelSwitch/handleModelSwitch from the user-reachable path (keep the
    boot-time force-load only).
Keep the per-model preset auto-snap (the loadedModel useEffect), since it now fires from
the forced boot load. Do not touch CreateView.tsx (dead; handled in P7).

One concern only: model lock + toggle removal. Do not alter audio modes or vault scope
here.
```
Verify: `npm run build --workspace`; launch each applet, confirm NO model selector visible, correct single model loaded, preset auto-snap fired for that model.

---

### P3i — Restore in-window audio player (test-harness prerequisite; runs BEFORE P4)

Inserted 2026-05-30 after live P3 testing: the in-window player does not play at all. P4-P6 (rail, modes, clamp) cannot be audio-tested until this is fixed, so it is sequenced ahead of P4.

```
Wiki ref: docs/wiki/gener8/vault-library.md + WIKI.md section 7 vault boundary +
split-architecture.md (player is shared at shell level). Read these IN FULL before editing:
- applets/gener8/web/src/shell/ShellAudioPlayer.tsx (the lifted player; useShellAudio()
  exposes playSong(song, queue), currentSong, isPlaying; owns the single <audio>).
- applets/gener8/web/src/views/LibraryView.tsx (rendered as VaultLibraryView; currently
  has NO playback wiring).
- applets/gener8/web/src/shell/applets/Gener8Core.tsx around :757 (playSong bridge) and
  :867 (renders <VaultLibraryView /> with NO props).
- packages/transport/src/vault.ts (audioUrl / convertFileSrc resolution).

Root cause confirmed on disk: the Pro extraction switched the Library route to
views/LibraryView (VaultLibraryView), rendered propless at Gener8Core:867. VaultLibraryView
neither receives onPlaySong nor calls useShellAudio(), so no track ever reaches
ShellAudioPlayer.playSong(); currentSong stays null and nothing plays. The <audio> element
and the playSong API are healthy; they are simply never invoked from the main surface.

Step 1 — INSTRUMENT FIRST (do not patch blind). Add a temporary log in ShellAudioPlayer's
playback effect (~:111) emitting currentSong?.audioUrl, and in the onError handler (~:79)
the audio error + src. Build, then play from a surface that IS still wired (RightSidebar /
SongProfile / create-view SongList via Gener8Core :903/:967/:995). Report: does audioUrl
resolve to a loadable URL, or is it missing/a raw path? This disambiguates a wiring break
(null url) from asset-protocol / vault-scope drift (url present, play() fails). State the
finding before Step 2.

Step 2 — WIRE THE LIBRARY. Have VaultLibraryView consume useShellAudio() directly and call
playSong(song, list) on row/track click; reflect currentSong/isPlaying for active-row state.
Do NOT thread props through Gener8Core; the view is shell-level and should talk to the lifted
player the same way Gener8Core does. If Step 1 showed audioUrl unresolved, ALSO fix it at the
source (convertFileSrc + tauri.conf.json vault scope for $HOME/Documents/Everywear Vault/**),
not by patching the <audio> element.

Step 3 — remove the Step 1 logs unless they belong in the permanent LogViewer diag surface
(source 'gener8').

Secondary (cheap, aids audio testing; keep clearly separate, do not let it grow scope):
in CreatePanel's boot force-load success (the engineApi.init in the isModelLocked effect,
~:374/:402), emit one structured line `[gener8] window=<applet-id> locked=<song|pro>
resolved=<model-name>` so the LogViewer shows which model each window loaded. This replaces
the model indicator P3 removed.
```
Verify: `npm run build --workspace @everywear/gener8-web`; runtime: open gener8-4ever, click a Library track -> plays through the shell player bar; open gener8-pro, same; currentSong/isPlaying reflect in UI; model-load log line appears in LogViewer per window; `git diff --check` clean.

---

### P3ii — Centralise Everywear logging + make it visible (observability prerequisite)

Inserted 2026-05-30 after the player hunt went blind: the observability itself is stubbed, which is why instrumentation kept being invisible. Decision (Sean): logs live at the conventional `~/.everywear/logs/` (`everywear_paths::logs_dir()`); disk location is not the point, VISIBILITY is. Surface them through the in-app LogViewer and a vault-structure reference so they are findable. Do NOT move logs into `Documents/Everywear Vault/` (that is the user-facing media library; keep it clean).

Current state confirmed on disk:
- `applets/gener8/web/src/lib/diag.ts` POSTs frontend console/errors to the LEGACY S3-Gener8 shim (`%LOCALAPPDATA%\S3-Gener8\logs`), never repointed to Everywear.
- The Rust shell writes only a startup banner to `~/.everywear/logs/gener8_*.log`; no `tracing` file appender carries runtime events (the today file has ONE line).
- `get_session_logs` + `export_session_log` (called by `LogViewerPanel.tsx`) are unimplemented `CODEX_NEEDED` stubs, so the in-app LogViewer shows nothing.

```
Wiki ref: read crates/everywear-paths/src/lib.rs (logs_dir/vault_root),
platform/everywear-os/src/components/LogViewerPanel.tsx (the two CODEX_NEEDED invokes),
applets/gener8/web/src/lib/diag.ts (legacy shim POST), and the tracing subscriber init in
platform/everywear-os/src-tauri/src/lib.rs IN FULL first.

Close three gaps:
1. Repoint diag.ts off the 127.0.0.1 S3-Gener8 shim. Add a Tauri command (e.g. append_ui_log)
   that appends structured entries to the current session file under everywear_paths::logs_dir();
   diag.ts invokes it instead of POSTing the shim.
2. Wire a tracing_appender (non-blocking; rolling or per-session) to everywear_paths::logs_dir()
   in the subscriber init, so backend runtime events actually land in the file, not just a banner.
3. Implement get_session_logs (and export_session_log) to read+parse the current session log under
   logs_dir() into LogEntry[], so the in-app LogViewer (the visibility surface) shows live entries.
   Confirm the LogViewer source filter lists 'gener8' and 'shell'.

Visibility: logs physically at ~/.everywear/logs (conventional), but discoverable. Add a reference
stub in the vault structure (a logs index note or a vault_root() pointer) so they can be found from
the vault. Do NOT relocate the files into Documents/Everywear Vault.
```
Verify: this is Rust+frontend -> `cargo build -p everywear-os` + relaunch (web build insufficient). After relaunch: the LogViewer shows live entries from the running session; `~/.everywear/logs/<session>.log` grows during runtime (not just the banner); export works. THEN the `[audio-diag]` instrumentation already in `ShellAudioPlayer.tsx` becomes visible in the LogViewer and is used to read the asset URL / status / error and fix the player.

---

## P4-onward execution directive: parallelise via subagents (Sean directive, 2026-05-30)

From P4 onward Codex must explicitly use subagents to parallelise, but ONLY along disjoint file-ownership lanes. The hard rule: no two agents edit the same module concurrently. `CreatePanel.tsx` and `transport.ts` are the collision hotspots; whichever lane owns them owns them exclusively.

Lane map:

- **Lane 1 (sequential, single agent, owns the Gener8 create surface):** P4 -> P5 -> P6. All three touch `CreatePanel.tsx`, the audio-mode rail, and manifest consumption, so they CANNOT be split across parallel agents. One agent runs them in order.
- **Lane 2 (parallel, independent):** P7 quarantine dead `views/CreateView.tsx` (file move + the one stale comment in `context/SongStoreContext.tsx`). Disjoint from Lane 1; coordinate only on the SongStoreContext comment line.
- **Lane 3 (parallel, independent):** P8 Vid Studio Pro (`views/VidView.tsx`, vid entitlement, the platform vid handoff). Depends on P1 (done), not on Lanes 1/2. Disjoint files.
- **Lane 4 (parallel, independent):** P10 B1 folder-panel occlusion (`platform/everywear-os/src/styles/shell.css` + folder panel component). Separate tree entirely from the gener8 bundle.

Orchestration: spawn Lanes 1-4 concurrently; each agent reads its target files in full (wiki-first) before editing and owns its files exclusively. Integration gate after all lanes merge: `npm run build --workspace @everywear/gener8-web`, `npm run build --workspace everywear-os`, `cargo check -p gener8`, `cargo check -p everywear-os`, then a runtime smoke of both applets. No lane marks done until the integration build is green.

---

### P4 — Gener8 4ever config: song-only, full vault, Vid standard

```
Wiki ref: split-architecture 4ever section. Read CreatePanel.tsx audio-mode rail and the
vault scope wiring (context/VaultProvider.tsx) IN FULL first.

For the 4ever manifest (allowedAudioModes ['song']):
  - collapse the audio-mode rail to Song only; do not render Reference/Cover buttons.
  - confirm full vault access is granted (vaultScope 'full').
  - confirm Create -> Vid link targets the standard 'vid' applet.
Drive all three off the manifest, not hardcoded ids. No Pro module mounts in 4ever.
```
Verify: `npm run build --workspace`; launch 4ever, confirm Song-only rail, vault opens fully, Vid link goes to standard Vid.

---

### P5 — Gener8 Pro config: pro-model-only, reference+cover only, Vid Pro link

```
Wiki ref: split-architecture Pro section. Read pro/useProAudioMode.ts,
pro/ProAudioModePanel.tsx, and the ProAudioModePanel mount in CreatePanel.tsx:1284 IN
FULL first.

For the pro manifest (allowedAudioModes ['reference','cover']):
  - mount ProAudioModePanel by default (gated by entitlementResolved + manifest, not by
    the old hasTier toggle path).
  - render Reference + Cover only; remove the Song mode entry from the Pro path.
  - in useProAudioMode.ts: remove the 'song' branch from ProAudioMode/proAudioReducer so
    the Pro module cannot enter song mode. Update pro/__tests__ accordingly.
  - Create -> Vid link targets 'vid_pro'.
```
Verify: `npm run build --workspace`; type-tests for pro/ pass; launch Pro, confirm Reference+Cover only, no Song, Vid link -> Vid Pro.

---

### P6 — Per-applet advanced-step clamp (declarative, model-keyed)

```
Wiki ref: split-architecture clamp section. Read CreatePanel.tsx:788-800 (generate-time
clamp) and the generationPresetFor / detectStudioModelKind helpers IN FULL first.

Replace mode-inferred capability detection (wantsCapabilityModel = mode === 'reference'
|| 'cover') with manifest.stepCeiling + the locked model name. The advanced Inference
Steps control must clamp to manifest.stepCeiling for the applet's locked model,
regardless of audio mode or any (now-removed) toggle. Keep detectStudioModelKind as the
model-name detector feeding the preset, but the CEILING comes from the manifest.

State explicitly in your response: the clamp now keys off (locked model + manifest
ceiling), never off a toggle or an audio-mode proxy.
```
Verify: `npm run build --workspace`; in each applet, attempt to exceed the manifest ceiling in Advanced; confirm clamp holds and matches the manifest value.

---

### P7 — Quarantine dead `views/CreateView.tsx`

```
Wiki ref: split-architecture (CreateView flagged dead in P0). Confirm via grep that
views/CreateView.tsx is imported nowhere (only a comment reference in
context/SongStoreContext.tsx:10). Do NOT delete it; per repo protocol, MOVE it to
docs/_archive/_pending_delete_<date>/ with a one-line README noting it was the
pre-split static-clamp create surface superseded by CreatePanel. Update the
SongStoreContext.tsx comment to drop the stale CreateView reference.
```
Verify: `npm run build --workspace` still green (it was never imported); grep confirms zero live references.

---

### P8 — Vid Studio Pro: watermark removal + multi-res export, linked from Pro

```
Wiki ref: the Vid section of WIKI.md and the vid applet entry in transport.ts. DEPENDS
ON B3 (P1) being merged. Read views/VidView.tsx and the vid entitlement gating IN FULL
first.

Gate watermark-removal and multi-resolution export behind vid_pro entitlement, surfaced
when Vid is launched from the Gener8 Pro vidTarget handoff. Standard Vid (from 4ever)
keeps watermark + single res. Do not build the export encoder in this prompt if it does
not exist; scope to the gating + the Pro handoff wiring, and flag any missing encoder
work as a follow-up carry.
```
Verify: `npm run build --workspace`; launch Pro -> Vid Pro, confirm watermark-removal + multi-res options present; launch 4ever -> Vid, confirm they are absent.

---

### P9 — Regression: Gener8 player broken (B2)

```
Wiki ref: docs/wiki/gener8/vault-library.md + CONTEXT.md section 7 vault boundary. Read
views/LibraryView.tsx (354 lines), components/LibraryView.tsx (legacy),
context/SongStoreContext.tsx, and packages/transport/src/vault.ts IN FULL first. Do NOT
assume the cause; instrument first.

Instrument the Song-mode play button: trace React click -> state update -> <audio> src
assignment -> Tauri convertFileSrc asset-protocol resolution. Identify the broken link
(candidates, rank and verify each: refs moved into useProAudioMode; tauri.conf.json scope
drift for $HOME/Documents/Everywear Vault/**; new views/LibraryView.tsx player not wired
to the same <audio>/state as legacy; SongStoreContext consumer chain change). Report the
broken link BEFORE patching. One fix at the identified link.
```
Verify: launch build, play a Song-mode track end to end; confirm audio plays and no 403 on vault asset resolution.

---

### P10 — Regression: folder panel occlusion at narrow widths (B1)

```
Wiki ref: shell layout section of WIKI.md. Read platform/everywear-os/src/styles/shell.css
folder-panel rules and the folder panel component (grep the desktop icon group rendering
in platform/everywear-os/src) IN FULL first. Note: shell.css is already a soft-target
breach on the OODA punch list; flag if your edit pushes it further.

Fix: give the expanded folder panel a solid or backdrop-filter blur background with
explicit z-index above the desktop icon column. Verify against BOTH the narrow and the
full-size shell window frames. Do NOT add absolute-positioning hacks that break the
full-size layout.
```
Verify: launch build at narrow and full window widths; confirm VA icon no longer bleeds through the folder panel and full-size layout is unchanged.

---

## 4. Sequencing summary

P0 (wiki) -> P1 (B3 shell entitlement) gate everything. P2 (registry) -> P3 (model lock) are the structural core; ship those four before P4-P6 (per-applet config + clamp). P7 is cleanup, do it anytime after P3. P8 depends on P1. P9/P10 are independent regression fixes blocking your release build; P9 (player) is the most user-visible, do it early in parallel if a second context is free.

OODA carries surfaced during this audit (already over budget, route to next structural pass, do not let these prompts silently grow them): `VideoGeneratorModal.tsx` (4,374 lines, hard-ceiling violation), `shell.css` (2,262 lines), `CreatePanel.tsx` (still over 2k soft target after extraction).

## 5. Proposed Mymory vault append (awaiting Sean confirmation)

Append to the Everywear wing CONTEXT, timestamped 2026-05-30T10:41+08, NOT overwrite:
audit finding (split is in-applet extraction only, not two applets), the locked decision
(single bundle + two launcher applets + capability manifest), and the P0-P10 sequence as
active tasks. Confirm and I will draft the exact diff.
