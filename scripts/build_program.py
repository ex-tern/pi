"""Assembles the site's program, frontend/super/pitechlab.sasm (SuperAI assembly), into
frontend/super/pitechlab.super.js (window.SUPERAI_PROGRAM), with the SuperAI engine in Rust (rust/superai, asm.rs).

    python scripts/build_program.py           assemble and write pitechlab.super.js
    python scripts/build_program.py --check   fail if pitechlab.super.js is not what the assembly gives
"""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend/super/pitechlab.sasm"
OUT = ROOT / "frontend/super/pitechlab.super.js"
CRATE = ROOT / "rust/superai"

HEAD = """// Pi Tech Lab, written in SuperAI. GENERATED from super/pitechlab.sasm by scripts/build_program.py: edit the
// assembly, not this file.
//
// SuperAI is the site's graphical language: supers joined by wires, data flowing from outputs into inputs, powered
// by AI engines. super/runtime.js loads this as SuperAI.program (or the visitor's own edited copy):
//
//   orbit.js           builds the site from  sources, titles, merges and bubbles
//   super/nodes.js     lays out the diagram  diagram.supers and diagram.wires (on a first visit)
//   super/project.js   draws the project map project
"""


def main():
    subprocess.run(["cargo", "build", "-q", "--release"], cwd=CRATE, check=True)
    req = json.dumps({"op": "assemble", "source": SRC.read_text(encoding="utf-8")})
    r = subprocess.run([str(CRATE / "target/release/superai")], input=req, capture_output=True, text=True, check=True)
    ans = json.loads(r.stdout)
    if not ans.get("ok"):
        sys.exit("pitechlab.sasm:\n  " + "\n  ".join(ans.get("errors", [])))
    prog = ans["program"]
    v = json.loads(subprocess.run([str(CRATE / "target/release/superai")], input=json.dumps({"op": "validate", "program": prog}),
                                  capture_output=True, text=True, check=True).stdout)
    if not v.get("ok"):
        sys.exit("the program does not validate:\n  " + "\n  ".join(v.get("errors", [])))
    text = HEAD + "window.SUPERAI_PROGRAM = " + json.dumps(prog, ensure_ascii=False, indent=1) + ";\n"
    if "--check" in sys.argv:
        if OUT.read_text(encoding="utf-8") != text:
            sys.exit("pitechlab.super.js is out of date: run python scripts/build_program.py")
        print("pitechlab.super.js matches pitechlab.sasm")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text)} bytes)")


if __name__ == "__main__":
    main()
