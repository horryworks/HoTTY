@echo off
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;C:\tmp\nasm\nasm-2.16.03;%PATH%"
npm run tauri:dev
