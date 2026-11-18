@echo off
setlocal
title ChessPublisher - Local FIDE updater
cd /d "%~dp0"
echo.
echo Starting ChessPublisher local FIDE updater...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIDE-Update.ps1"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo The update did not finish successfully. See the messages above.
) else (
  echo The rating lists are ready in the fide folder.
)
echo.
pause
exit /b %EXITCODE%
