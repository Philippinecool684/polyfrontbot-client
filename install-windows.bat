@echo off
chcp 65001 >nul 2>&1
title Installing Dependencies

echo.
echo ========================================
echo    Checking Node.js installation...
echo ========================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from the official website:
    echo.
    echo     https://nodejs.org/
    echo.
    echo Download the LTS version and run the installer.
    echo After installation, restart this script.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js found: %NODE_VERSION%
echo.

echo ========================================
echo    Installing dependencies...
echo ========================================
echo.

npm install --no-audit --no-fund --loglevel=error

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to install dependencies!
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo    Installation completed!
echo ========================================
echo.
pause
