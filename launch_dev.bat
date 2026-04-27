@echo off
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%LOCALAPPDATA%\bin\NASM;%PATH%"
npm run tauri:dev
