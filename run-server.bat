@echo off
setlocal

:menu
cls
echo Paisa local development server
echo.
echo 1. Start server
echo 2. Stop server
echo Q. Quit
echo.
choice /c 12Q /n /m "Choose an option: "
if errorlevel 3 exit /b
if errorlevel 2 goto stop
if errorlevel 1 goto start

:start
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
    echo Port 8000 is already in use; opening the local page.
) else (
    if not exist "%~dp0node_modules\vite\bin\vite.js" (
        echo Dependencies are missing. Run npm install in this folder first.
        pause
        goto menu
    )
    start "Paisa local server" /D "%~dp0" cmd /k "npm run dev"
    timeout /t 2 /nobreak >nul
)
start "" "http://localhost:8000/?refresh=%RANDOM%"
pause
goto menu

:stop
powershell -NoProfile -Command "$processIds = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if (-not $processIds) { Write-Host 'No server is listening on port 8000.' } else { foreach ($processId in $processIds) { Stop-Process -Id $processId -ErrorAction Stop; Write-Host ('Stopped server process ' + $processId) } }"
pause
goto menu
