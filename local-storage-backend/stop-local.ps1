# ==============================================================================
# Stop the no-Docker stack started by start-local.ps1
# ==============================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsDir  = Join-Path $ScriptDir "tools"
$PidFile   = Join-Path $ScriptDir "logs\local-pids.txt"

Write-Host "`nStopping no-Docker services (MinIO + Backend + Nginx + Ngrok)..." -ForegroundColor Yellow

# Kill each launcher cmd.exe and everything it started (/T = whole process tree)
if (Test-Path $PidFile) {
    Get-Content $PidFile | ForEach-Object {
        if ($_ -match '^\d+$') { taskkill /F /T /PID $_ 2>&1 | Out-Null }
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

# Safety net: anything still running from .\tools
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($ToolsDir, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "No-Docker services stopped.`n" -ForegroundColor Green
