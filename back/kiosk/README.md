# piii kiosk

A computer that boots straight into piii.app: full screen, no desktop, nothing else. If the page closes or
crashes, it opens again. Made for an older Intel MacBook, and works on most PCs.

## 1. Install Debian on the computer

Debian 13 is light and runs well on old Macs (Ubuntu 22.04+ also works).

1. On another computer, download the **Debian netinst** image (debian.org → Download) and write it to a USB stick
   with balenaEtcher or Rufus.
2. **Plug the Mac into the router with a network cable** for the install. Its Wi-Fi needs a driver that the
   installer doesn't have; the kiosk installer adds it afterwards.
3. Plug in the USB stick, turn the Mac on while holding **Option (⌥)**, and choose **EFI Boot**.
4. Install with the defaults. This replaces macOS, so copy off anything you want to keep first. At **Software
   selection**, untick *Debian desktop environment* and *GNOME*, and keep *standard system utilities*.

## 2. Make it a piii kiosk

Sign in with the user you made, then:

```bash
su -c "apt install -y sudo git && usermod -aG sudo $USER"   # Debian: let your user use sudo (then sign out and in)
git clone https://github.com/ex-tern/pi && cd pi
sudo bash back/kiosk/install.sh
sudo nmtui      # Wi-Fi: Activate a connection → your network
sudo reboot
```

It starts in piii.app.

| | |
|---|---|
| Admin console | **Ctrl+Alt+F2**, sign in with your user; **Ctrl+Alt+F1** goes back to piii.app |
| Wi-Fi later | `sudo nmtui` from the admin console |
| Another page | `sudo PIII_URL=https://... bash back/kiosk/install.sh` |
| Undo | `sudo bash back/kiosk/install.sh --remove` |

The kiosk runs as its own user (`piii`) with no password, which signs in on the first screen only. The browser is
Chromium (Firefox where Chromium isn't packaged) inside `cage`, a compositor that shows one app full screen.
