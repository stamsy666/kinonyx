# Builds omnivoice.cpp's tts-server.exe (voice-over synthesis, GGML + CUDA) with the KINONYX dubbing
# patch and puts it where the app looks for it: apps\desktop\src-tauri\translator\omnivoice\.
# The installer takes it from there (bundle resource translator/**/*).
#
# Needs (same as for whisper-server.exe): Git, CMake, Ninja, Visual Studio Build Tools (C++), CUDA 13.
#   powershell -ExecutionPolicy Bypass -File scripts\build-omnivoice.ps1
#
# Pinned to the commit the patch was written against. Default CUDA architectures of the project
# already include RTX 50 (sm_120) with CUDA >= 12.8.

param(
  [string]$Commit = "a650381a67905fd6ad08b323ed026b042a07b623"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "third_party\omnivoice.cpp"
$patch = Join-Path $PSScriptRoot "omnivoice-cpp-dubbing.patch"
$dest = Join-Path $root "apps\desktop\src-tauri\translator\omnivoice"

function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed ($LASTEXITCODE)" }
}

if (-not (Test-Path $src)) {
  Run git @("clone", "https://github.com/ServeurpersoCom/omnivoice.cpp", $src)
}
Push-Location $src
try {
  Run git @("fetch", "origin")
  Run git @("checkout", "--force", $Commit)
  Run git @("submodule", "update", "--init", "--depth", "1")
  # The patch on top of a clean checkout (checkout --force dropped any earlier copy of it).
  Run git @("apply", "--whitespace=nowarn", $patch)

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $vs) { throw "Visual Studio C++ build tools not found" }
  $vcvars = Join-Path $vs "VC\Auxiliary\Build\vcvars64.bat"

  $cmd = "call `"$vcvars`" && cmake -S . -B build -G `"Ninja Multi-Config`" -DGGML_CUDA=ON && cmake --build build --config Release --target tts-server -j $env:NUMBER_OF_PROCESSORS"
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "omnivoice.cpp build failed" }

  $exe = Get-ChildItem -Path build -Recurse -Filter "tts-server.exe" | Where-Object { $_.FullName -match "Release" } | Select-Object -First 1
  if (-not $exe) { throw "tts-server.exe not found under build\" }

  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Remove-Item -Path (Join-Path $dest "*") -Force -ErrorAction SilentlyContinue
  Copy-Item $exe.FullName $dest
  # ggml builds as DLLs next to the exe (ggml.dll, ggml-base.dll, ggml-cpu.dll, ggml-cuda.dll).
  Get-ChildItem -Path $exe.DirectoryName -Filter "*.dll" | Copy-Item -Destination $dest
  Write-Host "OK: $dest"
  Get-ChildItem $dest | Format-Table Name, Length
}
finally {
  Pop-Location
}
