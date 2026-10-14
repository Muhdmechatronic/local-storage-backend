@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    All Services Live Logs - Full Stack Monitoring
echo ========================================================
echo.

cd /d "%~dp0"

REM Check if services are running
docker-compose ps -q >nul 2>&1
if errorlevel 1 (
    echo Services not running. Starting all services...
    docker-compose up -d
    echo.
    echo Waiting for services to start...
    timeout /t 5 /nobreak >nul
    echo.
) else (
    echo Services running. Connecting to logs...
    echo.
)

echo ========================================================
echo  Monitoring All Services:
echo  - Backend API
echo  - MinIO Storage
echo  - Nginx Proxy
echo  - Ngrok Tunnel
echo ========================================================
echo  Press Ctrl+C to stop viewing logs
echo ========================================================
echo.

REM Follow all service logs with timestamps
docker-compose logs -f --tail=50

pause
