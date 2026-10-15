#!/bin/bash
# Face Mace Server: install (or update) on a home Linux machine: Debian 12+, Ubuntu 22.04+, Raspberry Pi OS.
#
#   git clone https://github.com/ex-tern/pi && cd pi
#   sudo FMS_DOMAIN=photos.example.org FMS_ADMIN=yourname bash back/facemace-server/install.sh
#
# FMS_DOMAIN  the name this machine is reached at from the internet (a free one from duckdns.org works); the
#             router must send ports 80 and 443 (TCP) and 51820 (UDP) to this machine (see README.md)
# FMS_ADMIN   the owner's user name (asked for a password once, here)
#
# Run it again after `git pull` to update: the photos, accounts, keys and settings are kept.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
DOMAIN="${FMS_DOMAIN:-}"
[[ -n "$DOMAIN" ]] || { echo "Set FMS_DOMAIN to this machine's internet name, e.g. sudo FMS_DOMAIN=photos.example.org bash $0" >&2; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "FMS_DOMAIN looks wrong: $DOMAIN" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OPT=/opt/facemace
DATA=/var/lib/facemace
LIB=/usr/local/lib/facemace
WG_PORT="${FMS_WG_PORT:-51820}"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q wireguard-tools iptables iproute2 python3 python3-venv python3-pip sudo curl ca-certificates gnupg
if ! command -v caddy >/dev/null; then
  if ! apt-get install -y -q caddy 2>/dev/null; then
    # Caddy's own repository (Ubuntu 22.04 and others without it)
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q && apt-get install -y -q caddy
  fi
fi

say "The program"
id facemace >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin facemace
mkdir -p "$OPT/back" "$OPT/front" "$DATA/tmp" "$LIB"
rm -rf "$OPT/back/facemace-server" && cp -r "$REPO/back/facemace-server" "$OPT/back/"
for d in app facemace fonts; do rm -rf "$OPT/front/$d" && cp -r "$REPO/front/$d" "$OPT/front/"; done
cp "$REPO/front/icon.svg" "$OPT/front/"
chown -R facemace:facemace "$DATA"
chmod 750 "$DATA"
[[ -x "$OPT/venv/bin/python" ]] || python3 -m venv "$OPT/venv"
"$OPT/venv/bin/pip" install -q --upgrade pip
"$OPT/venv/bin/pip" install -q -r "$OPT/back/facemace-server/requirements.txt"

say "The VPN (WireGuard)"
install -m 755 "$REPO/back/facemace-server/fms-wg" "$LIB/fms-wg"
install -m 755 "$REPO/back/facemace-server/fms-fw" "$LIB/fms-fw"
echo "facemace ALL=(root) NOPASSWD: $LIB/fms-wg" > /etc/sudoers.d/facemace
chmod 440 /etc/sudoers.d/facemace
visudo -cf /etc/sudoers.d/facemace >/dev/null
mkdir -p /etc/wireguard && chmod 700 /etc/wireguard
if [[ ! -f /etc/wireguard/wg0.conf ]]; then
  umask 077
  KEY="$(wg genkey)"
  cat > /etc/wireguard/wg0.conf <<EOF
# Face Mace Server's VPN. The devices are added by the server itself (fms-wg); the firewall by fms-fw.
[Interface]
Address = 10.66.0.1/16
ListenPort = $WG_PORT
PrivateKey = $KEY
PostUp = $LIB/fms-fw up %i
PostDown = $LIB/fms-fw down %i
EOF
  umask 022
fi
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/90-facemace.conf
sysctl -q -p /etc/sysctl.d/90-facemace.conf
systemctl enable -q wg-quick@wg0
systemctl restart wg-quick@wg0

say "Settings"
if [[ ! -f /etc/facemace.env ]]; then
  cat > /etc/facemace.env <<EOF
FMS_DATA=$DATA
FMS_FRONT=$OPT/front
FMS_WG=on
FMS_WG_ENDPOINT=$DOMAIN:$WG_PORT
FMS_WG_DNS=1.1.1.1, 9.9.9.9
FMS_QUOTA_GB=20
FMS_MAX_DEVICES=5
TMPDIR=$DATA/tmp
EOF
fi
sed -i "s|^FMS_WG_ENDPOINT=.*|FMS_WG_ENDPOINT=$DOMAIN:$WG_PORT|" /etc/facemace.env
chmod 640 /etc/facemace.env && chgrp facemace /etc/facemace.env

say "The service"
cat > /etc/systemd/system/facemace.service <<EOF
[Unit]
Description=Face Mace Server (photos, sorted by face, and a VPN)
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
User=facemace
Group=facemace
EnvironmentFile=/etc/facemace.env
WorkingDirectory=$OPT/back/facemace-server
ExecStart=$OPT/venv/bin/uvicorn fmserver:app --host 127.0.0.1 --port 8770 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=on-failure
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q facemace
systemctl restart facemace

say "HTTPS (Caddy)"
cat > /etc/caddy/facemace.caddy <<EOF
# Face Mace Server (written by install.sh)
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 5GB
	}
	reverse_proxy 127.0.0.1:8770
}
# the same, privately, for devices on the VPN
http://10.66.0.1 {
	request_body {
		max_size 5GB
	}
	reverse_proxy 127.0.0.1:8770
}
EOF
CF=/etc/caddy/Caddyfile
if [[ ! -f "$CF" ]] || grep -q "root \* /usr/share/caddy" "$CF"; then
  echo "import /etc/caddy/facemace.caddy" > "$CF"           # the stock example page: replaced
elif ! grep -q "facemace.caddy" "$CF"; then
  echo "import /etc/caddy/facemace.caddy" >> "$CF"          # your own Caddyfile: Face Mace added to it
fi
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow "$WG_PORT/udp" >/dev/null
fi

say "The owner's account"
if [[ -n "${FMS_ADMIN:-}" ]]; then
  set -a; . /etc/facemace.env; set +a
  runuser -u facemace -- env FMS_DATA="$DATA" FMS_WG=off "$OPT/venv/bin/python" "$OPT/back/facemace-server/fmserver.py" create-admin "$FMS_ADMIN"
  systemctl restart facemace
else
  echo "No FMS_ADMIN given: make the owner's account with"
  echo "  sudo runuser -u facemace -- env FMS_DATA=$DATA FMS_WG=off $OPT/venv/bin/python $OPT/back/facemace-server/fmserver.py create-admin YOURNAME"
fi

say "Done"
cat <<EOF
Face Mace Server is running.
  Open        https://$DOMAIN   (sign in as the owner; new people sign up there, you approve them)
  On the VPN  http://10.66.0.1
  Router      send TCP 80 and 443, and UDP $WG_PORT, to this machine ($(hostname -I | awk '{print $1}'))
  Logs        journalctl -u facemace -f
  Update      git pull, then run this again
EOF
