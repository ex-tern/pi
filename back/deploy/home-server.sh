#!/bin/bash
# piii.app on your own computer (Ubuntu or Debian), run as Railway runs it, and reached from the internet through a
# Cloudflare Tunnel: the computer connects out to Cloudflare, so nothing is opened in the router.
# (owner, 2026-10-17: "can you use my home pc with ubuntu server on it as server for the site?"; "test first".)
#
#   sudo bash back/deploy/home-server.sh                       a test: a temporary https://….trycloudflare.com address
#   sudo PIII_SITE_PASSWORD=… bash back/deploy/home-server.sh  the same, behind a password (the site's own gate)
#   sudo PIII_TUNNEL_TOKEN=… bash back/deploy/home-server.sh   live: your own name (piii.app), through your tunnel
#   sudo bash back/deploy/home-server.sh --address             the test address again (it changes at each restart)
#   sudo bash back/deploy/home-server.sh --remove              stop and remove the services (data and settings kept)
#
# Run it again after `git pull` to update: the data (/var/lib/piii-site) and settings (/etc/piii-site.env) are kept.
# The site's keys (AI providers, ORCID, chain) go in /etc/piii-site.env, as on Railway; without them it still runs,
# with its own local model. Then: sudo systemctl restart piii-site
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OPT=/opt/piii-site
DATA=/var/lib/piii-site
ENVF=/etc/piii-site.env
PORT="${PIII_PORT:-8000}"
U=piiisite
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

address() {
  for _ in $(seq 1 60); do
    # only what the tunnel running now said (each start has a new address)
    inv="$(systemctl show -p InvocationID --value piii-site-tunnel 2>/dev/null || true)"
    a="$(journalctl _SYSTEMD_INVOCATION_ID="$inv" --no-pager -o cat 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | grep -v 'api\.trycloudflare' | tail -1 || true)"
    [[ -n "$a" ]] && { echo "$a"; return 0; }
    sleep 1
  done
  return 1
}

case "${1:-}" in
  --address)
    a="$(address)" && echo "piii.app on this computer: $a" || echo "No test address yet: journalctl -u piii-site-tunnel -n 50"
    exit 0 ;;
  --remove)
    systemctl disable --now piii-site-tunnel piii-site 2>/dev/null || true
    rm -f /etc/systemd/system/piii-site.service /etc/systemd/system/piii-site-tunnel.service
    systemctl daemon-reload
    echo "Removed the services. Kept: $DATA (the data), $ENVF (the settings), $OPT (the program)."
    echo "A live tunnel (cloudflared.service), if you made one: sudo cloudflared service uninstall"
    exit 0 ;;
esac

say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates

say "The program"
id "$U" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$U"
mkdir -p "$OPT" "$DATA"
rm -rf "$OPT/app" && mkdir -p "$OPT/app"
tar -C "$REPO" --exclude=.git --exclude=target --exclude=venv --exclude=node_modules --exclude=__pycache__ -cf - . | tar -C "$OPT/app" -xf -
chown -R "$U:$U" "$DATA"
chmod 750 "$DATA"

say "Python 3.11 (as on Railway) and the site's packages"
# Railway runs 3.11, and numpy 1.26 has no builds for the newest Python: uv fetches exactly 3.11
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh
fi
export UV_PYTHON_INSTALL_DIR="$OPT/python"
if ! { [[ -x "$OPT/venv/bin/python" ]] && "$OPT/venv/bin/python" -c 'import sys; sys.exit(sys.version_info[:2] != (3, 11))'; }; then
  rm -rf "$OPT/venv"
  uv venv -q --python 3.11 "$OPT/venv"
fi
uv pip install -q --python "$OPT/venv/bin/python" -r "$OPT/app/back/requirements.txt"
chmod -R a+rX "$OPT/python" "$OPT/venv"

say "Settings ($ENVF)"
if [[ ! -f "$ENVF" ]]; then
  # every setting the site knows, empty where it needs your keys (the same names as Railway's Variables)
  cp "$OPT/app/back/.env.example" "$ENVF"
  sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" "$ENVF"
fi
sed -i "/^SCHOLARPI_DATA_DIR=/d; /^PORT=/d" "$ENVF"
printf 'SCHOLARPI_DATA_DIR=%s\nPORT=%s\n' "$DATA" "$PORT" >> "$ENVF"
if [[ -n "${PIII_SITE_PASSWORD:-}" ]]; then
  sed -i "/^SITE_PASSWORD=/d" "$ENVF"
  printf 'SITE_PASSWORD=%s\n' "$PIII_SITE_PASSWORD" >> "$ENVF"
fi
chmod 640 "$ENVF" && chgrp "$U" "$ENVF"

say "The service (piii-site, on 127.0.0.1:$PORT)"
cat > /etc/systemd/system/piii-site.service <<EOF
[Unit]
Description=piii.app on this computer
After=network-online.target
Wants=network-online.target

[Service]
User=$U
Group=$U
EnvironmentFile=$ENVF
Environment=PYTHONUNBUFFERED=1
# only on this computer: the tunnel brings the visitors
Environment=GUNICORN_CMD_ARGS=--bind=127.0.0.1:$PORT
WorkingDirectory=$OPT/app
ExecStart=$OPT/venv/bin/gunicorn api:app -c back/gunicorn.conf.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q piii-site
systemctl restart piii-site
printf 'Starting'
ok=""
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health"; then ok=1; break; fi
  printf '.'; sleep 1
done
echo
if [[ -z "$ok" ]]; then
  echo "The site did not start. What it said:"
  journalctl -u piii-site -n 40 --no-pager -o cat
  exit 1
fi
echo "The site answers on http://127.0.0.1:$PORT"

say "Cloudflare Tunnel"
if ! command -v cloudflared >/dev/null; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch.deb"
  dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
fi
if [[ -n "${PIII_TUNNEL_TOKEN:-}" ]]; then
  # live: the tunnel made in Cloudflare (Zero Trust → Networks → Tunnels), its public name pointing at
  # http://localhost:PORT; the temporary one goes
  systemctl disable --now piii-site-tunnel 2>/dev/null || true
  rm -f /etc/systemd/system/piii-site-tunnel.service
  cloudflared service uninstall >/dev/null 2>&1 || true
  cloudflared service install "$PIII_TUNNEL_TOKEN"
  systemctl daemon-reload
  say "Done"
  echo "piii.app is served from this computer, through your Cloudflare tunnel (cloudflared.service)."
  echo "  Logs   journalctl -u piii-site -f     ·   journalctl -u cloudflared -f"
  exit 0
fi
cat > /etc/systemd/system/piii-site-tunnel.service <<EOF
[Unit]
Description=piii.app on this computer: a temporary public address (Cloudflare quick tunnel)
After=network-online.target piii-site.service
Wants=network-online.target

[Service]
User=$U
Group=$U
Environment=HOME=$DATA
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q piii-site-tunnel
systemctl restart piii-site-tunnel
a="$(address || true)"

say "Done"
cat <<EOF
piii.app is running on this computer.
  Open from anywhere   ${a:-(not ready yet: sudo bash back/deploy/home-server.sh --address)}
  On this computer     http://127.0.0.1:$PORT
  Password             ${PIII_SITE_PASSWORD:+set (SITE_PASSWORD in $ENVF)}${PIII_SITE_PASSWORD:-none (to add one: sudo PIII_SITE_PASSWORD=… bash back/deploy/home-server.sh)}
  Keys                 add them to $ENVF, then: sudo systemctl restart piii-site
  Logs                 journalctl -u piii-site -f
The test address is temporary: it changes when the tunnel restarts (--address shows it). This is a fresh copy with
its own empty data; www.piii.app on Railway is not touched.
EOF
