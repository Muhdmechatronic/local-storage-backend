@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    Starting MinIO S3 Secure Storage Stack (Docker)
echo ========================================================

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

pause
