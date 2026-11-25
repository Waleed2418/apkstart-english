<#
.SYNOPSIS
  Installs the English interface for ApkStart 0.6.3-0.6.4 on Windows.

.DESCRIPTION
  Two modes:

  - Microsoft Store package: copies the ApkStart app from the Store package to
    a writable folder, applies the English translation layer, copies the
    Android runtime next to it, and creates a desktop shortcut.

  - Local source checkout: applies the translation layer in place to a cloned
    RoutineMiku/apkstart repository. No Store package is read, no runtime is
    copied, and no desktop shortcut is created.

  The Store package itself is never modified.

.PARAMETER Target
  Folder to create for the copied Store app. Default: %USERPROFILE%\ApkStartEN
  Ignored with -LocalPath.

.PARAMETER LocalPath
  Path to a cloned RoutineMiku/apkstart source checkout (must contain
  src\main.js and package.json). The patch is applied in place. Alias: -Source.
  Ignored: -Target, -SkipRuntime, -NoShortcut.

.PARAMETER SkipRuntime
  Store mode only. Do not copy the 1.68 GB Android runtime. The translated app
  starts, but the Android runtime cannot boot until resources\runtime exists.

.PARAMETER NoShortcut
  Store mode only. Do not create the desktop shortcut.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -LocalPath C:\src\apkstart
#>
param(
  [string]$Target = (Join-Path $env:USERPROFILE 'ApkStartEN'),
  [Alias('Source')]
  [string]$LocalPath,
  [switch]$SkipRuntime,
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$apply = Join-Path $repo 'patch\apply.js'

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# 1. Check prerequisites -----------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is required to apply the patch. Install it from https://nodejs.org/ (LTS).' }
Write-Host "Node   : $($node.Source)"

# 2. Local source checkout mode ----------------------------------------------
if ($LocalPath) {
  if (-not (Test-Path -LiteralPath $LocalPath -PathType Container)) {
    Fail "Local source checkout not found: $LocalPath"
  }
  $localRoot = (Resolve-Path -LiteralPath $LocalPath).Path
  if (-not (Test-Path (Join-Path $localRoot 'src\main.js'))) {
    Fail "src\main.js not found in $localRoot. Point -LocalPath at the apkstart repository root."
  }
  if (-not (Test-Path (Join-Path $localRoot 'package.json'))) {
    Fail "package.json not found in $localRoot. Point -LocalPath at the apkstart repository root."
  }

  Write-Host "Source : $localRoot (local checkout)"
  Write-Host 'Applying English translation in place...'
  & $node.Source $apply $localRoot
  if ($LASTEXITCODE -ne 0) { Fail 'The patch failed. The report above lists the steps that did not match.' }

  Write-Host ''
  Write-Host 'Done. The source checkout is patched in place. Start it with:'
  Write-Host "  cd `"$localRoot`""
  Write-Host '  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue'
  Write-Host '  npm start'
  if (-not (Test-Path (Join-Path $localRoot 'node_modules'))) {
    Write-Host 'Note: node_modules is missing. Run npm install in that folder first.' -ForegroundColor Yellow
  }
  Write-Host 'No desktop shortcut was created in local-checkout mode.'
  exit 0
}

# 3. Locate the installed Store package --------------------------------------
$pkgRoot = $null
try {
  $pkg = Get-AppxPackage -Name 'RoutineMiku.ApkStart' -ErrorAction Stop | Select-Object -First 1
  if ($pkg) { $pkgRoot = $pkg.InstallLocation }
} catch { }

if (-not $pkgRoot -or -not (Test-Path $pkgRoot)) {
  $candidates = Get-ChildItem 'C:\Program Files\WindowsApps' -Directory -Filter 'RoutineMiku.ApkStart_*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  if ($candidates) { $pkgRoot = $candidates[0].FullName }
}
if (-not $pkgRoot) { Fail 'ApkStart is not installed. Install it from the Microsoft Store first, or use -LocalPath for a source checkout.' }
$appSrc = Join-Path $pkgRoot 'app'
if (-not (Test-Path (Join-Path $appSrc 'ApkStart.exe'))) { Fail "ApkStart.exe not found in $appSrc" }
Write-Host "Source : $appSrc"

# 4. Copy the app (without the multi-GB runtime) -----------------------------
if (Test-Path $Target) {
  Write-Host "Target already exists: $Target"
  Write-Host 'Existing files will be overwritten where the patch needs to write.'
} else {
  New-Item -ItemType Directory -Path $Target | Out-Null
}
Write-Host 'Copying app files...'
$null = robocopy $appSrc $Target /E /XD (Join-Path $appSrc 'resources\runtime') /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { Fail "robocopy failed with exit code $LASTEXITCODE" }

# 5. Apply the translation ---------------------------------------------------
Write-Host 'Applying English translation...'
& $node.Source $apply $Target
if ($LASTEXITCODE -ne 0) { Fail 'The patch failed. The report above lists the steps that did not match.' }

# 6. Copy the Android runtime ------------------------------------------------
$rtSrc = Join-Path $appSrc 'resources\runtime'
$rtDst = Join-Path $Target 'resources\runtime'
if ($SkipRuntime) {
  Write-Host 'Runtime copy skipped. Android apps will not boot until the runtime is present.' -ForegroundColor Yellow
  Write-Host "Copy it later from: $rtSrc"
} elseif (Test-Path (Join-Path $rtDst 'emulator')) {
  Write-Host 'Runtime already present, skipping the 1.68 GB copy.'
} else {
  if (Test-Path $rtDst) { Remove-Item $rtDst -Recurse -Force }
  Write-Host 'Copying Android runtime (1.68 GB, this can take a few minutes)...'
  $null = robocopy $rtSrc $rtDst /E /MT:16 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { Fail "runtime copy failed with exit code $LASTEXITCODE" }
}

# 7. Desktop shortcut --------------------------------------------------------
if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'ApkStart (English).lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = Join-Path $Target 'ApkStart.exe'
  $sc.WorkingDirectory = $Target
  $sc.IconLocation = (Join-Path $Target 'ApkStart.exe') + ',0'
  $sc.Description = 'ApkStart - English interface'
  $sc.Save()
  Write-Host "Shortcut: $lnk"
}

Write-Host ''
Write-Host 'Done. Start ApkStart (English) from the desktop.'
Write-Host 'Close the Microsoft Store version first: both builds share %USERPROFILE%\ApkStart\data.'
