@echo off
echo ========================================================
echo    Starting UrbanMove Backend (NO Docker)
echo ========================================================

cd /d "%~dp0"

REM Files from a downloaded GitHub zip are marked "from the internet" and can be
REM blocked by Windows. Unblock the scripts so PowerShell runs them.
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Filter *.ps1 | Unblock-File" >nul 2>&1

REM OneDrive can keep files cloud-only, which tools like nginx cannot open.
echo "%~dp0" | "%SystemRoot%\System32\find.exe" /i "OneDrive" >nul
if not errorlevel 1 (
    echo [!] This folder is inside OneDrive. If a service fails to start, move the
    echo     project to a plain folder like C:\local-storage-backend and run again.
    echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"

echo.
echo  Logs: logs-local.bat (backend)  /  logs-all-local.bat (all services)
echo  Stop: stop-local.bat
echo.

pause
