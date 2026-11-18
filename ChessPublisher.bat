@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
start "" wscript.exe "%ROOT%ChessPublisher.vbs"
exit /b 0
