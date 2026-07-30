"""
Gunicorn config for production. Run from backend/:
    gunicorn api:app -c gunicorn.conf.py

Overridable via environment variables so the same image works across
different instance sizes without an edit.
"""
import multiprocessing
import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
worker_class = "uvicorn.workers.UvicornWorker"

# SQLite (even in WAL mode) is happiest with a small number of writer
# processes, and this app loads a full copy of PyTorch into every worker
# process — on a memory-constrained host (e.g. Render's free 512MB tier),
# more than 1 worker will OOM. Default to 1; raise via WEB_CONCURRENCY only
# once you've confirmed the host has enough RAM to spare (roughly 300-400MB
# per additional worker).
workers = int(os.getenv("WEB_CONCURRENCY", "1"))

timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))  # PDF assessment can take a while
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

preload_app = False  # each worker loads its own PyTorch model state
