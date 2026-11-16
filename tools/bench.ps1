<#
.SYNOPSIS
  Benchmarks one Mercury configuration: frame times in the page, CPU and private memory per process type.
.EXAMPLE
  tools\bench.ps1 -Name d3d11 -Settings '{"engine.angle":"d3d11"}' -Url 'https://krunker.io/?game=FRA:abcde' -Seconds 30
  Run on a quiet machine. Use the same -Url (one live lobby) for every configuration so they render the same map.
  Appends one JSON line per run to -Out (default target\bench.jsonl).
#>
param(
  [Parameter(Mandatory)] [string] $Name,
  [string] $Settings = '{}',         # settings.json content for this run (engine.* keys)
  [string] $Switches = '',               # extra command-line switches
  [string] $Url = '',                # lobby to load (default: krunker.io, random lobby)
  [int] $Seconds = 30,
  [int] $Warmup = 20,                # seconds after load before measuring (shaders, ads, first frames)
  [int] $Port = 9250,
  [string] $Out = "$PSScriptRoot\..\target\bench.jsonl"
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."
$exe = "$root\target\bundle\MercuryClient.exe"
$data = Join-Path $env:TEMP "mercury-bench-$Name"
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", $Settings)

$env:MERCURY_DATA_DIR = $data
$argList = @("--remote-debugging-port=$Port", '--remote-allow-origins=*') + ($Switches -split ' ' | Where-Object { $_ })
$proc = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory (Split-Path $exe) -PassThru
try {
  Start-Sleep -Seconds 8
  if ($Url) { node "$PSScriptRoot\cdp.mjs" $Port "location.href = '$Url'; 1" | Out-Null }
  Start-Sleep -Seconds $Warmup

  # Every Mercury process of this instance, by type.
  function Snapshot {
    $all = Get-CimInstance Win32_Process -Filter "Name='MercuryClient.exe'"
    $mine = @($all | Where-Object { $_.ProcessId -eq $proc.Id -or $_.ParentProcessId -eq $proc.Id })
    foreach ($p in $mine) {
      $type = if ($p.CommandLine -match '--type=(\S+)') { $Matches[1] } else { 'browser' }
      if ($p.CommandLine -match '--utility-sub-type=([\w.]+)') { $type = "utility:" + ($Matches[1] -replace '^.*\.', '') }
      $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      if ($gp) { [pscustomobject]@{ Id = $p.ProcessId; Type = $type; Cpu = $gp.TotalProcessorTime.TotalSeconds; Mem = $gp.PrivateMemorySize64 } }
    }
  }
  $before = Snapshot
  $t0 = Get-Date
  $frames = node "$PSScriptRoot\frames.mjs" $Port $Seconds | ConvertFrom-Json
  $wall = ((Get-Date) - $t0).TotalSeconds
  $after = Snapshot

  $cores = [Environment]::ProcessorCount
  $byType = @{}
  foreach ($a in $after) {
    $b = $before | Where-Object Id -eq $a.Id
    $cpu = if ($b) { ($a.Cpu - $b.Cpu) / $wall / $cores * 100 } else { 0 }
    if (-not $byType[$a.Type]) { $byType[$a.Type] = [ordered]@{ count = 0; cpuPct = 0.0; memMB = 0.0 } }
    $byType[$a.Type].count += 1
    $byType[$a.Type].cpuPct = [math]::Round($byType[$a.Type].cpuPct + $cpu, 2)
    $byType[$a.Type].memMB = [math]::Round($byType[$a.Type].memMB + $a.Mem / 1MB, 1)
  }
  $result = [ordered]@{
    name = $Name; time = (Get-Date).ToString('s'); settings = ($Settings | ConvertFrom-Json); switches = $Switches; url = $Url
    frames = $frames; processes = $byType
    totalMemMB = [math]::Round((($after | Measure-Object Mem -Sum).Sum) / 1MB, 1)
    totalCpuPct = [math]::Round((($byType.Values | ForEach-Object { $_.cpuPct } | Measure-Object -Sum).Sum), 2)
  }
  $line = $result | ConvertTo-Json -Depth 6 -Compress
  New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
  Add-Content -Path $Out -Value $line -Encoding utf8
  $line
}
finally {
  # Always close the instance this run started.
  $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($p) { [void]$p.CloseMainWindow(); if (-not $p.WaitForExit(15000)) { Stop-Process -Id $proc.Id -Force } }
}
