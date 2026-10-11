"""Build the SuperAI engine (rust/superai) to WebAssembly: frontend/super/superai.wasm.

    python scripts/build_superai.py            build and copy the .wasm
    python scripts/build_superai.py --test     run the engine's tests first (cargo test)

Needs Rust with the wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`). Where
that target cannot be downloaded, `--build-std` builds core and alloc from rust-src instead
(RUSTC_BOOTSTRAP=1 cargo build -Z build-std=core,alloc).
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CRATE = ROOT / "rust" / "superai"
OUT = ROOT / "frontend" / "super" / "superai.wasm"


def main() -> int:
    args = sys.argv[1:]
    if "--test" in args:
        subprocess.run(["cargo", "test", "-q"], cwd=CRATE, check=True)
    cmd = ["cargo", "build", "--release", "--lib", "--target", "wasm32-unknown-unknown"]
    env = dict(os.environ)
    if "--build-std" in args:
        cmd += ["-Z", "build-std=core,alloc", "-Z", "build-std-features=compiler-builtins-mem", "--offline"]
        env["RUSTC_BOOTSTRAP"] = "1"
    subprocess.run(cmd, cwd=CRATE, check=True, env=env)
    built = CRATE / "target" / "wasm32-unknown-unknown" / "release" / "superai.wasm"
    shutil.copyfile(built, OUT)
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
