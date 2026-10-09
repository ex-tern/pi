#!/usr/bin/env python3
"""build_hal.py -- build HAL-OS's boot image from its own repository, for the Lab.

    python scripts/build_hal.py --src ../HAL-OS
    python scripts/build_hal.py --src /tmp/HAL-OS --ref 7f2e094

HAL-OS is a separate repository and stays one. ScholarPi does not vendor its
source; it builds the image from a checkout at deploy time (see Dockerfile),
the same way `python bitllm_kernel.py` does on a desktop, and serves the
result to the browser, where v86 boots it.

Two things are written to frontend/hal/:

    bitllm.img   the boot disk, trimmed (see below)
    build.json   what was built, from which ref, and the constants the browser
                 side was written against

THE AGREEMENT IS CHECKED HERE, NOT DISCOVERED IN A BROWSER
---------------------------------------------------------
frontend/hal/wire.js is a port of inject.py's encoder. The two only work if
they agree on geometry, palette band and protocol constants -- and a mismatch
does not error, it renders every colour slightly wrong or trains the wrong
slots. So the build imports the HAL-OS modules and compares their constants
with the values wire.js declares, and refuses to produce an image if any of
them disagree. Change the kernel's geometry and this build fails until
wire.js follows.

WHY THE IMAGE IS TRIMMED
------------------------
bitllm_kernel.py pads the disk to 8 MiB for VirtualBox's geometry probing.
Everything after the MBR and stage 2 is zeros, and in a browser those zeros
are an 8 MiB download. SeaBIOS under v86 boots a 64 KiB disk identically, and
the build checks that no non-zero byte is cut off.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "frontend", "hal")
WIRE_JS = os.path.join(OUT_DIR, "wire.js")
TRIM_TO = 64 * 1024


def wire_constants():
    """The `export const NAME = <int>;` lines of wire.js, as a dict."""
    with open(WIRE_JS, "r", encoding="utf-8") as fh:
        text = fh.read()
    found = {}
    for name, value in re.findall(r"export const (\w+) = (0x[0-9A-Fa-f]+|\d+);", text):
        found[name] = int(value, 0)
    return found


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--src", default=os.environ.get("HAL_OS_DIR",
                                                   os.path.join(os.path.dirname(HERE), "..", "HAL-OS")),
                   help="path to a HAL-OS checkout (default: $HAL_OS_DIR or ../HAL-OS)")
    p.add_argument("--ref", default=os.environ.get("HAL_OS_REF", ""),
                   help="the commit or tag the checkout is at, recorded in build.json")
    p.add_argument("--repo", default=os.environ.get("HAL_OS_REPO", "https://github.com/neurophilic/HAL-OS"))
    args = p.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.isfile(os.path.join(src, "bitllm_kernel.py")):
        sys.exit("[build_hal] no bitllm_kernel.py in %s -- point --src at a HAL-OS checkout" % src)
    sys.path.insert(0, src)
    import bitllm_kernel as K   # noqa: E402
    import inject as I          # noqa: E402

    # ---- the agreement -------------------------------------------------
    js = wire_constants()
    expected = {
        "SCREEN_W": (I.SCREEN_W, K.NEURON_W),
        "SCREEN_H": (I.SCREEN_H, K.NEURON_H),
        # The palette is decided by the kernel (palette_dac starts the cube at
        # OUT_MIN), so that is what the browser must match -- not inject.py,
        # which disagrees with it in HAL-OS 7f2e094 (see the warning below).
        "OUT_LO": (K.OUT_MIN,),
        "CUBE": (I.CUBE,),
        "MAX_SEG": (I.MAX_SEG,),
        "MIN_RUN": (I.MIN_RUN,),
        "BRIDGE": (I.BRIDGE,),
        "CMD_ADDR": (I.CMD_ADDR,),
        "CMD_DUMP": (I.CMD_DUMP,),
        "CMD_WIRE_BASE": (I.CMD_WIRE_BASE, getattr(K, "CMD_WIRE_BASE", I.CMD_WIRE_BASE)),
    }
    bad = []
    for name, sources in expected.items():
        if name not in js:
            bad.append("%s missing from wire.js" % name)
            continue
        for v in sources:
            if js[name] != v:
                bad.append("%s: wire.js says %d, HAL-OS says %d" % (name, js[name], v))
    ops = {"FILL8": I.OP_FILL8, "ROW": I.OP_ROW, "SEEK": I.OP_SEEK,
           "SAVE": I.OP_SAVE, "LOAD": I.OP_LOAD, "RESET": I.OP_RESET}
    with open(WIRE_JS, "r", encoding="utf-8") as fh:
        wire_text = fh.read()
    for name, op in ops.items():
        if not re.search(r"\b%s: \[0x%02X," % (name, op), wire_text, re.I):
            bad.append("opcode %s (0x%02X) does not match wire.js MNEMONICS" % (name, op))
    if I.OUT_LO != K.OUT_MIN:
        print("[build_hal] WARNING: HAL-OS's own inject.py packs colours from index %d, but "
              "the kernel's palette starts at OUT_MIN = %d. Desktop injection will show "
              "shifted colours until inject.py is fixed; the browser follows the kernel."
              % (I.OUT_LO, K.OUT_MIN))
    if bad:
        sys.exit("[build_hal] wire.js and HAL-OS disagree -- refusing to build:\n  "
                 + "\n  ".join(bad))

    # ---- the image -----------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "bitllm.img")
        K.build(path)
        with open(path, "rb") as fh:
            img = fh.read()
    extent = len(img.rstrip(b"\0"))
    if extent > TRIM_TO:
        sys.exit("[build_hal] image has %d bytes of content, more than the %d it is "
                 "trimmed to -- raise TRIM_TO" % (extent, TRIM_TO))
    img = img[:TRIM_TO]

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "bitllm.img"), "wb") as fh:
        fh.write(img)

    # The kernel saves bank by bank, two 64-sector halves each, from WEIGHT_LBA.
    weight_sectors = K.WEIGHT_LBA + K.BANKS * 2 * K.SECT_PER_CALL
    info = {
        "repo": args.repo,
        "ref": args.ref or "local",
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "image_sha256": hashlib.sha256(img).hexdigest(),
        "image_bytes": len(img),
        "content_bytes": extent,
        "neurons": [K.NEURON_W, K.NEURON_H],
        "screen": [K.SCREEN_W, K.SCREEN_H],
        "resp_linear": K.RESP_SEG << 4,
        "frame_counter": K.FRAME,
        "weights_restored_flag": K.DBOK,
        "weight_magic": K.MAGIC,
        "weight_disk_bytes": max(1 << 20, weight_sectors * 512),
        "init_mode": getattr(K, "INIT_MODE", "block"),
        # Where the portal's keyboard channel writes, and where the command
        # row sits, in SLOT space. Read by the browser so it never guesses.
        "key_band_start": K.KEY_BAND_START,
        "cmd_base": K.CMD_BASE,
        "commands": bool(getattr(K, "COMMANDS", False)),
    }
    with open(os.path.join(OUT_DIR, "build.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    print("[build_hal] bitllm.img %d bytes (%d of content) from %s @ %s"
          % (len(img), extent, src, info["ref"]))


if __name__ == "__main__":
    main()
