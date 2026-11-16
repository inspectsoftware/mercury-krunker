<#
.SYNOPSIS
  Input-to-screen latency of one Mercury configuration (PLAN.md M3 item 4). TAKES OVER THE MOUSE for about a minute:
  run it only when nobody is using the PC.
.EXAMPLE
  tools\latency.ps1 -Name uncapped
  tools\latency.ps1 -Name vsync -Settings '{"engine.uncapped":false}'
  tools\latency.ps1 -Name heavy -Busy 4      # 4 ms of main-thread work per frame, like a busy game loop
#>
param(
  [Parameter(Mandatory)] [string] $Name,
  [string] $Settings = '{}',
  [string] $Switches = '',
  [int] $Busy = 0,
  [int] $Count = 60,
  [int] $Port = 9251,
  [string] $Out = "$PSScriptRoot\..\target\latency.jsonl"
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."
$tool = "$root\target\debug\latency.exe"
if (-not (Test-Path $tool)) { throw "build it first: cargo build -p latency" }
$data = Join-Path $env:TEMP "mercury-latency-$Name"
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", $Settings)

$env:MERCURY_DATA_DIR = $data
$argList = @("--remote-debugging-port=$Port", '--remote-allow-origins=*') + ($Switches -split ' ' | Where-Object { $_ })
$proc = Start-Process -FilePath "$root\target\bundle\MercuryClient.exe" -ArgumentList $argList -WorkingDirectory "$root\target\bundle" -PassThru
try {
  Start-Sleep -Seconds 8
  $page = ([Uri]"$PSScriptRoot\latency\latency.html").AbsoluteUri + "?busy=$Busy"
  node "$PSScriptRoot\drive.mjs" $Port - "nav:$page" | Out-Null
  Start-Sleep -Seconds 3
  $result = & $tool --pid $proc.Id --count $Count
  if ($LASTEXITCODE -ne 0) { throw "latency tool failed" }
  $line = ([ordered]@{ name = $Name; time = (Get-Date).ToString('s'); settings = ($Settings | ConvertFrom-Json); switches = $Switches; busy = $Busy; latency = ($result | ConvertFrom-Json) } | ConvertTo-Json -Compress -Depth 5)
  Add-Content -Path $Out -Value $line -Encoding utf8
  $line
}
finally {
  $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($p) { [void]$p.CloseMainWindow(); if (-not $p.WaitForExit(15000)) { Stop-Process -Id $proc.Id -Force } }
}
