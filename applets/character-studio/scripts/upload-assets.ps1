<#
Uploads the Character Studio runtime asset set to Cloudflare R2.

Default mode is a dry run. Fill the variables below, export the credential env
vars, then run with -Execute when the object list looks sane.
#>

[CmdletBinding()]
param(
  [switch]$Execute
)

# Cloudflare R2 target. No secrets live here.
$Bucket = "everywear-assets"
$Account = "3407fcb4405b38b6d3b5237f08fa391f"

# Required credentials: set these in your shell, never in this file.
$ApiTokenEnvVar = "CLOUDFLARE_API_TOKEN"
$AccountIdEnvVar = "CLOUDFLARE_ACCOUNT_ID"

# Object layout. This matches VITE_ASSET_PATH=https://assets.everywear.id/character-studio.
# Until custom-domain SSL/ownership finishes, the managed fallback is:
# https://pub-59c29c1388024e9f836e42baca32e6a7.r2.dev/character-studio
$R2KeyPrefix = "character-studio"

# Source paths.
$AppletPublicRoot = Resolve-Path (Join-Path $PSScriptRoot "..\public")
$ForkPublicRoot = "C:\Users\MAG MSI\Project Strands\CharacterStudio-Strands\public"
$ManifestSource = Join-Path $ForkPublicRoot "manifest.json"
$AssetDirs = @(
  "character-assets",
  "hdr",
  "lora-assets",
  "sound",
  "ktx2"
)

# Tooling. Uses npx so the repo does not need a committed Wrangler dependency.
$NpxArgs = @("--yes", "wrangler@latest")

function Assert-Configured {
  if ($Bucket -like "TODO_*") {
    if ($Execute) {
      throw "Fill `$Bucket at the top of this script."
    }

    Write-Warning "Bucket is still a TODO placeholder."
  }

  if ($Account -like "TODO_*") {
    if ($Execute) {
      throw "Fill `$Account at the top of this script."
    }

    Write-Warning "Account is still a TODO placeholder."
  }

  if ($Execute -and -not [Environment]::GetEnvironmentVariable($ApiTokenEnvVar)) {
    throw "Set environment variable $ApiTokenEnvVar before upload."
  }

  if ($Execute -and -not [Environment]::GetEnvironmentVariable($AccountIdEnvVar)) {
    [Environment]::SetEnvironmentVariable($AccountIdEnvVar, $Account, "Process")
  }
}

function Get-ContentType {
  param([string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".avif" { "image/avif"; break }
    ".bin" { "application/octet-stream"; break }
    ".hdr" { "image/vnd.radiance"; break }
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".js" { "text/javascript"; break }
    ".json" { "application/json"; break }
    ".ktx2" { "image/ktx2"; break }
    ".md" { "text/markdown"; break }
    ".mp3" { "audio/mpeg"; break }
    ".ogg" { "audio/ogg"; break }
    ".png" { "image/png"; break }
    ".vrm" { "model/gltf-binary"; break }
    ".webm" { "video/webm"; break }
    ".webp" { "image/webp"; break }
    default { "application/octet-stream" }
  }
}

function Get-UploadItems {
  $items = foreach ($dir in $AssetDirs) {
    $sourceDir = Join-Path $AppletPublicRoot $dir
    if (-not (Test-Path -LiteralPath $sourceDir)) {
      throw "Missing asset directory: $sourceDir"
    }

    Get-ChildItem -LiteralPath $sourceDir -Recurse -File | ForEach-Object {
      $relative = [IO.Path]::GetRelativePath($AppletPublicRoot, $_.FullName)
      [pscustomobject]@{
        File = $_.FullName
        Key = ($R2KeyPrefix, ($relative -replace "\\", "/")) -join "/"
      }
    }
  }

  if (-not (Test-Path -LiteralPath $ManifestSource)) {
    throw "Missing fork manifest.json: $ManifestSource"
  }

  $items += [pscustomobject]@{
    File = $ManifestSource
    Key = "$R2KeyPrefix/manifest.json"
  }

  $items
}

function Invoke-R2Put {
  param(
    [string]$File,
    [string]$Key
  )

  $contentType = Get-ContentType -Path $File
  $object = "$Bucket/$Key"
  $wranglerArgs = @()
  $wranglerArgs += $NpxArgs
  $wranglerArgs += @(
    "r2",
    "object",
    "put",
    $object,
    "--file",
    $File,
    "--content-type",
    $contentType,
    "--remote"
  )

  if ($Account) {
    $wranglerArgs += @("--account-id", $Account)
  }

  if (-not $Execute) {
    Write-Host "[dry-run] npx $($wranglerArgs -join ' ')"
    return
  }

  & npx @wranglerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler upload failed for $File -> $object"
  }
}

Assert-Configured

$uploadItems = Get-UploadItems
$totalBytes = ($uploadItems | ForEach-Object { (Get-Item -LiteralPath $_.File).Length } | Measure-Object -Sum).Sum
Write-Host ("Upload plan: {0} files, {1:n2} MB, prefix '{2}'" -f $uploadItems.Count, ($totalBytes / 1MB), $R2KeyPrefix)

foreach ($item in $uploadItems) {
  Invoke-R2Put -File $item.File -Key $item.Key
}

if (-not $Execute) {
  Write-Host "Dry run complete. Re-run with -Execute after Bucket, Account, and credentials are set."
}
