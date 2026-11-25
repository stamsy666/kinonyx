# Tests DLSS-G on generated 1080p frames using NVIDIA's SDK and an existing signed runtime.
# Run from the VS x64 Developer PowerShell, with the NVIDIA DLSS repository checked out locally.
param(
    [Parameter(Mandatory = $true)][string]$SdkPath,
    [Parameter(Mandatory = $true)][string]$RuntimeDll
)

$ErrorActionPreference = 'Stop'
$sdk = (Resolve-Path -LiteralPath $SdkPath).Path
$dll = Get-Item -LiteralPath $RuntimeDll
if ($dll.Name -ne 'nvngx_dlssg.dll') { throw 'Select nvngx_dlssg.dll.' }
$signature = Get-AuthenticodeSignature -LiteralPath $dll.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=NVIDIA Corporation(,|$)') {
    throw 'Select an original NVIDIA-signed DLSS-G runtime.'
}
$compiler = Get-Command cl.exe -ErrorAction Stop
$source = Join-Path $PSScriptRoot 'dlss-framegen-probe.cpp'
$include = Join-Path $sdk 'include'
$library = Join-Path $sdk 'lib\Windows_x86_64\x64\nvsdk_ngx_s.lib'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('kinonyx-dlssg-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $scratch | Out-Null
Push-Location -LiteralPath $scratch
try {
    & $compiler.Source /nologo /EHsc /MT /std:c++17 /O2 "/I$include" $source $library d3d12.lib dxgi.lib advapi32.lib user32.lib setupapi.lib shell32.lib ole32.lib /Fe:probe.exe
    if ($LASTEXITCODE -ne 0) { throw "DLSS probe compilation failed with exit code $LASTEXITCODE." }
    foreach ($generated in 1, 2) {
        Write-Host "DLSS-G x$($generated + 1) at 1920x1080"
        & .\probe.exe $dll.DirectoryName ([string]$generated)
        if ($LASTEXITCODE -ne 0) { throw "DLSS probe failed with exit code $LASTEXITCODE." }
    }
} finally {
    Pop-Location
}
