#!/bin/bash
# piii kiosk: turn a computer into one that boots straight into piii.app, full screen, and nothing else.
# (owner, 2026-10-17: "I want this mac run piii.app as os on it": an older Intel MacBook.)
#
# On a fresh Debian 12/13 (recommended) or Ubuntu 22.04+ install, as a user who can sudo:
#
#   sudo apt install -y git && git clone https://github.com/ex-tern/pi && cd pi
#   sudo bash back/kiosk/install.sh
#
# Then restart: the machine logs in by itself and opens piii.app. If piii.app closes or crashes it opens again.
#   * Wi-Fi:            before installing (or any time from the admin console), run  sudo nmtui
#   * Admin console:    Ctrl+Alt+F2 gives a normal text login; Ctrl+Alt+F1 goes back to piii.app
#   * Another address:  sudo PIII_URL=https://... bash back/kiosk/install.sh
#   * Undo:             sudo bash back/kiosk/install.sh --remove
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
URL="${PIII_URL:-https://www.piii.app/}"
KUSER=piii
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

if [[ "${1:-}" == "--remove" ]]; then
  rm -f /etc/systemd/system/getty@tty1.service.d/piii-kiosk.conf
  systemctl daemon-reload
  echo "The kiosk is off: tty1 asks for a login again from the next start. The user $KUSER is kept (sudo deluser --remove-home $KUSER removes it)."
  exit 0
fi

. /etc/os-release
say "Packages ($PRETTY_NAME)"
export DEBIAN_FRONTEND=noninteractive
if [[ "${ID:-}" == "debian" ]]; then
  # Debian keeps Wi-Fi drivers and firmware (Broadcom, as in MacBooks) in non-free and non-free-firmware
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do
    [[ -f "$f" ]] || continue
    sed -i -E '/^deb /{/non-free-firmware/!s/main( |$)/main contrib non-free non-free-firmware\1/}' "$f"
    sed -i -E '/^Components:/{/non-free-firmware/!s/main( |$)/main contrib non-free non-free-firmware\1/}' "$f"
  done
fi
apt-get update -q
apt-get install -y -q cage curl ca-certificates network-manager fonts-noto-core fonts-noto-color-emoji pciutils

# the browser: a real package where there is one (Debian: chromium); Ubuntu's chromium and firefox are snaps
BROWSER=""
if [[ "${ID:-}" == "debian" ]] && apt-get install -y -q chromium; then
  BROWSER="chromium"
elif apt-get install -y -q chromium-browser 2>/dev/null && command -v chromium-browser >/dev/null; then
  BROWSER="chromium-browser"
elif apt-get install -y -q firefox-esr 2>/dev/null || apt-get install -y -q firefox; then
  BROWSER="firefox"
fi
[[ -n "$BROWSER" ]] || { echo "No browser could be installed." >&2; exit 1; }

# MacBooks (and many laptops) have Broadcom Wi-Fi, which needs its own driver
if lspci -nn 2>/dev/null | grep -qi 'network controller.*broadcom'; then
  say "Wi-Fi driver (Broadcom)"
  apt-get install -y -q "linux-headers-$(uname -r)" || true
  if [[ "${ID:-}" == "debian" ]]; then
    apt-get install -y -q broadcom-sta-dkms || true
  else
    apt-get install -y -q bcmwl-kernel-source || true
  fi
fi
# the network: NetworkManager (Wi-Fi is set up with  sudo nmtui)
systemctl enable -q --now NetworkManager 2>/dev/null || true

say "The kiosk user"
id "$KUSER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --comment "piii kiosk" "$KUSER"
passwd -l "$KUSER" >/dev/null                 # no password: it only logs in by itself, on the first screen
for g in video render input audio; do getent group "$g" >/dev/null && usermod -aG "$g" "$KUSER"; done

case "$BROWSER" in
  firefox) CMD="firefox --kiosk --private-window \"\$URL\"" ;;
  *)       CMD="$BROWSER --kiosk --no-first-run --noerrdialogs --disable-infobars --disable-translate \
--disable-features=TranslateUI --check-for-update-interval=31536000 --overscroll-history-navigation=0 \
--ozone-platform-hint=auto --password-store=basic --app=\"\$URL\"" ;;
esac

H=/home/$KUSER
cat > "$H/piii-kiosk.sh" <<EOF
#!/bin/bash
# piii kiosk (written by back/kiosk/install.sh): piii.app full screen, opened again whenever it closes.
URL="$URL"
until curl -fsS -o /dev/null --max-time 5 "\$URL"; do
  clear; printf '\n\n   piii\n\n   Waiting for the internet...\n   (no Wi-Fi yet? Ctrl+Alt+F2, sign in, run: sudo nmtui)\n'
  sleep 3
done
while true; do
  cage -s -- $CMD
  sleep 1
done
EOF
cat > "$H/.bash_profile" <<'EOF'
# piii kiosk: on the first screen, piii.app; on any other (Ctrl+Alt+F2...), a normal shell
if [[ -z "${WAYLAND_DISPLAY:-}" && "$(tty)" == "/dev/tty1" ]]; then
  exec bash ~/piii-kiosk.sh
fi
EOF
chmod 755 "$H/piii-kiosk.sh"
chown "$KUSER:$KUSER" "$H/piii-kiosk.sh" "$H/.bash_profile"

say "Log in by itself on the first screen"
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/piii-kiosk.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KUSER --noclear %I \$TERM
EOF
# a graphical login screen, if the system has one, would take the first screen: boot to text instead
systemctl set-default multi-user.target >/dev/null
systemctl daemon-reload

say "Done"
cat <<EOF
Restart to start piii.app:   sudo reboot
  Wi-Fi           sudo nmtui   (now, or later from Ctrl+Alt+F2)
  Admin console   Ctrl+Alt+F2 (your own user), Ctrl+Alt+F1 back to piii.app
  Browser         $BROWSER, opening $URL
  Undo            sudo bash back/kiosk/install.sh --remove
EOF
