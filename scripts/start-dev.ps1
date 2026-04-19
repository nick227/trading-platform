$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$tmpDir = Join-Path $root 'tmp\dev'
$logDir = Join-Path $tmpDir 'logs'
$pidFile = Join-Path $tmpDir 'processes.json'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path $pidFile) {
  $existing = Get-Content $pidFile | ConvertFrom-Json
  $running = @()

  foreach ($proc in $existing.processes) {
    if (Get-Process -Id $proc.pid -ErrorAction SilentlyContinue) {
      $running += $proc
    }
  }

  if ($running.Count -gt 0) {
    throw "Existing dev processes found in $pidFile. Run .\scripts\stop-dev.ps1 first."
  }

  Remove-Item -LiteralPath $pidFile -Force
}

Write-Host 'Cleaning stale worker rows...'
& npm.cmd run ops:cleanup-workers --workspace=server | Out-Host

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  $stdout = Join-Path $logDir "$Name.out.log"
  $stderr = Join-Path $logDir "$Name.err.log"

  if (Test-Path $stdout) { Remove-Item -LiteralPath $stdout -Force }
  if (Test-Path $stderr) { Remove-Item -LiteralPath $stderr -Force }

  $process = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  return [pscustomobject]@{
    name = $Name
    pid = $process.Id
    stdout = $stdout
    stderr = $stderr
  }
}

$processes = @(
  (Start-LoggedProcess -Name 'server' -WorkingDirectory (Join-Path $root 'server') -ArgumentList @('run', 'start')),
  (Start-LoggedProcess -Name 'worker' -WorkingDirectory (Join-Path $root 'worker') -ArgumentList @('run', 'start')),
  (Start-LoggedProcess -Name 'app' -WorkingDirectory (Join-Path $root 'app') -ArgumentList @('run', 'dev'))
)

$payload = [pscustomobject]@{
  startedAt = (Get-Date).ToString('o')
  processes = $processes
  urls = [pscustomobject]@{
    api = 'http://localhost:3001'
    docs = 'http://localhost:3001/docs'
    app = 'http://localhost:5173'
    ops = 'http://localhost:5173/ops'
  }
}

$payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pidFile

Write-Host ''
Write-Host 'Local dev stack started.'
Write-Host "PID file: $pidFile"
Write-Host 'Logs:'
foreach ($proc in $processes) {
  Write-Host "  $($proc.name): pid=$($proc.pid)"
  Write-Host "    stdout: $($proc.stdout)"
  Write-Host "    stderr: $($proc.stderr)"
}
Write-Host ''
Write-Host 'Endpoints:'
Write-Host '  app:  http://localhost:5173'
Write-Host '  ops:  http://localhost:5173/ops'
Write-Host '  api:  http://localhost:3001'
Write-Host '  docs: http://localhost:3001/docs'
