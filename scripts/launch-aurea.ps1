# Aurea launcher - rebuilds the app if any source file is newer than the last
# build, then starts Electron against the built output in apps/desktop.
#
# Wired to the Desktop shortcut created by scripts/install-shortcut.ps1.
# Fresh build => console flashes for a moment and the app opens.
# Stale build => you watch the build here, then the app opens.

$ErrorActionPreference = "Stop"
$repo    = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repo "apps\desktop"
$Host.UI.RawUI.WindowTitle = "Aurea"

function Newest-Mtime([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (-not (Test-Path $p)) { continue }
    $item = Get-Item $p
    if ($item.PSIsContainer) {
      $files = Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
               Where-Object { $_.FullName -notmatch '\\node_modules\\' }
      foreach ($f in $files) { if ($f.LastWriteTime -gt $newest) { $newest = $f.LastWriteTime } }
    } elseif ($item.LastWriteTime -gt $newest) {
      $newest = $item.LastWriteTime
    }
  }
  return $newest
}

# Everything that ends up inside the bundle. packages/* matter because the
# studiod backend is bundled into dist-electron/studiod.js at build time.
$sources = @(
  (Join-Path $desktop "src"),
  (Join-Path $desktop "electron"),
  (Join-Path $desktop "index.html"),
  (Join-Path $desktop "vite.config.ts"),
  (Join-Path $desktop "package.json"),
  (Join-Path $repo "packages\core\src"),
  (Join-Path $repo "packages\shared\src")
)
$outputs = @(
  (Join-Path $desktop "dist\index.html"),
  (Join-Path $desktop "dist-electron\main.js"),
  (Join-Path $desktop "dist-electron\studiod.js"),
  (Join-Path $desktop "dist-electron\preload.cjs")
)

$srcTime = Newest-Mtime $sources
$missing = $outputs | Where-Object { -not (Test-Path $_) }
if ($missing) {
  $outTime = [datetime]::MinValue
} else {
  $outTime = ($outputs | ForEach-Object { (Get-Item $_).LastWriteTime } | Sort-Object)[0]
}

if ($srcTime -gt $outTime) {
  Write-Host ""
  Write-Host "  Aurea - sources changed since the last build. Rebuilding..." -ForegroundColor Cyan
  Write-Host "  (this takes about a minute; the app opens by itself when it's done)"
  Write-Host ""
  Push-Location $desktop
  npm run build
  $buildOk = $?
  Pop-Location
  if (-not $buildOk) {
    Write-Host ""
    Write-Host "  BUILD FAILED - see the errors above." -ForegroundColor Red
    if ($missing) {
      Write-Host "  No previous build to fall back on. Nothing was launched." -ForegroundColor Red
      Read-Host "  Press Enter to close"
      exit 1
    }
    Write-Host "  Press Enter to launch the LAST GOOD build instead (it will be out of date)," -ForegroundColor Yellow
    Write-Host "  or close this window to abort." -ForegroundColor Yellow
    Read-Host
  }
} else {
  Write-Host "  Aurea is up to date - starting..." -ForegroundColor DarkGray
}

# Reuse the pinned Electron from node_modules (same binary electron-builder packages).
$electron = Join-Path $repo "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
  $electron = Join-Path $desktop "node_modules\electron\dist\electron.exe"
}
if (-not (Test-Path $electron)) {
  Write-Host "  Could not find electron.exe - run 'npm install' in $repo" -ForegroundColor Red
  Read-Host "  Press Enter to close"
  exit 1
}

# Detached so this console can close while the app keeps running.
Start-Process -FilePath $electron -ArgumentList "." -WorkingDirectory $desktop
