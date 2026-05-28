# Everywear OS Tutorial Script Draft

Project location: `C:\Users\MAG MSI\Project Everywear`

Format: spotlight target, short tooltip, one required action, deterministic completion condition.

## Global Pattern

Each step should be a small object:

```ts
{
  id: "desktop.icon.s3-folder",
  target: "[data-tour='s3-folder']",
  copy: "S3 Studio groups the creator tools. Open it to see audio, image, video, and director apps.",
  action: "click",
  completion: "S3 folder tray is expanded"
}
```

Add `data-tour` attributes to stable controls. Do not target CSS classes that exist only for styling.

## 1. First Desktop

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Center clock/HUD | This is your home node. It shows local status, inference state, network posture, and weather. | None | User clicks Next | `theme-graphite-01-desktop.png` |
| 2 | Icon rail | Apps live on the left. Some are applets, some are system surfaces. | None | User clicks Next | `theme-graphite-01-desktop.png` |
| 3 | S3 folder | S3 Studio is a folder of creator tools. Locked badges mean your current entitlement does not expose that tool yet. | Click folder | Folder tray opens | `theme-graphite-02-s3-folder-open.png` |
| 4 | Taskbar Light/Dark | This is the quick mode switch. Full theme control lives in Settings. | Toggle Light, then Dark | Mode changes | `theme-light-01-desktop.png`, `theme-graphite-01-desktop.png` |
| 5 | Report button | Use this when a screen crashes or behaves weirdly. It seeds a bug report with the current surface. | Click report | Bug report modal opens | `app-taskbar-bell-graphite.png` |

## 2. Settings And Themes

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Settings icon | Settings controls Everywear's visual language and local shell preferences. | Click Settings | Settings window opens | `app-settings-graphite.png` |
| 2 | Theme grid | Pick the base skin. Light is daytime; Graphite, Anodized, and Carbon are EWDS-v2. | Click theme | `data-skin` / `data-mode` changes | `theme-*.png` |
| 3 | Accent grid | Accent changes system highlights. It should not alter product identity labels. | Click accent | Accent swatch and controls update | `app-settings-graphite.png` |
| 4 | Chrome density | This controls barcode, serial, and industrial-chrome intensity. | Drag slider | Chrome density updates | `icon-combo-graphite-cut-left.png` |
| 5 | Wallpaper intensity | This controls desktop substrate strength. | Drag slider | Wallpaper grain changes | `icon-combo-carbon-square-right.png` |
| 6 | Bevel | This controls depth and edge lighting on v2 surfaces. | Drag slider | Bevel variables update | `icon-combo-graphite-square-left.png` |
| 7 | Traffic lights | Choose whether window controls sit left or right. | Click side | Titlebar controls move | `icon-combo-graphite-rounded-right.png` |
| 8 | Surface treatment | Cut, rounded, and square affect widgets and app chrome. | Click treatment | Surface class changes | `icon-combo-*.png` |

## 3. S3 Studio Folder

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | S3 folder | These are the creator tools: 1magen, Gener8, Vid Studio, AI Director, and 3nvizen. | Open folder | Tray opens | `app-s3-folder-graphite.png` |
| 2 | 1magen | 1magen creates and edits images locally. If locked, explain the plan required. | Click | App opens or lock explainer appears | `app-s3-1magen-locked-click.png` |
| 3 | Gener8 | Gener8 makes music and audio assets. | Click | App opens or lock explainer appears | `app-s3-gener8-locked-click.png` |
| 4 | Vid Studio | Vid Studio is the video surface for visualizers and exports. | Click | App opens or lock explainer appears | `app-s3-vid-studio-locked-click.png` |
| 5 | AI Director | AI Director plans shots and orchestrates creator flows. | Click | App opens or lock explainer appears | `app-s3-ai-director-locked-click.png` |
| 6 | 3nvizen | 3nvizen is the video generation workbench. | Click | App opens or lock explainer appears | `app-s3-3nvizen-locked-click.png` |

Needed before tutorial shipping: replace the current launch error path with a friendly lock explainer.

## 4. Vault

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Vault icon | Vault is the shared Everywear asset memory. It holds generated audio, video, images, stems, references, and logs. | Click Vault | Vault opens | `vault-01-media-all.png` |
| 2 | Media/Logs tabs | Media is content. Logs are activity receipts and debugging evidence. | Click Logs | Logs tab opens | `vault-04-logs-tab.png` |
| 3 | Counts row | Counts tell you what is indexed and searchable. | None | User clicks Next | `vault-01-media-all.png` |
| 4 | Search | Search filters indexed assets by title and metadata. | Type query | Results update | `vault-03-search-codex.png` |
| 5 | Media filters | Use filters to narrow Songs, Stems, Riffs, Samples, References, Cover Sources, Local Audio, Images, Videos, and Favorites. | Click Videos | Videos filter selected | `vault-02-videos-filter.png` |
| 6 | Sort menu | Newest is default. Other sorts should explain what they change. | Open sort | Menu visible | needs capture |
| 7 | Pagination | Vault pages large libraries to keep the app responsive. | Next page | Page number changes | `vault-01-media-all.png` |
| 8 | Row/item | Selecting an item should open detail, preview, playback, or metadata. | Click row | Detail opens | needs retest |
| 9 | Delete | Delete must be confirmed, with "do not ask again" only for local owner-approved workflows. | Click trash | Confirm modal opens | needs retest |

Needed before tutorial shipping: Videos should become tiled cards in the running bundle.

## 5. My Mait

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | My Mait icon | My Mait is the local agent hub. It stays inside Everywear and uses local rails first. | Click My Mait | Agent hub opens | `mymait-01-ready.png` |
| 2 | Skills rail | Skills are task modes. Select one to change the assistant's working context. | Click a skill | Skill highlights | `mymait-02-code-review-skill-selected.png` |
| 3 | Connections | MyMory, Local Files, and Browser show which capabilities are currently reachable. | None | User clicks Next | `mymait-01-ready.png` |
| 4 | Composer | Ask a question or hand off a local task. | Type prompt | Text appears | `mymait-03-chat-draft.png` |
| 5 | `@ SKILL` chip | Inserts a skill reference into the composer. | Click | Composer gets `@skill` | needs retest |
| 6 | `# VAULT` chip | Inserts a Vault context marker into the composer. | Click | Composer gets `#vault` | needs retest |
| 7 | Send | Sends the prompt to the local My Mait runtime. | Click send | Message enters chat or safe error appears | needs harmless prompt retest |
| 8 | Ask Before Acting | Safety rail for irreversible work. | Toggle | State changes | needs capture |
| 9 | Everywear Boundary | Blocks standalone window commands in this mount. | Toggle | State changes | needs capture |

## 6. Layer U OSINT

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Layer U icon | Layer U is the compact OSINT worldview surface. | Click | Layer U opens | `layeru-01-map-offline.png` |
| 2 | Offline badge | The Project SON service is not running. Start the local service to populate the worldview. | None | User clicks Next | `layeru-01-map-offline.png` |
| 3 | Map tab | Map holds flights, maritime, GPS interference, and event overlays. | Click Map | Map selected | `layeru-01-map-offline.png` |
| 4 | Feeds tab | Feeds should show RSS/news/video/live sources when service is online. | Click Feeds | Feeds selected | `layeru-02-feeds-tab.png` |
| 5 | Sources tab | Sources should show source posture and trust metadata. | Click Sources | Sources selected | `layeru-03-sources-tab.png` |
| 6 | Refresh | Refreshes local snapshot state. | Click | Refresh starts or offline boundary persists | `layeru-01-map-offline.png` |
| 7 | Pull Live | Requests a live pull from the local service. | Click | Live pull starts or disabled/offline state explains why | `layeru-01-map-offline.png` |
| 8 | Reload Map | Reloads the embedded worldview frame. | Click | Frame reloads or offline message remains | `layeru-04-reload-map.png` |

## 7. The Loom

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | The Loom icon | Loom is the education surface: local learning packs plus My Maits Lite teaching support. | Click | Loom opens | `loom-01-public-surface.png` |
| 2 | Phase cards | These explain what exists, what is planned, and what is blocked. | None | User clicks Next | `loom-01-public-surface.png` |
| 3 | Plan Downloads | Builds a transparent acquisition plan. It must not silently download large files. | Click | Plan message updates | source-driven, needs fresh runtime capture |
| 4 | Accept Plan | Accepts manifest review only. Downloads remain blocked until URLs, sizes, and checksums are visible. | Click | Accepted state appears | source-driven, needs fresh runtime capture |
| 5 | Subject tabs | Switch between Mathematics, Biology, Chemistry, Physics, English, and Computer Science. | Click subject | Module changes | source-driven, needs fresh runtime capture |
| 6 | Content packs | Toggle optional packs. Required packs cannot be removed. | Click pack | Selection updates | source-driven, needs fresh runtime capture |

Needed before tutorial shipping: rebuild the running bundle so it stops showing Project NOMAD copy.

## 8. Avatar / Character Studio

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Avatar Studio icon | Character Studio will create and export Blanks assets. | Click | Placeholder opens | `character-01-placeholder.png` |
| 2 | Placeholder badge | This is a port scaffold, not the finished editor. | None | User clicks Next | `character-01-placeholder.png` |
| 3 | Feature cards | Explain future Blank Customizer, Skin & Texture, Animation Rig, and Blank Export Kit. | None | User clicks Next | source-driven |

Needed before tutorial shipping: rebuild the running bundle so NFT/on-chain language disappears.

## 9. Recovery And Error Flow

| Step | Target | Tooltip | Action | Completion | Screenshot |
|---|---|---|---|---|---|
| 1 | Window close/minimize/maximize | Every applet is an OS window. You can close, minimize, or maximize it from the titlebar. | Click minimize | Window hides | needs capture |
| 2 | Report problem | Opens a seeded bug report for this window. | Click `!` | Bug report modal opens | `app-taskbar-bell-graphite.png` |
| 3 | Error boundary retry | If an applet crashes, Retry reloads it and Report Crash captures context. | Trigger only in test harness | Error boundary visible | source-driven |

## Data Attributes To Add

- `desktop.centerHud`
- `desktop.icon.s3Folder`
- `desktop.icon.<appletId>`
- `taskbar.start`
- `taskbar.mode.light`
- `taskbar.mode.dark`
- `taskbar.profile`
- `taskbar.report`
- `settings.theme.<theme>`
- `settings.accent.<accent>`
- `settings.slider.chromeDensity`
- `settings.slider.wallpaperIntensity`
- `settings.slider.bevel`
- `settings.traffic.left`
- `settings.traffic.right`
- `settings.surface.<surface>`
- `vault.tab.media`
- `vault.tab.logs`
- `vault.search`
- `vault.filter.<filter>`
- `vault.sort`
- `vault.pagination.prev`
- `vault.pagination.next`
- `mymait.skill.<skillId>`
- `mymait.composer`
- `mymait.context.skill`
- `mymait.context.vault`
- `mymait.send`
- `layeru.tab.map`
- `layeru.tab.feeds`
- `layeru.tab.sources`
- `layeru.refresh`
- `layeru.pullLive`
- `layeru.reloadMap`
- `loom.planDownloads`
- `loom.acceptPlan`
- `loom.subject.<subjectId>`
- `loom.pack.<packId>`
- `window.close`
- `window.minimize`
- `window.maximize`
- `window.report`
