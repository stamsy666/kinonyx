# Assembles the Windows x64 DLSS frame generation runtime alongside interpolate.vpy.
param(
    [Parameter(Mandatory = $true)][string]$SdkPath,
    [Parameter(Mandatory = $true)][string]$RuntimeDll
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sdk = (Resolve-Path -LiteralPath $SdkPath).Path
$provider = Get-Item -LiteralPath $RuntimeDll
if ($provider.Name -ne 'nvngx_dlssg.dll') { throw 'Select nvngx_dlssg.dll.' }
$signature = Get-AuthenticodeSignature -LiteralPath $provider.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=NVIDIA Corporation(,|$)') {
    throw 'Select an original NVIDIA-signed DLSS-G runtime.'
}
$providerHash = (Get-FileHash -LiteralPath $provider.FullName).Hash
$framegen = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps\desktop\src-tauri\framegen'
$destination = Join-Path $framegen 'runtime'
$stage = [IO.Path]::GetFullPath((Join-Path $framegen ('.stage-' + [guid]::NewGuid())))
$framegen = [IO.Path]::GetFullPath($framegen)
$destination = [IO.Path]::GetFullPath($destination)
if ([IO.Path]::GetDirectoryName($stage) -ne $framegen -or [IO.Path]::GetDirectoryName($destination) -ne $framegen) {
    throw 'Invalid frame generation runtime directory.'
}
$runtime = Join-Path $stage 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null

function Get-PinnedFile([string]$url, [string]$hash, [string]$path) {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path -TimeoutSec 90
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash) {
        throw "Checksum mismatch for $url"
    }
}

function Expand-Wheel([string]$path, [string]$target) {
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        foreach ($entry in $archive.Entries) {
            if (-not $entry.Name -or $entry.Name.EndsWith('.pdb')) { continue }
            $file = [IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
            if (-not $file.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Unexpected path inside a frame generation wheel.'
            }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $file, $false)
        }
    } finally {
        $archive.Dispose()
    }
}

try {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $installations = & $vswhere -all -prerelease -products '*' -property installationPath
    $vcvars = $installations | ForEach-Object { Join-Path $_ 'VC\Auxiliary\Build\vcvars64.bat' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $vcvars) { throw 'Visual Studio x64 C++ tools are required.' }
    $source = Join-Path $PSScriptRoot 'framegen\dlss-bridge.cpp'
    $library = Join-Path $sdk 'lib\Windows_x86_64\x64\nvsdk_ngx_s.lib'
    @"
@echo off
call "$vcvars" > nul
if errorlevel 1 exit /b %errorlevel%
cl.exe /nologo /EHsc /MT /std:c++17 /O2 /LD /I"$sdk\include" "$source" "$library" d3d12.lib dxgi.lib advapi32.lib user32.lib setupapi.lib shell32.lib ole32.lib /Fe:"$runtime\kx-dlss.dll"
exit /b %errorlevel%
"@ | Set-Content -LiteralPath (Join-Path $stage 'compile.cmd') -Encoding ASCII
    Push-Location -LiteralPath $stage
    try {
        & cmd.exe /d /c compile.cmd
        if ($LASTEXITCODE -ne 0) { throw "DLSS bridge compilation failed ($LASTEXITCODE)." }
    } finally {
        Pop-Location
    }

    $python = Join-Path $stage 'python.zip'
    Get-PinnedFile 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip' '90905E64A840557D8C1BC4F5B74DB3D7EE85E3FFB217611CAC1C7813ACEA4159' $python
    Expand-Archive -LiteralPath $python -DestinationPath $runtime
    [IO.File]::WriteAllLines((Join-Path $runtime 'python314._pth'), [string[]]@('python314.zip', '.', 'lib/site-packages'))

    $vapour = Join-Path $stage 'vapoursynth.zip'
    Get-PinnedFile 'https://github.com/vapoursynth/vapoursynth/releases/download/R82/VapourSynth64-Portable-R82.zip' 'F97EA50C4C9F778EEAC4BC4E3E43F86FB3B71787371D06E584E0C47F396874CA' $vapour
    $vsDir = Join-Path $stage 'vs'
    Expand-Archive -LiteralPath $vapour -DestinationPath $vsDir
    $site = Join-Path $runtime 'lib\site-packages'
    Expand-Wheel (Join-Path $vsDir 'wheel\vapoursynth-82-cp312-abi3-win_amd64.whl') $site

    $copiedProvider = Join-Path $runtime 'nvngx_dlssg.dll'
    Copy-Item -LiteralPath $provider.FullName -Destination $copiedProvider
    if ((Get-FileHash -LiteralPath $copiedProvider).Hash -ne $providerHash) { throw 'DLSS provider changed during assembly.' }
    $previous = Join-Path $stage 'previous'
    if ([IO.Directory]::Exists($destination)) { [IO.Directory]::Move($destination, $previous) }
    try {
        [IO.Directory]::Move($runtime, $destination)
    } catch {
        if ([IO.Directory]::Exists($previous)) { [IO.Directory]::Move($previous, $destination) }
        throw
    }
    Write-Host "DLSS frame generation runtime is ready at $destination"
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
