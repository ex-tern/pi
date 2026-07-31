#!/usr/bin/env bash
#
# Take ownership of the data directory, then drop privileges.
#
# A mounted volume arrives owned by root and REPLACES whatever the image
# prepared at that path, so the `chown` in the Dockerfile — which runs at build
# time — is undone the moment the volume appears. The container then starts as
# a non-root user that cannot write to its own data directory, and the worker
# dies at import with EACCES before serving a request.
#
# The fix has to run at container start, after the mount exists. This script is
# the only thing that runs as root: it prepares the directory, then execs the
# real command as the unprivileged user via gosu. `exec` matters — it replaces
# this shell so gunicorn keeps PID 1 and receives SIGTERM directly, which is
# what makes graceful shutdown and zero-downtime redeploys work.
set -euo pipefail

DATA_DIR="${SCHOLARPI_DATA_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/data}}"

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR/logs"
    # Only chown when it is actually wrong. On a large existing volume a
    # recursive chown on every boot is slow and pointless.
    if [ "$(stat -c '%U' "$DATA_DIR")" != "scholarpi" ]; then
        echo "[entrypoint] Taking ownership of $DATA_DIR"
        chown -R scholarpi:scholarpi "$DATA_DIR"
    fi
    exec gosu scholarpi "$@"
fi

# Already unprivileged (e.g. a platform that enforces its own user). Nothing to
# hand over — run in place rather than failing.
mkdir -p "$DATA_DIR/logs" 2>/dev/null || true
exec "$@"
