# piii VPN

Your own VPN service, from a Linux machine at home. People get accounts, add their phones and computers, and all
their internet goes through your machine, encrypted (WireGuard). You decide who gets in and how much each may use.

You and your users manage it on **piii.app → Tools → piii VPN** (type your server's name once), or on the server's
own page at `https://your-name`. Both show the same thing.

- **Joining.** People sign up and you approve them, or you give them an **invite code** that lets them in at once
  with a plan, or you open sign-up to everyone.
- **Plans.** Per person: data a month (or unlimited), how many devices, and, if you like, the date access ends.
  Over the data or past the date, that person's devices are cut off by themselves. Data comes back on the 1st of the
  month; extend a date with one click.
- **Devices.** Each device gets a QR code (for a phone) or a file (for a computer) for the free WireGuard app. Its
  key is made for it and shown once; the server does not keep it.
- **Usage.** Data per device and per person per month, who is connected now, and from where.
- **Safety.** Devices reach the internet only: not your home network, not each other, and on this machine only its
  web page. The part that changes the VPN is a small script that runs as root for a few checked commands; everything
  else runs as its own user.

The browser is where you manage it; the tunnel itself is the WireGuard app on each device (a web page cannot carry a
whole device's internet).

## What you need

1. **The machine.** Ubuntu Server 22.04 or newer (also Debian 12+, Raspberry Pi OS), on all the time, wired to your
   router if you can.
2. **A name for your home.** Your home address usually changes, so make a free dynamic-DNS name, e.g. at
   [duckdns.org](https://www.duckdns.org) make `yourname.duckdns.org`. Copy its token: the installer keeps the name
   pointed at your home by itself.
3. **Ports opened in your router** (*port forwarding*), all to the machine's local address (the installer prints it):

   | Port | For |
   |---|---|
   | 80 TCP | the HTTPS certificate (Let's Encrypt, automatic) |
   | 443 TCP | the page, and piii.app talking to your server |
   | 51820 UDP | the VPN (51821 if Face Mace Server's VPN is on the same machine) |

4. **A real public address.** Some providers share one address among many homes (*CGNAT*); then ports cannot be
   opened. The installer checks this and tells you. If so, ask your provider for a public IPv4 address.

## Install

On the machine:

```bash
git clone https://github.com/ex-tern/pi && cd pi
sudo PVPN_DOMAIN=yourname.duckdns.org PVPN_ADMIN=yourname PVPN_DUCKDNS_TOKEN=your-token bash back/vpn-server/install.sh
```

It asks once for your password, then sets up WireGuard, the firewall, the service and HTTPS (Caddy), and checks that
your name points at your home. Then open **piii.app → Tools → piii VPN**, type `yourname.duckdns.org`, and sign in.

**To update:** `git pull`, then the same command again. Accounts, keys, usage and settings are kept.

## Running it

- **Invite someone:** *Invite codes* → choose the plan → *Make a code* → *Copy link*, and send it. Or on the machine:
  `sudo piiivpn invite 50 3 30` (50 GB a month, 3 devices, 30 days; `0` means unlimited / no end).
- **Approve someone** who signed up: *People* → *Approve*.
- **Change a plan:** type the GB or devices in their row; *+30 d* extends access; *Reset month* clears this month's
  count.
- **Cut someone off:** *Turn off* (devices stop at once and they are signed out) or *Delete*.
- **See everything on the machine:** `sudo piiivpn status`.
- **Join without approval / invite only / open:** *Settings* → *How people join*.

## Before you let others in

Everyone's traffic leaves from **your** home connection: what they do online looks as if it came from you, and
abuse reports would come to you. Some providers' terms also forbid sharing your connection. Let in only people you
trust. Your upload speed is everyone's download speed through the VPN, so a few people at a time is what a home line
does well.

Devices send IPv6 into the tunnel too, where it stops: nothing leaks around the VPN, and sites fall back to IPv4.

## Files and settings

| What | Where |
|---|---|
| Accounts, devices, usage (SQLite) | `/var/lib/piiivpn` |
| Settings (public name, DNS for devices) | `/etc/piiivpn.env`, then `sudo systemctl restart piiivpn` |
| The VPN | `/etc/wireguard/pvpn0.conf` (addresses `10.77.0.0/16`); devices are added through `/usr/local/lib/piiivpn/pvpn-wg` |
| Firewall | `/usr/local/lib/piiivpn/pvpn-fw`, run as the VPN starts and stops |
| Logs | `journalctl -u piiivpn -f` |

To back up, copy `/var/lib/piiivpn` and `/etc/wireguard/pvpn0.conf`.

Only piii.app may use your server from a browser (besides its own page). To allow another site (your own copy of
piii.app, say), add `PVPN_ORIGINS=https://that.site` to `/etc/piiivpn.env`.

## Development

```bash
cd back/vpn-server && PVPN_WG=off PVPN_DATA=/tmp/pvpn python3 pvpn.py create-admin me
PVPN_WG=off PVPN_DATA=/tmp/pvpn PVPN_ORIGINS=http://localhost:8000 uvicorn pvpn:app --port 8771
cd back && python -m pytest -q tests/test_pvpn.py
```

With `PVPN_WG=off` nothing on the system is touched: WireGuard is stood in for, so everything else can be tried.
