@echo off
title Build Elegoo CC2 Cost Calculator Windows .EXE
cd /d "%~dp0"
echo Building standalone bundle and packaging Windows .exe ...
call npm install
call npm run build
call node scripts/build-offline.mjs
call npx --yes electron-packager . "Elegoo CC2 Cost Calculator" --platform=win32 --arch=x64 --out=dist-exe --overwrite
echo.
echo Done! Your standalone Windows .exe is inside the dist-exe folder.
pause
