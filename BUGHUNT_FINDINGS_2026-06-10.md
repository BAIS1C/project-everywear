# Everywear Bughunt Findings - 2026-06-10

Location: `C:\Users\MAG MSI\Project Everywear`

## Phase 1 Proof Findings

| ID | Proof | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| P1-001 | Provisioning replay | No safe genuine download path was available without mutating local model caches. Gener8 4ever launched with compatible local ACE models and emitted zero provisioning events. Missing 1magen/3nvizen requirements lacked complete downloadable HF metadata, so they could not exercise `download_with_resume_and_progress`. | `screenshots/2026-06-10-proof-pass/p1-gener8-provisioning-25s.json`; native `resolve_all_models` output in session log. | Tier 3 | Decision/card needed before cache purge or seeded test requirement. |
| P2-001 | Engine-health smoke | Native proof initially failed because the running `target/debug/everywear-os.exe` was stale from 01:47, before lane-A. `cargo check` verified source but did not update the executable used by native QA. | No `engine-health` direct Tauri events or shared browser events until `cargo build -p everywear-os` and relaunch. | Tier 1 | Fixed operationally by rebuilding before proof; keep as QA discipline. |
| P2-002 | Engine-health smoke | Direct JS invoke `request_applet_switch('gener8-4ever')` returns `FrontendInline applet is missing frontend_port`, while the visible shell UI opens Gener8 4ever. | `screenshots/2026-06-10-proof-pass/p2-engine-health-smoke.json`. | Tier 2 | Carry into event/command contract audit; not a P2 blocker. |
| P3-001 | Vid export, sidecar down | WASM fallback is no longer a silent no-op, but it still does not complete: the visible alert reports a broken `HTMLImageElement` in `drawImage`, then `Nothing was saved`. | `screenshots/2026-06-10-proof-pass/p3-vid-sidecar-down-wasm-result.json`; `p3-vid-sidecar-down-wasm-result.png`. | Tier 1 | Open. Needs WASM render input sanitization or fallback image handling. |
| P3-002 | Vid export, sidecar up | NVENC encode path worked but post-encode save failed before the fix. The sidecar received 1440 frames and produced a 29.9MB MP4 in 5.5s, while the UI showed `Rendering failed: Failed to fetch. Nothing was saved.` Root cause: save path depended on legacy Gener8 shim API at 3001 while shell engine-health correctly reports `gener8-shim` down. | `screenshots/2026-06-10-proof-pass/p3-vid-sidecar-up-gpu-result.json`; `.codex-runlogs/video-encoder-manual.out.log`. | Tier 1 | Fixed by native `vault_register_video_from_encoder` path. |
| P3-003 | Vid export, shell sidecar start | Direct `request_video_encoder` returned `{ ok: true, value: 9877 }` during proof but did not leave a listener on 9877. The successful P3 postfix replay used the already-running manual encoder process. | `screenshots/2026-06-10-proof-pass/p3-video-encoder-start-attempt.json`; port checks in session log. | Tier 1 | Open. Separate shell-owned encoder lifecycle bug. |
| P3-004 | Vid export, postfix | GPU export and Vault registration now pass when an encoder is listening. Native Vid showed GPU CTA, rendered via NVENC, displayed `Video saved (14.9 MB) -> Videos/Strands Sound Studio`, wrote a 15,636,134 byte MP4 under `Documents/Everywear Vault/Videos`, and `vault_search(mediaFilter=videos)` indexed the 960x540 / 24fps item with SHA256 `0d6b17b16a57d01cdf22bf079c80578d8f80beee082efd4b9fc282fa164c31e1`. | `screenshots/2026-06-10-proof-pass/p3-vid-gpu-postfix-result.json`; `p3-vid-gpu-postfix-vault-search.json`; `p3-vid-gpu-postfix-result.png`. | Tier 1 | Fixed/verified for encoder-up save + Vault registration. |
| P4-001 | VRAM release | BinaryLocal kill cleanup passed x3 with My Mait / kasai. Each launch allocated the same two kasai rows (20,500MB primary + 5,400MB encoder); killing the exact `everywear-kasai.exe` child emitted `applet-webview-closed`, cleared `active_applet`, emptied budget allocations, and left no kasai process. | `screenshots/2026-06-10-proof-pass/p4-vram-baseline.json`; `p4-kasai-kill-1.json`; `p4-kasai-kill-cycles-2-3.json`. | Tier 1 | Passed. No reservation stacking reproduced. |

## Decision Cards

CARD: P1 cache mutation or seeded test model
CONTEXT: P1 cannot prove real provisioning replay while local compatible models satisfy the applet ladders and missing requirements lack download metadata. Forcing it requires moving/deleting model cache files or adding a small seeded downloadable test requirement.
RECOMMEND: Add a seeded downloadable test requirement for QA, because it proves the lifecycle contract without risking Sean's working model cache.
ALTERNATIVE: Approve a temporary move of exact model cache paths before P1, then restore them after the replay.
COST OF DELAY: Provisioning HUD and resume/failure behavior remain unproven for the beta gate.
REVERSAL: Easy if test requirement is QA-only and excluded from release manifests.
-> "ok" locks it; one-line redirect re-routes it

CARD: P3 shell-owned video encoder lifecycle
CONTEXT: Vid GPU export now saves and registers through the shell when an encoder is already listening on 9877, but direct `request_video_encoder` previously returned port 9877 without a live listener. That means the save path is fixed, while the shell-owned boot path is still not trustworthy.
RECOMMEND: Treat shell encoder boot as the next Tier 1 slice before calling P3 fully closed. Verify with manual encoder stopped: call `request_video_encoder`, assert 9877 listens, render Vid GPU, then call/rely on release and assert the lifecycle policy is honest.
ALTERNATIVE: Keep using manual encoder for local QA only, but label P3 as encoder-up save-path coverage rather than complete shell lifecycle coverage.
COST OF DELAY: First-run users can still hit GPU-unavailable fallback or dead-start behavior even though the encoder and Vault save code are now capable.
REVERSAL: Easy; lifecycle fix should be isolated to `video_encoder.rs` / command wiring, not the modal.
-> "ok" locks it; one-line redirect re-routes it
