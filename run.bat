@echo off
REM ---------------------------------------------------------------------
REM  Monster Truck Madness - start the game.
REM
REM  Double-click this file. It checks Node is present and new enough,
REM  installs the dependencies the first time, then starts the dev server
REM  and opens your browser.
REM
REM  Leave the window open while you play; closing it stops the server.
REM ---------------------------------------------------------------------

setlocal enabledelayedexpansion

REM Run from this file's own folder, whatever directory it was launched from.
cd /d "%~dp0"

title Monster Truck Madness

echo.
echo   MONSTER TRUCK MADNESS
echo   =====================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js was not found on your PATH.
    echo.
    echo   Install the LTS build from https://nodejs.org/ then run this again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set "NODE_RAW=%%v"
set "NODE_NUM=!NODE_RAW:v=!"
for /f "tokens=1,2 delims=." %%a in ("!NODE_NUM!") do (
    set "NODE_MAJOR=%%a"
    set "NODE_MINOR=%%b"
)

REM Vite 8 needs Node 20.19 or newer.
set "TOO_OLD="
if !NODE_MAJOR! LSS 20 set "TOO_OLD=1"
if !NODE_MAJOR! EQU 20 if !NODE_MINOR! LSS 19 set "TOO_OLD=1"
if defined TOO_OLD (
    echo   Node !NODE_RAW! is too old - this needs 20.19 or newer.
    echo.
    echo   Update from https://nodejs.org/ then run this again.
    echo.
    pause
    exit /b 1
)

echo   Node !NODE_RAW! - ok

if not exist "node_modules" (
    echo.
    echo   First run, so installing dependencies. This takes a minute
    echo   and only happens once.
    echo.
    REM npm is a .cmd, so it needs CALL or it never returns to this script.
    call npm install
    if errorlevel 1 (
        echo.
        echo   npm install failed. The reason is above.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo   Starting at http://127.0.0.1:5173/
echo   Your browser should open by itself.
echo.
echo   Drop tracks, trucks and music into public\content and they
echo   appear without a restart. Close this window to stop.
echo.

call npm run dev -- --open

echo.
echo   The server has stopped.
pause
