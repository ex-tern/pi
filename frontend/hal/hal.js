// hal.js — the HAL-OS Portal, in a browser.
//
// portal.py owns a VirtualBox VM and a TCP socket to its UART. Here the VM is
// v86 running the same boot image, and the "socket" is v86's serial0 input.
// Everything between — the canvas, the channels, the two-step INJECT, the
// delta encoder, the control plane, readback — follows portal.py and
// inject.py, through wire.js.

import * as W from "./wire.js";

const $ = id => document.getElementById(id);
const V86_DIR = "vendor/v86/";

// ------------------------------------------------------------------ state
let info = null;           // build.json
let emu = null;            // the V86 instance
let weights = null;        // ArrayBuffer: the weight disk, shared live with v86
let running = false;
let ready = false;          // set once v86 has finished starting; it cannot be paused or resumed before
let armed = false;
let source = "none";
const canvas = new Uint8Array(W.SLOTS);   // one byte per neuron, as in portal.py
let prev = null;           // what the GUEST last saw
let nframes = 0;
let sent = 0, trained = 0;
let lastFrame = null;      // last full frame sent, for scoring
const keys = [];
let keyPtr = 0;
let mouseXY = null;
let dumping = null;        // {buf, resolve}

// ------------------------------------------------------------------ status
function setState(text, kind) {
  $("state").textContent = text;
  $("dot").className = "dot" + (kind ? " " + kind : "");
}
function overlay(html) {
  const o = $("overlay");
  if (!html) { o.classList.add("hidden"); return; }
  o.innerHTML = html;
  o.classList.remove("hidden");
}
function fmtBytes(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B";
}

// ------------------------------------------------------------------ weights
// The weight disk is the only irreplaceable thing (README: "weights.vdi is
// the only irreplaceable file"). The kernel autosaves to it every 512 frames;
// this copies the disk into IndexedDB so it survives the tab.
const DB = "hal-os", STORE = "disks";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
    });
  } catch (_) { return null; }
}
async function idbPut(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(value, key);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    return true;
  } catch (_) { return false; }
}
async function idbDel(key) {
  try {
    const db = await idb();
    await new Promise(res => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(key); t.oncomplete = res; t.onerror = res; });
  } catch (_) { /* nothing stored is the same as deleted */ }
}
function weightKey() { return "weights:" + info.neurons.join("x") + ":" + info.weight_disk_bytes; }
function hasMagic(buf) { return buf && buf.byteLength >= 2 && new Uint16Array(buf, 0, 1)[0] === info.weight_magic; }

let lastPersist = 0;
async function persistWeights(force) {
  if (!weights || !hasMagic(weights)) return;
  if (!force && Date.now() - lastPersist < 10000) return;
  lastPersist = Date.now();
  // A copy: v86 keeps writing into the live buffer while this is stored.
  const ok = await idbPut(weightKey(), weights.slice(0));
  if (ok) $("wstate").textContent = $("wstate").textContent.replace(/ · saved.*$/, "") + " · saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------ machine
async function boot(diskBuffer) {
  if (emu) { try { await emu.destroy(); } catch (_) { /* already gone */ } emu = null; }
  running = false;
  ready = false;
  prev = null;
  setState("booting…");
  const { V86 } = await import("./" + V86_DIR + "libv86.mjs");
  const img = await (await fetch("bitllm.img", { cache: "no-cache" })).arrayBuffer();
  weights = diskBuffer;
  emu = new V86({
    wasm_path: V86_DIR + "v86.wasm",
    bios: { url: V86_DIR + "seabios.bin" },
    vga_bios: { url: V86_DIR + "vgabios.bin" },
    hda: { buffer: img },
    hdb: { buffer: weights },
    memory_size: 4 * 1024 * 1024,
    vga_memory_size: 2 * 1024 * 1024,
    screen_container: $("screen"),
    // The guest has no keyboard or mouse of its own (GUEST_KEYBOARD = False);
    // both are training channels, handled below. Left on, v86 would also
    // swallow keystrokes meant for the text box.
    disable_keyboard: true,
    disable_mouse: true,
    disable_speaker: true,
    autostart: true,
  });
  emu.add_listener("emulator-ready", () => {
    ready = true;
    running = true;
    setState("running", "on");
    $("pause").textContent = "Pause";
    overlay(null);
    // DBOK is set by the kernel once it has restored weights from disk.
    setTimeout(() => {
      if (!emu) return;
      const ok = emu.read_memory(info.weights_restored_flag, 1)[0];
      $("wstate").textContent = ok ? "weights restored" : "weights fresh";
    }, 1500);
  });
  emu.add_listener("serial0-output-byte", b => {
    if (!dumping) return;
    dumping.buf.push(b);
    if (dumping.buf.length >= W.SLOTS) { const d = dumping; dumping = null; d.resolve(Uint8Array.from(d.buf.slice(0, W.SLOTS))); }
  });
}

function send(bytes) {
  if (!emu || !running || !bytes.length) return;
  emu.serial_send_bytes(0, bytes);
  sent += bytes.length;
}
function queueDepth() {
  try { return emu.v86.cpu.devices.uart0.input.length; } catch (_) { return 0; }
}

// ------------------------------------------------------------------ sources
// A 320x100 RGBA scratch canvas: every visual source is letterboxed into it at
// the aspect it will APPEAR at on the 4:3 display (fit_box in inject.py).
const scratch = document.createElement("canvas");
scratch.width = W.SCREEN_W; scratch.height = W.SCREEN_H;
const sctx = scratch.getContext("2d", { willReadFrequently: true });
function letterbox(src, sw, sh) {
  const [w, h] = W.fitBox(sw, sh);
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, W.SCREEN_W, W.SCREEN_H);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, (W.SCREEN_W - w) >> 1, (W.SCREEN_H - h) >> 1, w, h);
  return W.rgbaToFrame(sctx.getImageData(0, 0, W.SCREEN_W, W.SCREEN_H).data, $("invertIn").checked);
}

const feed = { images: [], idx: 0, since: 0, hold: 4000, bytes: null, off: 0, fileName: "" };
let media = null;          // {stream, video}
let sineT = 0;
const SINE = (() => { const t = new Uint8Array(360); for (let i = 0; i < 360; i++) t[i] = Math.floor(127.5 * (1 + Math.sin(2 * Math.PI * i / 360))); return t; })();

function baseLayer() {
  switch (source) {
    case "images": {
      if (!feed.images.length) return null;
      if (feed.images.length > 1 && performance.now() - feed.since > feed.hold) {
        feed.idx = (feed.idx + 1) % feed.images.length; feed.since = performance.now();
      }
      return feed.images[feed.idx];
    }
    case "file": {
      if (!feed.bytes) return null;
      const out = new Uint8Array(W.SLOTS);
      out.set(feed.bytes.subarray(feed.off, feed.off + W.SLOTS));
      feed.off = (feed.off + W.SLOTS) % Math.max(1, feed.bytes.length);
      return out;
    }
    case "text": {
      const raw = new TextEncoder().encode($("textIn").value || " ");
      const out = new Uint8Array(W.SLOTS);
      for (let i = 0; i < W.SLOTS; i++) out[i] = raw[i % raw.length];
      return out;
    }
    case "camera": case "screen": {
      const v = media && media.video;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      return letterbox(v, v.videoWidth, v.videoHeight);
    }
    case "sine": {
      const out = new Uint8Array(W.SLOTS);
      for (let y = 0; y < W.SCREEN_H; y++) for (let x = 0; x < W.SCREEN_W; x++) out[y * W.SCREEN_W + x] = SINE[(sineT + y * 14 + x) % 360];
      sineT = (sineT + 9) % 360;
      return out;
    }
    case "noise": return crypto.getRandomValues(new Uint8Array(W.SLOTS));
    default: return null;
  }
}

// paint_marker() in portal.py, with one change: portal.py paints 0xFC, which
// was "saturated red+green" in the old RGB332 palette but lies past the end of
// the 6x6x6 cube the kernel now loads. Yellow from the cube is the same intent.
const MARKER = W.rgbIndex(255, 255, 0);
function paintMarker(x, y, size = 3) {
  for (let r = Math.max(0, y - size); r < Math.min(W.SCREEN_H, y + size + 1); r++)
    canvas.fill(MARKER, r * W.SCREEN_W + Math.max(0, x - size), r * W.SCREEN_W + Math.min(W.SCREEN_W, x + size + 1));
}

function compose() {
  const base = baseLayer();
  if (base) canvas.set(base);
  if ($("chMouse").checked && mouseXY) paintMarker(mouseXY[0], mouseXY[1]);
  if ($("chKbd").checked) {
    while (keys.length) {
      canvas[keyPtr] = keys.shift();
      keyPtr = keyPtr + 1 >= W.SLOTS ? info.key_band_start : keyPtr + 1;
    }
  }
  return canvas.slice(0);
}

// ------------------------------------------------------------------ sender
// Sender._run() in portal.py, one tick per frame.
function tick() {
  if (!running || dumping) return;
  const full = source !== "none";
  const live = armed && (full || $("chMouse").checked || $("chKbd").checked);
  if (!live) { prev = null; nframes = 0; return; }
  // Backpressure. A blocking socket paces portal.py to what the guest's UART
  // drains; v86's queue is unbounded, so the same pacing is done by hand.
  if (queueDepth() > 4 * W.SLOTS) return;

  if (full && !baseLayerReady()) return;
  const baseline = (full || prev) ? null : canvas.slice(0);
  const frame = compose();
  let key = false;
  if (baseline) prev = baseline;
  else {
    const every = parseInt($("keyIn").value, 10) || 1;
    key = full && nframes % every === 0;
  }
  // Threshold 0: frames are colour, as in portal.py (6 is its greyscale value).
  const wire = W.encodeDelta(prev, frame, 0, key);
  prev = frame;
  if (wire.length) { send(wire); trained += W.SLOTS; }
  if (full) lastFrame = frame;
  nframes++;
  drawFrame($("preview"), frame);
}
function baseLayerReady() {
  // camera/screen before the first video frame have nothing to send yet
  if (source === "camera" || source === "screen") return !!(media && media.video && media.video.videoWidth);
  if (source === "images") return feed.images.length > 0;
  if (source === "file") return !!feed.bytes;
  return true;
}

let timer = null;
function restartTimer() {
  clearInterval(timer);
  const fps = parseInt($("fpsIn").value, 10) || 8;
  $("fpsOut").textContent = fps;
  timer = setInterval(tick, 1000 / fps);
}

// ------------------------------------------------------------------ drawing
const PAL = (() => { const p = new Uint8Array(256 * 3); for (let i = 0; i < 256; i++) p.set(W.paletteRGB(i), i * 3); return p; })();
function drawFrame(cv, frame) {
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(320, 200);
  for (let y = 0; y < 200; y++) {
    const row = (y >> 1) * W.SCREEN_W;           // each neuron is 2 screen rows
    for (let x = 0; x < 320; x++) {
      const c = frame[row + x] * 3, o = (y * 320 + x) * 4;
      img.data[o] = PAL[c]; img.data[o + 1] = PAL[c + 1]; img.data[o + 2] = PAL[c + 2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ controls
async function setSource(value) {
  if (media && value !== source) { media.stream.getTracks().forEach(t => t.stop()); media = null; }
  source = value;
  $("textIn").classList.toggle("hidden", value !== "text");
  prev = null;
  if (value === "images" && !feed.images.length) $("pickImages").click();
  if (value === "file" && !feed.bytes) $("pickFile").click();
  if (value === "camera" || value === "screen") {
    try {
      const stream = value === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      media = { stream, video };
      stream.getVideoTracks()[0].addEventListener("ended", () => { if (source === value) { document.querySelector('input[name=src][value=none]').click(); } });
    } catch (e) {
      // Like portal.py: a refused capture reports and turns itself off rather
      // than leaving a channel that looks live and sends nothing.
      $("injectHint").textContent = (value === "camera" ? "Camera" : "Screen sharing") + " was not allowed: " + (e.message || e.name);
      document.querySelector('input[name=src][value=none]').checked = true;
      source = "none";
    }
  }
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const imgs = files.filter(f => f.type.startsWith("image/"));
  if (imgs.length) {
    const frames = [];
    for (const f of imgs.slice(0, 200)) {
      try {
        const bmp = await createImageBitmap(f);
        frames.push(letterbox(bmp, bmp.width, bmp.height));
        bmp.close();
      } catch (_) { /* not decodable: skip, as src_dir skips non-images */ }
    }
    if (frames.length) {
      feed.images = frames; feed.idx = 0; feed.since = performance.now();
      $("imgCount").textContent = frames.length === 1 ? "(1)" : "(" + frames.length + ", 4 s each)";
      document.querySelector('input[name=src][value=images]').checked = true;
      await setSource("images");
      drawFrame($("preview"), frames[0]);
      return;
    }
  }
  // Anything else: raw bytes, unmodified — the file's own structure as colour.
  const f = files[0];
  feed.bytes = new Uint8Array(await f.slice(0, 16 * 1024 * 1024).arrayBuffer());
  feed.off = 0;
  $("fileName").textContent = "(" + (f.name.length > 18 ? f.name.slice(0, 17) + "…" : f.name) + ")";
  document.querySelector('input[name=src][value=file]').checked = true;
  await setSource("file");
}

async function score() {
  if (!running || dumping) return;
  const was = armed; armed = false;
  $("rbCap").textContent = "reading back…";
  // Let the wire drain first: a dump requested mid-frame would be decoded as
  // pixel data by the guest's state machine.
  for (let i = 0; i < 100 && queueDepth() > 0; i++) await new Promise(r => setTimeout(r, 50));
  const got = await new Promise(resolve => {
    dumping = { buf: [], resolve };
    send(W.dumpRequest());
    setTimeout(() => { if (dumping) { const d = dumping; dumping = null; d.resolve(null); } }, 20000);
  });
  armed = was;
  if (!got) { $("rbCap").textContent = "readback timed out"; return; }
  drawFrame($("readback"), got);
  $("rbCap").textContent = lastFrame
    ? "readback · rmse " + W.rmse(lastFrame, got).toFixed(1) + " vs last frame sent"
    : "readback · what the network is painting";
}

function sendProgram(text) {
  try {
    send(W.program(W.assemble(text)));
    prev = null;   // a RESET re-seeds every weight, so the guest no longer holds prev
    return true;
  } catch (e) {
    $("injectHint").textContent = e.message;
    return false;
  }
}

function bindUI() {
  const pickImages = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, id: "pickImages", hidden: true });
  const pickFile = Object.assign(document.createElement("input"), { type: "file", id: "pickFile", hidden: true });
  document.body.append(pickImages, pickFile);
  pickImages.addEventListener("change", () => loadFiles(pickImages.files));
  pickFile.addEventListener("change", async () => {
    const f = pickFile.files[0]; if (!f) return;
    feed.bytes = new Uint8Array(await f.slice(0, 16 * 1024 * 1024).arrayBuffer()); feed.off = 0;
    $("fileName").textContent = "(" + (f.name.length > 18 ? f.name.slice(0, 17) + "…" : f.name) + ")";
  });

  document.querySelectorAll("input[name=src]").forEach(r => r.addEventListener("change", () => setSource(r.value)));
  // Re-picking: clicking an already-selected source opens its picker again.
  document.querySelector('input[name=src][value=images]').addEventListener("click", () => { if (source === "images" && feed.images.length) pickImages.click(); });
  document.querySelector('input[name=src][value=file]').addEventListener("click", () => { if (source === "file" && feed.bytes) pickFile.click(); });

  $("inject").addEventListener("click", () => {
    armed = !armed;
    $("inject").setAttribute("aria-pressed", String(armed));
    $("inject").textContent = armed ? "INJECTING" : "INJECT";
    $("injectHint").textContent = armed
      ? "Live. Every byte sent is a weight update — the network cannot be un-taught."
      : "Pick a source, then press INJECT. Nothing goes on the wire until you do.";
    setState(running ? (armed ? "injecting" : "running") : $("state").textContent, armed ? "live" : "on");
    prev = null;
  });

  $("fpsIn").addEventListener("input", restartTimer);
  $("score").addEventListener("click", score);
  $("pause").addEventListener("click", async () => {
    if (!emu) return;
    if (running) { await emu.stop(); running = false; setState("paused"); $("pause").textContent = "Resume"; persistWeights(true); }
    else { await emu.run(); running = true; setState(armed ? "injecting" : "running", armed ? "live" : "on"); $("pause").textContent = "Pause"; }
  });
  $("reboot").addEventListener("click", async () => { await persistWeights(true); boot(weights); });
  $("save").addEventListener("click", () => { if (sendProgram("SAVE")) setTimeout(() => persistWeights(true), 1500); });
  $("reset").addEventListener("click", () => {
    if (confirmInline($("reset"), "Really reset?")) sendProgram("RESET");
  });
  $("forget").addEventListener("click", async () => {
    if (!confirmInline($("forget"), "Really forget?")) return;
    await idbDel(weightKey());
    boot(new ArrayBuffer(info.weight_disk_bytes));
  });
  $("dl").addEventListener("click", () => {
    if (!weights) return;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([weights.slice(0)], { type: "application/octet-stream" })),
      download: "hal-os-weights.img",
    });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $("ul").addEventListener("change", async () => {
    const f = $("ul").files[0]; if (!f) return;
    const buf = new ArrayBuffer(info.weight_disk_bytes);
    new Uint8Array(buf).set(new Uint8Array(await f.slice(0, info.weight_disk_bytes).arrayBuffer()));
    if (!hasMagic(buf)) { $("injectHint").textContent = "That file is not a HAL-OS weight disk (no signature at sector 0)."; return; }
    await idbPut(weightKey(), buf.slice(0));
    boot(buf);
  });
  $("run").addEventListener("click", () => { if (sendProgram($("prog").value)) $("injectHint").textContent = "Program sent."; });

  // Drag and drop onto the screen.
  const drop = $("drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", async e => {
    const items = Array.from(e.dataTransfer.items || []);
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.some(en => en.isDirectory)) {
      const files = [];
      const walk = en => new Promise(res => {
        if (en.isFile) en.file(f => { files.push(f); res(); }, res);
        else en.createReader().readEntries(async list => { for (const c of list) await walk(c); res(); }, res);
      });
      for (const en of entries) await walk(en);
      loadFiles(files);
    } else loadFiles(e.dataTransfer.files);
  });

  // Mouse and keyboard channels: training data, not control.
  $("screen").addEventListener("mousemove", e => {
    const r = $("screen").getBoundingClientRect();
    mouseXY = [Math.floor((e.clientX - r.left) / r.width * W.SCREEN_W), Math.floor((e.clientY - r.top) / r.height * W.SCREEN_H)];
  });
  $("screen").addEventListener("mouseleave", () => { mouseXY = null; });
  $("screen").addEventListener("keydown", e => {
    if (!$("chKbd").checked || e.ctrlKey || e.metaKey) return;
    if (e.key.length === 1) { keys.push(e.key.charCodeAt(0) & 0xFF); e.preventDefault(); }
  });

  // The Lab tab pauses the machine when it is hidden, so a background tab is
  // not running an x86 emulator for nobody.
  window.addEventListener("message", async e => {
    // the page sends pause/resume as windows come and go; before the machine
    // is up there is nothing to pause, and it starts by itself anyway
    if (e.origin !== location.origin || !e.data || !emu || !ready) return;
    if (e.data.hal === "pause" && running) { await emu.stop(); running = false; setState("paused"); $("pause").textContent = "Resume"; persistWeights(true); }
    if (e.data.hal === "resume" && !running) { await emu.run(); running = true; setState(armed ? "injecting" : "running", armed ? "live" : "on"); $("pause").textContent = "Pause"; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) persistWeights(true); });
  window.addEventListener("pagehide", () => persistWeights(true));
}

// Two-click confirm on the button itself; no browser dialog.
function confirmInline(btn, prompt) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = prompt;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3000);
  return false;
}

// ------------------------------------------------------------------ stats
let lastF = null, lastSent = 0, lastT = performance.now();
setInterval(() => {
  const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
  if (emu && running && info) {
    const m = emu.read_memory(info.frame_counter, 2), f = m[0] | (m[1] << 8);
    if (lastF !== null) $("fps").textContent = (((f - lastF) & 0xFFFF) / dt).toFixed(0) + " fps";
    lastF = f;
  } else lastF = null;
  $("rate").textContent = fmtBytes(Math.round((sent - lastSent) / dt)) + "/s";
  lastSent = sent;
  $("ratio").textContent = sent ? Math.round(trained / sent) + "×" : "—";
  persistWeights(false);
}, 1000);

// ------------------------------------------------------------------ start
async function main() {
  bindUI();
  drawFrame($("preview"), new Uint8Array(W.SLOTS).fill(W.OUT_LO));
  drawFrame($("readback"), new Uint8Array(W.SLOTS).fill(W.OUT_LO));
  try {
    const r = await fetch("build.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    info = await r.json();
  } catch (_) {
    setState("not built", "err");
    overlay("The HAL-OS boot image has not been built for this deployment.<br>Run <code>python scripts/build_hal.py --src ../HAL-OS</code>.");
    return;
  }
  if (info.neurons[0] !== W.SCREEN_W || info.neurons[1] !== W.SCREEN_H) {
    setState("geometry mismatch", "err");
    overlay("This boot image has a " + info.neurons.join("×") + " neuron grid; wire.js expects " + W.SCREEN_W + "×" + W.SCREEN_H + ".");
    return;
  }
  keyPtr = info.key_band_start;
  const ref = info.ref && info.ref !== "local" ? info.ref.slice(0, 7) : "local build";
  $("buildInfo").textContent = "Boot image " + fmtBytes(info.image_bytes) + " · HAL-OS " + ref + " · built " + info.built_at.slice(0, 10) + ".";
  if (info.ref && info.ref !== "local") $("srcLink").href = info.repo + "/tree/" + info.ref;
  if (typeof WebAssembly !== "object") { setState("unsupported", "err"); overlay("This browser has no WebAssembly, which the emulator needs."); return; }

  let disk = await idbGet(weightKey());
  if (!(disk instanceof ArrayBuffer) || disk.byteLength !== info.weight_disk_bytes) disk = new ArrayBuffer(info.weight_disk_bytes);
  overlay("Booting HAL-OS…");
  await boot(disk);
  restartTimer();
}
main().catch(e => { setState("error", "err"); overlay("Could not start the machine: " + (e.message || e)); console.error(e); });
