#!/usr/bin/env bash
# ScholarPi — one-shot local setup + run (macOS / Linux).
set -e
cd "$(dirname "$0")/backend"

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
echo "Installing dependencies (first run only, this can take a few minutes)..."
pip install -q -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created backend/.env from .env.example — edit it to add your API keys."
fi

echo ""
echo "Starting ScholarPi at http://localhost:8000 ..."
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
