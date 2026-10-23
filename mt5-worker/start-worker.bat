@echo off
rem Runs the CapitalTrade MT5 sync worker from this folder's .venv.
rem Extra arguments are passed through, e.g. start-worker.bat --once
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo .venv not found. Create it first:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)
call ".venv\Scripts\activate.bat"
python worker.py %*
if errorlevel 1 pause
