# ==============================================================================
# MinIO S3 Local Storage & Cloudflare Tunnel 1-Click Starter (PowerShell)
# ==============================================================================
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   Starting MinIO S3 Secure Storage Stack (Docker)..." -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Initialize .env if missing
$EnvFile = Join-Path $ScriptDir ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "[*] .env file not found. Generating secure credentials..." -ForegroundColor Yellow
    $randomPass = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')).Substring(0, 24)
    $envContent = @"
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=$randomPass
MINIO_SERVER_URL=https://api.your-tunnel.com
MINIO_DEFAULT_BUCKET=app-images
"@
    Set-Content -Path $EnvFile -Value $envContent
    Write-Host "[+] Created .env with auto-generated root password." -ForegroundColor Green
}

# 2. Start Docker Containers
Write-Host "[*] Launching Docker Compose stack (minio, minio-init, tunnel)..." -ForegroundColor Yellow
docker compose up -d --build

# 3. Wait for services and tunnel URL
Write-Host "[*] Waiting for tunnel connection and bucket auto-initialization..." -ForegroundColor Yellow

$tunnelUrl = ""
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    $logs = [string](cmd /c "docker logs minio-tunnel 2>&1")
    if ($logs -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
        $tunnelUrl = $matches[0]
        break
    }
}

if ($tunnelUrl) {
    Write-Host "[+] Cloudflare Tunnel established: $tunnelUrl" -ForegroundColor Green
    
    # Update MINIO_SERVER_URL in .env if changed
    $currentEnv = Get-Content $EnvFile -Raw
    $updatedEnv = $currentEnv -replace 'MINIO_SERVER_URL=.*', "MINIO_SERVER_URL=$tunnelUrl"
    Set-Content -Path $EnvFile -Value $updatedEnv -NoNewline
} else {
    Write-Host "[!] Tunnel is starting up. Check 'docker logs minio-tunnel' shortly." -ForegroundColor Yellow
    $tunnelUrl = "Check 'docker logs minio-tunnel'"
}

# Read credentials from .env
$user = "admin"
$pass = ""
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^MINIO_ROOT_USER=(.*)$') { $user = $matches[1].Trim() }
    if ($_ -match '^MINIO_ROOT_PASSWORD=(.*)$') { $pass = $matches[1].Trim() }
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "   MinIO Storage Stack is RUNNING & READY!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Web Console]   : http://localhost:9001" -ForegroundColor Cyan
Write-Host " [Public S3 API] : $tunnelUrl" -ForegroundColor Cyan
Write-Host " [Root User]     : $user" -ForegroundColor White
Write-Host " [Root Password] : $pass" -ForegroundColor White
Write-Host " [Default Bucket]: app-images (Public Download Active)" -ForegroundColor White
Write-Host "========================================================`n" -ForegroundColor Green
