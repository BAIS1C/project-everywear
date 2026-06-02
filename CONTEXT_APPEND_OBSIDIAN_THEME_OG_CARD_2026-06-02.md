# Context Append: Obsidian Theme (planned) + everywear.id OG/Social Card

Location: C:\Users\MAG MSI\Project Everywear\CONTEXT_APPEND_OBSIDIAN_THEME_OG_CARD_2026-06-02.md
Created: 2026-06-02 SGT
Status: append-only digression note; sync to Project Mymory vault (EWDS / Everywear wing) next Cowork session (vault not mounted this session)

## Decision / Facts

- EWDS theme "Obsidian": discussed recently, NOT yet built. No asset, no CSS token, no screenshot exists. Only "obsidian" reference in the codebase is the MyMory Obsidian-vault integration in platform/everywear-os/src-tauri/src/commands/kasai.rs (unrelated).
- Confirmed EWDS dark theme family that DOES exist: graphite (default), anodized, carbon; OS switcher adds classic, refined, terminal, light.
- everywear.id social/link card (OG + Twitter): updated in the SEPARATE marketing repo C:\Users\MAG MSI\Project Websites\everywear\index.html.
  - og/twitter title -> "EveryWear: The Steam for Local Federated AI Apps and Agents"
  - og/twitter description -> "Discover, install, and run AI applets and agents locally on your own hardware. Federated by default, sovereign by design, zero lock-in."
  - Added og:image + twitter:image (were missing; summary_large_image had no image).
  - Interim card image = graphite desktop shot, copied to Project Websites\everywear\screens\og\everywear-obsidian-graphite-desktop.png (source: Project Everywear\screenshots\2026-05-29-everywear-os-themes-tour\theme-graphite-01-desktop.png, 1440x960, unwatermarked).

## Open / Next

- When Obsidian theme ships: replace card image with an Obsidian desktop shot (drop into screens/og/, repoint og:image + twitter:image). One-line change.
- Deploy marketing repo, then force X card re-scrape by posting https://everywear.id/?v=2 (X caches one card per exact URL; bare everywear.id keeps serving the stale "Browser-Native Agentic OS" card until ~7-day TTL).
- DRIFT FLAG: Project Everywear\index.html still carries the old "Browser-Native Agentic OS" narrative (title, H1, OG). Reconcile which everywear index.html is the canonical deploy source for everywear.id (live site currently serves the Project Websites\everywear version).
- OPEN: DeckLayerU / Layer U assets and links that "apply to everywear" — unactioned, awaiting scope from Sean.
