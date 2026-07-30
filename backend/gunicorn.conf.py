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
# processes. Default to 2; raise via WEB_CONCURRENCY if you migrate to a
# server-based DB (Postgres, etc.) later.
workers = int(os.getenv("WEB_CONCURRENCY", "2"))

timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))  # PDF assessment can take a while
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

preload_app = False  # each worker loads its own PyTorch model state
