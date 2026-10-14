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
  for (const f of list) { out.push(files.length + "\t" + f.size + "\t" + f.name.replace(/[\t\n]/g, " ")); files.push(f); }
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
      n.addEventListener("drop", (e) => { e.preventDefault(); send(id, k, fileList(e.dataTransfer.files)); });
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
const rtcStop = (state, error) => {
  if (RTC.pc) { try { RTC.pc.close(); } catch (_) {} }
  if (RTC.local) RTC.local.getTracks().forEach((t) => t.stop());
  Object.assign(RTC, { pc: null, local: null, remote: null, offer: null, early: [], muted: false, state: state || "ended", error: error || "" });
  const au = document.getElementById("intern-audio"); if (au) au.remove();
};
const rtcPc = async () => {
  RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: RTC.video });
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  RTC.local.getTracks().forEach((t) => pc.addTrack(t, RTC.local));
  pc.onicecandidate = (e) => { if (e.candidate) rtcSend("ice", e.candidate.toJSON()); };
  pc.ontrack = (e) => { RTC.remote = e.streams[0] || new MediaStream([e.track]); rtcShow(); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") { RTC.state = "connected"; rtcShow(); }
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
    (async () => {
      try {
        const pc = await rtcPc();
        await pc.setRemoteDescription({ type: "offer", sdp: RTC.offer.sdp });
        for (const c of RTC.early) await rtcIce(c); RTC.early = [];
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        rtcSend("answer", { sdp: ans.sdp });
        RTC.state = "connected";
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
const ops = {
  ptr: () => lastPointer,
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
  // a chosen picture, decoded by the browser and shrunk to fit max × max: its RGBA pixels
  rgba: (a) => {
    const [token, file, max] = a.split("\t").map(Number);
    (async () => {
      try {
        const bmp = await createImageBitmap(files[file]);
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
    files[file].arrayBuffer().then((b) => give(token, new Uint8Array(b), 1, 1)).catch(() => give(token, new Uint8Array(0), 0, 0));
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
  fileurl: (a) => (files[+a] ? URL.createObjectURL(files[+a]) : ""),
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
