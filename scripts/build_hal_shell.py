"""Build the HAL-OS shell boot image: frontend/hal/shell/shell.asm -> frontend/hal/shell.img.

    python scripts/build_hal_shell.py          # needs nasm
    python scripts/build_hal_shell.py --check  # verify the committed image matches the source

The image is committed (it is 64 KB), so the deployment does not need nasm.
It is padded to 64 KB, the size of the network image, so the emulated BIOS
sees an ordinary small disk.
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "frontend", "hal", "shell", "shell.asm")
OUT = os.path.join(ROOT, "frontend", "hal", "shell.img")
SIZE = 64 * 1024


def build() -> bytes:
    if not shutil.which("nasm"):
        sys.exit("nasm is required: apt install nasm / brew install nasm")
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "shell.bin")
        subprocess.run(["nasm", "-f", "bin", SRC, "-o", out], check=True)
        raw = open(out, "rb").read()
    if raw[510:512] != b"\x55\xaa":
        sys.exit("boot signature missing")
    if len(raw) > SIZE:
        sys.exit(f"shell is {len(raw)} bytes, more than {SIZE}")
    return raw + bytes(SIZE - len(raw))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    img = build()
    if a.check:
        have = open(OUT, "rb").read() if os.path.exists(OUT) else b""
        if have != img:
            sys.exit("frontend/hal/shell.img is out of date: run python scripts/build_hal_shell.py")
        print("[build_hal_shell] shell.img matches shell.asm")
        return
    open(OUT, "wb").write(img)
    used = len(img.rstrip(b"\0"))
    print(f"[build_hal_shell] shell.img {len(img)} bytes ({used} used), sha256 {hashlib.sha256(img).hexdigest()[:16]}")


if __name__ == "__main__":
    main()
