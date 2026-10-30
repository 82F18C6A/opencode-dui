@echo off
cd /d "%~dp0"

rem Clear the run-as-node flag that exists in this machine's environment
set ELECTRON_RUN_AS_NODE=

set NODE_DIR=D:\Plugins\node24.15.0
if exist "%NODE_DIR%\npm.cmd" set PATH=%NODE_DIR%;%PATH%

echo Starting opencode-gui (dev mode)...
echo If Windows Firewall asks, click Allow.
echo.

call npm.cmd run dev

echo.
echo Process exited. Press any key to close.
pause >nul
