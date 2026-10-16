#!/bin/bash
# piii VPN: install (or update) your own VPN service on a Linux machine at home: Ubuntu Server 22.04+, Debian 12+,
# Raspberry Pi OS.
#
#   git clone https://github.com/ex-tern/pi && cd pi
#   sudo PVPN_DOMAIN=vpn.example.org PVPN_ADMIN=yourname bash back/vpn-server/install.sh
#
# PVPN_DOMAIN         the name this machine is reached at from the internet (a free one from duckdns.org works); the
#                     router must send ports 80 and 443 (TCP) and the VPN's port (UDP, 51820) to this machine
# PVPN_ADMIN          the owner's user name (asked for a password once, here)
# PVPN_DUCKDNS_TOKEN  optional: your DuckDNS token; the machine then keeps PVPN_DOMAIN pointed at your home itself
# PVPN_WG_PORT        optional: the VPN's UDP port (51820, or 51821 when Face Mace Server's VPN already has 51820)
#
# Run it again after `git pull` to update: accounts, keys, usage and settings are kept.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
DOMAIN="${PVPN_DOMAIN:-}"
[[ -n "$DOMAIN" ]] || { echo "Set PVPN_DOMAIN to this machine's internet name, e.g. sudo PVPN_DOMAIN=vpn.example.org bash $0" >&2; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "PVPN_DOMAIN looks wrong: $DOMAIN" >&2; exit 1; }
# a bare DuckDNS name ("yourname"): its whole name
[[ "$DOMAIN" == *.* ]] || { DOMAIN="$DOMAIN.duckdns.org"; echo "Using $DOMAIN"; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OPT=/opt/piiivpn
DATA=/var/lib/piiivpn
LIB=/usr/local/lib/piiivpn
IF=pvpn0
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# the VPN's port: kept from an earlier install; else 51820, unless another WireGuard here has it
if [[ -f /etc/wireguard/$IF.conf ]]; then
  WG_PORT="${PVPN_WG_PORT:-$(awk -F' *= *' '/^ListenPort/ {print $2}' /etc/wireguard/$IF.conf)}"
elif [[ -n "${PVPN_WG_PORT:-}" ]]; then
  WG_PORT="$PVPN_WG_PORT"
elif grep -qs "^ListenPort *= *51820" /etc/wireguard/*.conf; then
  WG_PORT=51821
else
  WG_PORT=51820
fi
[[ "$WG_PORT" =~ ^[0-9]+$ ]] || { echo "PVPN_WG_PORT looks wrong: $WG_PORT" >&2; exit 1; }

if [[ -f /etc/caddy/facemace.caddy ]] && grep -q "^$DOMAIN {" /etc/caddy/facemace.caddy; then
  echo "Face Mace Server already answers at $DOMAIN: give piii VPN its own name (a second DuckDNS name is free)." >&2
  exit 1
fi

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
id piiivpn >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin piiivpn
mkdir -p "$OPT" "$DATA" "$LIB"
rm -rf "$OPT/app" && cp -r "$REPO/back/vpn-server" "$OPT/app"
chown -R piiivpn:piiivpn "$DATA"
chmod 750 "$DATA"
[[ -x "$OPT/venv/bin/python" ]] || python3 -m venv "$OPT/venv"
"$OPT/venv/bin/pip" install -q --upgrade pip
"$OPT/venv/bin/pip" install -q -r "$OPT/app/requirements.txt"

say "The VPN (WireGuard, UDP $WG_PORT)"
install -m 755 "$REPO/back/vpn-server/pvpn-wg" "$LIB/pvpn-wg"
install -m 755 "$REPO/back/vpn-server/pvpn-fw" "$LIB/pvpn-fw"
# run through bash, so it works where scripts in /usr/local cannot be run directly (noexec mounts, hardening)
echo "piiivpn ALL=(root) NOPASSWD: /bin/bash $LIB/pvpn-wg *" > /etc/sudoers.d/piiivpn
chmod 440 /etc/sudoers.d/piiivpn
visudo -cf /etc/sudoers.d/piiivpn >/dev/null
mkdir -p /etc/wireguard && chmod 700 /etc/wireguard
if [[ ! -f /etc/wireguard/$IF.conf ]]; then
  umask 077
  KEY="$(wg genkey)"
  cat > /etc/wireguard/$IF.conf <<EOF
# piii VPN. Devices are added by the server itself (pvpn-wg); the firewall by piiivpn-fw.service (pvpn-fw).
[Interface]
Address = 10.77.0.1/16
ListenPort = $WG_PORT
PrivateKey = $KEY
EOF
  umask 022
fi
sed -i "s|^ListenPort *=.*|ListenPort = $WG_PORT|" /etc/wireguard/$IF.conf
# an earlier install ran the firewall from WireGuard's PostUp, which Ubuntu's AppArmor profile for wg-quick
# forbids on newer releases: it is its own service now (below)
sed -i -E "/^(PostUp|PostDown) *=.*pvpn-fw/d" /etc/wireguard/$IF.conf
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/90-piiivpn.conf
sysctl -q -p /etc/sysctl.d/90-piiivpn.conf
# the firewall: its own service, up right after the VPN and down with it
cat > /etc/systemd/system/piiivpn-fw.service <<EOF
[Unit]
Description=piii VPN firewall (devices reach the internet only)
After=wg-quick@$IF.service
BindsTo=wg-quick@$IF.service
PartOf=wg-quick@$IF.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash $LIB/pvpn-fw up $IF
ExecStop=/bin/bash $LIB/pvpn-fw down $IF

[Install]
WantedBy=wg-quick@$IF.service
EOF
systemctl daemon-reload
systemctl enable -q wg-quick@$IF
systemctl enable -q piiivpn-fw
if ! systemctl restart wg-quick@$IF || ! systemctl restart piiivpn-fw; then
  echo; echo "The VPN did not start. What it said:"
  journalctl -u wg-quick@$IF -u piiivpn-fw -n 25 --no-pager -o cat || true
  if ! modprobe wireguard 2>/dev/null; then
    echo; echo "This kernel has no WireGuard module. Install it with:  sudo apt install linux-generic  (then reboot and run this again)"
  fi
  exit 1
fi

say "Settings"
if [[ ! -f /etc/piiivpn.env ]]; then
  cat > /etc/piiivpn.env <<EOF
PVPN_DATA=$DATA
PVPN_WG=on
PVPN_WG_ENDPOINT=$DOMAIN:$WG_PORT
PVPN_WG_DNS="1.1.1.1, 9.9.9.9"
EOF
fi
sed -i "s|^PVPN_WG_ENDPOINT=.*|PVPN_WG_ENDPOINT=$DOMAIN:$WG_PORT|" /etc/piiivpn.env
# a value with a space must be quoted (an earlier install wrote it bare)
sed -i -E 's/^PVPN_WG_DNS=([^"].*)$/PVPN_WG_DNS="\1"/' /etc/piiivpn.env
chmod 640 /etc/piiivpn.env && chgrp piiivpn /etc/piiivpn.env

say "The service"
cat > /etc/systemd/system/piiivpn.service <<EOF
[Unit]
Description=piii VPN (your own VPN service)
After=network-online.target wg-quick@$IF.service
Wants=network-online.target

[Service]
User=piiivpn
Group=piiivpn
EnvironmentFile=/etc/piiivpn.env
WorkingDirectory=$OPT/app
ExecStart=$OPT/venv/bin/uvicorn pvpn:app --host 127.0.0.1 --port 8771 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=on-failure
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
# the command for the owner: sudo piiivpn status | invite | create-admin NAME | sync
cat > /usr/local/bin/piiivpn <<EOF
#!/bin/bash
[[ \$EUID -eq 0 ]] || exec sudo "\$0" "\$@"
set -a; . /etc/piiivpn.env; set +a
cd $OPT/app && exec runuser -u piiivpn -- env PVPN_DATA="\$PVPN_DATA" PVPN_WG="\$PVPN_WG" PVPN_WG_ENDPOINT="\$PVPN_WG_ENDPOINT" PVPN_WG_DNS="\$PVPN_WG_DNS" PVPN_ADMIN_PASSWORD="\${PVPN_ADMIN_PASSWORD:-}" $OPT/venv/bin/python pvpn.py "\$@"
EOF
chmod 755 /usr/local/bin/piiivpn
systemctl daemon-reload
systemctl enable -q piiivpn
systemctl restart piiivpn

say "HTTPS (Caddy)"
cat > /etc/caddy/piiivpn.caddy <<EOF
# piii VPN (written by install.sh)
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8771
}
# the same, privately, for devices on the VPN
http://10.77.0.1 {
	reverse_proxy 127.0.0.1:8771
}
EOF
CF=/etc/caddy/Caddyfile
if [[ ! -f "$CF" ]] || grep -q "root \* /usr/share/caddy" "$CF"; then
  echo "import /etc/caddy/piiivpn.caddy" > "$CF"            # the stock example page: replaced
  [[ -f /etc/caddy/facemace.caddy ]] && echo "import /etc/caddy/facemace.caddy" >> "$CF"
elif ! grep -q "piiivpn.caddy" "$CF"; then
  echo "import /etc/caddy/piiivpn.caddy" >> "$CF"           # your own Caddyfile: piii VPN added to it
fi
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow "$WG_PORT/udp" >/dev/null
  # ufw drops forwarded traffic by default; the VPN's own rules come first, so nothing more is needed here
fi

if [[ -n "${PVPN_DUCKDNS_TOKEN:-}" ]]; then
  say "Dynamic DNS (DuckDNS)"
  SUB="${DOMAIN%.duckdns.org}"
  [[ "$SUB" != "$DOMAIN" ]] || { echo "PVPN_DUCKDNS_TOKEN given, but $DOMAIN is not a duckdns.org name: skipped." >&2; }
  if [[ "$SUB" != "$DOMAIN" ]]; then
    umask 077
    echo "url=\"https://www.duckdns.org/update?domains=$SUB&token=$PVPN_DUCKDNS_TOKEN&ip=\"" > /etc/piiivpn-duckdns.curl
    umask 022
    cat > /etc/systemd/system/piiivpn-duckdns.service <<EOF
[Unit]
Description=piii VPN: point $DOMAIN at this home
[Service]
Type=oneshot
ExecStart=/usr/bin/curl -sS -K /etc/piiivpn-duckdns.curl
EOF
    cat > /etc/systemd/system/piiivpn-duckdns.timer <<EOF
[Unit]
Description=piii VPN: keep $DOMAIN pointed at this home
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable -q --now piiivpn-duckdns.timer
    systemctl start piiivpn-duckdns.service || true
  fi
fi

say "The owner's account"
if [[ -n "${PVPN_ADMIN:-}" ]]; then
  /usr/local/bin/piiivpn create-admin "$PVPN_ADMIN"
  systemctl restart piiivpn
else
  echo "No PVPN_ADMIN given: make the owner's account with   sudo piiivpn create-admin YOURNAME"
fi

say "Checks"
PUBLIC_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org || true)"
NAME_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
echo "  This home's internet address: ${PUBLIC_IP:-unknown}"
echo "  $DOMAIN points at:            ${NAME_IP:-nothing yet}"
if [[ -n "$PUBLIC_IP" && -n "$NAME_IP" && "$PUBLIC_IP" != "$NAME_IP" ]]; then
  echo "  !! They differ: point $DOMAIN at $PUBLIC_IP (DuckDNS: set PVPN_DUCKDNS_TOKEN and run this again)."
fi
case "$PUBLIC_IP" in
  100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*)
    echo "  !! Your provider shares one address among many homes (CGNAT): ports cannot be opened. Ask them for a public IPv4." ;;
esac

say "Done"
cat <<EOF
piii VPN is running.
  Open        https://$DOMAIN    (sign in as the owner), or on piii.app: Tools → piii VPN, server $DOMAIN
  Router      send TCP 80 and 443, and UDP $WG_PORT, to this machine ($(hostname -I | awk '{print $1}'))
  Owner       sudo piiivpn status   ·   sudo piiivpn invite 50 3 30   (50 GB a month, 3 devices, 30 days)
  Logs        journalctl -u piiivpn -f
  Update      git pull, then run this again
EOF
