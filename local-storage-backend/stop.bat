@echo off
cd /d "%~dp0"
echo Stopping all services (MinIO + Backend API + Nginx + Ngrok)...

REM Docker mode
where docker >nul 2>&1
if not errorlevel 1 docker compose down 2>nul

REM No-Docker mode
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-local.ps1"

echo.
echo ========================================================
echo All services stopped successfully!
echo ========================================================
pause
