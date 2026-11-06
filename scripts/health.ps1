$log = "C:\Users\krs\work\trench-watch\data\watch.log"
$stalled = $false
while ($true) {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*src/watch.js*" -or $_.CommandLine -like "*src\watch.js*" }
  if (-not $procs) {
    Write-Output "FAILED: trench-watch process is not running"
    exit 1
  }
  if (-not (Test-Path $log)) {
    Write-Output "FAILED: watcher log is missing"
    exit 1
  }
  $ageMin = ((Get-Date) - (Get-Item $log).LastWriteTime).TotalMinutes
  if ($ageMin -gt 8) {
    if (-not $stalled) {
      Write-Output "ACTION_REQUIRED: watcher log has not changed for $([int]$ageMin) minutes"
      $stalled = $true
    }
  } else {
    $stalled = $false
  }
  Start-Sleep -Seconds 60
}
