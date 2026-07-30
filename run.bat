@echo off
REM ScholarPi -- one-shot local setup + run (Windows).
cd /d "%~dp0backend"

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat
echo Installing dependencies (first run only, this can take a few minutes)...
pip install -q -r requirements.txt

if not exist .env (
    copy .env.example .env
    echo Created backend\.env from .env.example -- edit it to add your API keys.
)

echo.
echo Starting ScholarPi at http://localhost:8000 ...
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
