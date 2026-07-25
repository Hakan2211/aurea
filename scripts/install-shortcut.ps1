# Creates (or refreshes) the "Aurea" shortcut on the Desktop.
# Run once: powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1

$ErrorActionPreference = "Stop"
$repo     = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "launch-aurea.ps1"
$icon     = Join-Path $repo "apps\desktop\build\icon.ico"

# OneDrive-redirected Desktop wins when it exists - that's the one the user sees.
$desktopDir = [Environment]::GetFolderPath("Desktop")
if ($env:OneDrive -and (Test-Path (Join-Path $env:OneDrive "Desktop"))) {
  $desktopDir = Join-Path $env:OneDrive "Desktop"
}

$lnk = Join-Path $desktopDir "Aurea.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$sc.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$sc.WorkingDirectory = $repo
$sc.WindowStyle      = 1   # normal - the console shows build progress, then closes itself
$sc.Description      = "Aurea - local-first AI creation platform (rebuilds if sources changed)"
if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

Write-Host "Shortcut created: $lnk"
