// wire.js — HAL-OS's host-side wire protocol, ported from inject.py.
//
// Everything here is one half of an agreement with bitllm_kernel.py. The
// constants carry the same names as in inject.py so a change on either side
// can be found on the other by searching for the name. If the kernel changes
// its geometry, palette band or decoder, this file has to follow — exactly as
// inject.py has to.

export const SCREEN_W = 320;          // neuron grid, not the pixel grid
export const SCREEN_H = 100;
export const SLOTS = SCREEN_W * SCREEN_H;

// Palette index of black: the kernel's OUT_MIN, where palette_dac() starts
// the colour cube. NOT inject.py's OUT_LO, which says 8 while the kernel
// says 4 -- see build_hal.py, which checks this against the kernel.
export const OUT_LO = 4;
export const CUBE = 6;                 // 6x6x6 colour cube from OUT_LO

// 0..255 -> cube level 0..5, rounded exactly as inject.py's LEVEL table.
export const LEVEL = new Uint8Array(256);
for (let v = 0; v < 256; v++) LEVEL[v] = Math.floor((v * (CUBE - 1) + 127) / 255);

export function rgbIndex(r, g, b) {
  return OUT_LO + (LEVEL[r] * CUBE + LEVEL[g]) * CUBE + LEVEL[b];
}

// The guest's display is 4:3, but the neuron grid is 320x100 — each neuron
// is painted over two screen rows. fit_box() in inject.py: the largest box
// that APPEARS at the source's aspect once displayed.
export const DISPLAY_ASPECT = 4 / 3;
export function fitBox(srcW, srcH) {
  const a = srcW / Math.max(1, srcH);
  const ratio = a * (SCREEN_W / SCREEN_H) / DISPLAY_ASPECT;
  let w = SCREEN_W, h = Math.round(SCREEN_W / ratio);
  if (h > SCREEN_H) { h = SCREEN_H; w = Math.round(SCREEN_H * ratio); }
  return [Math.max(1, Math.min(SCREEN_W, w)), Math.max(1, Math.min(SCREEN_H, h))];
}

// RGBA pixels of a SCREEN_W x SCREEN_H canvas -> one palette byte per neuron.
// Deliberately not dithered, for the reason given in inject.py: dither noise
// changes every frame and would defeat the delta encoder.
export function rgbaToFrame(rgba, invert = false) {
  const out = new Uint8Array(SLOTS);
  for (let i = 0, p = 0; i < SLOTS; i++, p += 4) {
    let r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    out[i] = rgbIndex(r, g, b);
  }
  return out;
}

// The kernel's palette, for drawing previews that match what the guest shows.
export function paletteRGB(index) {
  const k = index - OUT_LO;
  if (k < 0 || k >= CUBE * CUBE * CUBE) return [0, 0, 0];
  const r = Math.floor(k / 36), g = Math.floor(k / 6) % 6, b = k % 6;
  return [r * 51, g * 51, b * 51];
}

// ------------------------------------------------------------------ protocol
//   addr_lo addr_hi len_lo len_hi [payload]
//   len & 0x8000 -> RUN (one byte repeated), otherwise LIT (len bytes)
export const MAX_SEG = 0x7F00;
export const MIN_RUN = 12;
export const BRIDGE = 12;

function spans(prev, cur, threshold) {
  const out = [];
  let start = -1, gap = 0;
  for (let i = 0; i < cur.length; i++) {
    if (Math.abs(cur[i] - prev[i]) > threshold) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > BRIDGE) { out.push([start, i - gap + 1]); start = -1; }
    }
  }
  if (start >= 0) out.push([start, cur.length]);
  return out;
}

function emit(out, addr, data) {
  const n = data.length;
  let i = 0;
  const hdr = (a, len) => out.push(a & 0xFF, (a >> 8) & 0xFF, len & 0xFF, (len >> 8) & 0xFF);
  while (i < n) {
    let j = i + 1;
    while (j < n && data[j] === data[i]) j++;
    let run = j - i;
    if (run >= MIN_RUN) {
      while (run > 0) {
        const take = Math.min(run, MAX_SEG);
        hdr(addr + i, take | 0x8000);
        out.push(data[i]);
        i += take; run -= take;
      }
      continue;
    }
    let k = i;
    while (k < n) {
      let m = k + 1;
      while (m < n && data[m] === data[k]) m++;
      if (m - k >= MIN_RUN) break;
      k = m;
    }
    while (k > i) {
      const take = Math.min(k - i, MAX_SEG);
      hdr(addr + i, take);
      for (let q = 0; q < take; q++) out.push(data[i + q]);
      i += take;
    }
  }
}

// prev is what the GUEST last saw (null for a keyframe).
export function encodeDelta(prev, cur, threshold = 0, keyframe = false) {
  const out = [];
  if (keyframe || !prev) emit(out, 0, cur);
  else for (const [lo, hi] of spans(prev, cur, threshold)) emit(out, lo, cur.subarray(lo, hi));
  return Uint8Array.from(out);
}

// Byte-for-byte model of the kernel's decoder (decode_reference in inject.py).
export function decodeReference(wire, canvas) {
  let state = 0, addr = 0, cnt = 0, ptr = 0;
  for (const b of wire) {
    if (state === 0) { addr = b; state = 1; }
    else if (state === 1) { addr |= b << 8; ptr = addr < SLOTS ? addr : 0; state = 2; }
    else if (state === 2) { cnt = b; state = 3; }
    else if (state === 3) {
      if (b & 0x80) { cnt |= (b & 0x7F) << 8; state = cnt ? 4 : 0; }
      else { cnt |= b << 8; state = cnt ? 5 : 0; }
    } else if (state === 4) {
      for (let q = 0; q < cnt; q++) { canvas[ptr] = b; ptr = ptr + 1 < SLOTS ? ptr + 1 : 0; }
      state = 0;
    } else {
      canvas[ptr] = b; ptr = ptr + 1 < SLOTS ? ptr + 1 : 0;
      if (--cnt === 0) state = 0;
    }
  }
  return canvas;
}

// ------------------------------------------------------------- control plane
export const CMD_ADDR = 0xFFFF;
export const CMD_DUMP = 1;
export const CMD_WIRE_BASE = 0xFE00;
export const MNEMONICS = {
  FILL8: [0x18, 3], ROW: [0x28, 2], SEEK: [0x38, 2],
  SAVE: [0x48, 0], LOAD: [0x58, 0], RESET: [0x68, 0],
};

// 'ROW 188 31' -> [[op,a,b,c], ...]; throws with a line number on bad input.
export function assemble(text) {
  const quads = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.split("#")[0].trim();
    if (!line) return;
    const parts = line.replace(/,/g, " ").split(/\s+/);
    const name = parts[0].toUpperCase();
    if (!(name in MNEMONICS)) throw new Error(`line ${idx + 1}: unknown instruction ${parts[0]}`);
    const [op, want] = MNEMONICS[name];
    const args = parts.slice(1).map(t => {
      const v = Number(t);
      if (!Number.isInteger(v)) throw new Error(`line ${idx + 1}: ${t} is not a number`);
      return v;
    });
    if (args.length !== want) throw new Error(`line ${idx + 1}: ${name} takes ${want} operand(s), got ${args.length}`);
    while (args.length < 3) args.push(0);
    quads.push([op, ...args]);
  });
  if (!quads.length) throw new Error("nothing to assemble");
  return quads;
}

export function program(quads, cmdBase = CMD_WIRE_BASE) {
  const body = [];
  for (const [op, a, b, c] of quads) body.push(op & 0xFF, a & 0xFF, b & 0xFF, c & 0xFF);
  return Uint8Array.from([cmdBase & 0xFF, cmdBase >> 8, body.length & 0xFF, (body.length >> 8) & 0xFF, ...body]);
}

export function dumpRequest() {
  return Uint8Array.from([CMD_ADDR & 0xFF, CMD_ADDR >> 8, CMD_DUMP & 0xFF, CMD_DUMP >> 8]);
}

export function rmse(target, actual) {
  const n = Math.min(target.length, actual.length);
  if (!n) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) { const d = target[i] - actual[i]; s += d * d; }
  return Math.sqrt(s / n);
}
