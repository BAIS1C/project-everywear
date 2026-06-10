# Everywear Bughunt Findings - 2026-06-10

Location: `C:\Users\MAG MSI\Project Everywear`

## Phase 1 Proof Findings

| ID | Proof | Finding | Evidence | Tier | Status |
| --- | --- | --- | --- | --- | --- |
| P1-001 | Provisioning replay | No safe genuine download path was available without mutating local model caches. Gener8 4ever launched with compatible local ACE models and emitted zero provisioning events. Missing 1magen/3nvizen requirements lacked complete downloadable HF metadata, so they could not exercise `download_with_resume_and_progress`. | `screenshots/2026-06-10-proof-pass/p1-gener8-provisioning-25s.json`; native `resolve_all_models` output in session log. | Tier 3 | Decision/card needed before cache purge or seeded test requirement. |
| P2-001 | Engine-health smoke | Native proof initially failed because the running `target/debug/everywear-os.exe` was stale from 01:47, before lane-A. `cargo check` verified source but did not update the executable used by native QA. | No `engine-health` direct Tauri events or shared browser events until `cargo build -p everywear-os` and relaunch. | Tier 1 | Fixed operationally by rebuilding before proof; keep as QA discipline. |
| P2-002 | Engine-health smoke | Direct JS invoke `request_applet_switch('gener8-4ever')` returns `FrontendInline applet is missing frontend_port`, while the visible shell UI opens Gener8 4ever. | `screenshots/2026-06-10-proof-pass/p2-engine-health-smoke.json`. | Tier 2 | Carry into event/command contract audit; not a P2 blocker. |

## Decision Cards

CARD: P1 cache mutation or seeded test model
CONTEXT: P1 cannot prove real provisioning replay while local compatible models satisfy the applet ladders and missing requirements lack download metadata. Forcing it requires moving/deleting model cache files or adding a small seeded downloadable test requirement.
RECOMMEND: Add a seeded downloadable test requirement for QA, because it proves the lifecycle contract without risking Sean's working model cache.
ALTERNATIVE: Approve a temporary move of exact model cache paths before P1, then restore them after the replay.
COST OF DELAY: Provisioning HUD and resume/failure behavior remain unproven for the beta gate.
REVERSAL: Easy if test requirement is QA-only and excluded from release manifests.
-> "ok" locks it; one-line redirect re-routes it
