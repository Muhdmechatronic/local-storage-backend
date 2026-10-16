@echo off
cd /d "%~dp0"

echo ========================================================
echo    All Services Live Logs (NO Docker mode)
echo ========================================================
echo  Monitoring:
echo  - Backend API    (logs\backend.log)
echo  - MinIO Storage  (logs\minio.log)
echo  - Nginx Proxy    (logs\nginx.log + nginx error.log)
echo  - Ngrok Tunnel   (logs\ngrok.log)
echo ========================================================
echo  Press Ctrl+C to stop viewing logs
echo ========================================================
echo.

if not exist "logs" (
    echo No logs yet. Run start-local.bat first.
    pause
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0logs-all-local.ps1"

pause
