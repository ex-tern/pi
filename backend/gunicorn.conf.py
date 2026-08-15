"""
Gunicorn config for production.

    gunicorn api:app -c backend/gunicorn.conf.py     (from the repo root)
    gunicorn api:app -c gunicorn.conf.py             (from backend/)

Both work because this file locates itself and chdirs there. That matters
because the backend modules import each other flatly (`from config import ...`),
so the process must run with backend/ as its working directory — and platforms
launch the start command from the repository root.

Doing it here rather than in the start command also avoids needing a shell.
Railway executes the start command directly, with no shell to interpret it, so
a command beginning `cd backend && ...` fails with "The executable `cd` could
not be found" — `cd` is a shell builtin, not a program.

Overridable via environment variables so the same config works across
different instance sizes without an edit.
"""
import os

# Absolute path to backend/, derived from this file's own location.
chdir = os.path.dirname(os.path.abspath(__file__))
# Also on sys.path, so the flat imports resolve regardless of how the
# interpreter was started.
pythonpath = chdir

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
worker_class = "uvicorn.workers.UvicornWorker"

# SQLite (even in WAL mode) is happiest with a small number of writer
# processes, and this app loads a full copy of PyTorch into every worker
# process — on a memory-constrained host (e.g. Render's free 512MB tier),
# more than 1 worker will OOM. Default to 1; raise via WEB_CONCURRENCY only
# once you've confirmed the host has enough RAM to spare (roughly 300-400MB
# per additional worker).
workers = int(os.getenv("WEB_CONCURRENCY", "1"))

# One paper can legitimately occupy a worker for minutes: extraction, then the
# model panel (bounded by PANEL_BUDGET_SECONDS), then enrichment. 120s was
# under that ceiling, so a slow-but-healthy assessment could be killed by the
# arbiter mid-request and reach the browser as a bare "network error".
#
# The stream also heartbeats every few seconds now, which keeps intermediaries
# from reaping the connection — but the two are separate protections: a
# heartbeat cannot stop gunicorn's own arbiter from reaping the worker.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "300"))
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

preload_app = False  # each worker loads its own PyTorch model state
