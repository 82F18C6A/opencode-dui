@echo off
cd /d "%~dp0"

rem Clear the run-as-node flag that exists in this machine's environment
set ELECTRON_RUN_AS_NODE=

set NODE_DIR=D:\Plugins\node24.15.0
if exist "%NODE_DIR%\npm.cmd" set PATH=%NODE_DIR%;%PATH%

set ELECTRON_EXE=D:\Plugins\electron-45.0.0\electron.exe

if not exist "%ELECTRON_EXE%" (
  echo Electron runtime not found:
  echo   %ELECTRON_EXE%
  pause
  exit /b 1
)

echo Building...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

start "" "%ELECTRON_EXE%" "%CD%"
exit /b 0
