@echo off
echo Rebuilding all services...
docker-compose up --build -d
echo.
echo Waiting for services to start...
timeout /t 10 /nobreak >nul
echo.
echo Checking service status...
docker-compose ps
echo.
echo Testing backend API...
echo (Local direct): http://localhost:5000/api/health
echo (Via nginx): http://localhost:8080/api/health
curl http://localhost:8080/api/health
echo.
echo.
echo ========================================================
echo Services rebuilt and started!
echo ========================================================
echo Test the public API:
echo curl https://pending-handheld-zone.ngrok-free.dev/api/health
echo ========================================================
pause
