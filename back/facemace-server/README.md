# Face Mace Server

Your photos, sorted by face, and a VPN, from a Linux machine at home.

- **Accounts.** People sign up on the server's page. You approve them (or turn on open sign-up).
- **Photos.** Each person uploads their own photos and videos. They are kept on your machine, are visible to that person only, and have a quota (20 GB each to start; you can change it per person). **Sort them with Face Mace** opens Face Mace (the full edition) on them, straight from the server. Sorting happens in the person's browser.
- **VPN (WireGuard).** Each person adds up to five devices. Each device gets a configuration, as a file or a QR code for a phone. A device either reaches **this server only**, or sends **all its internet** through it. The second works only for people you allow, and the firewall enforces this whatever a device's configuration says.

## What you need

1. **A Linux machine that stays on.** Debian 12+, Ubuntu 22.04+ or Raspberry Pi OS: a Raspberry Pi 4/5, a mini PC or an old laptop.
   - Most NAS systems (Synology, QNAP) can't run the installer directly. Run a Debian or Ubuntu virtual machine on the NAS instead, and point it at the NAS's photo storage.
2. **A name on the internet for your home.** Your home address usually changes, so use a free dynamic-DNS name. For example, at [duckdns.org](https://www.duckdns.org) make `yourname.duckdns.org` and install its small updater on the machine (DuckDNS shows how).
3. **Three ports opened in your router**, all sent to the machine's local address (the installer prints it at the end):

   | Port | For |
   |---|---|
   | 80 TCP | HTTPS certificate (Let's Encrypt, automatic) |
   | 443 TCP | the website |
   | 51820 UDP | the VPN |

   In the router this is called *port forwarding* or *virtual server*.

## Install

On the machine:

```bash
git clone https://github.com/ex-tern/pi && cd pi
sudo FMS_DOMAIN=yourname.duckdns.org FMS_ADMIN=yourname bash back/facemace-server/install.sh
```

The installer:

- asks once for the owner's password;
- sets up WireGuard and the firewall;
- installs Caddy, which gets the HTTPS certificate by itself.

Then open `https://yourname.duckdns.org` and sign in.

**To update:** run `git pull`, then the same command again. Photos, accounts, keys and settings are kept.

## Using it

- **People** sign up at your address and wait. You see them under **People** on your page: there you approve them, set their space, and allow "all internet" if you choose.
- **Photos** are added on the page: drop files or whole folders. Then **Sort them with Face Mace →**.
  - In Face Mace, **Your photos on this server** loads them.
  - Duplicates that Face Mace finds can be moved aside or deleted on the server.
  - Results download as a ZIP, or can be saved into a folder on your own computer.
- **VPN:** under **VPN**, name a device and choose where it goes. Scan the QR code with the WireGuard app on a phone, or download the file for a computer. The configuration is shown **once**: its key is not kept on the server.
- On the VPN, the server is also at `http://10.66.0.1`.

## Before allowing "all internet"

Traffic from a device on "all internet" leaves from **your home connection**: anything that person does online looks as if it came from you. Some internet providers also forbid running a VPN for others. That's why new accounts wait for your approval and "all internet" is off until you allow it per person. Allow it only for people you trust.

What VPN devices can and cannot reach:

- they **can** reach this machine's website and send pings to it;
- they **cannot** reach other services on the machine, each other's devices, or anything on your home network.

## Files and settings

| What | Where |
|---|---|
| Photos, accounts (SQLite) | `/var/lib/facemace` |
| Settings | `/etc/facemace.env` (quota per new person, devices per person, VPN DNS); restart with `sudo systemctl restart facemace` |
| The VPN | `/etc/wireguard/wg0.conf`; devices are added by the server through `/usr/local/lib/facemace/fms-wg`, the only part with root rights |
| Logs | `journalctl -u facemace -f` |

To back up, copy `/var/lib/facemace` and `/etc/wireguard`.
