@echo off
cd /d "%~dp0"
if not exist "src-tauri\target\release\hotty.exe" (
    echo Release binary not found. Building...
    set "PATH=%USERPROFILE%\.cargo\bin;C:\tmp\nasm\nasm-2.16.03;%PATH%"
    call npm run tauri:build
    if errorlevel 1 (
        echo Build failed.
        exit /b 1
    )
)
start "" "src-tauri\target\release\hotty.exe"
