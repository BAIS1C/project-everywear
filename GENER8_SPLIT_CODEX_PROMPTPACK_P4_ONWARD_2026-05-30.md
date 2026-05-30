# Gener8 Two-Applet Split — Codex Prompt Pack, P4 onward (fresh-context paste)

Location: C:\Users\MAG MSI\Project Everywear
Authored: 2026-05-30T12:32+08 SGT. Self-contained for a fresh context. Paste into a new Codex/Cowork session AFTER the player patch (asset-protocol fix) is landed and runtime-verified.

---

## 0. State at handoff

Done and verified: P0 (wiki/split-architecture.md + WIKI addendum), P1 (shell `entitlementResolved`), P2 (two launcher applets `gener8-4ever` + `gener8-pro` register, group in S3 folder, distinct icons), P3 (launch manifest force-loads the locked model at boot, in-frame model selector hidden).

In flight at handoff: P3i player. The in-window player was silent because the Tauri asset protocol was never enabled/scoped, so `convertFileSrc()` 403s vault files. Fix = `assetProtocol.enable + scope` in `tauri.conf.json` + `cargo build -p everywear-os` + relaunch. See `GENER8_PLAYER_VAULT_HANDOFF_2026-05-30.md` and the vault note `Project Mymory/everywear/2026-05-30_everywear_gener8_player_asset_protocol_root_cause.md`.

GATE-0 (do not start P4 until ALL true):
- Vault audio plays end to end in both `gener8-4ever` and `gener8-pro` windows (duration populates, audio advances).
- Relative-vs-absolute `file_path` for freshly-created songs is resolved (persist absolute, or resolve bare key in `vaultFileUrl()` before `convertFileSrc`).
- Vault-blank (left-rail click) and workspace row delete are runtime-confirmed.
P4-P6 require working audio to test; starting earlier wastes cycles.

---

## 1. Locked architecture (recap)

One Gener8 web bundle, two launcher applets, one declarative capability manifest. No CreatePanel fork. Each applet force-loads its single model at boot; no in-frame selector; clamp is a declared per-applet value, not a toggle or audio-mode proxy.

Manifest fields per applet entry: `lockedModel: 'song'|'pro'`, `allowedAudioModes: ('song'|'reference'|'cover')[]`, `stepCeiling: number`, `vaultScope: 'full'`, `vidTarget: 'vid'|'vid_pro'`.

| Applet id | lockedModel | allowedAudioModes | stepCeiling | vaultScope | vidTarget |
|-----------|-------------|-------------------|-------------|------------|-----------|
| `gener8-4ever` | `song` | `['song']` | `12` | `full` | `vid` |
| `gener8-pro` | `pro` | `['reference','cover']` | `75` | `full` | `vid_pro` |

Legacy `gener8` id aliases (non-enumerated) to `gener8-4ever`: `getApplet/launchApplet/requestAppletSwitch('gener8')` resolve to 4ever; `listApplets()` shows the two.

---

## 2. File map (so you don't re-grep)

- Registries (TWO, keep in sync): `platform/everywear-os/src/lib/transport.ts` (browser fallback `BROWSER_APPLET_REGISTRY`) and `platform/everywear-os/src-tauri/src/registry.rs` (Rust shell, authoritative in dev).
- Launcher / icons / grouping: `panels/LauncherGrid.tsx` (`iconGlyph`, `grouped` Set, `byId`), `components/AppletIcon.tsx` (glyph + colour map), `shell/ShellLayout.tsx` (`S3_FOLDER_APPLET_IDS`, `S3_FOLDER_ORDER`).
- Manifest plumbing: `components/AppletViewRouter.tsx` -> `applets/gener8/web/src/ShellApp.tsx` -> `context/LaunchManifestContext.tsx` -> `shell/applets/Gener8Core.tsx` -> `components/CreatePanel.tsx`.
- Create surface: `components/CreatePanel.tsx` (LIVE). `views/CreateView.tsx` is DEAD (imported nowhere; P7).
- Pro module: `applets/gener8/web/src/pro/` (`useProAudioMode.ts`, `ProAudioModePanel.tsx`, `proModelResolver.ts`, `entitlementGate.ts`).
- Player / vault: `shell/ShellAudioPlayer.tsx` (shared `<audio>`, `useShellAudio`), `views/LibraryView.tsx` (VaultLibraryView), `packages/transport/src/vault.ts` (`vaultFileUrl`).
- Vid: `views/VidView.tsx`, the `vid` applet entry in both registries.
- Shell occlusion: `platform/everywear-os/src/styles/shell.css` + the folder-panel component.

---

## 3. Hard rules (learned this session, non-negotiable)

1. WIKI-FIRST: read `docs/wiki/gener8/split-architecture.md` + the relevant WIKI.md section + every target file IN FULL before editing. State which section you referenced.
2. LAYER DISCIPLINE: any change to `tauri.conf.json`, `capabilities/*`, or `src-tauri/**` requires `cargo build -p everywear-os` + exe relaunch. A green `npm run build` proves NOTHING about shell/Rust/config behaviour. A runtime bug that survives a web rebuild is below the web layer.
3. MANIFEST-DRIVEN: behaviour (model, modes, clamp, vault, vid target) comes from the launch manifest, never from a toggle or an audio-mode proxy.
4. BACKEND ID STAYS SHARED: `gener8` remains the shared engine/VRAM/vault/job id (engine_registry, vram_scheduler, gener8_engine, vault_commands). Split ONLY the launcher identity.
5. INSTRUMENT BEFORE INFERRING on runtime bugs: capture the live WebView (actual values + errors -> LogViewer source 'gener8' or a file, not console-only). Source inference missed the player bug three times.
6. NEVER two agents editing the same module concurrently. `CreatePanel.tsx` and the two registries are collision hotspots.

---

## 4. Parallelisation directive (Sean): use subagents along disjoint lanes

Spawn the lanes below concurrently as subagents. Each agent owns its files exclusively and reads them in full before editing.

- Lane 1 (sequential, ONE agent, owns the create surface): P4 -> P5 -> P6. All touch `CreatePanel.tsx` + audio rail + manifest consumption; cannot be parallelised against each other.
- Lane 2 (parallel): P7 quarantine dead `views/CreateView.tsx`.
- Lane 3 (parallel): P8 Vid Studio Pro (`views/VidView.tsx`, vid entitlement, platform handoff). Depends on P1 (done).
- Lane 4 (parallel): P9 B1 folder-panel occlusion (`shell.css` + folder panel; platform tree, disjoint from the bundle).

Integration gate after all lanes merge: `npm run build --workspace @everywear/gener8-web`, `npm run build --workspace everywear-os`, `cargo check -p gener8`, `cargo check -p everywear-os`, then a runtime smoke of both applets (audio plays, correct rails/modes/clamp per manifest). No lane is done until the integration build is green AND runtime-smoked.

---

## 5. Prompts

### P3.5 — Gate reconciliation (RUN BEFORE P4; makes code match the canonical gate manifest)

Done already by Claude, do NOT redo: player CSP/asset fix, DAW applet registration, loom min_tier, My Mait top-billing, and the canonical gate manifest itself (WIKI Addendum 2026-05-30 "Applet Gate Manifest + My Mait Product Model" + PROJECT_STATE.md "CANONICAL APPLET GATES"). This step makes the code AGREE with that manifest.

```
Wiki ref: WIKI Addendum 2026-05-30 "Applet Gate Manifest + My Mait Product Model" +
PROJECT_STATE.md "CANONICAL APPLET GATES". Read in full first: transport.ts registry,
registry.rs registry, the relevant applet.toml files, AuthContext.tsx tier->flag grants.

Deterministic, do now:
1. 3nvizen -> Creator Studio. Change required_tier gener8_pro -> creator_studio in ALL FOUR:
   transport.ts entry, registry.rs entry, applets/3nvizen/applet.toml ([entitlements.launch]
   min_tier), and AuthContext.tsx (move the `3nvizen` and `3nvizen.video` flag grants OUT of
   the gener8_pro block INTO the creator_studio block). Verify: a gener8_pro user no longer
   sees 3nvizen unlocked; a creator_studio user does.
2. Display rename "My Maits" -> "My Mait" (singular) in USER-FACING strings ONLY. Do NOT
   rename the internal `kasai` id, KasaiCore, @applets/kasai, or KasaiStore. Grep "My Maits",
   fix display copy, leave code identifiers untouched.
3. Consistency VERIFY (report mismatches; change only to match the manifest): for every applet
   confirm required_tier + required_entitlements agree across transport.ts, registry.rs,
   applet.toml, and that each required entitlement is granted at that tier in AuthContext.
   Canon: Gener8 -> 1magen, gener8-4ever (Gener8 = Gener8 4ever, one-off payment).
   Gener8 Pro -> gener8-pro (sub). Creator Studio -> 3nvizen, vid, ai-director, daw (sub).
   FREE -> kasai/My Mait, character-studio, layeru-osint, loom, strands-game, s3studio.

NOT in this pass (separate scoped tasks; must NOT block P4): My Mait Lite/Full removal +
owned-shard ownership ledger; VRAM-at-install model assignment; Trading Post surface.
```
Verify: `npm run build --workspace everywear-os`; `cargo check -p everywear-os`; runtime smoke as each tier confirms the gate table holds.

---

### P4 — Gener8 4ever config: song-only, full vault, Vid standard (Lane 1, first)

```
Wiki ref: docs/wiki/gener8/split-architecture.md (4ever section). Read CreatePanel.tsx
audio-mode rail, the LaunchManifestContext consumption added in P3, and context/VaultProvider.tsx
IN FULL first.

For the 4ever manifest (allowedAudioModes ['song']):
- Collapse the audio-mode rail to Song only; do NOT render Reference/Cover buttons.
- Confirm full vault access (vaultScope 'full').
- Confirm Create -> Vid link targets the standard 'vid' applet (vidTarget).
Drive all three from the manifest, not hardcoded ids. No Pro module mounts in 4ever.
```
Verify: `npm run build --workspace @everywear/gener8-web`; runtime in 4ever: Song-only rail, vault opens fully, Vid link -> standard Vid.

### P5 — Gener8 Pro config: pro-model-only, reference+cover only, Vid Pro link (Lane 1, second)

```
Wiki ref: split-architecture.md (Pro section). Read pro/useProAudioMode.ts,
pro/ProAudioModePanel.tsx, and the ProAudioModePanel mount in CreatePanel.tsx IN FULL first.

For the pro manifest (allowedAudioModes ['reference','cover']):
- Mount ProAudioModePanel by default, gated by entitlementResolved + manifest (not the old
  hasTier toggle path).
- Render Reference + Cover only; remove the Song-mode entry from the Pro path.
- In useProAudioMode.ts remove the 'song' branch from ProAudioMode + proAudioReducer so the Pro
  module cannot enter song mode; update pro/__tests__ accordingly.
- Create -> Vid link targets 'vid_pro' (vidTarget).
```
Verify: `npm run build --workspace @everywear/gener8-web`; pro/ type-tests pass; runtime in Pro: Reference+Cover only, no Song, Vid link -> Vid Pro.

### P6 — Per-applet advanced-step clamp (declarative, model-keyed) (Lane 1, third)

```
Wiki ref: split-architecture.md (clamp canon: ceiling = launchManifest.stepCeiling for the
locked model). Read CreatePanel.tsx generate-time clamp (~:794-800) and the
generationPresetFor / detectStudioModelKind helpers IN FULL first.

Replace mode-inferred capability detection (wantsCapabilityModel = mode === 'reference'||'cover')
with manifest.stepCeiling + the locked model name. The Advanced Inference Steps control clamps to
manifest.stepCeiling regardless of audio mode or any removed toggle. detectStudioModelKind stays as
the model-name detector feeding presets, but the CEILING comes from the manifest.
State explicitly: clamp keys off (locked model + manifest ceiling), never a toggle or mode proxy.
```
Verify: `npm run build --workspace @everywear/gener8-web`; in each applet, try to exceed the manifest ceiling in Advanced; clamp holds at 12 (4ever) / 75 (pro).

### P7 — Quarantine dead views/CreateView.tsx (Lane 2)

```
Wiki ref: split-architecture.md (CreateView flagged dead). Confirm via grep that
views/CreateView.tsx is imported nowhere (only a comment in context/SongStoreContext.tsx).
Do NOT delete; MOVE it to docs/_archive/_pending_delete_2026-05-30/ with a one-line README
(pre-split static-clamp create surface superseded by CreatePanel). Update the SongStoreContext.tsx
comment to drop the stale CreateView reference.
```
Verify: `npm run build --workspace @everywear/gener8-web` green; grep confirms zero live references.

### P8 — Vid Studio Pro: watermark removal + multi-res export, linked from Pro (Lane 3)

```
Wiki ref: WIKI.md Vid section + the vid applet entry in both registries. Depends on P1 (done).
Read views/VidView.tsx and the vid entitlement gating IN FULL first.

Gate watermark-removal and multi-resolution export behind vid_pro entitlement, surfaced when Vid is
launched from the Gener8 Pro vidTarget handoff. Standard Vid (from 4ever) keeps watermark + single
res. If the export encoder does not exist, scope to gating + the Pro handoff wiring and flag the
encoder as a follow-up carry; do not stub a fake encoder.
```
Verify: `npm run build --workspace @everywear/gener8-web`; runtime: Pro -> Vid Pro shows watermark-removal + multi-res; 4ever -> Vid does not.

### P9 — Folder-panel occlusion at narrow widths (B1) (Lane 4)

```
Wiki ref: WIKI.md shell-layout section. Read platform/everywear-os/src/styles/shell.css folder-panel
rules + the folder-panel component (grep the desktop icon-group rendering) IN FULL first. shell.css is
already an OODA soft-target breach; flag if your edit grows it.

Fix: give the expanded folder panel a solid or backdrop-filter-blur background with explicit z-index
above the desktop icon column. Verify against BOTH narrow and full-size shell window frames. No
absolute-positioning hacks that break the full-size layout. This is a shell change -> cargo build +
relaunch to verify, not just a web build.
```
Verify: launch build at narrow + full widths; VA icon no longer bleeds through the folder panel; full-size layout unchanged.

---

## 6. After P4-P9

Run the integration gate (section 4). Then file a session note to the Mymory `everywear` wing + a CONTEXT.md addendum per the vault discipline (dated note + MOC entry + CONTEXT link-stub; never overwrite). Remaining OODA carries to route, not grow: `VideoGeneratorModal.tsx` (4,374 lines), `shell.css`, `CreatePanel.tsx` (>2k soft target).
