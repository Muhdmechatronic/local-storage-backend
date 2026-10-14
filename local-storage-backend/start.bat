@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================================
echo    UrbanMove Backend Launcher
echo ========================================================
echo.

REM No Docker installed -> go straight to no-Docker mode
where docker >nul 2>&1
if errorlevel 1 (
    echo Docker not found - starting WITHOUT Docker...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
    pause
    exit /b
)

echo   [1] With Docker
echo   [2] Without Docker  (lighter, for small laptops)
echo.
choice /c 12 /n /m "Choose 1 or 2: "

if errorlevel 2 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
)

pause
