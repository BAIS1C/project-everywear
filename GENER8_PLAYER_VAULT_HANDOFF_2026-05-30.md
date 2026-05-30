# Gener8 Player / Vault Blank — Audit Handoff (fresh context opener)

Location: C:\Users\MAG MSI\Project Everywear
Authored: 2026-05-30 ~12:25+08 SGT, Claude (Cowork, Kasai), read-only disk audit.
Trigger: after P3i + three runtime patches by Codex, Sean verified playback still silent, Vault still broken, delete still not restored. Codex thread stopped. This is the clean handoff. Treat Codex's last runtime fixes as SUSPECT until re-verified.

## Headline root cause (playback) — CONFIRMED ON DISK

The Tauri asset protocol is NOT enabled or scoped for the vault directory. `convertFileSrc()` therefore returns 403 for every vault file, the `<audio>` element never loads metadata, duration stays `0:00`, and no audio advances. Selection reaching the bottom player is a red herring; the URL it loads is dead.

Evidence:
- `platform/everywear-os/src-tauri/tauri.conf.json:46-48`: `security` block contains ONLY `csp`. No `assetProtocol` key.
- The CSP DOES allow `asset:` in `media-src` (line 47). This is necessary but NOT sufficient. In Tauri v2 the asset protocol must additionally be enabled+scoped via `app.security.assetProtocol`. It is not, so the protocol handler refuses the URL with 403 regardless of CSP.
- `platform/everywear-os/src-tauri/capabilities/default.json:18-32`: grants `fs:scope` for `$HOME/Documents/Everywear Vault/**` and `$DOCUMENT/Everywear Vault/**`. That is the FS PLUGIN scope (read/write API). It is a DIFFERENT mechanism from the asset protocol scope that `convertFileSrc` depends on. Having fs:scope does not grant asset-protocol access.
- `packages/transport/src/vault.ts:302-303`: explicit unresolved marker — "CODEX_NEEDED: Vault paths must be added to Tauri asset protocol scope. Until then, convertFileSrc() will return 403." Never actioned.
- `packages/transport/src/vault.ts:305-309`: `vaultFileUrl()` passes any non-scheme path to `convertFileSrc()`. With the protocol unscoped, the result 403s.

## Why every prior fix was a no-op

All of Codex's runtime patches (removed `crossOrigin='anonymous'` in ShellAudioPlayer:57-58 — confirmed landed; `tags` hardening in LibraryView; delete re-gating in SongList; row-click wiring in P3i) live in the WEB BUNDLE. `npm run build --workspace @everywear/gener8-web` and `--workspace everywear-os` passing proved nothing about the blocker, which is in the Tauri security CONFIG and requires a `cargo` rebuild + exe relaunch. Web HMR cannot touch it. This is the core process lesson: a playback bug that survives a web rebuild is almost certainly below the web layer.

## The fix (config + Rust, not React)

1. `tauri.conf.json` `app.security`, add alongside `csp`:
```json
"assetProtocol": {
  "enable": true,
  "scope": [
    "$HOME/Documents/Everywear Vault/**",
    "$DOCUMENT/Everywear Vault/**"
  ]
}
```
(Confirm the exact Tauri v2 schema for this build; some versions also want the scope mirrored in a capability. Verify against the installed `@tauri-apps/*` version, do not assume.)
2. Rebuild the RUST shell: `cargo build -p everywear-os` (debug ok for test). A web build is insufficient.
3. Relaunch the exe. HMR will not apply a security-config change.

## Secondary, independent issue (verify, likely real)

Newly-created song rows may persist a RELATIVE audio key (e.g. `gener8/foo.mp3`), not an absolute path. `vaultFileUrl()` only short-circuits paths that already carry a scheme; a bare relative key is handed to `convertFileSrc()` and will not resolve even AFTER the asset scope is fixed. Old/migrated rows hold absolute `file_path` and will play once scoped.

Action for fresh context: confirm the persisted `file_path` shape for a freshly generated song vs a migrated one (inspect the vault index / a row object at runtime). If relative, fix at the SOURCE — normalize to an absolute vault path on write, and/or resolve a bare key against the vault root inside `vaultFileUrl()` before `convertFileSrc`. Do not paper over it only in the player.

## Mandate for the fresh context: instrument live, do not infer from source

Source-only inference has now failed three times. Before any further patch, capture live evidence from the running WebView:
- Log the exact `audio.src` string at assignment (ShellAudioPlayer playback effect ~:111).
- Log the `<audio>` `error` event `.code` + `.message` (onError ~:79) and whether `loadedmetadata` ever fires.
- Capture the WebView network/console result for that asset URL (expect HTTP 403 pre-fix).
- Route these to the in-app LogViewer (source 'gener8') or a file the host can read, NOT console-only — Cowork cannot attach to Tauri devtools. Confirm 403 disappears after the asset-scope fix + cargo rebuild.

## Status of the three reported regressions

1. PLAYBACK silent — ROOT CAUSED above (asset protocol unscoped). Headline fix. Independent of all React patches.
2. VAULT BLANK on left-rail click — was an ErrorBoundary-swallowed render throw from legacy rows (`item.tags` assumed present). Codex hardened tags + claims a `normalizeVaultItem()` adapter-boundary normalization. VERIFY this normalizes ALL optional VaultItem fields (tags, file_path, duration_seconds, generation_params, applet_id, title), not just tags, or the next legacy row with a different gap re-throws. If the window "stayed poisoned," close/reopen just the Gener8 applet window.
3. DELETE missing in workspace — Codex re-gated visibility on `onDelete` instead of `song.userId` ownership (SongList.tsx). VERIFY at runtime; this is plausibly correct but unconfirmed.

## Confirmed-good vs suspect (do not re-trust blindly)

- CONFIRMED on disk: crossOrigin removal landed (ShellAudioPlayer:57-58); asset protocol genuinely unscoped (tauri.conf.json:46-48); fs:scope present but irrelevant to the player (default.json:18-32); CODEX_NEEDED marker still open (vault.ts:302).
- SUSPECT (web-layer, build-passed but runtime-unverified): tags hardening, normalizeVaultItem, delete re-gate, P3i row wiring. All may be correct AND irrelevant to playback; none addresses the asset-scope blocker.

## Split-work status (unchanged by this firefight)

P0 done, P1 done (shell entitlementResolved), P2 done (two applets register + group + icons, verified in shell screenshot), P3 done (manifest force-loads locked model, selector hidden), P3i attempted (player) — blocked by the asset-scope bug above. P4-P10 not started. The P4-onward parallelisation directive (subagent lane map) is recorded in `GENER8_SPLIT_CODEX_PROMPTPACK_2026-05-30.md`. Do NOT start P4 until playback works, because P4-P6 require audio testing.

## First moves for the fresh context

1. Apply the asset-protocol scope fix + `cargo build -p everywear-os` + relaunch. Retest playback.
2. If still silent, use the live instrumentation above to read the actual `audio.src` + error, do not guess.
3. Confirm the relative-vs-absolute file_path shape; fix at source if relative.
4. Re-verify Vault-blank and delete at runtime.
5. Only then resume P4 with the subagent lane map.
