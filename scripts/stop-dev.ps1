$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'tmp\dev\processes.json'

if (-not (Test-Path $pidFile)) {
  Write-Host 'No dev PID file found.'
  exit 0
}

$payload = Get-Content $pidFile | ConvertFrom-Json

foreach ($proc in $payload.processes) {
  $running = Get-Process -Id $proc.pid -ErrorAction SilentlyContinue
  if ($running) {
    Stop-Process -Id $proc.pid -Force
    Write-Host "Stopped $($proc.name) ($($proc.pid))"
  }
  else {
    Write-Host "$($proc.name) ($($proc.pid)) already stopped"
  }
}

Remove-Item -LiteralPath $pidFile -Force
Write-Host 'Removed PID file.'
