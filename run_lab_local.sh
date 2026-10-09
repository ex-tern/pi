#!/usr/bin/env bash
# Run ScholarPi locally with the Lab wired up the way production has it:
#   - HAL-OS's boot image built from ../HAL-OS (its own repository)
#   - private projects served from ../private (never inside this repo)
set -euo pipefail
cd "$(dirname "$0")"

python3 scripts/build_hal.py --src "${HAL_OS_DIR:-../HAL-OS}"

export PRIVATE_PROJECTS_DIR="${PRIVATE_PROJECTS_DIR:-$(cd .. && pwd)/private}"
# Owner sign-in needs a signing secret. A random one per run is fine locally:
# it only means signing in again after a restart.
export SESSION_SECRET="${SESSION_SECRET:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"

cd backend
exec python3 -m uvicorn api:app --host 127.0.0.1 --port "${PORT:-8000}"
