# ==============================================================================
# MinIO S3 Local Storage Stop Script (PowerShell)
# ==============================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "`nStopping MinIO Storage Stack..." -ForegroundColor Yellow
docker compose down
Write-Host "MinIO stack stopped successfully.`n" -ForegroundColor Green
