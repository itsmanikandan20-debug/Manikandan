@echo off
title Design Agent
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Download the LTS version from https://nodejs.org
  echo  then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo.
  echo  First start: installing Design Agent. This takes about a minute...
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node server\launch.js --open
echo.
echo  Design Agent stopped.
pause
