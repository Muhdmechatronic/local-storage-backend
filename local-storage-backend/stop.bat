@echo off
cd /d "%~dp0"
echo Stopping all services (MinIO + Backend API + Nginx + Ngrok)...
docker compose down
echo.
echo ========================================================
echo All services stopped successfully!
echo ========================================================
