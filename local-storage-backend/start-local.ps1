# ==============================================================================
# UrbanMove Backend 1-Click Starter WITHOUT Docker (PowerShell)
# Downloads MinIO, mc, nginx and ngrok into .\tools on first run, then starts
# everything in the background. Logs go to .\logs, stop with stop-local.bat.
# ==============================================================================
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster on PowerShell 5
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$ToolsDir   = Join-Path $ScriptDir "tools"
$LogsDir    = Join-Path $ScriptDir "logs"
$BackendDir = Join-Path $ScriptDir "backend"
$EnvFile    = Join-Path $ScriptDir ".env"
$PidFile    = Join-Path $LogsDir "local-pids.txt"
New-Item -ItemType Directory -Force -Path $ToolsDir, $LogsDir | Out-Null

$NginxVersion = "1.26.2"
$MinioExe = Join-Path $ToolsDir "minio.exe"
$McExe    = Join-Path $ToolsDir "mc.exe"
$NgrokExe = Join-Path $ToolsDir "ngrok.exe"
$NginxDir = Join-Path $ToolsDir "nginx-$NginxVersion"
$NginxExe = Join-Path $NginxDir "nginx.exe"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   Starting UrbanMove Backend (NO Docker)" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# 1. Node.js
# ------------------------------------------------------------------------------
# No Node.js installed -> use a portable copy in .\tools\node (includes npm, no admin needed)
$NodeDir = Join-Path $ToolsDir "node"
if (Test-Path (Join-Path $NodeDir "node.exe")) {
    $env:Path = "$NodeDir;$env:Path"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[!] Node.js not found - downloading portable Node.js LTS (includes npm)..." -ForegroundColor Yellow
    $lts = (Invoke-RestMethod "https://nodejs.org/dist/index.json") | Where-Object { $_.lts } | Select-Object -First 1
    $nodeZip = Join-Path $ToolsDir "node.zip"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-win-x64.zip" -OutFile $nodeZip -UseBasicParsing
    Expand-Archive -Path $nodeZip -DestinationPath $ToolsDir -Force
    Remove-Item $nodeZip
    Rename-Item (Join-Path $ToolsDir "node-$($lts.version)-win-x64") $NodeDir
    $env:Path = "$NodeDir;$env:Path"
    Write-Host "[+] Node.js $($lts.version) ready (portable, in tools\node)." -ForegroundColor Green
}
Write-Host "[+] Using Node.js $(node --version), npm $(cmd /c npm --version)" -ForegroundColor Green

# ------------------------------------------------------------------------------
# 2. Download tools (first run only)
# ------------------------------------------------------------------------------
function Get-Tool($Name, $Url, $OutFile) {
    Write-Host "[*] Downloading $Name ..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
    Write-Host "[+] $Name downloaded." -ForegroundColor Green
}

# MinIO no longer publishes free binaries, so build them from source with a
# temporary portable Go (same as minio/Dockerfile). Go is deleted afterwards.
if (-not (Test-Path $MinioExe) -or -not (Test-Path $McExe)) {
    Write-Host "[*] Building MinIO from source (first run only, takes 5-15 minutes)..." -ForegroundColor Yellow
    $goTemp = Join-Path $ToolsDir "go-temp"
    $goVersion = (Invoke-RestMethod "https://go.dev/dl/?mode=json")[0].version
    $goZip = Join-Path $ToolsDir "go.zip"
    Get-Tool "Go $goVersion (temporary)" "https://go.dev/dl/$goVersion.windows-amd64.zip" $goZip
    Expand-Archive -Path $goZip -DestinationPath $goTemp -Force
    Remove-Item $goZip

    $env:GOROOT    = Join-Path $goTemp "go"
    $env:GOPATH    = Join-Path $goTemp "gopath"
    $env:GOCACHE   = Join-Path $goTemp "cache"
    $env:GOBIN     = $ToolsDir
    $env:GOTOOLCHAIN = "auto"
    $goExe = Join-Path $env:GOROOT "bin\go.exe"

    $ErrorActionPreference = "Continue"
    if (-not (Test-Path $MinioExe)) { Write-Host "[*] Compiling minio.exe ..." -ForegroundColor Yellow; & $goExe install github.com/minio/minio@latest }
    if (-not (Test-Path $McExe))    { Write-Host "[*] Compiling mc.exe ..." -ForegroundColor Yellow;    & $goExe install github.com/minio/mc@latest }
    $ErrorActionPreference = "Stop"

    # GOPATH module cache is read-only; clear the flag so it can be deleted
    cmd /c "attrib -R `"$goTemp\*`" /S /D >nul 2>&1"
    Remove-Item $goTemp -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $goTemp) { Start-Sleep -Seconds 3; Remove-Item $goTemp -Recurse -Force -ErrorAction SilentlyContinue }
    if (-not (Test-Path $MinioExe) -or -not (Test-Path $McExe)) {
        Write-Host "[!] MinIO build failed. Check your internet connection and run start-local.bat again." -ForegroundColor Red
        exit 1
    }
    Write-Host "[+] minio.exe and mc.exe built (Go removed)." -ForegroundColor Green
}
if (-not (Test-Path $NginxExe)) {
    $zip = Join-Path $ToolsDir "nginx.zip"
    Get-Tool "nginx $NginxVersion" "https://nginx.org/download/nginx-$NginxVersion.zip" $zip
    Expand-Archive -Path $zip -DestinationPath $ToolsDir -Force
    Remove-Item $zip
}
if (-not (Test-Path $NgrokExe)) {
    $zip = Join-Path $ToolsDir "ngrok.zip"
    Get-Tool "ngrok" "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" $zip
    Expand-Archive -Path $zip -DestinationPath $ToolsDir -Force
    Remove-Item $zip
}

# ------------------------------------------------------------------------------
# 3. .env
# ------------------------------------------------------------------------------
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $ScriptDir ".env.example") $EnvFile
    $randomPass = ([Guid]::NewGuid().ToString('N')).Substring(0, 24)
    (Get-Content $EnvFile -Raw) -replace 'MINIO_ROOT_PASSWORD=.*', "MINIO_ROOT_PASSWORD=$randomPass" |
        Set-Content $EnvFile -NoNewline
    Write-Host "[+] Created .env from .env.example (fill in GEMINI_API_KEY and FIREBASE_* later)." -ForegroundColor Green
}

function Read-EnvFile {
    $values = @{}
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $values[$matches[1]] = $matches[2].Trim().Trim('"')
        }
    }
    return $values
}
$cfg = Read-EnvFile

$ngrokToken = $cfg["NGROK_AUTHTOKEN"]
if ([string]::IsNullOrWhiteSpace($ngrokToken) -or $ngrokToken -eq "your_ngrok_authtoken_here") {
    Write-Host "[!] NGROK_AUTHTOKEN is not configured in .env!" -ForegroundColor Yellow
    Write-Host "    1. Sign up for free at: https://dashboard.ngrok.com/signup" -ForegroundColor Gray
    Write-Host "    2. Copy your token from: https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Gray
    Write-Host "    3. Claim a free domain:  https://dashboard.ngrok.com/domains`n" -ForegroundColor Gray
    $inputToken = Read-Host "Paste your NGROK_AUTHTOKEN (or press Enter to skip the public tunnel)"
    if (-not [string]::IsNullOrWhiteSpace($inputToken)) {
        $inputDomain = (Read-Host "Paste your free NGROK_DOMAIN (e.g. bold-cat.ngrok-free.app)").Trim()
        $updated = (Get-Content $EnvFile -Raw) -replace 'NGROK_AUTHTOKEN=.*', "NGROK_AUTHTOKEN=$($inputToken.Trim())"
        $updated = $updated -replace 'NGROK_DOMAIN=.*', "NGROK_DOMAIN=$inputDomain"
        if ($inputDomain) { $updated = $updated -replace 'MINIO_SERVER_URL=.*', "MINIO_SERVER_URL=https://$inputDomain" }
        Set-Content -Path $EnvFile -Value $updated -NoNewline
        Write-Host "[+] Saved Ngrok credentials to .env`n" -ForegroundColor Green
        $cfg = Read-EnvFile
    }
}

$user   = $cfg["MINIO_ROOT_USER"];      if (-not $user)   { $user = "admin" }
$pass   = $cfg["MINIO_ROOT_PASSWORD"]
$bucket = $cfg["MINIO_DEFAULT_BUCKET"]; if (-not $bucket) { $bucket = "app-images" }
$ngrokToken  = $cfg["NGROK_AUTHTOKEN"]
$ngrokDomain = $cfg["NGROK_DOMAIN"]
if ($ngrokDomain -eq "your-static-domain.ngrok-free.app") { $ngrokDomain = "" }

# Child processes inherit these (dotenv in the backend never overrides them)
$env:MINIO_ROOT_USER      = $user
$env:MINIO_ROOT_PASSWORD  = $pass
$env:MINIO_DEFAULT_BUCKET = $bucket
$env:MINIO_SERVER_URL     = $cfg["MINIO_SERVER_URL"]
$env:MINIO_ENDPOINT       = "127.0.0.1"
$env:MINIO_PORT           = "9000"
$env:BACKEND_PORT         = "3000"
$env:NGROK_AUTHTOKEN      = $ngrokToken

# ------------------------------------------------------------------------------
# 4. Port check (Docker stack or a previous run still holding the ports)
# ------------------------------------------------------------------------------
$busy = @(9000, 9001, 3000, 8080) | Where-Object {
    Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
}
if ($busy) {
    Write-Host "[!] Port(s) already in use: $($busy -join ', ')" -ForegroundColor Red
    Write-Host "    Run stop.bat first (stops both Docker and no-Docker modes), then try again." -ForegroundColor Gray
    exit 1
}

# ------------------------------------------------------------------------------
# 5. Backend dependencies (first run only)
# ------------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $BackendDir "node_modules"))) {
    Write-Host "[*] Installing backend packages (npm install)..." -ForegroundColor Yellow
    Push-Location $BackendDir
    cmd /c "npm install --omit=dev"
    Pop-Location
}

# ------------------------------------------------------------------------------
# 6. Start services in the background (each logs to .\logs\<name>.log)
# ------------------------------------------------------------------------------
$ErrorActionPreference = "Continue"
Remove-Item $PidFile -ErrorAction SilentlyContinue

function Start-LocalService($Name, $WorkDir, $Command) {
    $log = Join-Path $LogsDir "$Name.log"
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$Command >> `"$log`" 2>&1`"" `
        -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru
    Add-Content -Path $PidFile -Value $p.Id
    Write-Host "[+] $Name started (log: logs\$Name.log)" -ForegroundColor Green
}

function Wait-Url($Url, $Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { Start-Sleep -Seconds 1 }
    }
    return $false
}

$dataDir = Join-Path $ScriptDir "minio-data"
Start-LocalService "minio" $ScriptDir "`"$MinioExe`" server `"$dataDir`" --console-address :9001"
Write-Host "[*] Waiting for MinIO..." -ForegroundColor Yellow
if (-not (Wait-Url "http://127.0.0.1:9000/minio/health/live" 60)) {
    Write-Host "[!] MinIO did not start. Check logs\minio.log" -ForegroundColor Red
}

# Bucket setup (same as the Docker minio-init container)
$mcConfig = Join-Path $ToolsDir "mc-config"
& $McExe --config-dir $mcConfig alias set localminio http://127.0.0.1:9000 $user $pass | Out-Null
& $McExe --config-dir $mcConfig mb --ignore-existing "localminio/$bucket" | Out-Null
& $McExe --config-dir $mcConfig anonymous set download "localminio/$bucket" | Out-Null
Write-Host "[+] Bucket '$bucket' ready (public download)" -ForegroundColor Green

Start-LocalService "backend" $BackendDir "node server.js"
if (-not (Wait-Url "http://127.0.0.1:3000/api/health" 30)) {
    Write-Host "[!] Backend did not answer yet. Check logs\backend.log (missing GEMINI/FIREBASE keys in .env?)" -ForegroundColor Red
}

$nginxConf   = (Join-Path $ScriptDir "nginx\nginx.local.conf") -replace '\\', '/'
$nginxPrefix = ($NginxDir -replace '\\', '/') + "/"
Start-LocalService "nginx" $NginxDir "nginx.exe -p `"$nginxPrefix`" -c `"$nginxConf`""

$tunnelUrl = "Disabled (set NGROK_AUTHTOKEN in .env)"
if ($ngrokToken -and $ngrokToken -ne "your_ngrok_authtoken_here") {
    if ($ngrokDomain) {
        Start-LocalService "ngrok" $ToolsDir "ngrok.exe http --url=https://$ngrokDomain 8080 --log stdout"
        $tunnelUrl = "https://$ngrokDomain"
    } else {
        Start-LocalService "ngrok" $ToolsDir "ngrok.exe http 8080 --log stdout"
        $tunnelUrl = "Starting up (check http://localhost:4040)"
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Seconds 2
            try {
                $r = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
                if ($r.tunnels.Count -gt 0) { $tunnelUrl = $r.tunnels[0].public_url; break }
            } catch { }
        }
    }
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "   UrbanMove Backend is RUNNING (no Docker)" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Public URL]      : $tunnelUrl" -ForegroundColor Cyan
Write-Host " [Local API]       : http://localhost:8080/api/health" -ForegroundColor Cyan
Write-Host " [MinIO Console]   : http://localhost:9001" -ForegroundColor Cyan
Write-Host " [Ngrok Dashboard] : http://localhost:4040" -ForegroundColor Cyan
Write-Host " [Root User]       : $user" -ForegroundColor White
Write-Host " [Root Password]   : $pass" -ForegroundColor White
Write-Host " [Default Bucket]  : $bucket (Public Download Active)" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
Write-Host " Services keep running after you close this window." -ForegroundColor Yellow
Write-Host " Logs: logs-local.bat (backend) / logs-all-local.bat (all)    Stop: stop.bat" -ForegroundColor Gray
Write-Host "========================================================`n" -ForegroundColor Green
