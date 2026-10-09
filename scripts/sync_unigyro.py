#!/usr/bin/env python3
"""sync_unigyro.py -- take the Lab's Unigyro window from its own repository.

    python scripts/sync_unigyro.py --src ../Unigyro          # copy in
    python scripts/sync_unigyro.py --src ../Unigyro --check  # only compare

Unigyro is Murtaza Vefadar's project and lives in its own repository,
https://github.com/neurophilic/Unigyro. That repository is the source: the
window the Lab shows is its `pitechlab/unigyro.js` and `pitechlab/unigyro.css`.
This script copies those two files into frontend/, so a change to Unigyro is
made there and pulled in here, the same way HAL-OS is built from its own
repository (scripts/build_hal.py).

--check copies nothing and fails if the site's copies differ from the source.
"""

import argparse
import filecmp
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [("pitechlab/unigyro.js", "frontend/unigyro.js"),
         ("pitechlab/unigyro.css", "frontend/unigyro.css")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", required=True, help="a checkout of neurophilic/Unigyro")
    ap.add_argument("--check", action="store_true", help="compare only; change nothing")
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    missing = [s for s, _ in FILES if not os.path.isfile(os.path.join(src, s))]
    if missing:
        print("[sync_unigyro] the source has no " + ", ".join(missing) +
              " -- is " + src + " a checkout of neurophilic/Unigyro?", file=sys.stderr)
        return 2
    differ = []
    for s, d in FILES:
        sp, dp = os.path.join(src, s), os.path.join(ROOT, d)
        same = os.path.isfile(dp) and filecmp.cmp(sp, dp, shallow=False)
        if a.check:
            if not same:
                differ.append(d)
        elif not same:
            shutil.copyfile(sp, dp)
            print("[sync_unigyro] updated " + d + " from " + s)
    if a.check and differ:
        print("[sync_unigyro] out of step with the Unigyro repository: " + ", ".join(differ), file=sys.stderr)
        return 1
    print("[sync_unigyro] " + ("in step with" if a.check else "synced from") + " " + src)
    return 0


if __name__ == "__main__":
    sys.exit(main())
