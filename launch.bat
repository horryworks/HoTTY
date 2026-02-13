@echo off
set "ELECTRON_RUN_AS_NODE="
echo ENV RUN_AS_NODE (batch): %ELECTRON_RUN_AS_NODE%
node_modules\electron\dist\electron.exe dist-electron/main/index.js
