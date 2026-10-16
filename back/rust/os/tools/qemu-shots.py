"""Boots piii OS in QEMU on real UEFI firmware (OVMF), drives it with the keyboard and a USB mouse, and saves what
the screen shows as PNG pictures, with the serial log (piii OS writes what it finds there).

    python3 tools/qemu-shots.py DISK.img OUTDIR        (run in back/rust/os; needs qemu-system-x86_64 and OVMF)
"""
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

IMG, OUT = Path(sys.argv[1]), Path(sys.argv[2])
QUICK = "--quick" in sys.argv  # only: does it start and draw?
OUT.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp())
sock_path = str(tmp / "qmp.sock")
serial = OUT / "serial.log"


def firmware():
    for p in ["/usr/share/ovmf/OVMF.fd", "/usr/share/OVMF/OVMF.fd", "/usr/share/qemu/OVMF.fd"]:
        if os.path.exists(p):
            return ["-bios", p]
    for code, vars_ in [("/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_VARS_4M.fd"),
                        ("/usr/share/OVMF/OVMF_CODE.fd", "/usr/share/OVMF/OVMF_VARS.fd")]:
        if os.path.exists(code):
            v = tmp / "vars.fd"
            shutil.copyfile(vars_, v)
            return ["-drive", f"if=pflash,format=raw,readonly=on,file={code}", "-drive", f"if=pflash,format=raw,file={v}"]
    sys.exit("no OVMF firmware found")


qemu = subprocess.Popen([
    "qemu-system-x86_64", "-machine", "q35", "-m", "512", *firmware(),
    "-drive", f"format=raw,file={IMG}",
    "-device", "qemu-xhci", "-device", "usb-mouse", "-device", "usb-kbd",
    "-vga", "std", "-display", "none",
    "-serial", f"file:{serial}",
    "-qmp", f"unix:{sock_path},server,nowait",
    "-no-reboot",
])

for _ in range(100):
    if os.path.exists(sock_path):
        break
    time.sleep(0.1)
s = socket.socket(socket.AF_UNIX)
s.connect(sock_path)
f = s.makefile("rw")


def cmd(execute, **args):
    f.write(json.dumps({"execute": execute, "arguments": args} if args else {"execute": execute}) + "\n")
    f.flush()
    while True:
        r = json.loads(f.readline())
        if "return" in r or "error" in r:
            return r


f.readline()  # the greeting
cmd("qmp_capabilities")


def log():
    return serial.read_text(errors="replace") if serial.exists() else ""


def wait_for(text, secs=60):
    t = time.time()
    while time.time() - t < secs:
        if text in log():
            return True
        time.sleep(0.25)
    return False


def png(ppm, out):
    d = ppm.read_bytes()
    parts, i = [], 0
    while len(parts) < 4:
        while d[i:i + 1].isspace():
            i += 1
        if d[i:i + 1] == b"#":
            while d[i:i + 1] != b"\n":
                i += 1
            continue
        j = i
        while not d[j:j + 1].isspace():
            j += 1
        parts.append(d[i:j])
        i = j
    i += 1
    w, h = int(parts[1]), int(parts[2])
    pix = d[i:i + w * h * 3]
    raw = b"".join(b"\x00" + pix[y * w * 3:(y + 1) * w * 3] for y in range(h))

    def chunk(k, data):
        return struct.pack(">I", len(data)) + k + data + struct.pack(">I", zlib.crc32(k + data) & 0xFFFFFFFF)

    out.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                    + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


n = 0


def shot(name, settle=0.8):
    global n
    time.sleep(settle)
    n += 1
    ppm = tmp / "s.ppm"
    cmd("screendump", filename=str(ppm))
    time.sleep(0.3)
    png(ppm, OUT / f"{n:02d}-{name}.png")
    print("shot", name, flush=True)


def keys(*names, gap=0.25):
    for k in names:
        cmd("send-key", keys=[{"type": "qcode", "data": k}])
        time.sleep(gap)


def move(dx, dy, steps=10):
    # small steps, often, as a real mouse sends them (big jumps overflow the emulated mouse's queue)
    for _ in range(steps):
        cmd("input-send-event", events=[{"type": "rel", "data": {"axis": "x", "value": dx // steps}},
                                        {"type": "rel", "data": {"axis": "y", "value": dy // steps}}])
        time.sleep(0.02)


def steps(dx, dy, n):
    for _ in range(n):
        cmd("input-send-event", events=[{"type": "rel", "data": {"axis": "x", "value": dx}},
                                        {"type": "rel", "data": {"axis": "y", "value": dy}}])
        time.sleep(0.02)


def button(down):
    cmd("input-send-event", events=[{"type": "btn", "data": {"down": down, "button": "left"}}])
    time.sleep(0.15)


ok = wait_for("piii OS: frame 1", 90)
print("booted:", ok, flush=True)
try:
    shot("boot", 2.0)
    if QUICK:
        if not ok:
            sys.exit("piii OS did not start")
        raise SystemExit(0)
    # the keyboard alone: Tab to Welcome, open, back; Program, the Turing machine, run
    keys("tab")
    shot("tab-welcome")
    keys("ret")
    shot("welcome")
    keys("esc", "tab", "ret")
    shot("program")
    keys("5", gap=0.6)
    keys("r", gap=0.6)
    shot("program-turing")
    keys("esc", "tab", "ret")
    shot("numbers-pi", 3.0)
    keys("esc")
    for _ in range(6):
        keys("tab", gap=0.35)
    keys("ret")
    shot("devices")
    keys("esc")
    # the mouse (piii OS's own USB driver): into the top left corner, onto Welcome in small steps (2 counts: slow
    # enough that the pointer's acceleration stays out, so each goes 0.35 × 2.8 pixels), drag it down and right,
    # then click it open. The screen is 1280 × 800; Welcome's middle is near (255, 235).
    move(-3000, -3000, steps=100)
    steps(2, 2, 336)
    steps(2, 0, 28)
    shot("mouse-on-welcome")
    button(True)
    steps(2, 2, 100)
    button(False)
    shot("mouse-dragged-welcome")
    time.sleep(0.5)
    button(True)
    time.sleep(0.2)
    button(False)
    shot("mouse-click-opens", 1.0)
finally:
    print(log(), flush=True)
    qemu.kill()
