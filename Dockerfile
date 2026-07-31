# ScholarPi — production image.
# Build:  docker build -t scholarpi .
# Run:    docker run -p 8000:8000 --env-file backend/.env -v scholarpi_data:/data scholarpi
FROM python:3.11-slim

# System deps: PyMuPDF and cryptography need a compiler + a few libs to
# build from source on some platforms; keep the image slim otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Persistent data (SQLite DB + PyTorch weights + logs) lives here, outside
# the image layer — mount a volume at /data in production.
ENV SCHOLARPI_DATA_DIR=/data
RUN mkdir -p /data

# Non-root user. Note there is deliberately no `USER scholarpi` here: the
# entrypoint must start as root so it can take ownership of a freshly mounted
# volume, and it drops to this user with gosu immediately afterwards. The
# build-time chown below covers /app and the image's own /data; a mounted
# volume replaces the latter and is handled at runtime instead.
RUN useradd --create-home --shell /bin/bash scholarpi \
    && chown -R scholarpi:scholarpi /app /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV ENVIRONMENT=production \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

WORKDIR /app/backend
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["gunicorn", "api:app", "-c", "gunicorn.conf.py"]
