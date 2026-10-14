@echo off
cd /d "%~dp0"

echo ========================================================
echo    Backend API Live Logs (NO Docker mode)
echo ========================================================
echo  Other logs: logs\minio.log  logs\nginx.log  logs\ngrok.log
echo  Press Ctrl+C to stop viewing logs
echo ========================================================
echo.

if not exist "logs\backend.log" (
    echo No backend log yet. Run start-local.bat first.
    pause
    exit /b
)

powershell -NoProfile -Command "Get-Content -Path 'logs\backend.log' -Tail 100 -Wait"

pause
