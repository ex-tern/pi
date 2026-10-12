#!/usr/bin/env python3
"""Run ScholarPi locally, on macOS, Linux or Windows (Python only: no shell or batch scripts).

    python run.py          set up a virtual environment the first time, then serve http://localhost:8000
    python run.py --lab    the Lab wired as production has it: HAL-OS's boot image built from ../HAL-OS
                           (or $HAL_OS_DIR) and private projects served from ../private (or $PRIVATE_PROJECTS_DIR)
"""
import os, secrets, shutil, subprocess, sys, venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"


def venv_python() -> Path:
    env = BACKEND / "venv"
    py = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not py.exists():
        print("Creating virtual environment...")
        venv.create(env, with_pip=True)
        print("Installing dependencies (first run only, this can take a few minutes)...")
        subprocess.run([str(py), "-m", "pip", "install", "-q", "-r", str(BACKEND / "requirements.txt")], check=True)
    return py


def main() -> None:
    lab = "--lab" in sys.argv
    py = venv_python()
    env_file = BACKEND / ".env"
    if not env_file.exists() and (BACKEND / ".env.example").exists():
        shutil.copy(BACKEND / ".env.example", env_file)
        print("Created backend/.env from .env.example: edit it to add your API keys.")
    env = dict(os.environ)
    host, port = "0.0.0.0", env.get("PORT", "8000")
    args = ["--reload"]
    if lab:
        subprocess.run([str(py), str(ROOT / "scripts/build_hal.py"), "--src", env.get("HAL_OS_DIR", str(ROOT.parent / "HAL-OS"))], check=True)
        env.setdefault("PRIVATE_PROJECTS_DIR", str(ROOT.parent / "private"))
        env.setdefault("SESSION_SECRET", secrets.token_hex(32))   # owner sign-in needs one; a fresh one per run only means signing in again
        host, args = "127.0.0.1", []
    print(f"\nStarting ScholarPi at http://localhost:{port} ...")
    sys.exit(subprocess.call([str(py), "-m", "uvicorn", "api:app", "--host", host, "--port", port, *args], cwd=BACKEND, env=env))


if __name__ == "__main__":
    main()
