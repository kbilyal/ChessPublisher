@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%"
echo chess-publisher DEBUG MODE
echo The console will remain visible. Close it only after chess-publisher exits.
echo.
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%ROOT%ChessPublisher-WebView.ps1" -ShowConsole
set "RC=%errorlevel%"
echo.
echo chess-publisher exited with code %RC%.
pause
exit /b %RC%
