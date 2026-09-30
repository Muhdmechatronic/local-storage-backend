@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    Starting MinIO S3 Secure Storage Stack (Docker)
echo ========================================================

cd /d "%~dp0"

REM 1. Check if .env exists, create if missing
if not exist .env (
    echo [*] .env file not found. Creating default .env...
    powershell -NoProfile -Command ".\start.ps1"
    goto end
)

REM 2. Run PowerShell runner to manage lifecycle and output URLs cleanly
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

:end
