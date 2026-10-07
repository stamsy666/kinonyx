<#
  Builds a signed KINONYX installer and the `latest.json` the in-app updater reads.

  One-time setup (once per machine, keep the private key SAFE and out of git):
    cd apps\desktop
    pnpm tauri signer generate -w $env:USERPROFILE\.tauri\kinonyx.key
  -> prints a PUBLIC key: paste it into src-tauri\tauri.conf.json (plugins.updater.pubkey)
     and put your GitHub "owner/repo" into plugins.updater.endpoints (replace OWNER/REPO).

  Every release:
    1. bump `version` in src-tauri\tauri.conf.json, src-tauri\Cargo.toml and package.json
    2. $env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\kinonyx.key"
       $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<the password you chose, or empty>"
       (optional) $env:KINONYX_DEFAULT_TMDB_KEY = "<built-in TMDB key>"
    3. .\scripts\release.ps1 -Repo owner/name -Notes "What's new"
    4. Create a GitHub Release tagged v<version> and attach the three files the script prints
       (installer .exe, its .exe.sig, latest.json) — or run the `gh release create` line it prints.
#>
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps\desktop"
$conf = Get-Content (Join-Path $desktop "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
$product = $conf.productName

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH -and -not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "Set TAURI_SIGNING_PRIVATE_KEY_PATH (see the header of this script)."
}
# `tauri build` reads the key's CONTENT from TAURI_SIGNING_PRIVATE_KEY (the *_PATH variant is
# ignored by the build step), so load the file when only the path was given.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:TAURI_SIGNING_PRIVATE_KEY_PATH -Raw
}
if ($conf.plugins.updater.pubkey -like "PASTE_*") {
  throw "Paste the public key into src-tauri\tauri.conf.json (plugins.updater.pubkey) first."
}

Push-Location $desktop
try {
  # Signed updater artifacts are only produced for releases, so a plain `tauri build`
  # (no key) keeps working for local installers.
  pnpm tauri build --config '{"bundle":{"createUpdaterArtifacts":true}}'
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
}

$bundle = Join-Path $desktop "src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem $bundle -Filter "${product}_${version}_x64-setup.exe" | Select-Object -First 1
if (-not $exe) { throw "Installer for $version not found in $bundle" }
$sigFile = "$($exe.FullName).sig"
if (-not (Test-Path $sigFile)) { throw "Signature $sigFile not found — was the signing key set?" }

$tag = "v$version"
$latest = [ordered]@{
  version   = $version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sigFile -Raw).Trim()
      url       = "https://github.com/$Repo/releases/download/$tag/$($exe.Name)"
    }
  }
}
$latestPath = Join-Path $bundle "latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host ""
Write-Host "Release $tag is ready. Attach these to the GitHub Release:" -ForegroundColor Green
Write-Host "  $($exe.FullName)"
Write-Host "  $sigFile"
Write-Host "  $latestPath"
Write-Host ""
Write-Host "Or, with the GitHub CLI:"
Write-Host "  gh release create $tag `"$($exe.FullName)`" `"$sigFile`" `"$latestPath`" --repo $Repo --title `"KINONYX $version`" --notes `"$Notes`""
