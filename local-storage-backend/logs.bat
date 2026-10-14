@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    Live Docker Logs - No Rebuild
echo ========================================================
echo.

cd /d "%~dp0"

REM Check if services are running
docker-compose ps -q backend >nul 2>&1
if errorlevel 1 (
    echo Services not running. Starting services...
    docker-compose up -d
    echo.
    echo Waiting for services to start...
    timeout /t 5 /nobreak >nul
    echo.
) else (
    echo Services already running. Connecting to logs...
    echo.
)

echo ========================================================
echo  Showing live logs for:
echo  - Backend API (uploads, requests, errors)
echo  - Nginx Proxy (access logs)
echo ========================================================
echo  Press Ctrl+C to stop viewing logs
echo ========================================================
echo.

REM Follow logs for backend and nginx with timestamps
docker-compose logs -f --tail=50 backend nginx

pause
