@echo off
setlocal
cd /d "%~dp0"

rem Clear the run-as-node flag that exists in this machine's environment
set ELECTRON_RUN_AS_NODE=

set NODE_DIR=D:\Plugins\node24.15.0
if exist "%NODE_DIR%\npm.cmd" set PATH=%NODE_DIR%;%PATH%

rem Build output and the official install location
set EXPORT_DIR=D:\Z_UserZYH\Projects\exports\opencode-dui
set SRC_DIR=%EXPORT_DIR%\win-unpacked
set DEST_DIR=D:\Softwares-self\opencode-dui

rem Set to 0 to skip creating the desktop shortcut
set CREATE_SHORTCUT=1

rem Refuse to update while the app is running
tasklist /FI "IMAGENAME eq opencode-dui.exe" 2>nul | find /I "opencode-dui.exe" >nul
if not errorlevel 1 (
  echo opencode-dui is still running. Close the app and run this again.
  pause
  exit /b 1
)

echo Building and packaging...
call npm.cmd run pack
if errorlevel 1 (
  echo Pack failed.
  pause
  exit /b 1
)

if not exist "%SRC_DIR%\opencode-dui.exe" (
  echo Packed output not found: %SRC_DIR%
  pause
  exit /b 1
)

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

echo Installing to %DEST_DIR% ...
rem /MIR mirrors the folder: files removed from the build are removed here too
robocopy "%SRC_DIR%" "%DEST_DIR%" /MIR /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
  echo Copy failed. Make sure no file in the target folder is in use.
  pause
  exit /b 1
)

if "%CREATE_SHORTCUT%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%USERPROFILE%\Desktop\opencode-dui.lnk'); $s.TargetPath='%DEST_DIR%\opencode-dui.exe'; $s.WorkingDirectory='%DEST_DIR%'; $s.Save()"
)

for /f %%v in ('node -p "require('./package.json').version"') do set APP_VERSION=%%v
echo.
echo Done. Version %APP_VERSION%
echo   %DEST_DIR%\opencode-dui.exe
pause
