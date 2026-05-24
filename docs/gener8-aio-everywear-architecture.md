# Gener8 AIO In Everywear Architecture

Date: 2026-05-24
Status: Accepted target architecture

## Decision

Gener8 AIO should move into Project Everywear as a first-party local applet. This
is a full product port of the current Gener8 internals and applet visuals, not a
small patch-port of only recent fixes. Keep the S3Studio web repo for cloud,
marketing, community, and future hosted instances, but stop treating the
standalone S3Studio desktop bundle as the long-term product shell.

Everywear is already shaped for this slot-in:

- The shell owns auth, entitlements, applet launch, vault, GPU state, VRAM
  scheduling, registry, EWDS, and platform permissions.
- `applets/gener8` owns the music workflow UI, local ACE shim compatibility,
  DAW, generation controls, and Gener8-specific domain logic.
- `packages/video-modal` owns the shared Gener8/Vid video creation surface.
- `applets/3nvizen` owns local AI video generation and advertises its engine to
  the shell.
- `applets/vid` owns the standalone Vid Studio view.

Gener8 AIO therefore means "all-in-one inside Everywear", not "Gener8 carries
its own separate OS, auth system, vault, updater, and VRAM detector."

The S3Studio desktop shell inside the original web product is superseded by
Everywear's own desktop interface. Port the Gener8 applet/workflow experience,
creation panels, DAW, video surfaces, Library integration, settings that remain
domain-specific, and visual language that belongs inside the applet. Do not port
the old S3Studio desktop, taskbar, global shell chrome, account shell, or applet
launcher as product authority.

## Repository Roles

| Repo/path | Role |
|---|---|
| `S3 STUDIO/s3studio-web` | Web/cloud product, hosted UI, cloud marketing/community endpoint, upstream source for latest Gener8 workflow improvements. |
| `S3 STUDIO/s-gener8` | Transitional desktop shell and ACE shim source. Keep for backtrace and emergency standalone builds while Everywear absorbs the applet. |
| `Project Everywear` | Canonical AIO target: shell, applet runtime, Vault, EWDS, GPU scheduler, registry, signed local applets. |

## Applet Boundary

Gener8 must follow the Everywear-compatible applet contract:

- No custom shell chrome.
- No applet-owned auth session.
- No applet-owned global vault.
- No direct privileged filesystem access from UI.
- No remote scripts for the privileged/local applet.
- No frontend-only entitlement enforcement.
- Models and large assets declared by manifest/hash and resolved by the shell.

The Gener8 applet can keep distinctive product UI inside its applet surface, but
it must consume Everywear session, Vault, transport, and EWDS primitives.

## Desktop And Widget Lifecycle

Everywear's desktop remains the only desktop. It may show live widgets such as
weather, clocks, status HUDs, and launch folders while idle, but those widgets
must close or deactivate while applets are launching or open.

Rules:

- Opening any applet collapses transient desktop folders such as the S3 Studio
  tray.
- Opening or launching any applet unmounts live desktop widgets so they stop
  timers, geolocation, polling, and network work.
- System panels may still use shell windows, but applet execution gets priority
  over decorative or ambient desktop activity.
- Applet UI should never depend on desktop widgets staying mounted behind it.

## Auth And Licence Gates

Auth source of truth:

- Shell frontend obtains Supabase/session state.
- Shell Rust receives auth state through `push_auth_state`.
- Applets read current user/tier through shell IPC such as `get_auth_context`.

Required Gener8 gates:

| Feature | Required tier | Enforcement |
|---|---|---|
| Standard generation | `gener8` or current free baseline, depending launch policy | Rust/cloud execution path. |
| Reference audio generation | `gener8_pro` | Rust/app-side execution gate, UI hint only. |
| Cover/remix generation | `gener8_pro` | Rust/app-side execution gate, UI hint only. |
| Sync lyrics / LM advanced controls | `gener8_pro` | Rust/app-side execution gate where execution has cost or unlocks model features. |
| DAW Creator Studio features | `creator_studio` | Rust/app-side DAW route or shell capability gate. |
| AI Director, local video, stems, style training | `creator_studio` | Shell entitlement plus model/engine unlock. |

The frontend may hide or soften controls for UX, but execution must fail closed
if the signed/current shell tier does not permit the feature.

## Vault Is The Library

The Library view in Gener8 AIO points at the Everywear Vault.

Current good baseline:

- `applets/gener8/web/src/views/LibraryView.tsx` already consumes
  `VaultProvider`.
- `applets/gener8/web/src/context/VaultProvider.tsx` already uses
  `@everywear/transport` vault commands.
- `platform/everywear-os/src-tauri/src/vault_commands.rs` already supports
  image, audio, video, stems, stats, search, tags, favorite, and delete.

Migration rule:

- The visible Library must never be backed by Gener8's legacy `library.json`.
- `/api/songs` and `library.rs` can remain only as a compatibility adapter for
  DAW/currently-playing/live-generation state until replaced.
- Completed audio, stems, videos, cover art, and AI Director outputs should be
  registered into Vault through `vault_register_audio`,
  `vault_register_video`, or the shell auto-register path.

Expected Vault media ownership:

| Media | Producer | Vault registration |
|---|---|---|
| Generated songs | Gener8 | `vault_register_audio` or shell auto-register for `gener8`. |
| Stems | Gener8 DAW/stem separation | Audio/stem document under Vault stems/audio path. |
| Music videos | Gener8 video modal or Vid Studio | `vault_register_video` with source applet tag. |
| AI Director video | 3nvizen / director pipeline | `vault_register_video` or engine auto-register. |
| Cover art | Gener8 / 1magen as appropriate | `vault_register_image`. |

## Video, Vid Studio, And 3nvizen

Gener8 AIO is not audio-only.

Video layers:

- `packages/video-modal` is the shared creation modal used by Gener8 and Vid.
- `applets/vid` is the standalone Vid Studio surface.
- `applets/3nvizen` is the local AI video engine applet and should remain the
  heavy local video generator.
- Gener8 can invoke video workflows and display results, but shell/Vault remains
  the cross-app media spine.

Architecture rule:

- Gener8 should orchestrate song-to-video workflows.
- Vid Studio should remain the dedicated edit/export surface.
- 3nvizen should remain the AI video engine for local text/image/video
  generation.
- All video outputs land in the Everywear Vault with source applet metadata so
  the Library can show videos from Gener8, Vid, and 3nvizen together.

## VRAM And Engine Scheduling

Do not port another standalone VRAM detector into Gener8 as the AIO authority.

Source of truth:

- `platform/everywear-os/src-tauri/src/gpu.rs`
- `platform/everywear-os/src-tauri/src/vram_scheduler.rs`
- shell engine router and applet launch environment

Gener8 may consume a shell-provided VRAM tier or current GPU state, but the shell
decides:

- Which model tier is available.
- Whether local video, stems, or Creator Studio engines can run.
- When to unload or pause engines.
- Whether a sidecar launch is refused for budget reasons.

Gener8's old `nvidia-smi` probing should be treated as fallback diagnostics only
while the port is incomplete.

## Port-In Matrix From Latest S3Studio Work

| Latest S3Studio change | Everywear target |
|---|---|
| Full current Gener8 internals and applet visuals | Port into `applets/gener8` while replacing only global shell/desktop concerns with Everywear shell services. |
| Cover no-op fix and source-audio normalization | `applets/gener8/web/src/views/CreateView.tsx` and shim generate route. |
| Improved reference generation path | Preserve in Gener8 applet, gate execution at `gener8_pro`. |
| Reference/Cover licence gate | Add applet `hasTier` helper from shell auth context and Rust execution check. |
| DAW Creator Studio gate | Gate DAW advanced routes or shell capability before model/engine use. |
| Shell app lock overlays | Use Everywear registry/tier model, not copied S3Studio shell chrome. |
| Desktop bundle output | Replace with Everywear applet build/package path. |
| Changelog/version discipline | Track under Everywear plus upstream S3Studio changelogs during transition. |

## Implementation Phases

### Phase 1: Freeze Architecture

- Keep this document as the canonical AIO slot-in target.
- Keep S3Studio web as cloud repo.
- Treat Everywear `applets/gener8` as the canonical local applet target.

### Phase 2: Port The Current Gener8 Product Surface

- Bring over the full current Gener8 applet/workflow internals and visuals.
- Exclude the superseded S3Studio desktop shell, taskbar, applet launcher, and
  global account shell.
- Add the latest cover/reference source-audio normalization.
- Add `hasTier` helper to the Gener8 applet auth context.
- Gate reference, cover, LM controls, and DAW advanced paths from shell auth.
- Preserve improved reference generation behavior.

### Phase 3: Vault-First Library

- Keep `LibraryView` on `VaultProvider`.
- Register completed audio and video into Vault automatically.
- Reduce `/api/songs` to live/compat state or adapt it to query Vault audio.

### Phase 4: Shell-Owned GPU

- Replace applet VRAM authority with shell GPU state.
- Pass model/VRAM tier into Gener8 launch/runtime context.
- Route Creator Studio/local-video decisions through shell scheduler.

### Phase 5: AIO Packaging

- Build Gener8 UI as an Everywear first-party local applet.
- Package engine sidecars, manifest, model declarations, and EWDS assets through
  Everywear signing/update rules.
- Retire standalone `s-gener8` as the main desktop product once parity is
  verified.
