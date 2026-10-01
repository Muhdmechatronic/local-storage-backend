# ==============================================================================
# MinIO S3 Local Storage & Ngrok Static Domain 1-Click Starter (PowerShell)
# ==============================================================================
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   Starting MinIO S3 Secure Storage Stack (Ngrok)..." -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Initialize .env if missing
$EnvFile = Join-Path $ScriptDir ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "[*] .env file not found. Generating default configuration..." -ForegroundColor Yellow
    $randomPass = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')).Substring(0, 24)
    $envContent = @"
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=$randomPass
MINIO_DEFAULT_BUCKET=app-images

# Ngrok Static Domain Config
NGROK_AUTHTOKEN=
NGROK_DOMAIN=
MINIO_SERVER_URL=https://api.your-tunnel.com
"@
    Set-Content -Path $EnvFile -Value $envContent
    Write-Host "[+] Created .env file." -ForegroundColor Green
}

# 2. Check for Ngrok Authtoken
$ngrokToken = ""
$ngrokDomain = ""
$user = "admin"
$pass = ""

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^MINIO_ROOT_USER=(.*)$') { $user = $matches[1].Trim() }
    if ($_ -match '^MINIO_ROOT_PASSWORD=(.*)$') { $pass = $matches[1].Trim() }
    if ($_ -match '^NGROK_AUTHTOKEN=(.*)$') { $ngrokToken = $matches[1].Trim() }
    if ($_ -match '^NGROK_DOMAIN=(.*)$') { $ngrokDomain = $matches[1].Trim() }
}

if ([string]::IsNullOrWhiteSpace($ngrokToken) -or $ngrokToken -eq "your_ngrok_authtoken_here") {
    Write-Host "[!] NGROK_AUTHTOKEN is not configured in .env!" -ForegroundColor Yellow
    Write-Host "    1. Sign up for free at: https://dashboard.ngrok.com/signup" -ForegroundColor Gray
    Write-Host "    2. Copy your token from: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Gray
    Write-Host "    3. Claim a free domain:  https://dashboard.ngrok.com/domains`n" -ForegroundColor Gray
    
    $inputToken = Read-Host "Paste your NGROK_AUTHTOKEN (or press Enter to configure in .env later)"
    if (-not [string]::IsNullOrWhiteSpace($inputToken)) {
        $ngrokToken = $inputToken.Trim()
        $inputDomain = Read-Host "Paste your free NGROK_DOMAIN (e.g. bold-cat-free.ngrok-free.app, or press Enter if none)"
        $ngrokDomain = $inputDomain.Trim()
        
        $currentEnv = Get-Content $EnvFile -Raw
        $updatedEnv = $currentEnv -replace 'NGROK_AUTHTOKEN=.*', "NGROK_AUTHTOKEN=$ngrokToken"
        $updatedEnv = $updatedEnv -replace 'NGROK_DOMAIN=.*', "NGROK_DOMAIN=$ngrokDomain"
        if ($ngrokDomain) {
            $updatedEnv = $updatedEnv -replace 'MINIO_SERVER_URL=.*', "MINIO_SERVER_URL=https://$ngrokDomain"
        }
        Set-Content -Path $EnvFile -Value $updatedEnv -NoNewline
        Write-Host "[+] Saved Ngrok credentials to .env`n" -ForegroundColor Green
    }
}

# Set environment variables for docker compose
$env:NGROK_AUTHTOKEN = $ngrokToken
$env:NGROK_DOMAIN = $ngrokDomain

# 3. Start Docker Containers
Write-Host "[*] Launching Docker Compose stack (minio, minio-init, ngrok-tunnel)..." -ForegroundColor Yellow
docker compose up -d --build

# 4. Determine Public Tunnel URL
Write-Host "[*] Waiting for Ngrok tunnel connection..." -ForegroundColor Yellow

$tunnelUrl = ""
if ($ngrokDomain) {
    $tunnelUrl = "https://$ngrokDomain"
} else {
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
            if ($response.tunnels -and $response.tunnels.Count -gt 0) {
                $tunnelUrl = $response.tunnels[0].public_url
                break
            }
        } catch {
            $logs = [string](cmd /c "docker logs minio-tunnel 2>&1")
            if ($logs -match 'url=(https://[a-zA-Z0-9-.]+\.ngrok[a-zA-Z0-9-.]*)') {
                $tunnelUrl = $matches[1]
                break
            }
        }
    }
}

if ($tunnelUrl) {
    Write-Host "[+] Ngrok Tunnel established: $tunnelUrl" -ForegroundColor Green
    
    # Update MINIO_SERVER_URL in .env
    $currentEnv = Get-Content $EnvFile -Raw
    $updatedEnv = $currentEnv -replace 'MINIO_SERVER_URL=.*', "MINIO_SERVER_URL=$tunnelUrl"
    Set-Content -Path $EnvFile -Value $updatedEnv -NoNewline
} else {
    if ([string]::IsNullOrWhiteSpace($ngrokToken)) {
        $tunnelUrl = "Disabled (Set NGROK_AUTHTOKEN in .env to activate)"
    } else {
        $tunnelUrl = "Starting up (Check http://localhost:4040)"
    }
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "   MinIO Storage Stack is RUNNING & READY!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Web Console]    : http://localhost:9001" -ForegroundColor Cyan
Write-Host " [Permanent S3 API]: $tunnelUrl" -ForegroundColor Cyan
Write-Host " [Ngrok Dashboard] : http://localhost:4040" -ForegroundColor Cyan
Write-Host " [Root User]      : $user" -ForegroundColor White
Write-Host " [Root Password]  : $pass" -ForegroundColor White
Write-Host " [Default Bucket] : app-images (Public Download Active)" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
Write-Host " [INFO] Containers are running in background." -ForegroundColor Yellow
Write-Host " To stop anytime, run: .\stop.ps1 or double-click stop.bat" -ForegroundColor Gray
Write-Host "========================================================`n" -ForegroundColor Green

# Optional: Prompt to follow logs or exit
$choice = Read-Host "Press [L] to stream live logs, or press [Enter] to exit launcher"
if ($choice -eq 'L' -or $choice -eq 'l') {
    Write-Host "`nStreaming live logs (Press Ctrl+C to stop viewing)...`n" -ForegroundColor Cyan
    docker compose logs -f
}
