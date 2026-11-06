# Removes the Trench Watch Windows service. Does not delete the database.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$exe = Join-Path $root "tools\TrenchWatch.exe"
if (-not (Test-Path $exe)) { throw "WinSW wrapper not found at $exe" }
& $exe stop
& $exe uninstall
Write-Output "Service removed. Database still at $root\data\trench.db"
