param(
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Harness = Join-Path $PSScriptRoot "index.html"
$OutRoot = Join-Path $Root "marketing\screenshots"
$Variants = @(
  @{ id = "ewd-clean"; name = "EWD Clean"; dir = "ewd-clean" },
  @{ id = "ewd-signal"; name = "EWD Signal"; dir = "ewd-signal" },
  @{ id = "ewd-darkops"; name = "EWD Dark Ops"; dir = "ewd-darkops" }
)
$Scenes = @(
  @{ id="auth-loading"; title="Auth loading"; source="platform/everywear-os/src/shell/AuthGate.tsx"; category="Onboarding" },
  @{ id="auth-login"; title="Everywear ID login"; source="platform/everywear-os/src/shell/AuthGate.tsx"; category="Onboarding" },
  @{ id="auth-signup"; title="Everywear ID signup"; source="platform/everywear-os/src/shell/AuthGate.tsx"; category="Onboarding" },
  @{ id="auth-otp"; title="OTP verification"; source="platform/everywear-os/src/shell/AuthGate.tsx"; category="Onboarding" },
  @{ id="shell-launcher"; title="Shell launcher desktop"; source="platform/everywear-os/src/panels/LauncherGrid.tsx"; category="Shell" },
  @{ id="shell-folder-open"; title="Launcher folder expanded"; source="platform/everywear-os/src/panels/LauncherGrid.tsx"; category="Shell" },
  @{ id="shell-active-applet"; title="Separate applet running banner"; source="platform/everywear-os/src/shell/ShellLayout.tsx"; category="Shell" },
  @{ id="profile-view"; title="Profile identity"; source="platform/everywear-os/src/panels/ProfilePanel.tsx"; category="Shell" },
  @{ id="profile-edit"; title="Profile edit state"; source="platform/everywear-os/src/panels/ProfilePanel.tsx"; category="Shell" },
  @{ id="wallet-view"; title="Wallet panel"; source="platform/everywear-os/src/panels/WalletPanel.tsx"; category="Shell" },
  @{ id="hardware-view"; title="Hardware and model assessment"; source="platform/everywear-os/src/panels/GpuPanel.tsx"; category="Shell" },
  @{ id="settings-view"; title="Settings appearance"; source="platform/everywear-os/src/panels/SettingsPanel.tsx"; category="Shell" },
  @{ id="logs-view"; title="Session logs"; source="platform/everywear-os/src/components/LogViewerPanel.tsx"; category="Diagnostics" },
  @{ id="bug-report-modal"; title="Bug report modal"; source="platform/everywear-os/src/components/BugReportModal.tsx"; category="Diagnostics"; cutout=$true },
  @{ id="vault-list"; title="Vault list"; source="applets/gener8/web/src/views/LibraryView.tsx"; category="Vault" },
  @{ id="vault-detail"; title="Vault detail panel"; source="applets/gener8/web/src/components/VaultDetailPanel.tsx"; category="Vault" },
  @{ id="vault-empty"; title="Vault empty/search state"; source="applets/gener8/web/src/views/LibraryView.tsx"; category="Vault" },
  @{ id="vault-loading"; title="Vault loading state"; source="applets/gener8/web/src/views/LibraryView.tsx"; category="Vault" },
  @{ id="applet-loading"; title="Applet loading skeleton"; source="platform/everywear-os/src/components/AppletLoadingSkeleton.tsx"; category="Applet Runtime" },
  @{ id="applet-error"; title="Applet error boundary"; source="platform/everywear-os/src/components/AppletViewRouter.tsx"; category="Applet Runtime" },
  @{ id="kasai-empty"; title="Kasai ready state"; source="applets/kasai/src/shell/KasaiCore.tsx"; category="Kasai" },
  @{ id="kasai-chat-tools"; title="Kasai chat and tool calls"; source="applets/kasai/src/shell/KasaiCore.tsx"; category="Kasai" },
  @{ id="kasai-skill"; title="Kasai skill detail"; source="applets/kasai/src/shell/KasaiCore.tsx"; category="Kasai" },
  @{ id="runtime-orchestration"; title="Runtime orchestration"; source="crates/mait/src; platform/everywear-os/src-tauri/src/vram_scheduler.rs"; category="Runtime" },
  @{ id="imagen-empty"; title="1magen prompt workbench"; source="applets/1magen/src/shell/ImagenCore.tsx"; category="1magen" },
  @{ id="imagen-generating"; title="1magen provisioning/generating"; source="applets/1magen/src/shell/ImagenCore.tsx"; category="1magen" },
  @{ id="imagen-result"; title="1magen result with vault save"; source="applets/1magen/src/shell/ImagenCore.tsx"; category="1magen" },
  @{ id="threevizen-idle"; title="3nvizen idle/offline"; source="applets/3nvizen/src/ThreevizenCore.tsx"; category="3nvizen" },
  @{ id="threevizen-generating"; title="3nvizen generation progress"; source="applets/3nvizen/src/ThreevizenCore.tsx"; category="3nvizen" },
  @{ id="threevizen-result"; title="3nvizen completed preview"; source="applets/3nvizen/src/components/VideoPreview.tsx"; category="3nvizen" },
  @{ id="gener8-create"; title="Gener8 create view"; source="applets/gener8/web/src/views/CreateView.tsx"; category="Gener8" },
  @{ id="gener8-progress"; title="Gener8 generation progress"; source="applets/gener8/web/src/views/CreateView.tsx"; category="Gener8" },
  @{ id="gener8-library"; title="Gener8 library"; source="applets/gener8/web/src/views/LibraryView.tsx"; category="Gener8" },
  @{ id="gener8-settings"; title="Gener8 settings"; source="applets/gener8/web/src/views/SettingsView.tsx"; category="Gener8" },
  @{ id="vid-studio"; title="Vid Studio runtime"; source="applets/vid/web/src/views/VidView.tsx"; category="Vid" },
  @{ id="vid-export-modal"; title="Vid Studio export modal"; source="applets/vid/web/src/components/VideoGeneratorModal.tsx"; category="Vid"; cutout=$true },
  @{ id="character-studio"; title="Character Studio placeholder"; source="applets/character-studio/src/CharacterStudioPlaceholder.tsx"; category="Character Studio" },
  @{ id="installer-models"; title="Install/model workflow"; source="crates/model-manager/src; platform/everywear-os/src-tauri/src/setup.rs"; category="Installers" },
  @{ id="file-browser"; title="File browser and project picker"; source="applets/1magen/src; applets/gener8/web/src"; category="Files" },
  @{ id="update-flow"; title="Update workflow"; source="platform/everywear-os/src-tauri/src/setup.rs"; category="Installers" }
)

if (!(Test-Path $ChromePath)) {
  throw "Chrome not found at $ChromePath"
}

New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
foreach ($variant in $Variants) {
  New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot $variant.dir) | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot "$($variant.dir)\jpg") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot "$($variant.dir)\thumbs") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot "$($variant.dir)\cutouts") | Out-Null
}

Add-Type -AssemblyName System.Drawing

function Save-JpegAndThumb {
  param([string]$PngPath, [string]$JpgPath, [string]$ThumbPath, [bool]$Cutout)
  $img = [System.Drawing.Image]::FromFile($PngPath)
  try {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 88L)
    $img.Save($JpgPath, $codec, $ep)

    $thumbW = 960
    $thumbH = 540
    $thumb = New-Object System.Drawing.Bitmap($thumbW, $thumbH)
    $g = [System.Drawing.Graphics]::FromImage($thumb)
    try {
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $srcRatio = $img.Width / $img.Height
      $dstRatio = $thumbW / $thumbH
      if ($srcRatio -gt $dstRatio) {
        $srcH = $img.Height
        $srcW = [int]($srcH * $dstRatio)
        $srcX = [int](($img.Width - $srcW) / 2)
        $srcY = 0
      } else {
        $srcW = $img.Width
        $srcH = [int]($srcW / $dstRatio)
        $srcX = 0
        $srcY = [int](($img.Height - $srcH) / 2)
      }
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$thumbW,$thumbH)), (New-Object System.Drawing.Rectangle($srcX,$srcY,$srcW,$srcH)), [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $g.Dispose()
    }
    $thumb.Save($ThumbPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $thumb.Dispose()

    if ($Cutout) {
      $cutW = [int]($img.Width * .42)
      $cutH = [int]($img.Height * .48)
      $cutX = [int](($img.Width - $cutW) / 2)
      $cutY = [int](($img.Height - $cutH) / 2)
      $cut = New-Object System.Drawing.Bitmap($cutW, $cutH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $cg = [System.Drawing.Graphics]::FromImage($cut)
      try {
        $cg.Clear([System.Drawing.Color]::Transparent)
        $cg.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$cutW,$cutH)), (New-Object System.Drawing.Rectangle($cutX,$cutY,$cutW,$cutH)), [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $cg.Dispose()
      }
      $cutoutPath = Join-Path (Split-Path (Split-Path $ThumbPath -Parent) -Parent) ("cutouts\" + [System.IO.Path]::GetFileName($PngPath))
      $cut.Save($cutoutPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $cut.Dispose()
    }
  } finally {
    $img.Dispose()
  }
}

function New-ContactSheet {
  param([hashtable]$Variant)
  $thumbDir = Join-Path $OutRoot "$($Variant.dir)\thumbs"
  $files = Get-ChildItem $thumbDir -Filter "*.png" | Sort-Object Name
  $cols = 4
  $cellW = 960
  $cellH = 620
  $rows = [Math]::Ceiling($files.Count / $cols)
  $sheet = New-Object System.Drawing.Bitmap($($cols * $cellW), $($rows * $cellH))
  $g = [System.Drawing.Graphics]::FromImage($sheet)
  try {
    $g.Clear([System.Drawing.Color]::FromArgb(14,16,20))
    $font = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::White
    for ($i = 0; $i -lt $files.Count; $i++) {
      $x = ($i % $cols) * $cellW
      $y = [Math]::Floor($i / $cols) * $cellH
      $thumb = [System.Drawing.Image]::FromFile($files[$i].FullName)
      try {
        $g.DrawImage($thumb, $x, $y, 960, 540)
      } finally {
        $thumb.Dispose()
      }
      $name = [System.IO.Path]::GetFileNameWithoutExtension($files[$i].Name)
      $g.DrawString($name, $font, $brush, $x + 22, $y + 556)
    }
    $font.Dispose()
  } finally {
    $g.Dispose()
  }
  $sheetPath = Join-Path $OutRoot "$($Variant.dir)\contact-sheet.png"
  $sheet.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $sheet.Dispose()
  return $sheetPath
}

$manifest = New-Object System.Collections.Generic.List[object]
$baseUri = ([System.Uri]((Resolve-Path $Harness).Path)).AbsoluteUri

foreach ($variant in $Variants) {
  foreach ($scene in $Scenes) {
    $safeName = "$($scene.id)"
    $png = Join-Path $OutRoot "$($variant.dir)\$safeName.png"
    $jpg = Join-Path $OutRoot "$($variant.dir)\jpg\$safeName.jpg"
    $thumb = Join-Path $OutRoot "$($variant.dir)\thumbs\$safeName.png"
    $cutout = $scene.ContainsKey("cutout") -and $scene.cutout
    $url = "$baseUri`?scene=$($scene.id)&variant=$($variant.id)&cutout=$cutout"
    $args = @(
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=3840,2160",
      "--virtual-time-budget=1500",
      "--screenshot=$png",
      $url
    )
    & $ChromePath @args | Out-Null
    if (!(Test-Path $png)) { throw "Screenshot failed: $png" }
    Save-JpegAndThumb -PngPath $png -JpgPath $jpg -ThumbPath $thumb -Cutout $cutout
    $manifest.Add([pscustomobject]@{
      id = "$($variant.id)/$($scene.id)"
      scene_id = $scene.id
      title = $scene.title
      category = $scene.category
      variant = $variant.name
      route_or_component = $scene.source
      png_4k = "marketing/screenshots/$($variant.dir)/$safeName.png"
      jpg_web = "marketing/screenshots/$($variant.dir)/jpg/$safeName.jpg"
      thumbnail = "marketing/screenshots/$($variant.dir)/thumbs/$safeName.png"
      transparent_cutout = if ($cutout) { "marketing/screenshots/$($variant.dir)/cutouts/$safeName.png" } else { $null }
    }) | Out-Null
  }
  New-ContactSheet -Variant $variant | Out-Null
}

$manifestPath = Join-Path $OutRoot "screenshot-manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

$featureLines = New-Object System.Collections.Generic.List[string]
$featureLines.Add("# EveryWear Marketing Screenshot Feature Index")
$featureLines.Add("")
$featureLines.Add("Generated: $(Get-Date -Format s)")
$featureLines.Add("")
$featureLines.Add("Total UI surfaces: $($Scenes.Count)")
$featureLines.Add("Total rendered screenshots: $($Scenes.Count * $Variants.Count)")
$featureLines.Add("")
foreach ($category in ($Scenes | Group-Object category | Sort-Object Name)) {
  $featureLines.Add("## $($category.Name)")
  foreach ($scene in $category.Group) {
    $featureLines.Add("- **$($scene.title)** ($($scene.id)) -> $($scene.source)")
  }
  $featureLines.Add("")
}
$featureLines.Add("## Audit Notes")
$featureLines.Add("- Captures include deterministic synthetic data for backend-only states such as sidecar health, model downloads, bug reports, and generation progress.")
$featureLines.Add("- mymories, s3studio, and strands-game do not currently expose standalone local UI code in this repository; they are represented through shell/vault/ecosystem surfaces.")
$featureLines.Add("- 3nvizen depends on the LTX sidecar at 127.0.0.1:8787; offline and running states are captured through the deterministic marketing harness.")
$featureLines.Add("- Shell auth requires live Supabase/Tauri state; onboarding screens are rendered as audited deterministic states.")
$featureLines | Set-Content -Path (Join-Path $OutRoot "feature-index.md") -Encoding UTF8

$gallery = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EveryWear Screenshot Gallery</title>
  <style>
    body { margin: 0; background: #0a0b0d; color: #e6e8ec; font-family: Inter, Segoe UI, sans-serif; }
    header { padding: 32px 42px; border-bottom: 1px solid #242833; position: sticky; top: 0; background: rgba(10,11,13,.92); backdrop-filter: blur(10px); z-index: 2; }
    h1 { margin: 0; font-size: 28px; }
    p { color: #9aa3b2; }
    section { padding: 26px 42px 52px; }
    h2 { margin: 28px 0 18px; font-size: 20px; color: #00c2ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
    .card { border: 1px solid #242833; background: #11151f; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; display: block; }
    .meta { padding: 12px 14px 16px; }
    .title { font-weight: 700; }
    .src { color: #7f8a9b; font: 12px Consolas, monospace; margin-top: 6px; }
    a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>EveryWear Marketing Screenshot Gallery</h1>
    <p>$($Scenes.Count) surfaces rendered across 3 EWD visual systems. Open any thumbnail for the 4K PNG master.</p>
  </header>
  <section>
"@
foreach ($variant in $Variants) {
  $gallery += "`n<h2>$($variant.name)</h2><div class='grid'>"
  foreach ($scene in $Scenes) {
    $gallery += "<a class='card' href='$($variant.dir)/$($scene.id).png'><img src='$($variant.dir)/thumbs/$($scene.id).png' alt='$($scene.title)' /><div class='meta'><div class='title'>$($scene.title)</div><div class='src'>$($scene.source)</div></div></a>"
  }
  $gallery += "</div>"
}
$gallery += @"
  </section>
</body>
</html>
"@
$gallery | Set-Content -Path (Join-Path $OutRoot "preview-gallery.html") -Encoding UTF8

$report = [pscustomobject]@{
  total_ui_surfaces_captured = $Scenes.Count
  total_screenshots_rendered = $Scenes.Count * $Variants.Count
  variants = $Variants.name
  outputs = @{
    root = "marketing/screenshots"
    manifest = "marketing/screenshots/screenshot-manifest.json"
    feature_index = "marketing/screenshots/feature-index.md"
    preview_gallery = "marketing/screenshots/preview-gallery.html"
  }
  missing_or_incomplete = @(
    "mymories has Rust/vault scaffolding but no local frontend surface in this repository.",
    "s3studio and strands-game are represented as web/ecosystem applets, not local screens.",
    "Several Tauri-only states require backend events; deterministic synthetic data was used for capture."
  )
  broken_or_risky = @(
    "3nvizen local sidecar health is expected to be offline unless the LTX adapter is running.",
    "Shell auth depends on Supabase session hydration and cannot show authenticated shell without local/live session or mocks.",
    "Vid and Gener8 export/generation flows depend on sidecars and browser media APIs."
  )
  suggested_ux_improvements = @(
    "Add a first-party demo/capture mode that hydrates shell panels with deterministic data.",
    "Expose explicit empty, loading, error, and progress story states for each applet.",
    "Give installer/model provisioning a shell-level visual route so it can be marketed and tested directly.",
    "Add route-level deep links for applet sub-states such as vault detail, bug report, and generator progress."
  )
}
$report | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutRoot "capture-report.json") -Encoding UTF8

Write-Host "Captured $($Scenes.Count) surfaces across $($Variants.Count) variants into $OutRoot"
