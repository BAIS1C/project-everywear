# Everywear OS Screenshot Manifest - 2026-05-29

Project location: `C:\Users\MAG MSI\Project Everywear`
Runtime: `C:\Users\MAG MSI\Project Everywear\target\debug\everywear-os.exe`
Capture method: real Tauri/WebView2 runtime with DevTools capture on `127.0.0.1:9222`.

## Theme And Icon Matrix

| Screenshot | Screen | Action | Expected | Actual / Notes |
|---|---|---|---|---|
| `00-entry.png` | Desktop | Initial runtime capture | Desktop shell visible | Graphite-ish dark desktop with center HUD and launcher rail. |
| `theme-light-01-desktop.png` | Desktop | Set Light theme | Light desktop/icon renderer visible | Captured. |
| `theme-light-02-s3-folder-open.png` | S3 folder | Open S3 folder in Light | Folder tray visible | Captured, S3 children show locked. |
| `theme-classic-01-desktop.png` | Desktop | Set Classic theme | Classic desktop/icon renderer visible | Captured. |
| `theme-classic-02-s3-folder-open.png` | S3 folder | Open S3 folder in Classic | Folder tray visible | Captured, S3 children show locked. |
| `theme-refined-01-desktop.png` | Desktop | Set Refined theme | Refined desktop/icon renderer visible | Captured. |
| `theme-refined-02-s3-folder-open.png` | S3 folder | Open S3 folder in Refined | Folder tray visible | Captured, S3 children show locked. |
| `theme-terminal-01-desktop.png` | Desktop | Set Terminal theme | Terminal desktop/icon renderer visible | Captured. |
| `theme-terminal-02-s3-folder-open.png` | S3 folder | Open S3 folder in Terminal | Folder tray visible | Captured, S3 children show locked. |
| `theme-graphite-01-desktop.png` | Desktop | Set Graphite theme | EWDS-v2 graphite desktop visible | Captured. |
| `theme-graphite-02-s3-folder-open.png` | S3 folder | Open S3 folder in Graphite | Folder tray visible | Captured, S3 children show locked. |
| `theme-anodized-01-desktop.png` | Desktop | Set Anodized theme | EWDS-v2 anodized desktop visible | Captured. |
| `theme-anodized-02-s3-folder-open.png` | S3 folder | Open S3 folder in Anodized | Folder tray visible | Captured, S3 children show locked. |
| `theme-carbon-01-desktop.png` | Desktop | Set Carbon theme | EWDS-v2 carbon desktop visible | Captured. |
| `theme-carbon-02-s3-folder-open.png` | S3 folder | Open S3 folder in Carbon | Folder tray visible | Captured, S3 children show locked. |
| `icon-combo-graphite-cut-left.png` | Desktop | Graphite, cut, left controls | Icon/chrome treatment visible | Captured. |
| `icon-combo-graphite-rounded-right.png` | Desktop | Graphite, rounded, right controls | Traffic controls move right | Captured. |
| `icon-combo-graphite-square-left.png` | Desktop | Graphite, square, high bevel | Surface treatment visible | Captured. |
| `icon-combo-anodized-rounded-right.png` | Desktop | Anodized, rounded, right controls | Anodized icon/chrome treatment visible | Captured. |
| `icon-combo-carbon-square-right.png` | Desktop | Carbon, square, right controls | Carbon icon/chrome treatment visible | Captured. |

## Applet And Shell Screens

| Screenshot | Screen | Action | Expected | Actual / Notes |
|---|---|---|---|---|
| `app-s3-folder-graphite.png` | S3 Studio folder | Open folder | Grouped S3 family launchers visible | Captured, 1magen, Gener8, Vid, AI Director, and 3nvizen are visibly locked. |
| `app-s3-1magen-locked-click.png` | S3 child | Click 1magen | Unlock or explain gate | Shows locked state and launch error handoff on some clicks. |
| `app-s3-gener8-locked-click.png` | S3 child | Click Gener8 | Unlock or explain gate | Shows locked state. |
| `app-s3-vid-studio-locked-click.png` | S3 child | Click Vid Studio | Unlock or explain gate | Shows locked state and launch error handoff on some clicks. |
| `app-s3-ai-director-locked-click.png` | S3 child | Click AI Director | Unlock or explain gate | Shows locked state. |
| `app-s3-3nvizen-locked-click.png` | S3 child | Click 3nvizen | Unlock or explain gate | Shows locked state and launch error handoff on some clicks. |
| `app-strands-nation-graphite.png` | Strands Nation | Click icon | Internal iframe/browser window opens | Did not visibly open during this run. |
| `app-my-mait-graphite.png` | My Mait | Click icon | My Mait applet opens | Captured ready agent hub. |
| `mymait-01-ready.png` | My Mait | Ready state | Skills, composer, slot state, safety rails visible | Captured. |
| `mymait-02-code-review-skill-selected.png` | My Mait | Click Code Review skill | Skill selection visible | Capture sequence corrected, but selection needs a manual retest. |
| `mymait-03-chat-draft.png` | My Mait | Type into composer | Text appears in composer | Composer input did not visibly type in this automated pass. |
| `app-layer-u-osint-graphite.png` | Layer U OSINT | Click icon | Layer U applet opens | Captured offline Project SON boundary. |
| `layeru-01-map-offline.png` | Layer U OSINT | Map tab | Offline map pane visible | Captured. |
| `layeru-02-feeds-tab.png` | Layer U OSINT | Click Feeds | Feeds tab visible | Captured. |
| `layeru-03-sources-tab.png` | Layer U OSINT | Click Sources | Sources tab visible | Captured. |
| `layeru-04-reload-map.png` | Layer U OSINT | Click Reload Map | Map reloads or preserves offline boundary | Captured. |
| `app-avatar-studio-graphite.png` | Avatar Studio | Click icon | Character Studio placeholder opens | Runtime still shows NFT Mint/on-chain copy. |
| `character-01-placeholder.png` | Avatar Studio | Placeholder | Blank tooling placeholder visible | Runtime still shows forbidden NFT/on-chain copy. |
| `app-loom-graphite.png` | The Loom | Click icon | Public education surface opens | Runtime still shows Project NOMAD to Everywear Rust. |
| `loom-01-public-surface.png` | The Loom | Public surface | Loom education copy visible | Runtime still leaks Project NOMAD title. |
| `loom-02-scrolled-modules.png` | The Loom | Scroll modules | Lower module/content controls visible | Captured, but scroll movement did not expose much additional content. |
| `app-settings-graphite.png` | Settings | Click icon | Appearance controls visible | Captured theme, accent, density, widget controls. |
| `app-vault-graphite.png` | Vault | Click icon | Vault media screen opens | Captured real indexed media. |
| `vault-01-media-all.png` | Vault | Media / All | Counts, filters, search, sort, pagination visible | Captured. |
| `vault-02-videos-filter.png` | Vault | Click Videos filter | Video gallery/cards expected | Runtime still shows dense list rows. |
| `vault-03-search-codex.png` | Vault | Type search query | Results filter or search accepted | Captured. |
| `vault-04-logs-tab.png` | Vault | Click Logs | Logs/activity view visible | Captured. |
| `app-taskbar-start-graphite.png` | Taskbar | Click start / show desktop | Windows minimized / desktop visible | Captured. |
| `app-taskbar-profile-graphite.png` | Taskbar | Click profile | Profile/account surface expected | Captured profile interaction boundary. |
| `app-taskbar-bell-graphite.png` | Taskbar | Click notification/report button | Bug report surface expected | Captured notification/report entry point. |

## Raw Capture Metadata

- `manifest-capture-raw.json`
- `manifest-apps-raw.json`
- `manifest-subflows-raw.json`
- `manifest-corrections-raw.json`

`debug-after-close.png` and any `debug-*` files are operational debug receipts, not tutorial deliverables.
