@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    Backend API Live Logs - Upload Monitoring
echo ========================================================
echo.

cd /d "%~dp0"

REM Check if backend is running
docker-compose ps -q backend >nul 2>&1
if errorlevel 1 (
    echo Backend not running. Starting services...
    docker-compose up -d
    echo.
    echo Waiting for backend to start...
    timeout /t 5 /nobreak >nul
    echo.
) else (
    echo Backend running. Connecting to logs...
    echo.
)

echo ========================================================
echo  Monitoring: Backend API
echo  - User uploads
echo  - API requests
echo  - Errors and warnings
echo ========================================================
echo  Press Ctrl+C to stop viewing logs
echo ========================================================
echo.

REM Follow backend logs only with timestamps and color
docker-compose logs -f --tail=100 backend

pause
