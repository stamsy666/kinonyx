param([string]$ArchivePath)

$ErrorActionPreference = 'Stop'
$release = 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-11-24-12-41'
$url = 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-24-12-41/ffmpeg-n8.1.3-41-ga8029b6528-win64-lgpl-8.1.zip'
$sha256 = '2201DF4D6CBDCBBDA9E612645605735821BB4CD0B120A9683F970C4C4E2DE8E4'
$lib = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps\desktop\src-tauri\lib'
$downloaded = $null

try {
    if (-not $ArchivePath) {
        $downloaded = Join-Path ([IO.Path]::GetTempPath()) ('kinonyx-ffmpeg-' + [guid]::NewGuid() + '.zip')
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $downloaded -TimeoutSec 150
        $ArchivePath = $downloaded
    }
    if ((Get-FileHash -LiteralPath $ArchivePath).Hash -ne $sha256) {
        throw 'FFmpeg archive SHA-256 does not match the pinned release.'
    }

    New-Item -ItemType Directory -Path $lib -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
    try {
        $base = 'ffmpeg-n8.1.3-41-ga8029b6528-win64-lgpl-8.1'
        $binary = $archive.GetEntry("$base/bin/ffmpeg.exe")
        $license = $archive.GetEntry("$base/LICENSE.txt")
        if (-not $binary -or -not $license) { throw 'Required FFmpeg files are missing from the archive.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($binary, (Join-Path $lib 'ffmpeg.exe'), $true)
        [IO.Compression.ZipFileExtensions]::ExtractToFile($license, (Join-Path $lib 'ffmpeg-LICENSE.txt'), $true)
        @"
FFmpeg is used as a standalone executable by yt-dlp to combine audio and video.
FFmpeg, build configuration and corresponding source links: $release
FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/a8029b6528
The build's license terms are included in ffmpeg-LICENSE.txt.
"@ | Set-Content -LiteralPath (Join-Path $lib 'ffmpeg-NOTICE.txt') -Encoding utf8
    } finally {
        $archive.Dispose()
    }
    $version = & (Join-Path $lib 'ffmpeg.exe') -version
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to start.' }
    $version | Select-Object -First 1
} finally {
    if ($downloaded -and (Test-Path -LiteralPath $downloaded)) {
        Remove-Item -LiteralPath $downloaded
    }
}
