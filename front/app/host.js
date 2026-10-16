// SPDX-License-Identifier: LicenseRef-PiTechLab-Proprietary
// The host for ScholarPi's Rust front end (back/rust/ui, built to ui.wasm).
//
// WebAssembly cannot touch the page by itself, so this lends it the DOM, the network and storage as numbered
// handles. It holds no views, no text and no logic of the site: all of that is in the Rust crate.
const nodes = [null], freed = [], forms = [null], files = [null];
const enc = new TextEncoder(), dec = new TextDecoder();
let W, capturing = false;

const str = (p, l) => dec.decode(new Uint8Array(W.memory.buffer, p, l));
function put(s) {
  const b = enc.encode(s), p = W.alloc(b.length);
  new Uint8Array(W.memory.buffer, p, b.length).set(b);
  return [p, b.length];
}
function ret(s) {
  if (s == null) return -1;
  const b = enc.encode(s), p = W.ret(b.length);
  new Uint8Array(W.memory.buffer, p, b.length).set(b);
  return b.length;
}
function keep(n) {
  const id = freed.length ? freed.pop() : nodes.length;
  nodes[id] = n;
  return id;
}
function send(id, kind, value) {
  const [kp, kl] = put(kind), [vp, vl] = put(value);
  W.event(id, kp, kl, vp, vl);
}
function fileList(list) {
  const out = [];
  // a folder chosen keeps its path (Holiday/2019/a.jpg), so files of the same name in different folders stay apart
  for (const f of list) { out.push(files.length + "\t" + f.size + "\t" + (f.webkitRelativePath || f.name).replace(/[\t\n]/g, " ")); files.push(f); }
  return out.join("\n");
}
const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
// a right-button box just drawn: the menu its release would open, and the double right click it would count, are not
let rdragAt = 0, tapAt = 0, touchAt = 0;
addEventListener("contextmenu", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t || !t.closest(".scene") || t.closest("input, textarea")) return;
  // on the canvas the right button draws (a super, a box), never the browser's menu
  e.preventDefault();
  // where the menu comes with the button's release (Windows), it is the box's own: not a right click
  if (Date.now() - rdragAt < 80) e.stopPropagation();
}, true);

const host = {
  create: (p, l) => {
    const t = str(p, l);
    return keep(t.startsWith("svg:") ? document.createElementNS("http://www.w3.org/2000/svg", t.slice(4)) : document.createElement(t));
  },
  text: (p, l) => keep(document.createTextNode(str(p, l))),
  set_text: (id, p, l) => { nodes[id].data = str(p, l); },
  attr: (id, kp, kl, vp, vl) => nodes[id].setAttribute(str(kp, kl), str(vp, vl)),
  unattr: (id, kp, kl) => nodes[id].removeAttribute(str(kp, kl)),
  prop: (id, kp, kl, vp, vl) => {
    const n = nodes[id], k = str(kp, kl), v = str(vp, vl);
    if (k === "checked") n.checked = v === "1"; else if (n[k] !== v) n[k] = v;
  },
  append: (p, c) => nodes[p].appendChild(nodes[c]),
  insert: (p, c, b) => nodes[p].insertBefore(nodes[c], nodes[b]),
  remove: (id) => { nodes[id].remove(); nodes[id] = undefined; freed.push(id); },
  release: (id) => { nodes[id] = undefined; freed.push(id); },
  listen: (id, kp, kl) => {
    const n = nodes[id], k = str(kp, kl);
    if (k === "enter") n.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(id, k, n.value || ""); } });
    // a press: x, y, then how: 0 a click, 1 shift + click (drags), 2 the middle button (resizes)
    else if (k === "pdown") n.addEventListener("pointerdown", (e) => {
      if (e.button === 1) e.preventDefault();
      // the corner grip of a selected super resizes, as the middle button does (a finger has neither)
      const grip = e.target.closest && e.target.closest("[data-resize]");
      if (e.button === 0 || e.button === 1) send(id, k, e.clientX + "," + e.clientY + "," + (e.button === 1 || grip ? 2 : e.shiftKey ? 1 : 0));
    });
    // a double click (left: "dbl", right: "dbl2") on the node itself, not on anything marked data-solid inside it
    // the pointer over a surface that draws itself (the map): x, y within it, and its width and height
    else if (k === "mdown" || k === "mmove" || k === "mup" || k === "mwheel") {
      const ev = { mdown: "pointerdown", mmove: "pointermove", mup: "pointerup", mwheel: "wheel" }[k];
      n.addEventListener(ev, (e) => {
        const r = n.getBoundingClientRect(), at = (e.clientX - r.left) + "," + (e.clientY - r.top) + "," + r.width + "," + r.height;
        if (k === "mwheel") { e.preventDefault(); send(id, k, e.deltaY + "," + at + "," + e.deltaX); return; }
        if (k === "mdown") { if (e.button !== 0 || e.target.closest("button, a, input, select")) return; try { n.setPointerCapture(e.pointerId); } catch (_) {} }
        send(id, k, at);
      }, k === "mwheel" ? { passive: false } : undefined);
      if (k === "mup") n.addEventListener("pointercancel", (e) => { const r = n.getBoundingClientRect(); send(id, k, (e.clientX - r.left) + "," + (e.clientY - r.top) + "," + r.width + "," + r.height); });
    }
    // a press on the bare background (nothing solid under it): the canvas pans from here
    else if (k === "bgdown") n.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("[data-solid], button, a, input, textarea, select, label")) return;
      send(id, k, e.clientX + "," + e.clientY);
    });
    // anywhere on an open page, over text too (owner, 2026-10-14): x, y within the node, as drawn; a super's own
    // canvas and the fields being typed in keep their own double clicks
    else if (k === "pdbl") n.addEventListener("dblclick", (e) => {
      if (e.target.closest("input, textarea, select, [contenteditable], .board, [data-layer], .win-grip, .ports-svg")) return;
      // where on the page's own column (what is drawn moves with it), wherever on the window the click was
      e.preventDefault(); const r = (n.querySelector(".win-in") || n).getBoundingClientRect(); send(id, k, (e.clientX - r.left) + "," + (e.clientY - r.top));
    });
    else if (k === "pdbl2") {
      let last = 0;
      n.addEventListener("contextmenu", (e) => {
        if (e.target.closest("input, textarea, select, [contenteditable], .board, [data-layer], .win-grip, .ports-svg")) return;
        e.preventDefault();
        const t = Date.now();
        if (t - last < 450) { last = 0; const r = (n.querySelector(".win-in") || n).getBoundingClientRect(); send(id, k, (e.clientX - r.left) + "," + (e.clientY - r.top)); } else last = t;
      });
    }
    // the right button held and dragged: a box (x0, y0, x1, y1, phase: 0 moving, 1 let go) that selects and groups
    else if (k === "rsel") n.addEventListener("pointerdown", (e) => {
      if (e.button !== 2 || e.target.closest("input, textarea")) return;
      const x0 = e.clientX, y0 = e.clientY; let on = false;
      const mv = (ev) => {
        if (!on && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
        on = true; rdragAt = Date.now(); send(id, k, x0 + "," + y0 + "," + ev.clientX + "," + ev.clientY + ",0");
      };
      const up = (ev) => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
        if (on) { rdragAt = Date.now(); send(id, k, x0 + "," + y0 + "," + ev.clientX + "," + ev.clientY + ",1"); }
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    });
    // a canvas super's inside is canvas too: you draw in it (not on its name)
    else if (k === "dbl") {
      n.addEventListener("dblclick", (e) => { if (Date.now() - tapAt < 700) return; const sol = e.target.closest("[data-solid]"); if (!sol || (sol.classList.contains("u-canvas") && !e.target.closest("input"))) { e.preventDefault(); const r = n.getBoundingClientRect(); send(id, k, e.clientX + "," + e.clientY + "," + (e.clientX - r.left) + "," + (e.clientY - r.top)); } });
      // a finger (a phone has no right button): a double tap draws a sparkle, a long press a super, and a long
      // press then a drag a box that selects and groups; a plain drag pans, two fingers zoom
      let lastTap = 0, lx = 0, ly = 0;
      n.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch" || !e.isPrimary) return;
        touchAt = Date.now();
        const sol = e.target.closest("[data-solid]");
        if (sol && !(sol.classList.contains("u-canvas") && !e.target.closest("input"))) return;
        const x0 = e.clientX, y0 = e.clientY; let moved = false, long = false, boxing = false;
        const timer = setTimeout(() => {
          if (moved) return;
          long = true;
          if (capturing) W.pointer(2, x0, y0);
          if (navigator.vibrate) navigator.vibrate(12);
        }, 550);
        const mv = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          const d = Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0);
          if (!long) { if (d > 10) moved = true; return; }
          if (d > 8) { boxing = true; rdragAt = Date.now(); send(id, "rsel", x0 + "," + y0 + "," + ev.clientX + "," + ev.clientY + ",0"); }
        };
        const up = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          clearTimeout(timer);
          removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
          if (ev.type === "pointercancel") return;
          const r = n.getBoundingClientRect(), at = ev.clientX + "," + ev.clientY + "," + (ev.clientX - r.left) + "," + (ev.clientY - r.top);
          if (boxing) { rdragAt = Date.now(); send(id, "rsel", x0 + "," + y0 + "," + ev.clientX + "," + ev.clientY + ",1"); return; }
          if (long) { tapAt = Date.now(); send(id, "dbl2", at); return; }
          if (moved) return;
          const t = Date.now();
          if (t - lastTap < 320 && Math.abs(ev.clientX - lx) + Math.abs(ev.clientY - ly) < 30) { lastTap = 0; tapAt = t; send(id, "dbl", at); }
          else { lastTap = t; lx = ev.clientX; ly = ev.clientY; }
        };
        addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
      });
    }
    else if (k === "dbl2") {
      let last = 0;
      n.addEventListener("contextmenu", (e) => {
        const sol = e.target.closest("[data-solid]");
        if (sol && !(sol.classList.contains("u-canvas") && !e.target.closest("input"))) return;
        e.preventDefault();
        // a long press of a finger is a super already: its menu event is not a right click
        if (Date.now() - touchAt < 1500) return;
        const t = Date.now();
        // two right clicks with no box drawn between them
        if (t - last < 450 && last > rdragAt) { last = 0; const r = n.getBoundingClientRect(); send(id, k, e.clientX + "," + e.clientY + "," + (e.clientX - r.left) + "," + (e.clientY - r.top)); } else last = t;
      });
    }
    // a key typed into something that is not a field (the HAL-OS screen): it goes only there
    else if (k === "key") n.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      if (key.length === 1 || key === "Enter" || key === "Backspace" || key === "Escape" || key === "Tab") { e.preventDefault(); e.stopPropagation(); send(id, k, key); }
    });
    else if (k === "files") n.addEventListener("change", () => { const v = fileList(n.files); n.value = ""; send(id, k, v); });
    else if (k === "drop") {
      n.addEventListener("dragover", (e) => e.preventDefault());
      // folders dropped (any number) are read through, with their paths
      n.addEventListener("drop", (e) => {
        e.preventDefault();
        const ents = [...(e.dataTransfer.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
        if (!ents.some((x) => x.isDirectory)) { send(id, k, fileList(e.dataTransfer.files)); return; }
        const out = [];
        const readAll = (dir) => new Promise((res) => { const rd = dir.createReader(), all = []; const step = () => rd.readEntries((es) => { if (!es.length) res(all); else { all.push(...es); step(); } }, () => res(all)); step(); });
        const walk = async (en, pre) => {
          if (en.isFile) { const f = await new Promise((res) => en.file(res, () => res(null))); if (f) out.push([pre + en.name, f]); }
          else if (en.isDirectory && en.name !== "Duplicates (Face Mace)") { for (const c of await readAll(en)) await walk(c, pre + en.name + "/"); }
        };
        (async () => { for (const en of ents) await walk(en, ""); send(id, k, out.map(([p, f]) => { const i = files.length; files.push(f); return i + "\t" + f.size + "\t" + p.replace(/[\t\n]/g, " "); }).join("\n")); })();
      });
    } else n.addEventListener(k, (e) => {
      if (n.dataset && n.dataset.stop) e.stopPropagation();
      // a tip sitting on a link (the sidebar's icons) wires; it does not follow the link
      if (n.dataset && n.dataset.nonav) e.preventDefault();
      send(id, k, n.type === "checkbox" ? (n.checked ? "1" : "0") : (n.value ?? ""));
    });
  },
  body: () => keep(document.body),
  head: () => keep(document.head),
  fetch: (req, mp, ml, up, ul, bp, bl, form) => {
    const url = str(up, ul), init = { method: str(mp, ml), headers: {} };
    const tok = safe(() => localStorage.getItem("sp_token"), null);
    if (tok && url.startsWith("/api/")) init.headers.Authorization = "Bearer " + tok;
    // piii VPN (Tools → piii VPN): the person's own server, with its own sign-in (kept per server) and the header it
    // asks for; nothing of this site's own sign-in goes there
    const vpn = /^https?:\/\/[^/]+\/api\/pvpn\//.test(url) ? safe(() => new URL(url).origin, "") : "";
    if (vpn) {
      init.headers["X-PVPN"] = "1";
      const vt = safe(() => localStorage.getItem("pvpn_token:" + vpn), null);
      if (vt) init.headers.Authorization = "Bearer " + vt;
    }
    if (form) { init.body = forms[form]; forms[form] = undefined; }
    else if (bl) { init.body = str(bp, bl); init.headers["Content-Type"] = "application/json"; }
    (async () => {
      let status = 0;
      try {
        const r = await fetch(url, init);
        status = r.status;
        const rd = r.body.getReader(), d = new TextDecoder();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          const s = d.decode(value, { stream: true });
          if (s) { const [p, l] = put(s); W.fetched(req, status, p, l, 0); }
        }
        const [p, l] = put(d.decode());
        W.fetched(req, status, p, l, 1);
      } catch (e) {
        const [p, l] = put(String(e));
        W.fetched(req, 0, p, l, 1);
      }
    })();
  },
  form: () => { forms.push(new FormData()); return forms.length - 1; },
  form_str: (f, kp, kl, vp, vl) => forms[f].append(str(kp, kl), str(vp, vl)),
  form_file: (f, kp, kl, file) => { if (files[file]) forms[f].append(str(kp, kl), files[file]); },
  store_get: (kp, kl) => ret(safe(() => localStorage.getItem(str(kp, kl)), null)),
  store_set: (kp, kl, vp, vl) => safe(() => localStorage.setItem(str(kp, kl), str(vp, vl))),
  store_del: (kp, kl) => safe(() => localStorage.removeItem(str(kp, kl))),
  cookie: () => ret(document.cookie),
  set_cookie: (p, l) => { document.cookie = str(p, l); },
  href: () => ret(location.href),
  replace_url: (p, l) => history.replaceState(null, "", str(p, l)),
  go: (p, l) => { location.href = str(p, l); },
  open: (p, l) => window.open(str(p, l), "_blank", "noopener"),
  set_timer: (ms, token) => setTimeout(() => W.timer(token), ms),
  now: () => Date.now(),
  log_: (p, l) => console.log(str(p, l)),
  title: (p, l) => { document.title = str(p, l); },
  scroll_top: () => window.scrollTo(0, 0),
  focus: (id) => nodes[id].focus(),
  print: () => window.print(),
  vw: () => window.innerWidth,
  vh: () => window.innerHeight,
  capture: (on) => { capturing = !!on; document.documentElement.classList.toggle("dragging", capturing); },
  download: (np, nl, tp, tl, dp, dl) => {
    const blob = new Blob([new Uint8Array(W.memory.buffer, dp, dl).slice()], { type: str(tp, tl) });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: str(np, nl) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },
  call: (op, ol, ap, al) => { const f = ops[str(op, ol)]; return ret(f ? safe(() => f(str(ap, al)), null) : null); },
};

// Helpers with no import of their own, called by name: host.call("audio", "play\turl\tloopStart\tloopLength").
let actx = null, song = null, songUrl = "", src = null, gain = null;
// Hands bytes back to the program: W.pixels(token, pointer, length, width, height).
function give(token, bytes, w, h) {
  const p = bytes.length ? W.alloc(bytes.length) : 0;
  if (bytes.length) new Uint8Array(W.memory.buffer, p, bytes.length).set(bytes);
  W.pixels(token, p, bytes.length, w, h);
}
// ------------------------------------------------------------------------------------------- Intern's calls
const RTC = { state: "idle", peer: "", name: "", video: false, muted: false, error: "", pc: null, local: null, remote: null, offer: null, early: [], after: 0, polling: false };
const rtcApi = (path, body) => {
  const tok = safe(() => localStorage.getItem("sp_token"), null), h = { "Content-Type": "application/json" };
  if (tok) h.Authorization = "Bearer " + tok;
  return fetch(path, body ? { method: "POST", headers: h, body: JSON.stringify(body), credentials: "same-origin" } : { headers: h, credentials: "same-origin" });
};
const rtcSend = (kind, data) => rtcApi("/api/intern/signal", { to: RTC.peer, kind, data: typeof data === "string" ? data : JSON.stringify(data || {}) }).catch(() => {});
const rtcShow = () => {
  const l = document.getElementById("intern-local"), r = document.getElementById("intern-remote");
  if (l && RTC.local && l.srcObject !== RTC.local) { l.srcObject = RTC.local; l.muted = true; }
  if (r && RTC.remote && r.srcObject !== RTC.remote) r.srcObject = RTC.remote;
  let au = document.getElementById("intern-audio");
  if (RTC.remote && !RTC.video) {
    if (!au) { au = Object.assign(document.createElement("audio"), { id: "intern-audio", autoplay: true }); au.hidden = true; document.body.appendChild(au); }
    if (au.srcObject !== RTC.remote) au.srcObject = RTC.remote;
  } else if (au && !RTC.remote) au.remove();
};
// the page is told at once when the call changes (Intern's token 5_999_999), instead of at its next look
const rtcPing = () => { try { give(5999999, enc.encode("rtc"), 1, 1); } catch (_) {} };
// a ring while a call waits to be answered: two short tones every two seconds, and the phone buzzes
let ringTimer = 0;
const ring = (on) => {
  clearInterval(ringTimer); ringTimer = 0;
  if (!on) return;
  const beep = () => {
    try { ops.tone("880\t880\t180\tsine\t0.06"); setTimeout(() => ops.tone("660\t660\t220\tsine\t0.06"), 240); } catch (_) {}
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };
  beep(); ringTimer = setInterval(beep, 2000);
};
// a notice on the phone or the desktop, when the app is not in front (or always, if asked)
function notify(title, body, tag, always) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  if (!always && !document.hidden) return false;
  const o = { body: body || "", tag: tag || "intern", icon: "/intern/icon-192.png", badge: "/intern/icon-192.png", renotify: true };
  const show = (reg) => { if (reg && reg.showNotification) reg.showNotification(title, o); else { try { new Notification(title, o); } catch (_) {} } };
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(show, () => show(null)); else show(null);
  return true;
}
const rtcStop = (state, error) => {
  ring(false);
  if (RTC.pc) { try { RTC.pc.close(); } catch (_) {} }
  if (RTC.local) RTC.local.getTracks().forEach((t) => t.stop());
  Object.assign(RTC, { pc: null, local: null, remote: null, offer: null, early: [], muted: false, state: state || "ended", error: error || "" });
  const au = document.getElementById("intern-audio"); if (au) au.remove();
  rtcPing();
};
const rtcPc = async () => {
  RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: RTC.video });
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  RTC.local.getTracks().forEach((t) => pc.addTrack(t, RTC.local));
  pc.onicecandidate = (e) => { if (e.candidate) rtcSend("ice", e.candidate.toJSON()); };
  pc.ontrack = (e) => { RTC.remote = e.streams[0] || new MediaStream([e.track]); rtcShow(); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") { RTC.state = "connected"; ring(false); rtcShow(); rtcPing(); }
    else if (pc.connectionState === "failed") rtcStop("ended", "the connection failed");
  };
  RTC.pc = pc;
  return pc;
};
const rtcIce = async (c) => { try { await RTC.pc.addIceCandidate(c); } catch (_) {} };
async function rtcGot(s) {
  let d = {}; try { d = JSON.parse(s.data || "{}"); } catch (_) {}
  if (s.kind === "offer") {
    if (RTC.state !== "idle" && RTC.state !== "ended") { RTC.peer === s.from || rtcApi("/api/intern/signal", { to: s.from, kind: "decline", data: "{}" }); return; }
    Object.assign(RTC, { state: "ringing", peer: s.from, name: s.name || "", video: !!d.video, offer: d, error: "", early: [] });
    ring(true);
    notify((s.name || "A colleague") + " is calling", d.video ? "Video call: open Intern to answer" : "Call: open Intern to answer", "intern-call");
    rtcPing();
  } else if (s.from !== RTC.peer) return;
  else if (s.kind === "answer" && RTC.pc) { await RTC.pc.setRemoteDescription({ type: "answer", sdp: d.sdp }); for (const c of RTC.early) await rtcIce(c); RTC.early = []; }
  else if (s.kind === "ice") { if (RTC.pc && RTC.pc.remoteDescription) await rtcIce(d); else RTC.early.push(d); }
  else if (s.kind === "hangup") rtcStop("ended", "");
  else if (s.kind === "decline") rtcStop("ended", "declined");
}
async function rtcPoll() {
  try {
    const r = await rtcApi("/api/intern/signals?after=" + RTC.after);
    if (r.status === 401 || r.status === 403) { RTC.polling = false; return; }
    if (r.ok) { const j = await r.json(); RTC.after = j.last || RTC.after; for (const s of j.signals || []) await rtcGot(s); }
  } catch (_) {}
  setTimeout(rtcPoll, RTC.state === "idle" || RTC.state === "ended" ? 2500 : 900);
}
function rtc(a) {
  const cmd = a[0];
  if (cmd === "listen") { if (!RTC.polling) { RTC.polling = true; rtcPoll(); } return "1"; }
  if (cmd === "state") { rtcShow(); return JSON.stringify({ state: RTC.state, name: RTC.name, video: RTC.video, muted: RTC.muted, error: RTC.error }); }
  if (cmd === "call") {
    if (!(navigator.mediaDevices && window.RTCPeerConnection)) { Object.assign(RTC, { state: "ended", error: "this browser cannot make calls" }); return "1"; }
    if (RTC.state !== "idle" && RTC.state !== "ended") return null;
    Object.assign(RTC, { state: "calling", peer: a[1], video: a[2] === "1", name: a[3] || "", error: "", early: [] });
    rtcPing();
    (async () => {
      try {
        const pc = await rtcPc(), o = await pc.createOffer();
        await pc.setLocalDescription(o);
        rtcSend("offer", { sdp: o.sdp, video: RTC.video });
      } catch (e) { rtcStop("ended", String((e && e.message) || e)); }
    })();
    if (!RTC.polling) { RTC.polling = true; rtcPoll(); }
    return "1";
  }
  if (cmd === "accept" && RTC.state === "ringing") {
    ring(false);
    (async () => {
      try {
        const pc = await rtcPc();
        await pc.setRemoteDescription({ type: "offer", sdp: RTC.offer.sdp });
        for (const c of RTC.early) await rtcIce(c); RTC.early = [];
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        rtcSend("answer", { sdp: ans.sdp });
        RTC.state = "connected"; rtcPing();
      } catch (e) { rtcSend("hangup"); rtcStop("ended", String((e && e.message) || e)); }
    })();
    return "1";
  }
  if (cmd === "hangup") {
    if (RTC.state === "ended") { RTC.state = "idle"; RTC.error = ""; return "1"; }
    if (RTC.state !== "idle") rtcSend(RTC.state === "ringing" ? "decline" : "hangup");
    rtcStop("idle", "");
    return "1";
  }
  if (cmd === "mute" && RTC.local) { RTC.muted = !RTC.muted; RTC.local.getAudioTracks().forEach((t) => (t.enabled = !RTC.muted)); return "1"; }
  return null;
}

// what the last press was made with: a finger ("touch"), a mouse or a pen
let lastPointer = "mouse";
addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; }, true);
// HEIC/HEIF (an iPhone's photos): Safari decodes them itself; elsewhere libheif (WebAssembly, LGPL, loaded from
// /facemace/heic/ only when such a photo is chosen) does. A small JPEG of each is kept as its thumbnail.
const isHeic = (f) => /\.(heic|heif)$/i.test(f.name || "") || /image\/hei[cf]/i.test(f.type || "");
const isVideo = (f) => /^video\//i.test(f.type || "") || /\.(mp4|m4v|mov|3gp|3g2|avi|mkv|webm|wmv|mts|m2ts|mpg|mpeg|flv|ogv)$/i.test(f.name || "");
let heicLib = null;
const heicThumbs = {}, rawUrls = {};
const thumbOf = (cv, idx) => {
  if (idx == null || heicThumbs[idx]) return;
  const k = Math.min(1, 240 / Math.max(cv.width, cv.height)), t = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(cv.width * k)), height: Math.max(1, Math.round(cv.height * k)) });
  t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
  heicThumbs[idx] = t.toDataURL("image/jpeg", 0.8);
};
// a video: one frame, a second in (or halfway through a shorter one), where Face Mace looks for faces
async function videoFrame(f, idx) {
  const url = URL.createObjectURL(f), v = document.createElement("video");
  Object.assign(v, { muted: true, playsInline: true, preload: "auto", src: url });
  const wait = (ev) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("this video could not be read")), 20000); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); v.addEventListener("error", () => { clearTimeout(t); rej(new Error("this video's format cannot be played here")); }, { once: true }); });
  try {
    await wait("loadedmetadata");
    const p = wait("seeked"); v.currentTime = Math.min(1, (isFinite(v.duration) && v.duration > 0 ? v.duration : 2) / 2); await p;
    if (!v.videoWidth) throw new Error("no picture in this video");
    const cv = Object.assign(document.createElement("canvas"), { width: v.videoWidth, height: v.videoHeight });
    cv.getContext("2d").drawImage(v, 0, 0);
    thumbOf(cv, idx);
    return cv;
  } finally { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }
}
async function decodeImage(f, idx) {
  if (isVideo(f)) return videoFrame(f, idx);
  try { return await createImageBitmap(f); } catch (e) { if (!isHeic(f)) throw e; }
  if (!heicLib) heicLib = (await import("/facemace/heic/libheif-bundle.mjs")).default();
  const imgs = new heicLib.HeifDecoder().decode(new Uint8Array(await f.arrayBuffer()));
  if (!imgs || !imgs.length) throw new Error("no image in this HEIC file");
  const im = imgs[0], w = im.get_width(), h = im.get_height();
  const id = new ImageData(w, h);
  await new Promise((res, rej) => im.display(id, (r) => (r ? res() : rej(new Error("HEIC could not be decoded")))));
  for (const x of imgs) { try { x.free(); } catch (_) {} }
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
  cv.getContext("2d").putImageData(id, 0, 0);
  thumbOf(cv, idx);
  return cv;
}

// Face Mace's neural engines (front/facemace/ml, NOTICE.txt): YuNet finds faces and their landmarks, SFace describes
// an aligned face, both run by ONNX Runtime (WebAssembly), loaded when a sort starts. Answers come back on token
// 6_000_000 ("ok", "error …") and the results of a run on 6_000_001.
let ml = null;
const ML_OUT = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"];
// they run in a worker of their own (front/facemace/ml/worker.mjs), so the page keeps answering the mouse while they
// work; where a module worker cannot start, on the page as before
let mlWorker = null, mlSeq = 0;
const mlWait = new Map();
function mlAsk(msg, transfer) {
  return new Promise((res, rej) => { const id = ++mlSeq; mlWait.set(id, { res, rej }); mlWorker.postMessage({ ...msg, id }, transfer || []); });
}
async function mlLoad() {
  try {
    mlWorker = new Worker("/facemace/ml/worker.mjs", { type: "module" });
    mlWorker.onmessage = (e) => { const w = mlWait.get(e.data.id); if (!w) return; mlWait.delete(e.data.id); if (e.data.error) w.rej(new Error(e.data.error)); else w.res(e.data); };
    mlWorker.onerror = (e) => { for (const w of mlWait.values()) w.rej(new Error((e && e.message) || "the engine worker stopped")); mlWait.clear(); };
    await mlAsk({ kind: "load" });
    ml = { worker: true };
    return;
  } catch (_) {
    if (mlWorker) { try { mlWorker.terminate(); } catch (_) {} }
    mlWorker = null;
  }
  const ort = await import("/facemace/ml/ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = "/facemace/ml/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  const opt = { executionProviders: ["wasm"], graphOptimizationLevel: "all", logSeverityLevel: 3 };
  const [yunet, sface] = await Promise.all([ort.InferenceSession.create("/facemace/ml/yunet.onnx", opt), ort.InferenceSession.create("/facemace/ml/sface.onnx", opt)]);
  ml = { ort, yunet, sface };
}
async function mlRun(model, data, dims) {
  if (ml.worker) return (await mlAsk({ kind: "run", model, data, dims }, [data.buffer])).out;
  const t = new ml.ort.Tensor("float32", data, dims);
  if (model === "yunet") {
    const r = await ml.yunet.run({ input: t });
    const parts = ML_OUT.map((k) => r[k].data), n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n);
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const r = await ml.sface.run({ data: t });
  return r.fc1.data;
}

// The folder Face Mace reads from, opened with the browser's folder access (Chrome, Edge), so that duplicates can be
// moved aside or deleted there when the person says so: where each chosen file lives (its folder and name).
let srcRoots = [];
// Photos kept on a Face Mace Server (back/facemace-server; owner, 2026-10-15: "a server who serves my photos through
// Face Mace"): files[i] is then a stand-in with the photo's name, size, type and date, and its bytes are fetched
// from the server when they are needed (the last few kept, as a photo is read twice: decoded, then shown)
class RemoteFile {
  constructor(p) { this.remote = true; this.id = p.id; this.url = p.url; this.name = p.name; this.size = p.size; this.type = p.type || ""; this.lastModified = p.mtime || 0; }
}
const remoteKept = new Map();
function fileOf(i) {
  const f = files[i];
  if (!f || !f.remote) return Promise.resolve(f);
  if (remoteKept.has(i)) return remoteKept.get(i);
  const p = fetch(f.url, { credentials: "same-origin" })
    .then((r) => { if (!r.ok) throw new Error("the server answered " + r.status); return r.blob(); })
    .then((b) => new File([b], f.name.split("/").pop(), { type: f.type || b.type, lastModified: f.lastModified }));
  remoteKept.set(i, p);
  if (remoteKept.size > 6) remoteKept.delete(remoteKept.keys().next().value);
  p.catch(() => remoteKept.delete(i));
  return p;
}
const srcAt = {};
const MEDIA = /\.(jpe?g|png|heic|heif|mp4|m4v|mov|3gp|3g2|avi|mkv|webm|wmv|mts|m2ts|mpg|mpeg|flv|ogv)$/i;
async function srcWalk(dir, pre, out) {
  for await (const [n, h] of dir.entries()) {
    if (h.kind === "directory") { if (n !== "Duplicates (Face Mace)") await srcWalk(h, pre + n + "/", out); }
    else if (MEDIA.test(n)) out.push([pre + n, await h.getFile(), dir, n]);
  }
}
async function srcFree(dir, name) {
  let n = name, k = 1;
  for (;;) { try { await dir.getFileHandle(n); k++; const dot = name.lastIndexOf("."); n = dot > 0 ? name.slice(0, dot) + " (" + k + ")" + name.slice(dot) : name + " (" + k + ")"; } catch (_) { return n; } }
}

let wakeLock = null, wakeWanted = false, wakeBeat = 0;
const wakeGet = () => {
  if (!wakeWanted || wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  navigator.wakeLock.request("screen").then((l) => { wakeLock = l; l.addEventListener("release", () => { wakeLock = null; }); }, () => {});
};
document.addEventListener("visibilitychange", wakeGet);

// Face Mace's own store in this browser (IndexedDB): each photo's scan, so a sort that was closed goes on where it
// was (owner, 2026-10-15: "the state of the app saves automatically")
let kvDb = null;
const kvOpen = () => kvDb || (kvDb = new Promise((res, rej) => { const r = indexedDB.open("facemace", 1); r.onupgradeneeded = () => r.result.createObjectStore("scan"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const kvDo = (mode, f) => kvOpen().then((db) => new Promise((res, rej) => { const t = db.transaction("scan", mode), q = f(t.objectStore("scan")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));

// the folder Face Mace saves into, and what waits to be written there
let outDir = null, outQ = [], outBusy = false, outSaved = 0, zipStop = false;
async function outRun() {
  outBusy = true;
  try {
    while (outQ.length && outDir) {
      const job = outQ.shift();
      if (job.mv || job.rm) {
        // a file already written, renamed or moved (a person named or corrected afterwards), or taken away
        const [from, to] = job.mv || [job.rm, null], fp = from.split("/").filter(Boolean), oldName = fp.pop();
        let d = outDir; for (const p of fp) d = await d.getDirectoryHandle(p, { create: true });
        if (!to) { try { await d.removeEntry(oldName); } catch (_) {} continue; }
        const tp = to.split("/").filter(Boolean), newName = tp.pop();
        let nd = outDir; for (const p of tp) nd = await nd.getDirectoryHandle(p, { create: true });
        const fh = await d.getFileHandle(oldName), same = fp.join("/") === tp.join("/");
        if (same && typeof fh.move === "function") await fh.move(newName);
        else if (typeof fh.move === "function") await fh.move(nd, newName);
        else { const data = await fh.getFile(), nh = await nd.getFileHandle(newName, { create: true }), w = await nh.createWritable(); await w.write(data); await w.close(); await d.removeEntry(oldName); }
        continue;
      }
      const [path, idx] = job, parts = path.split("/").filter(Boolean), name = parts.pop();
      let d = outDir;
      for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(name, { create: true }), w = await fh.createWritable();
      await w.write(await fileOf(idx)); await w.close();
      outSaved++;
      give(2000002, enc.encode("saved " + outSaved), 1, 1);
    }
  } catch (e) { outQ = []; give(2000002, enc.encode("error " + ((e && e.message) || e)), 1, 1); }
  outBusy = false;
}

// ZIP, built from the chosen files where they are (a Blob of the files themselves: nothing is copied into memory),
// stored, with ZIP64 so neither a file nor the whole is held to 4 GB or 65 535 entries. Progress goes back on token
// 2_000_001 ("k/n", then "done n" or "error …").
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function crcOf(file) {
  let c = 0xFFFFFFFF; const r = file.stream().getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; for (let i = 0; i < value.length; i++) c = CRC_T[(c ^ value[i]) & 255] ^ (c >>> 8); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function zipFiles(name, list) {
  const tell = (m) => give(2000001, enc.encode(m), 1, 1);
  const parts = [], central = []; let off = 0;
  const le = (n, b) => { const a = new Uint8Array(b); let v = BigInt(n); for (let i = 0; i < b; i++) { a[i] = Number(v & 255n); v >>= 8n; } return a; };
  const cat = (...xs) => { const n = xs.reduce((a, x) => a + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  zipStop = false;
  for (let k = 0; k < list.length; k++) {
    if (zipStop) { tell("error stopped"); return; }
    const [path, idx] = list[k];
    if (!files[idx]) continue;
    const file = await fileOf(idx);
    const nm = enc.encode(path), size = file.size, crc = await crcOf(file);
    const x64 = cat(le(1, 2), le(16, 2), le(size, 8), le(size, 8));
    const local = cat(le(0x04034b50, 4), le(45, 2), le(0x0800, 2), le(0, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(0xFFFFFFFF, 4), le(0xFFFFFFFF, 4), le(nm.length, 2), le(x64.length, 2), nm, x64);
    const c64 = cat(le(1, 2), le(24, 2), le(size, 8), le(size, 8), le(off, 8));
    central.push(cat(le(0x02014b50, 4), le(45, 2), le(45, 2), le(0x0800, 2), le(0, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(0xFFFFFFFF, 4), le(0xFFFFFFFF, 4), le(nm.length, 2), le(c64.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(0xFFFFFFFF, 4), nm, c64));
    parts.push(local, file); off += local.length + size;
    if (k % 20 === 0 || k === list.length - 1) tell((k + 1) + "/" + list.length);
  }
  const cd = cat(...central), cdOff = off, n = central.length;
  const z64 = cat(le(0x06064b50, 4), le(44, 8), le(45, 2), le(45, 2), le(0, 4), le(0, 4), le(n, 8), le(n, 8), le(cd.length, 8), le(cdOff, 8));
  const loc = cat(le(0x07064b50, 4), le(0, 4), le(cdOff + cd.length, 8), le(1, 4));
  const end = cat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(0xFFFF, 2), le(0xFFFF, 2), le(0xFFFFFFFF, 4), le(0xFFFFFFFF, 4), le(0, 2));
  const blob = new Blob([...parts, cd, z64, loc, end], { type: "application/zip" }), u = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: u, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 600000);
  tell("done " + n);
}
const ops = {
  ptr: () => lastPointer,
  // Intern: notices. notify: title, body, tag (shown only when the app is not in front); notify-ask asks once and
  // hands the answer back on token 5_999_998; notify-state is "granted", "denied", "default" or "unsupported"
  notify: (a) => { const [t, b, tag] = a.split("\t"); return notify(t, b, tag, false) ? "1" : "0"; },
  "notify-state": () => ("Notification" in window ? Notification.permission : "unsupported"),
  "notify-ask": () => {
    if (!("Notification" in window)) return "unsupported";
    Promise.resolve(Notification.requestPermission()).then((p) => give(5999998, enc.encode(String(p)), 1, 1), () => give(5999998, enc.encode("denied"), 1, 1));
    return "1";
  },
  hidden: () => (document.hidden ? "1" : "0"),
  // a chosen picture, shrunk to fit max × max and handed back as a JPEG data: URL (kept in the browser only)
  imgurl: (a) => {
    const [token, file, max] = a.split("\t").map(Number);
    (async () => {
      try {
        const bmp = await createImageBitmap(files[file]);
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
        cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        give(token, enc.encode(cv.toDataURL("image/jpeg", 0.82)), w, h);
      } catch (_) { give(token, new Uint8Array(0), 0, 0); }
    })();
    return "1";
  },
  // Intern's calls: WebRTC between two doctors, the offer, answer and candidates passed through /api/intern/signal.
  // listen | state | call\tkey\tvideo\tname | accept | hangup | mute
  rtc: (a) => rtc(a.split("\t")),
  // the browser's Ethereum wallet: token, method, params (JSON); the answer comes back as {"ok": …} or {"err": code, "msg": …}
  eth: (a) => {
    const [token, method, params] = a.split("\t"), w = window.ethereum;
    if (!w || !w.request) return null;
    const back = (o) => give(+token, enc.encode(JSON.stringify(o)), 1, 1);
    w.request({ method, params: JSON.parse(params || "[]") }).then((r) => back({ ok: r ?? null }), (e) => back({ err: (e && e.code) || 0, msg: String((e && e.message) || e) }));
    return "1";
  },
  // RGBA bytes in the program's memory, onto the canvas a selector names: selector, pointer, length, width, height
  blit: (a) => {
    const [sel, p, l, w, h] = a.split("\t"), cv = document.querySelector(sel);
    if (!cv) return null;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(W.memory.buffer, +p, +l).slice(), +w, +h), 0, 0);
    return "1";
  },
  // a file the server decides on (a paper): fetched with the session so an author gets their own private one, saved
  // under a name; when it is not available, the fallback (the publisher's copy) opens instead
  getfile: (a) => {
    const [url, name, fallback] = a.split("\t"), tok = safe(() => localStorage.getItem("sp_token"), null);
    fetch(url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }).then(async (r) => {
      if (!r.ok) throw new Error(r.status);
      const blob = await r.blob(), u = URL.createObjectURL(blob);
      const el = Object.assign(document.createElement("a"), { href: u, download: name || "paper.pdf" });
      document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000);
    }).catch(() => { if (fallback) window.open(fallback, "_blank", "noopener"); else alert("The paper's file is not available to you: it stays private until its author publishes it."); });
    return "1";
  },
  copy: (a) => { navigator.clipboard && navigator.clipboard.writeText(a).catch(() => {}); return "1"; },
  // a chosen picture, decoded by the browser (HEIC/HEIF too: see decodeImage) and shrunk to fit max × max: its RGBA pixels
  rgba: (a) => {
    const [token, file, max] = a.split("\t").map(Number);
    (async () => {
      try {
        const bmp = await decodeImage(await fileOf(file), file);
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        give(token, ctx.getImageData(0, 0, w, h).data, w, h);
      } catch (_) { give(token, new Uint8Array(0), 0, 0); }
    })();
    return "1";
  },
  // a chosen file's bytes
  bytes: (a) => {
    const [token, file] = a.split("\t").map(Number);
    fileOf(file).then((f) => f.arrayBuffer()).then((b) => give(token, new Uint8Array(b), 1, 1)).catch(() => give(token, new Uint8Array(0), 0, 0));
    return "1";
  },
  // a short tone (the game's sounds): from, to (Hz), ms, wave, gain
  tone: (a) => {
    const [f1, f2, ms, type, gain] = a.split("\t");
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    const t0 = actx.currentTime, d = (+ms) / 1000, osc = actx.createOscillator(), amp = actx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(+f1, t0);
    if (+f2 && +f2 !== +f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, +f2), t0 + d);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(+gain || 0.05, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(amp); amp.connect(actx.destination); osc.start(t0); osc.stop(t0 + d + 0.02);
    return "1";
  },
  // a chosen file, as an address the page can show
  // a chosen file at full size, for the photo viewer (made once per file)
  fileraw: (a) => { const i = +a; if (!files[i]) return ""; if (!rawUrls[i]) rawUrls[i] = isHeic(files[i]) ? (heicThumbs[i] || "") : files[i].remote ? files[i].url : URL.createObjectURL(files[i]); return rawUrls[i]; },
  fileurl: (a) => (heicThumbs[+a] || (files[+a] && !isVideo(files[+a]) ? (files[+a].remote ? files[+a].url : URL.createObjectURL(files[+a])) : "")),
  // part of a chosen file: token, file, start, length (Face Mace reads where a photo or video says it was taken)
  slice: (a) => {
    const [token, idx, start, len] = a.split("\t").map(Number), f = files[idx];
    if (!f) return null;
    if (f.remote) {
      // only that part, asked of the server (it answers ranges); the whole file if it does not
      fetch(f.url, { credentials: "same-origin", headers: { Range: "bytes=" + start + "-" + (start + len - 1) } })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.status === 206 ? r.arrayBuffer() : r.arrayBuffer().then((b) => b.slice(start, start + len)); })
        .then((b) => give(token, new Uint8Array(b), 1, 1), () => give(token, new Uint8Array(0), 0, 0));
      return "1";
    }
    f.slice(start, start + len).arrayBuffer().then((b) => give(token, new Uint8Array(b), 1, 1), () => give(token, new Uint8Array(0), 0, 0));
    return "1";
  },
  // a folder on this computer to save into (Chrome, Edge): a new folder of the given name is made in the one picked;
  // the answer comes back on token 2_000_002 ("dir <name>" or "error …"). canpick says whether the browser can.
  canpick: () => (typeof window.showDirectoryPicker === "function" ? "1" : "0"),
  // piii OS onto a flash drive (Tools → piii OS): the drive chosen (or its EFI folder, where the browser will not open
  // a drive itself), piii OS fetched from this site, written to EFI/BOOT/BOOTX64.EFI and read back to check; a boot
  // file already there is kept as BOOTX64-before-piii.EFI. Progress and the answer come back on token 7_000_000:
  // "step …", "done bytes\tname\tkept\twhere" or "error …".
  osflash: (a) => {
    if (typeof window.showDirectoryPicker !== "function") return null;
    const tell = (s) => give(7000000, enc.encode(s), 1, 1);
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    (async () => {
      let root;
      try { root = await window.showDirectoryPicker({ mode: "readwrite", id: "piii-os" }); }
      catch (e) { return tell("error " + (e && e.name === "AbortError" ? "cancelled" : (e && e.message) || e)); }
      try {
        tell("step Getting piii OS from piii.app…");
        const r = await fetch(a, { cache: "no-store" });
        if (!r.ok) throw new Error("piii OS could not be downloaded (the site answered " + r.status + ")");
        const bin = new Uint8Array(await r.arrayBuffer());
        if (bin.length < 4096 || bin[0] !== 0x4d || bin[1] !== 0x5a) throw new Error("what was downloaded is not a UEFI program");
        const inEfi = root.name.toUpperCase() === "EFI";
        const efi = inEfi ? root : await root.getDirectoryHandle("EFI", { create: true });
        const boot = await efi.getDirectoryHandle("BOOT", { create: true });
        let kept = "";
        try {
          const old = new Uint8Array(await (await (await boot.getFileHandle("BOOTX64.EFI")).getFile()).arrayBuffer());
          if (!same(old, bin)) {
            const w = await (await boot.getFileHandle("BOOTX64-before-piii.EFI", { create: true })).createWritable();
            await w.write(old); await w.close(); kept = "1";
          }
        } catch (_) { /* nothing there before */ }
        tell("step Writing piii OS to the drive…");
        const fh = await boot.getFileHandle("BOOTX64.EFI", { create: true });
        const w = await fh.createWritable();
        await w.write(bin); await w.close();
        tell("step Checking what was written…");
        const back = new Uint8Array(await (await fh.getFile()).arrayBuffer());
        if (!same(back, bin)) throw new Error("what was read back differs from what was written: try another flash drive");
        tell("done " + bin.length + "\t" + root.name + "\t" + kept + "\t" + (inEfi ? "efi" : "drive"));
      } catch (e) {
        const m = (e && e.message) || String(e);
        tell("error " + (/not allowed|denied|security/i.test(m) ? "the browser did not allow writing there (" + m + ")" : m));
      }
    })();
    return "1";
  },
  // on a Face Mace Server: the edition its page asks for ("full"), whether it keeps photos, and their list (given
  // as a folder chosen is, on token 2_000_005; a problem on 2_000_008)
  edition: () => document.documentElement.dataset.edition || "",
  library: () => (document.documentElement.dataset.library ? "1" : ""),
  srvlist: () => {
    const lib = document.documentElement.dataset.library;
    if (!lib) return null;
    fetch(lib, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "sign in on the server's page first" : r.status === 403 ? "your account is not active yet" : "the server answered " + r.status))))
      .then((d) => {
        const lines = (d.photos || []).map((p) => { const i = files.length; files.push(new RemoteFile(p)); srcAt[i] = ["remote", p.id]; return i + "\t" + p.size + "\t" + ("Server/" + p.name).replace(/[\t\n]/g, " "); });
        give(2000005, enc.encode(lines.join("\n")), 1, 1);
      }, (e) => give(2000008, enc.encode((e && e.message) || String(e)), 1, 1));
    return "1";
  },
  pickdir: (a) => {
    if (typeof window.showDirectoryPicker !== "function") return null;
    window.showDirectoryPicker({ mode: "readwrite", id: "facemace" }).then(async (root) => {
      let name = a || "Face Mace", n = 1;
      for (;;) { try { await root.getDirectoryHandle(n === 1 ? name : name + " (" + n + ")"); n++; } catch (_) { break; } }
      name = n === 1 ? name : name + " (" + n + ")";
      outDir = await root.getDirectoryHandle(name, { create: true }); outQ = []; outSaved = 0;
      give(2000002, enc.encode("dir " + name), 1, 1);
    }, (e) => give(2000002, enc.encode("error " + ((e && e.name === "AbortError") ? "cancelled" : (e && e.message) || e)), 1, 1));
    return "1";
  },
  // a chosen file into that folder (as soon as it is asked: one at a time, in order): "path\tfile"; "saved n" or
  // "error …" comes back on token 2_000_002
  save: (a) => {
    if (!outDir) return null;
    const t = a.lastIndexOf("\t");
    outQ.push([a.slice(0, t), +a.slice(t + 1)]);
    if (!outBusy) outRun();
    return "1";
  },
  "ml-load": () => {
    if (ml) { give(6000000, enc.encode("ok"), 1, 1); return "1"; }
    mlLoad().then(() => give(6000000, enc.encode("ok"), 1, 1), (e) => give(6000000, enc.encode("error " + ((e && e.message) || e)), 1, 1));
    return "1";
  },
  // a model run on floats in the program's memory: model, pointer, count, dims (comma separated)
  infer: (a) => {
    const [model, p, n, d] = a.split("\t");
    if (!ml) return null;
    const data = new Float32Array(W.memory.buffer, +p, +n).slice();
    mlRun(model, data, d.split(",").map(Number)).then((out) => give(6000001, new Uint8Array(out.buffer, out.byteOffset, out.byteLength), 1, 1), (e) => give(6000001, new Uint8Array(0), 0, 0));
    return "1";
  },
  // Face Mace's Stop: what waits to be written into the folder is dropped, and a ZIP being made is given up
  "save-stop": () => { outQ = []; return "1"; },
  // keep the computer awake while Face Mace works (owner, 2026-10-15: "dont let the windows sleep"): the screen wake
  // lock, taken again when the tab comes back; in the Windows app also a "busy" note to the program every 10 s,
  // which then keeps Windows from sleeping (SetThreadExecutionState)
  wake: (a) => {
    const on = a === "1";
    wakeWanted = on;
    if (on) {
      wakeGet();
      if (!wakeBeat && /^(127\.0\.0\.1|localhost|[a-z]+\.localhost)$/.test(location.hostname)) {
        const beat = () => fetch("/__busy", { cache: "no-store" }).catch(() => {});
        beat(); wakeBeat = setInterval(beat, 10000);
      }
    } else {
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
      if (wakeBeat) { clearInterval(wakeBeat); wakeBeat = 0; fetch("/__idle", { cache: "no-store" }).catch(() => {}); }
    }
    return "navigator" in window && "wakeLock" in navigator ? "1" : "0";
  },
  // the store: kvget "token\tkey" answers on the token (empty when there is none), kvput "key\tvalue", kvclear
  kvget: (a) => {
    const t = a.indexOf("\t"), token = +a.slice(0, t), key = a.slice(t + 1);
    kvDo("readonly", (s) => s.get(key)).then((v) => give(token, enc.encode(v || ""), 1, 1), () => give(token, new Uint8Array(0), 1, 1));
    return "1";
  },
  kvput: (a) => { const t = a.indexOf("\t"); kvDo("readwrite", (s) => s.put(a.slice(t + 1), a.slice(0, t))).catch(() => {}); return "1"; },
  kvclear: () => { kvDo("readwrite", (s) => s.clear()).catch(() => {}); return "1"; },
  // a folder to read from, with access kept (the list comes back on token 2_000_005, as the file picker's)
  pickfolder: () => {
    if (typeof window.showDirectoryPicker !== "function") return null;
    window.showDirectoryPicker({ mode: "read", id: "facemace-src" }).then(async (root) => {
      // each folder chosen is added (many can be): its files under its name, Holiday/2019/a.jpg
      const found = []; await srcWalk(root, root.name + "/", found);
      const ri = srcRoots.push(root) - 1;
      const lines = found.map(([path, file, dir, name]) => { const i = files.length; files.push(file); srcAt[i] = [dir, name, ri]; return i + "\t" + file.size + "\t" + path.replace(/[\t\n]/g, " "); });
      give(2000005, enc.encode(lines.join("\n")), 1, 1);
    }, () => {});
    return "1";
  },
  // duplicates out of the folder read from: "move" (into its "Duplicates (Face Mace)" folder) or "delete", then
  // the files (comma separated); "done n" or "error …" on token 2_000_006
  srcdel: (a) => {
    const [mode, list] = a.split("\t"), all = (list || "").split(",").filter(Boolean).map(Number);
    // photos on a Face Mace Server are put aside or deleted there; the others in their folders
    const rem = all.filter((i) => srcAt[i] && srcAt[i][0] === "remote"), ids = all.filter((i) => srcAt[i] && srcAt[i][0] !== "remote");
    const used = [...new Set(ids.map((i) => srcAt[i] && srcAt[i][2]).filter((x) => x !== undefined))];
    if (!used.length && !rem.length) return null;
    // asked for every folder at once, while the click is still fresh
    const perms = used.map((ri) => srcRoots[ri].requestPermission({ mode: "readwrite" }));
    (async () => {
      for (const p of perms) if ((await p) !== "granted") throw new Error("permission to change the folder was not given");
      let n = 0;
      for (const i of rem) {
        const id = srcAt[i][1];
        const r = await fetch("/api/fms/photos/" + id + (mode === "move" ? "/aside" : ""), { method: mode === "move" ? "POST" : "DELETE", headers: { "X-FMS": "1" }, credentials: "same-origin" });
        if (!r.ok) throw new Error("the server answered " + r.status);
        delete srcAt[i]; n++;
        give(2000006, enc.encode("progress " + n), 1, 1);
      }
      const asides = {};
      for (const i of ids) {
        const at = srcAt[i]; if (!at) continue;
        const [dir, name, ri] = at;
        const aside = mode === "move" ? (asides[ri] || (asides[ri] = await srcRoots[ri].getDirectoryHandle("Duplicates (Face Mace)", { create: true }))) : null;
        if (aside) {
          const fh = await dir.getFileHandle(name), free = await srcFree(aside, name);
          if (typeof fh.move === "function") await fh.move(aside, free);
          else { const data = await fh.getFile(), nh = await aside.getFileHandle(free, { create: true }), w = await nh.createWritable(); await w.write(data); await w.close(); await dir.removeEntry(name); }
        } else await dir.removeEntry(name);
        delete srcAt[i]; n++;
        give(2000006, enc.encode("progress " + n), 1, 1);
      }
      give(2000006, enc.encode("done " + n), 1, 1);
    })().catch((e) => give(2000006, enc.encode("error " + ((e && e.message) || e)), 1, 1));
    return "1";
  },
  // a file written into the folder, renamed: "from\tto" (paths in the folder, same place, new name)
  rmfile: (a) => {
    if (!outDir) return null;
    outQ.push({ rm: a });
    if (!outBusy) outRun();
    return "1";
  },
  mvfile: (a) => {
    if (!outDir) return null;
    const [from, to] = a.split("\t");
    outQ.push({ mv: [from, to] });
    if (!outBusy) outRun();
    return "1";
  },
  "zip-stop": () => { zipStop = true; return "1"; },
  // a ZIP of chosen files: its name, then a line "path\tfile" for each
  zip: (a) => {
    const [name, ...lines] = a.split("\n");
    zipFiles(name, lines.filter(Boolean).map((l) => { const t = l.lastIndexOf("\t"); return [l.slice(0, t), +l.slice(t + 1)]; })).catch((e) => give(2000001, enc.encode("error " + ((e && e.message) || e)), 1, 1));
    return "1";
  },
  // a chosen file's date (when it was last changed, in ms): Face Mace's fallback when a photo has no camera date
  filetime: (a) => (files[+a] ? String(files[+a].lastModified || 0) : "0"),
  // how far this computer's clock is ahead of UTC at a moment (ms since 1970), in ms: a video's UTC date made local
  tzoff: (a) => String(-new Date(+a || 0).getTimezoneOffset() * 60000),
  audio: (a) => {
    const [cmd, url, ls, ll] = a.split("\t");
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (cmd === "play") {
      if (actx.state === "suspended") actx.resume().catch(() => {});
      if (src) { gain.gain.setTargetAtTime(0.8, actx.currentTime, 0.08); return "1"; }
      const go = () => {
        if (src || !song) return;
        const d = song.getChannelData(0); let i = 0;
        while (i < d.length && Math.abs(d[i]) < 1e-4) i++;
        const at = i / song.sampleRate;
        src = actx.createBufferSource(); src.buffer = song; src.loop = true;
        src.loopStart = at; src.loopEnd = Math.min(song.duration, at + (+ll || song.duration));
        gain = actx.createGain(); gain.gain.setValueAtTime(0, actx.currentTime);
        gain.gain.linearRampToValueAtTime(0.8, actx.currentTime + 0.4);
        src.connect(gain).connect(actx.destination); src.start(actx.currentTime + 0.02, at + (+ls || 0));
      };
      if (song && songUrl === url) go();
      else { songUrl = url; fetch(url).then((r) => r.arrayBuffer()).then((b) => actx.decodeAudioData(b)).then((b) => { song = b; go(); }).catch(() => {}); }
      return "1";
    }
    if (cmd === "pause" && src && actx.state === "running") {
      gain.gain.setTargetAtTime(0, actx.currentTime, 0.08);
      setTimeout(() => { if (gain && gain.gain.value < 0.05) actx.suspend().catch(() => {}); }, 350);
    }
    return "1";
  },
};

const wasm = new URL("ui.wasm" + new URL(import.meta.url).search, import.meta.url);
const bytes = await (await fetch(wasm)).arrayBuffer();
W = (await WebAssembly.instantiate(bytes, { host })).instance.exports;
addEventListener("hashchange", () => W.nav());
addEventListener("resize", () => W.resized());
addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "Delete" || e.key === "Backspace" || e.key === "Escape") { const [p, l] = put(e.key); W.keyed(p, l); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); const [p, l] = put("Undo"); W.keyed(p, l); }
  // keys a game steers with, down (+) and up (−); the program says whether it used them
  if (STEER.has(e.key)) { const [p, l] = put("+" + e.key); if (W.keyed(p, l) === 1) e.preventDefault(); }
});
const STEER = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "a", "s", "d", "W", "A", "S", "D", "Escape"]);
addEventListener("keyup", (e) => { if (STEER.has(e.key)) { const [p, l] = put("-" + e.key); W.keyed(p, l); } });
// holding Shift shows the four arrows: a Shift drag resizes any super (owner, 2026-10-14)
const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
const shifted = (on) => document.documentElement.classList.toggle("shift-on", !!on);
addEventListener("keydown", (e) => { if (e.key === "Shift" && !typing(e.target)) shifted(true); });
addEventListener("keyup", (e) => { if (e.key === "Shift") shifted(false); });
addEventListener("blur", () => shifted(false));
// the middle button held does what Shift does, and shows the same four arrows
addEventListener("pointerdown", (e) => { if (e.button === 1) shifted(true); }, true);
addEventListener("pointerup", (e) => { if (e.button === 1 && !e.shiftKey) shifted(false); }, true);
// while wiring, the super under the pointer names its tips: its ports (drawn in their own layer) are marked .hov
let hovKey = null;
const hovMark = (key) => {
  document.querySelectorAll(".ports-svg .port.hov").forEach((g) => { if (!key || !g.dataset.p || !g.dataset.p.startsWith(key + "-")) g.classList.remove("hov"); });
  if (key) document.querySelectorAll(`.ports-svg .port[data-p^="${key}-"]`).forEach((g) => g.classList.add("hov"));
};
addEventListener("pointerover", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const port = t && t.closest(".ports-svg .port[data-p]");
  const sup = t && t.closest("[data-s], [data-bn]");
  const key = port ? port.dataset.p.slice(0, port.dataset.p.lastIndexOf("-")) : sup ? (sup.dataset.s !== undefined ? sup.dataset.s : "b" + sup.dataset.bn) : null;
  if (key !== hovKey) { hovKey = key; hovMark(key); }
});
addEventListener("pointermove", (e) => { if (hovKey && !document.querySelector(".ports-svg .port.hov")) hovMark(hovKey); if (!e.shiftKey && document.documentElement.classList.contains("shift-on")) shifted(false); if (capturing) W.pointer(0, e.clientX, e.clientY); });
addEventListener("pointerup", (e) => { if (capturing) W.pointer(1, e.clientX, e.clientY); });
addEventListener("pointercancel", (e) => { if (capturing) W.pointer(2, e.clientX, e.clientY); });
// Zoom is piii's own, the same everywhere, and never the browser's (owner, 2026-10-14): a pinch, Ctrl/⌘ and the wheel,
// or Ctrl/⌘ with +, − or 0 zoom what is shown (the canvas, or the open page) and the browser's zoom stays as it is.
const zoomBy = (dy, x, y) => W.zoomed(dy, x, y);
// No scrolling anywhere, only zoom (owner, 2026-10-14: "delete the scrolling function all over and just keep the zoom
// function"): the wheel and two fingers zoom about the pointer; dragging pans. The sidebar's list alone still scrolls.
addEventListener("wheel", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!(e.ctrlKey || e.metaKey) && t && t.closest(".rail")) return;
  // Intern, the app, is a page that scrolls like any other
  if (document.querySelector(".iapp")) return;
  e.preventDefault(); e.stopPropagation();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  if (dy) zoomBy(dy, e.clientX, e.clientY);
}, { passive: false, capture: true });
addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key, cx = innerWidth / 2, cy = innerHeight / 2;
  if (k === "+" || k === "=") { e.preventDefault(); zoomBy(-200, cx, cy); }
  else if (k === "-" || k === "_") { e.preventDefault(); zoomBy(200, cx, cy); }
  else if (k === "0") { e.preventDefault(); zoomBy(0, cx, cy); }
}, { capture: true });
let gscale = 1;
addEventListener("gesturestart", (e) => { e.preventDefault(); gscale = 1; });
addEventListener("gesturechange", (e) => { e.preventDefault(); const r = e.scale / gscale; gscale = e.scale; zoomBy(-Math.log(r) / 0.0015, e.clientX, e.clientY); });
let pinch = 0;
addEventListener("touchmove", (e) => {
  if (e.touches.length !== 2) { pinch = 0; return; }
  e.preventDefault();
  const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  if (pinch) zoomBy(-Math.log(d / pinch) / 0.0015, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  pinch = d;
}, { passive: false });
addEventListener("touchend", () => { pinch = 0; });
// Every page pans (owner, 2026-10-14: "every page can pan"): a drag on its bare background moves what it shows, any
// way, as the canvas does; the program keeps the offset.
addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !e.target.closest) return;
  // anywhere bare on an open page (its body or its head) selects the window; unlocked, a drag moves the window
  const body = e.target.closest(".win-body, .win-head");
  if (!body || e.target.closest("[data-solid], button, a, input, textarea, select, label, [contenteditable], .ports-svg, .board-ports")) return;
  W.page_pressed();
  let lx = e.clientX, ly = e.clientY, moved = false;
  const mv = (ev) => {
    if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
    if (!moved) document.documentElement.classList.add("panning");
    moved = true; W.panned(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY;
  };
  const up = () => { document.documentElement.classList.remove("panning"); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
});
W.start();
