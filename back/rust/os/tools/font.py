"""Writes src/font.rs from the Spleen bitmap font (BSD 2-clause, https://github.com/fcambus/spleen; its licence is
kept in fonts/SPLEEN-LICENSE): printable ASCII, the Latin-1 letters, and the few symbols piii OS shows.

    python3 tools/font.py /path/to/spleen        (run in back/rust/os)
"""
import re
import sys
from pathlib import Path

KEEP = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | {
    0x3C0, 0x3C6, 0x2192, 0x2190, 0x2191, 0x2193, 0x2264, 0x2265, 0x221E, 0x2014, 0x2013, 0x2022,
    0x2026, 0x201C, 0x201D, 0x2018, 0x2019, 0x25A0, 0x25CF,
}


def load(path):
    glyphs, enc, rows, inbm = {}, None, [], False
    for line in Path(path).read_text().splitlines():
        if line.startswith("ENCODING "):
            enc = int(line.split()[1])
        elif line == "BITMAP":
            inbm, rows = True, []
        elif line == "ENDCHAR":
            if enc in KEEP:
                glyphs[enc] = rows
            inbm = False
        elif inbm:
            rows.append(int(line, 16))
    return glyphs


def emit(name, w, h, glyphs):
    codes = sorted(glyphs)
    out = [f"pub static {name}: Font = Font {{ w: {w}, h: {h}, codes: &["]
    out.append("    " + ", ".join(str(c) for c in codes))
    out.append("], rows: &[")
    for c in codes:
        rows = glyphs[c]
        # a row is the glyph's w bits, highest bit = leftmost pixel, stored in a u16
        shift = (16 - w) if w <= 16 else 0
        vals = []
        for r in rows[:h]:
            bits = r if w > 8 else r  # bdf rows are padded to whole bytes, leftmost pixel in the top bit
            nbytes = (w + 7) // 8
            vals.append((bits << (16 - 8 * nbytes)) & 0xFFFF)
        vals += [0] * (h - len(vals))
        out.append("    " + ", ".join(f"0x{v:04x}" for v in vals) + ",")
    out.append("] };")
    return "\n".join(out)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "spleen")
    small, big = load(src / "spleen-8x16.bdf"), load(src / "spleen-16x32.bdf")
    text = [
        "// Written by tools/font.py from the Spleen font (BSD 2-clause; fonts/SPLEEN-LICENSE). Do not edit.",
        "",
        "pub struct Font {",
        "    pub w: usize,",
        "    pub h: usize,",
        "    /// the characters it has, in order",
        "    pub codes: &'static [u32],",
        "    /// h rows per character, a row's leftmost pixel in the top bit",
        "    pub rows: &'static [u16],",
        "}",
        "",
        emit("SMALL", 8, 16, small),
        "",
        emit("BIG", 16, 32, big),
        "",
    ]
    Path("src/font.rs").write_text("\n".join(text))
    lic = (src / "LICENSE").read_text()
    Path("fonts").mkdir(exist_ok=True)
    Path("fonts/SPLEEN-LICENSE").write_text(lic)
    print("src/font.rs:", len(small), "+", len(big), "glyphs")


main()
