@echo off
echo ========================================================
echo    Starting UrbanMove Backend (NO Docker)
echo ========================================================

cd /d "%~dp0"

REM Files from a downloaded GitHub zip are marked "from the internet" and can be
REM blocked by Windows. Unblock the scripts so PowerShell runs them.
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Filter *.ps1 | Unblock-File" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"

echo.
echo  Logs: logs-local.bat (backend)  /  logs-all-local.bat (all services)
echo  Stop: stop-local.bat
echo.

pause
