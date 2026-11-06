# Installs Trench Watch as a Windows service. Run this file from an elevated PowerShell.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tools = Join-Path $root "tools"
$exe = Join-Path $tools "TrenchWatch.exe"
$xml = Join-Path $tools "TrenchWatch.xml"
$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $tools | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "data\service") | Out-Null

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an Administrator PowerShell. The database is not touched."
}

if (-not (Test-Path $exe)) {
  $url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
  Write-Output "Downloading WinSW from $url"
  Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
}

@"
<service>
  <id>TrenchWatch</id>
  <name>Trench Watch</name>
  <description>Records Pump.fun launches into the local trench database and serves the status panel on 127.0.0.1:8787.</description>
  <executable>$node</executable>
  <arguments>$root\src\watch.js</arguments>
  <workingdirectory>$root</workingdirectory>
  <logpath>$root\data\service</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <onfailure action="restart" delay="15 sec"/>
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
</service>
"@ | Set-Content -Path $xml -Encoding UTF8

$existing = Get-Service -Name TrenchWatch -ErrorAction SilentlyContinue
if ($existing) {
  & $exe stop
  & $exe uninstall
  Start-Sleep -Seconds 2
}

& $exe install
& $exe start
Start-Sleep -Seconds 2
$svc = Get-Service TrenchWatch
$svc | Format-List Name, Status, StartType
$result = "installed $($svc.Status) $(Get-Date -Format o)"
Set-Content -Path (Join-Path $root "data\service-install.log") -Value $result
Write-Output "Panel: http://127.0.0.1:8787"
Write-Output "Database left in place: $root\data\trench.db"
