@echo off
REM ============================================================
REM  Recording helper for the demo video (thin launcher).
REM  Runs one shot's exact command sequence so nothing has to be
REM  typed or pasted while recording.
REM
REM  Usage:  run-record-step.bat 1   (uninstall, show 21/57)
REM          run-record-step.bat 2   (install, show 22/58)
REM          run-record-step.bat 3   (run the simulation)
REM          run-record-step.bat 4   (self-checks + git history)
REM
REM  ASCII-only on purpose: cmd.exe mangles non-ASCII batch files.
REM ============================================================

setlocal
set "SHOT=%~1"
set "PS1=%~dp0run-record-step.ps1"

if not exist "%PS1%" (
  echo [ERROR] run-record-step.ps1 not found next to this file.
  echo         Expected: %PS1%
  pause
  exit /b 1
)

if "%SHOT%"=="" (
  echo.
  echo Usage: run-record-step.bat ^<1^|2^|3^|4^>
  echo.
  echo   1  uninstall the skill, then list upstream capabilities   ^(21/57^)
  echo   2  install the skill back                                   ^(22/58^)
  echo   3  run the simulation and show the result
  echo   4  run self-checks and show commit history
  echo.
  pause
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %SHOT%
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
