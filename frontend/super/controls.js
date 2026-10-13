// super/controls.js: the main canvas's controls and conditions (owner, 2026-10-13: "the control buttons at the top are
// save, lock, open, stop, and the condition buttons at the bottom are if, then, plus, minus, multiply, divide, timer";
// "controls and conditions are only in the main canvas"; "delete these icons from the super and put these icons on the
// control. Everything should be iconized, both controls and condition"). They sit on the main super's top edge, either
// side of its sync port, and on its bottom edge, either side of its condition port: control comes in at the top and
// conditions at the bottom, as every super's sync and condition ports do (data goes in at the left, out at the right).
// Every button is an icon (its name is its tooltip and its accessible name); the padlock and the disk are the ones the
// supers carried, and they show the state of what they act on (closed padlock: locked; filled disk: saved).
//
// Every button is a super too, with four ports (owner: "the buttons are super as well for wiring"; super/site.js owners
// ctl:<name> and cond:<name>, drawn by the engine). The controls act on the supers they are wired to, else on the
// selected super (with the main or second super selected: on every Super AI super for open and stop):
//   save   saves it (a saved super is never deleted), or unsaves it when it is saved
//   lock   locks it (it keeps its place, size and n), or unlocks it; a super wired to it is locked and stays locked
//          while the wire is there (cut the wire and it unlocks)
//   chain  chains it: it and everything it holds move as one group (super/chain.js), or unchains it; a super wired to
//          it stays chained while the wire is there
//   open   opens it: a bubble or the project grows open, a pill opens its window, a Super AI super asks (words typed
//          into a plain super make it one), a held window comes back
//   compact compacts it (owner, 2026-10-13: "a compact button in the control, which compacts a super"): an open bubble
//          folds back to its compact square (a compact one sized by hand to the usual size), the project compacts, a
//          window folds into its pill, a Super AI super goes back to its usual size, a holder wraps close round what it holds
//   stop   stops it: asking stops, a window closes, a bubble or the project compacts; the timer stops too
//   reset  brings back a saved state (super/restore.js; owner, 2026-10-13): wired to a super, that super goes back to how
//          it was when last saved, at once as the wire is made; wired to the main super's condition port or to the logo,
//          the whole page goes back to its last saved state (saved by the save control on the main or second super, or by
//          saving the logo). Not wired: the selected super goes back; nothing selected, the app starts afresh as on a first
//          visit (a second press within 3 s; the title's wire into the site no longer resets)
// The conditions (a click on one types its value; Enter keeps it, empty clears it; kept as se:cond):
//   if      open goes ahead only if the value passes: > 5, < 3, = yes, or a word it must contain; wired from a super,
//           that super's value is tested (wired alone, it must say something true)
//   then    what follows an open: "stop", words such as "open explore", or (wired) the supers it is wired to open
//   + − × ÷ compute: every super wired into it (by any port but its output) and the number typed into it, in order;
//           the result shows on it and is its output's value, so it can be wired on into any super
//   timer   every so many seconds (10, 10s, 2m) the supers it is wired to open, else the super selected when it was
//           set; it counts down on itself; empty or stop ends it
// A super wired from its condition port into a condition's top port is that condition's subject: if governs only its
// subjects, then follows only their opening (and opens what its out port is wired to), the timer opens them; a value
// wired into a condition's in port is what it reads.
(function () {
  "use strict";
  const html = document.documentElement;
  const on = () => html.classList.contains("shape-se");
  const O = () => window.PiOrbit || {}, LV = () => window.LabView || {}, SS = () => window.SeSelect || {};
  const SVG = (d, vb) => '<svg viewBox="' + (vb || "0 0 16 16") + '" aria-hidden="true">' + d + "</svg>";
  const SHACKLE = { closed: "M3.5,5.5 V4 a2.5,2.5 0 0 1 5,0 V5.5", open: "M8.5,5.5 V4 a2.5,2.5 0 0 0 -5,0 V1.4" };   // super/lock.js's padlock
  const ICON = {
    save: SVG('<path class="sv-body" d="M2,1.5 H8.6 L10.5,3.4 V10.5 H2 Z"/><path class="sv-label" d="M3.6,1.5 V4 H7.6 V1.5"/><rect class="sv-slot" x="3.6" y="6.6" width="5.3" height="3.9" rx="0.6"/>', "0 0 12 12"),
    lock: SVG('<path class="lk-shackle" d="' + SHACKLE.open + '"/><rect class="lk-body" x="2" y="5.5" width="8" height="5.5" rx="1.6"/>', "0 0 12 12"),
    chain: SVG('<rect class="ch-link" x="1.2" y="5.6" width="7.4" height="4.8" rx="2.4" stroke-width="1.5"/><rect class="ch-link" x="7.4" y="5.6" width="7.4" height="4.8" rx="2.4" stroke-width="1.5"/>'),
    compact: SVG('<path d="M2.5 6.2h3.7V2.5M13.5 6.2H9.8V2.5M2.5 9.8h3.7v3.7M13.5 9.8H9.8v3.7" stroke-width="1.6"/>'),
    open: SVG('<path d="M7 3H3v10h10V9" stroke-width="1.5"/><path d="M9 2.6h4.4V7M13.2 2.8L7.6 8.4" stroke-width="1.6"/>'),
    stop: SVG('<rect class="f" x="3.5" y="3.5" width="9" height="9"/>'),
    reset: SVG('<path d="M3.4 8a4.6 4.6 0 1 0 1.5-3.4" stroke-width="1.6"/><path class="f" d="M2.2 1.9v4.6h4.6z"/>'),
    if: SVG('<path d="M8 1.8L14.2 8 8 14.2 1.8 8z" stroke-width="1.5"/><path d="M6.3 6.4a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.6-.8 1.2" stroke-width="1.3"/><circle class="f" cx="8" cy="11" r=".8"/>'),
    then: SVG('<path d="M2 8h10.5" stroke-width="1.6"/><path d="M9 4.2L12.8 8 9 11.8" stroke-width="1.6"/>'),
    plus: SVG('<path d="M8 3v10M3 8h10" stroke-width="1.8"/>'),
    minus: SVG('<path d="M3 8h10" stroke-width="1.8"/>'),
    multiply: SVG('<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke-width="1.8"/>'),
    divide: SVG('<path d="M3 8h10" stroke-width="1.7"/><circle class="f" cx="8" cy="4.3" r="1.25"/><circle class="f" cx="8" cy="11.7" r="1.25"/>'),
    timer: SVG('<circle cx="8" cy="9" r="5.3" stroke-width="1.5"/><path d="M8 9V6.2M6.4 1.8h3.2M12.3 4.3l1-1" stroke-width="1.5"/>'),
    up: SVG('<path d="M8 13.5V2.8" stroke-width="1.7"/><path d="M3.8 7L8 2.8 12.2 7" stroke-width="1.7"/>'),
    down: SVG('<path d="M8 2.5v10.7" stroke-width="1.7"/><path d="M3.8 9L8 13.2 12.2 9" stroke-width="1.7"/>'),
    left: SVG('<path d="M13.5 8H2.8" stroke-width="1.7"/><path d="M7 3.8L2.8 8 7 12.2" stroke-width="1.7"/>'),
    right: SVG('<path d="M2.5 8h10.7" stroke-width="1.7"/><path d="M9 3.8L13.2 8 9 12.2" stroke-width="1.7"/>'),
  };
  // open, compact and stop are no longer on the bar (owner, 2026-10-13: "remove these 3 buttons from control"): the
  // arrows below go in and out (PiEn), a super still opens and stops by Enter and its words; their code stays for wires
  const CONTROLS = ["save", "lock", "chain", "reset"];
  // the bottom bar: four arrows (owner, 2026-10-13: "add only top, down, left, right arrows to this section"; "each of
  // these are smart buttons: using PiEn it decides what it does"); the conditions it held before (if, then, + − × ÷,
  // the timer) are no longer on the bar: the same words still work typed into any super (super/define.js)
  const ARROWS = ["left", "up", "down", "right"];
  const CONDS = [];
  const HINT = { if: "> 5", then: "stop", plus: "0", minus: "0", multiply: "1", divide: "1", timer: "10s" };
  const OPS = { plus: (a, b) => a + b, minus: (a, b) => a - b, multiply: (a, b) => a * b, divide: (a, b) => b === 0 ? NaN : a / b };
  let top, bottom, cond = {};
  try { cond = JSON.parse(localStorage.getItem("se:cond") || "{}") || {}; } catch (_) { cond = {}; }
  ["time", "when", "how"].forEach(k => delete cond[k]);                 // conditions there are no longer
  const save = () => { try { localStorage.setItem("se:cond", JSON.stringify(cond)); } catch (_) { /* private mode */ } };
  let noteEl, noteT = 0;
  const say = t => { const o = document.querySelector(".lv-out"); if (o) o.textContent = t; flash(t); };
  function flash(t) {
    if (!noteEl) { noteEl = document.createElement("div"); noteEl.className = "se-ctl-note"; noteEl.setAttribute("aria-hidden", "true"); document.body.appendChild(noteEl); }
    noteEl.textContent = t; noteEl.classList.add("is-on"); clearTimeout(noteT); noteT = setTimeout(() => noteEl.classList.remove("is-on"), 2200);
    if (bottom) { const r = bottom.getBoundingClientRect(); noteEl.style.left = (window.innerWidth / 2) + "px"; noteEl.style.top = (r.top - 30) + "px"; }
  }

  // ---- the supers ----------------------------------------------------------------------------------
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.getClientRects().length; };
  const engines = () => [...document.querySelectorAll(".lv-node[data-id]")].filter(el => shown(el) && LV().isEngine && LV().isEngine(el));
  const target = () => { const s = SS().selected ? SS().selected() : ""; return s && typeof s !== "string" ? s : null; };
  const nameOf = el => !el ? "every super" : el.classList.contains("orbit-panel") ? "the window" : el.classList.contains("orbit-bubble") ? ((el.querySelector(":scope > .ob-label") || {}).textContent || "the bubble").trim() : el.classList.contains("se-project") ? "the project" : el.classList.contains("lv-node") ? "the super" : el.classList.contains("ob-member") ? (el.textContent || "the pill").trim().slice(0, 30) : el.classList.contains("se-ctl") || el.classList.contains("se-cond") ? (el.dataset.ctl || el.dataset.cond) : "the title";
  function valueOf(el) {
    if (!el) return "";
    if (el.classList.contains("se-cond")) return condValue(el.dataset.cond);
    if (el.classList.contains("lv-node")) return LV().valueOf ? LV().valueOf(el) : el.textContent || "";
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
  }
  const numOf = v => { const m = String(v == null ? "" : v).replace(",", ".").match(/-?\d+(\.\d+)?(e[-+]?\d+)?/i); return m ? parseFloat(m[0]) : NaN; };

  // ---- what a button is wired to -------------------------------------------------------------------
  function elOfAnchor(h) {
    if (!h) return null;
    let m;
    if ((m = /^port:([^/]+)\//.exec(h))) {
      const o = m[1];
      if (o === "main" || o === "site") return "all";
      if (o.startsWith("ctl:")) return document.querySelector('[data-ctl="' + CSS.escape(o.slice(4)) + '"]');
      if (o.startsWith("cond:")) return document.querySelector('.se-cond[data-cond="' + CSS.escape(o.slice(5)) + '"]');
      if (o.startsWith("pill:")) return document.querySelector('.ob-member[data-key="' + CSS.escape(o.slice(5)) + '"]');
      return window.SeSite && window.SeSite.ownerEl ? window.SeSite.ownerEl(o) : null;
    }
    if (/^(input|output|sync|condition)$/.test(h.replace(/^port:/, ""))) return "all";
    if (h.startsWith("node:")) return document.querySelector('.lv-node[data-id="' + CSS.escape(h.slice(5)) + '"]');
    if (h.startsWith("k:")) return [...document.querySelectorAll('[data-key="' + CSS.escape(h.slice(2)) + '"]')].find(e => e.getClientRects().length) || null;
    if (h === "project") return document.querySelector(".se-project");
    if (h === "title") return document.querySelector(".orbit-title .se-titlesuper");
    if (h.startsWith("w:")) return [...document.querySelectorAll(".orbit-panel")].find(p => { const t = p.querySelector(".op-title"); return t && t.textContent === h.slice(2); }) || null;
    return null;
  }
  // the supers a button is wired to, with the port of the button the wire is at
  function wires(owner) {
    const L = window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : [], pre = "port:" + owner + "/";
    const out = [];
    L.forEach(l => {
      const a = l.a && l.a.h, b = l.b && l.b.h;
      const mineA = !!a && a.startsWith(pre), mineB = !!b && b.startsWith(pre); if (mineA === mineB) return;
      const port = (mineA ? a : b).slice(pre.length), el = elOfAnchor(mineA ? b : a);
      if (el && !out.some(x => x.el === el)) out.push({ el, port });
    });
    return out;
  }
  const wiredTo = owner => wires(owner).map(w => w.el);
  const ins = k => wires("cond:" + k).filter(w => w.port !== "output" && w.el !== "all").map(w => w.el);   // what flows into a condition
  // a condition's subjects: the supers wired to its top (control) port, from their condition port, are the ones it
  // governs (if: they open only when it passes; then: it follows their opening; timer: it opens them)
  const subjects = k => wires("cond:" + k).filter(w => w.port === "sync" && w.el !== "all").map(w => w.el);
  const dataIn = k => wires("cond:" + k).filter(w => w.port === "input" && w.el !== "all").map(w => w.el);   // values fed into its in port

  // ---- the conditions -------------------------------------------------------------------------------
  function condValue(k) {
    if (OPS[k]) {                                                       // + − × ÷: the wired values, then the typed one
      const vals = ins(k).map(el => numOf(valueOf(el))).filter(isFinite);
      const own = numOf(cond[k]); if (isFinite(own)) vals.push(own);
      if (!vals.length) return "";
      const r = vals.reduce((a, b) => OPS[k](a, b));
      return isFinite(r) ? String(Math.round(r * 1e9) / 1e9) : "undefined";
    }
    if (k === "timer") return timer.on ? String(Math.max(0, Math.ceil((timer.at - performance.now()) / 1000))) : "";
    const w = dataIn(k)[0];
    return w ? valueOf(w) : (cond[k] || "");
  }
  function passes(el) {                                                  // "if"
    const subs = subjects("if"); if (subs.length && !subs.includes(el)) return true;   // it governs only its subjects
    const w = dataIn("if")[0], c = (cond.if || "").trim();
    if (w && !c) { const t = valueOf(w).trim().toLowerCase(); return !!t && t !== "0" && t !== "false" && t !== "no"; }
    if (!c) return true;
    const v = valueOf(w || el), m = /^(>=|<=|!=|>|<|=)\s*(.+)$/.exec(c);
    if (m) {
      const a = numOf(v), b = numOf(m[2]), num = isFinite(a) && isFinite(b);
      const x = num ? a : String(v).trim().toLowerCase(), y = num ? b : m[2].trim().toLowerCase();
      return m[1] === ">" ? x > y : m[1] === "<" ? x < y : m[1] === ">=" ? x >= y : m[1] === "<=" ? x <= y : m[1] === "!=" ? x !== y : x === y;
    }
    return String(v).toLowerCase().includes(c.toLowerCase());
  }
  let thenBusy = false;
  function after(el) {                                                   // "then"
    if (thenBusy) return;
    const subs = subjects("then"); if (subs.length && !subs.includes(el)) return;      // it follows only its subjects
    const tw = wires("cond:then").filter(w => w.port === "output" && w.el !== el && w.el !== "all").map(w => w.el);
    if (tw.length) { thenBusy = true; setTimeout(() => { tw.forEach(x => openOne(x, true)); thenBusy = false; say("then: opened " + tw.map(nameOf).join(", ")); }, 600); return; }
    const t = (cond.then || "").trim(); if (!t) return;
    if (t.toLowerCase() === "stop") { setTimeout(() => stopOne(el), 600); return; }
    if (LV().act) LV().act(t);
  }
  // the timer
  const timer = { on: false, at: 0, every: 10, who: null, t: 0 };
  function seconds(v) {
    const m = /^\s*([\d.]+)\s*(ms|s|sec|m|min|h)?\s*$/i.exec(v || "");
    if (!m) return 0;
    const n = +m[1], u = (m[2] || "s").toLowerCase();
    return Math.max(0.5, Math.min(86400, u === "ms" ? n / 1000 : u === "m" || u === "min" ? n * 60 : u === "h" ? n * 3600 : n));
  }
  function setTimer() {
    clearTimeout(timer.t); const s = seconds(cond.timer);
    timer.on = s > 0; timer.every = s; timer.who = target(); timer.at = performance.now() + s * 1000;
    if (timer.on) timer.t = setTimeout(fire, s * 1000);
  }
  function fire() {
    if (!timer.on) return;
    const w = wires("cond:timer").filter(x => x.port === "sync" || x.port === "output").map(x => x.el);
    const list = w.length ? w : [timer.who && timer.who.isConnected ? timer.who : null];
    list.forEach(x => openOne(x === "all" ? null : x, true));
    timer.at = performance.now() + timer.every * 1000; timer.t = setTimeout(fire, timer.every * 1000);
  }

  // ---- the controls ---------------------------------------------------------------------------------
  function openOne(el, quiet) {
    if (!el) { const all = engines(); if (!all.length) { if (!quiet) say("Nothing to open here: select a super first"); return false; } all.forEach(n => openOne(n, true)); if (!quiet) say("Opened " + all.length + " super" + (all.length > 1 ? "s" : "")); return true; }
    if (!passes(el)) { if (!quiet) say("if " + (cond.if || "its wire") + ": not met, " + nameOf(el) + " does not open"); return false; }
    let ok = false;
    if (el.classList.contains("lv-node")) ok = !!(LV().run && LV().run(el));
    else if (el.classList.contains("orbit-bubble")) ok = !!(window.SeBubble && window.SeBubble.open(el, true) !== false);
    else if (el.classList.contains("ob-member")) { const k = el.dataset.key; if (k && O().openKey) { O().openKey(k); ok = true; } }
    else if (el.classList.contains("se-project")) { if (window.SeProject) { window.SeProject.open(); ok = true; } }
    else if (el.classList.contains("orbit-panel")) { el.classList.remove("se-held"); ok = true; }
    else if (el.classList.contains("se-ctl")) { press(el.dataset.ctl); ok = true; }
    else if (el.dataset && el.dataset.ctl === "privacy" && window.SeConsent) { window.SeConsent.open(); ok = true; }   // the privacy choices super
    if (!quiet) say(ok ? "Opened " + nameOf(el) : nameOf(el) + " cannot open (locked?)");
    if (ok) after(el);
    return ok;
  }
  function compactOne(el) {
    if (!el || el === "all") return false;
    if (el.classList.contains("orbit-bubble")) {
      if (!el.classList.contains("is-compact")) { if (window.SeBubble) window.SeBubble.open(el, false); return true; }
      if (el.classList.contains("se-sized")) { el.style.width = ""; el.style.height = ""; el.classList.remove("se-sized"); try { localStorage.removeItem("se:size:" + el.dataset.key); } catch (_) { /* private mode */ } if (O().layout) O().layout(); return true; }
      return false;
    }
    if (el.classList.contains("se-project")) { if (window.SeProject) { window.SeProject.close(); if (window.SeProject.resize) { const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--se-compact")) || 104; window.SeProject.resize(s, s); } } return true; }
    if (el.classList.contains("orbit-panel")) { const k = (O().keyOf && O().keyOf(el)) || (el.item && el.item.key); if (k && O().close) O().close(k); return true; }
    if (el.classList.contains("lv-node") && LV().rectOf && LV().setRect) {
      const r = LV().rectOf(el); if (!r) return false;
      let w = 84, h = 84;
      if (el.classList.contains("is-holder")) {                       // a holder: close round what it holds, keeping 30 % free
        const held = [...new Set([...(window.SeBind && window.SeBind.members ? window.SeBind.members(el) : []), ...(window.SeHold && window.SeHold.heldBy ? window.SeHold.heldBy(el) : [])])];
        if (!held.length) return false;
        const b = el.getBoundingClientRect(), k = (r.w / (b.width || r.w)) || 1, rs = held.map(e => e.getBoundingClientRect());
        const L = Math.min(...rs.map(q => q.left)), T = Math.min(...rs.map(q => q.top)), R = Math.max(...rs.map(q => q.right)), B = Math.max(...rs.map(q => q.bottom));
        const area = rs.reduce((a, q) => a + q.width * q.height, 0), pad = Math.max(10, Math.min(R - L, B - T) * 0.06);
        let W = R - L + 2 * pad, H = B - T + 2 * pad + Math.min(46, (B - T) * 0.08);
        if (area > 0.7 * W * H) { const g = Math.sqrt(area / (0.7 * W * H)); W *= g; H *= g; }   // the 30 % rule
        if (W >= b.width - 1 && H >= b.height - 1) return false;
        const cx = (L + R) / 2, cy = (T + B) / 2;
        if (window.SeBind && window.SeBind.settle) window.SeBind.settle();   // what it holds keeps its size: the shares are taken afresh
        LV().setRect(el, r.x + (cx - W / 2 - b.left) * k, r.y + (cy - H / 2 - b.top) * k, W * k, H * k);
        return true;
      }
      if (Math.abs(r.w - w) < 1 && Math.abs(r.h - h) < 1) return false;
      LV().setRect(el, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h); return true;
    }
    return false;
  }
  function stopOne(el) {
    if (!el) { engines().forEach(n => LV().stop && LV().stop(n)); return; }
    if (el.classList.contains("lv-node")) { if (LV().stop) LV().stop(el); }
    else if (el.classList.contains("orbit-bubble")) { if (window.SeBubble && !el.classList.contains("is-compact")) window.SeBubble.open(el, false); }
    else if (el.classList.contains("orbit-panel")) { const k = (O().keyOf && O().keyOf(el)) || (el.item && el.item.key); if (k && O().close) O().close(k); }
    else if (el.classList.contains("se-project")) { if (window.SeProject) window.SeProject.close(); }
  }
  // save and lock: the state of what they act on (the main and second supers lock through their own hosts)
  const lockable = el => el === "all" ? (window.SeLock && window.SeLock.loop ? window.SeLock.loop("site") : null) : el;
  const isLocked = el => { el = lockable(el); return !!(el && window.SeLock && window.SeLock.isLocked(el)); };
  const isSaved = el => !!(el && el !== "all" && window.SeSave && window.SeSave.isSaved(el));
  function toggle(k, el) {
    if (k === "chain") {                                                  // the chain: it and what it holds move as one (super/chain.js)
      if (!el || el === "all" || !window.SeChain || !(window.SeLock && window.SeLock.nameOf(el))) return null;
      const now = window.SeChain.isChained(el); window.SeChain.set(el, !now); return (now ? "Unchained " : "Chained ") + nameOf(el);
    }
    if (k === "save" && el === "all") {                                  // the main loop: a snapshot of the whole page
      if (!window.SeRestore) return null;
      window.SeRestore.snapshotPage(); return "Saved the page: a reset wired to the main super's condition or the logo brings it back";
    }
    el = k === "lock" ? lockable(el) : el; if (!el || el === "all") return null;
    const A = k === "lock" ? window.SeLock : window.SeSave; if (!A) return null;
    if (window.SeLock && !window.SeLock.nameOf(el)) return null;           // not a super that keeps a lock or a save
    const now = k === "lock" ? A.isLocked(el) : A.isSaved(el);
    A.set(el, !now);
    return (k === "lock" ? (now ? "Unlocked " : "Locked ") : (now ? "Unsaved " : "Saved ")) + nameOf(el);
  }
  function selfWired(x, k) { return x && x.classList && x.classList.contains("se-ctl") && x.dataset.ctl === k; }
  function targetsOf(k) {
    const s = SS().selected ? SS().selected() : "";
    // save and lock: the selected super (the wired ones are held saved or locked by their wire, super/controls.js syncWired)
    if ((k === "lock" || k === "save" || k === "chain") && s) {
      if (typeof s !== "string") return [s];
      if (k === "lock" && window.SeLock && window.SeLock.loop) return [window.SeLock.loop(s === "loop" ? "main" : "site")];
      if (k === "save") return ["all"];                                   // the main or second super selected: the page
    }
    const w = wiredTo("ctl:" + k).filter(x => !selfWired(x, k));
    if (w.length) return w;
    if (s && typeof s !== "string") return [s];
    if (k === "lock" && s && window.SeLock && window.SeLock.loop) return [window.SeLock.loop(s === "loop" ? "main" : "site")];   // the main or second super: its own lock
    return [null];
  }
  // ---- reset: back to a saved state (super/restore.js) ----------------------------------------------
  // the ends wired to the reset control, as wire ends (port:main/condition, title, node:..., k:...)
  function resetEnds(list) {
    const pre = "port:ctl:reset/";
    const h = an => an ? (an.loop ? "loop" : an.h) : null;               // the main loop itself is a wire end with no name
    return (list || []).map(l => { const a = h(l.a), b = h(l.b); return a && a.startsWith(pre) ? b : b && b.startsWith(pre) ? a : null; }).filter(Boolean);
  }
  // the logo or the main loop (its edge, or any of its ports): wired to reset, the whole app starts again, as on a first
  // visit (owner, 2026-10-13: "connecting the circular icon to logo or main loop, to reset the app")
  const pageEnd = h => h === "title" || h === "loop" || /^port:main\//.test(h);
  function resetApp() { if (window.SuperLink && window.SuperLink.reset) { window.SuperLink.reset(); return true; } return resetPage(); }
  function resetOne(el) {
    const R = window.SeRestore; if (!R || !el || el === "all") return false;
    if (R.has(el)) return R.restore(el);
    say(nameOf(el) + " has no saved state yet: save it first"); return false;
  }
  function resetPage() {
    const R = window.SeRestore; if (!R) return false;
    if (R.hasPage()) return R.restorePage();
    say("The page has no saved state yet: save the main super or the logo first"); return false;
  }
  function resetEnd(h) {
    if (pageEnd(h)) return resetApp();
    const el = elOfAnchor(h);
    return el && el !== "all" && isSuper(el) ? resetOne(el) : false;
  }
  function resetWired() {
    const ends = resetEnds(window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : []);
    if (!ends.length) return false;
    if (ends.some(pageEnd)) { resetApp(); return true; }                // the app comes first: it holds everything else
    ends.forEach(resetEnd); return true;
  }
  // making the wire is the reset (owner: "doing this resets the super"): only a wire made now, not one the page had
  let resetSeen = null;
  document.addEventListener("superlink:change", () => setTimeout(() => {
    if (!settled || !window.SuperLink || !window.SuperLink.links) return;
    const ends = resetEnds(window.SuperLink.links());
    const fresh = resetSeen ? ends.filter(h => !resetSeen.has(h)) : [];
    resetSeen = new Set(ends);
    if (!fresh.length) return;
    if (fresh.some(pageEnd)) resetApp(); else fresh.forEach(resetEnd);
  }, 120));
  setTimeout(() => { if (window.SuperLink && window.SuperLink.links) resetSeen = new Set(resetEnds(window.SuperLink.links())); }, 4200);

  let armed = 0;
  // ---- the arrows: smart buttons, PiEn decides (pien.js PiEN.rank) ------------------------------------
  //   → ←  step through what PiEn would suggest next, best first: the card is selected (its blue edge) and named
  //   ↓    goes in: opens the card the arrows point at, else PiEn's first pick
  //   ↑    goes out: closes the window opened last, else folds the selected bubble
  let ranked = [], at = -1, aim = null, rankedAt = 0;
  const titleOf = k => ((O().info && O().info(k)) || {}).title || k.split(":").pop();
  function ranking() {
    const P = window.PiEN; let r = P && P.rank ? P.rank() : [];
    if (!r.length) r = [...new Set([...document.querySelectorAll(".ob-member[data-key]")].map(e => e.dataset.key))].filter(k => !k.startsWith("links:") && !/ group$/.test(k)).map(key => ({ key, score: 0 }));
    return r;
  }
  function showCard(key) {
    const el = document.querySelector('.ob-member[data-key="' + CSS.escape(key) + '"]') || (O().elOf && O().elOf(key));
    if (el && SS().select) SS().select(el);
  }
  function arrowGo(k) {
    const now = performance.now();
    if (k === "left" || k === "right") {
      if (!ranked.length || now - rankedAt > 6000) { ranked = ranking(); at = k === "right" ? -1 : 0; }
      rankedAt = now;
      if (!ranked.length) { say("PiEn: nothing to suggest here yet"); return; }
      at = (at + (k === "right" ? 1 : -1) + ranked.length) % ranked.length;
      aim = ranked[at].key; showCard(aim);
      say("PiEn: " + titleOf(aim) + (at === 0 ? " (its first pick)" : " (" + (at + 1) + " of " + ranked.length + ")") + ". ↓ opens it");
      return;
    }
    if (k === "down") {
      const key = aim || ((ranked = ranking())[0] || {}).key;
      if (!key) { say("PiEn: nothing to open here yet"); return; }
      const ok = O().openKey ? O().openKey(key) : (O().open ? (O().open(key), true) : false);
      say(ok === false ? titleOf(key) + " cannot open here" : "Opened " + titleOf(key) + " (PiEn)");
      aim = null; ranked = []; return;
    }
    if (k === "up") {
      const wins = [...document.querySelectorAll(".orbit-panel:not(.leaving)")].filter(p => p.getClientRects().length)
        .sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0));
      const key = wins.length && O().keyOf ? O().keyOf(wins[0]) : null;
      if (key && O().close && O().close(key)) { say("Closed " + titleOf(key)); return; }
      const s = SS().selected ? SS().selected() : null, b = s && s.closest ? s.closest(".orbit-bubble.is-group:not(.is-compact)") : null;
      if (b && window.SeBubble) { window.SeBubble.open(b, false); say("Folded " + ((b.querySelector(":scope > .ob-label") || {}).textContent || "the bubble").trim()); return; }
      say("Nothing open to go out of");
    }
  }
  function press(k) {
    if (ARROWS.includes(k)) { arrowGo(k); return; }
    if (k === "reset") {
      if (resetWired()) return;                                         // wired: a super goes back to its saved state; the logo or main loop, the app starts again
      const s = SS().selected ? SS().selected() : "";
      if (s && typeof s !== "string" && window.SeRestore) { resetOne(s); return; }
      const b = top && top.querySelector(".se-ctl-reset");               // nothing: the app starts afresh, as on a first visit; a second press within 3 s
      if (performance.now() < armed) { if (window.SuperLink && window.SuperLink.reset) window.SuperLink.reset(); return; }
      armed = performance.now() + 3000; if (b) { b.classList.add("is-on"); setTimeout(() => b.classList.remove("is-on"), 3000); }
      say("Reset: press again to start the app afresh"); return;
    }
    const list = targetsOf(k);
    if (k === "open") { list.forEach(x => openOne(x === "all" ? null : x, list.length > 1)); if (list.length > 1) say("Opened " + list.length + " wired supers"); return; }
    if (k === "compact") {
      const done = list.filter(x => x && compactOne(x));
      say(done.length ? "Compacted " + done.map(nameOf).join(", ") : list[0] ? nameOf(list[0]) + " is compact already" : "Select a super (or wire it to compact) first"); return;
    }
    if (k === "stop") {
      if (timer.on && !wiredTo("ctl:stop").length) { timer.on = false; clearTimeout(timer.t); }
      list.forEach(x => stopOne(x === "all" ? null : x)); say("Stopped " + (list.length > 1 ? list.length + " supers" : nameOf(list[0] === "all" ? null : list[0]))); return;
    }
    const held = list.filter(x => x && x !== "all" && wiredTo("ctl:" + k).includes(x));
    if (held.length && held.length === list.length) { say(nameOf(held[0]) + " is wired to " + k + ": it stays " + (k === "lock" ? "locked" : k === "chain" ? "chained" : "saved") + " while the wire is there"); return; }
    const done = list.map(x => x && toggle(k, x)).filter(Boolean);
    say(done.length ? done.join(", ") : "Select a super (or wire it to " + k + ") first");
    mark();
  }

  // ---- the bars ------------------------------------------------------------------------------------
  function build() {
    if (top || !on() || !document.body) return;
    top = document.createElement("div"); top.className = "se-ctlbar se-ctl-top"; top.setAttribute("role", "toolbar"); top.setAttribute("aria-label", "controls");
    const half = (list, side) => '<div class="se-ctl-half se-ctl-' + side + '">' + list.map(k => '<span class="se-ctl se-ctl-' + k + '" data-ctl="' + k + '" title="' + k + '" role="img" aria-label="' + k + '">' + ICON[k] + "</span>").join("") + "</div>";
    top.innerHTML = half(CONTROLS.slice(0, 2), "l") + half(CONTROLS.slice(2), "r");   // together, two either side of the sync port (owner, 2026-10-13: "put all these together")
    bottom = document.createElement("div"); bottom.className = "se-ctlbar se-ctl-bottom"; bottom.setAttribute("role", "toolbar"); bottom.setAttribute("aria-label", "conditions");
    const chip = k => '<label class="se-cond' + (OPS[k] ? " is-op" : "") + '" data-cond="' + k + '" title="' + k + '"><span class="se-cond-k">' + ICON[k] + '</span><input class="se-cond-v" size="1" spellcheck="false" placeholder="' + HINT[k] + '" aria-label="' + k + '"><span class="se-cond-r" aria-live="polite"></span></label>';
    const arrow = k => '<span class="se-ctl se-arrow se-ctl-' + k + '" data-ctl="' + k + '" title="' + k + ' (PiEn decides)" role="button" tabindex="0" aria-label="' + ({ left: "previous suggestion", right: "next suggestion", up: "go out", down: "go in" })[k] + '">' + ICON[k] + "</span>";
    bottom.innerHTML = '<div class="se-ctl-half se-ctl-l">' + ARROWS.slice(0, 2).map(arrow).join("") + '</div><div class="se-ctl-half se-ctl-r">' + ARROWS.slice(2).map(arrow).join("") + "</div>";
    bottom.setAttribute("aria-label", "arrows");
    // smart buttons: pressed (a click, Enter) or opened by a wire, PiEn decides what each does (arrowGo below)
    bottom.querySelectorAll(".se-arrow").forEach(a => {
      a.addEventListener("click", e => { e.stopPropagation(); press(a.dataset.ctl); });
      a.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(a.dataset.ctl); } });
    });
    document.body.appendChild(top); document.body.appendChild(bottom);
    // the bars are the main canvas's own: a press, scroll or double click on them goes nowhere else
    [top, bottom].forEach(b => ["pointerdown", "dblclick", "wheel", "click", "keydown"].forEach(t => b.addEventListener(t, e => { e.stopPropagation(); }, { passive: t !== "click" && t !== "dblclick" && t !== "keydown" })));
    // the controls are supers, not buttons: nothing presses them (owner, 2026-10-13); they act by wires and by scroll
    bottom.querySelectorAll(".se-cond").forEach(c => {
      const k = c.dataset.cond, inp = c.querySelector("input");
      inp.value = cond[k] || ""; fitInput(inp);
      inp.addEventListener("input", () => fitInput(inp));
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } if (e.key === "Escape") { inp.value = cond[k] || ""; fitInput(inp); inp.blur(); } });
      inp.addEventListener("change", () => commit(k, inp));
      inp.addEventListener("blur", () => commit(k, inp));
    });
    if (cond.timer && CONDS.includes("timer")) setTimer();   // no timer on the bar any more: a stored one does not tick unseen
    place();
  }
  function fitInput(inp) { inp.size = Math.max(1, Math.min(18, (inp.value || "").length || 1)); inp.closest(".se-cond").classList.toggle("is-set", !!inp.value.trim()); }
  function commit(k, inp) {
    const v = inp.value.trim(); if ((cond[k] || "") === v) return;
    if (v) cond[k] = v; else delete cond[k];
    save(); fitInput(inp);
    if (k === "timer") setTimer();
    say(v ? k + " " + v : k + " cleared");
  }
  // what the buttons show: the padlock and the disk of what they act on, results, the countdown, wired ones
  let markAt = 0;
  function mark() {
    if (!bottom) return;
    bottom.querySelectorAll(".se-cond").forEach(c => {
      const k = c.dataset.cond, r = c.querySelector(".se-cond-r");
      const wired = wires("cond:" + k).length > 0;
      if (c.classList.contains("is-wired") !== wired) c.classList.toggle("is-wired", wired);
      const show = OPS[k] ? (condValue(k) && (ins(k).length || cond[k]) ? "= " + condValue(k) : "") : k === "timer" && timer.on ? condValue(k) + " s" : "";
      if (r.textContent !== show) r.textContent = show;
    });
    // blue only while connected (owner, 2026-10-13: "they should be blue if they are connected, only then"): the controls and the arrows
    [top, bottom].forEach(bar => bar.querySelectorAll(".se-ctl").forEach(b => { const w = wiredTo("ctl:" + b.dataset.ctl).length > 0; if (b.classList.contains("is-wired") !== w) b.classList.toggle("is-wired", w); }));
    const lk = targetsOf("lock")[0], sv = targetsOf("save")[0];
    const L = top.querySelector(".se-ctl-lock"), Sv = top.querySelector(".se-ctl-save");
    const locked = !!lk && isLocked(lk), saved = !!sv && isSaved(sv);
    if (L && L.classList.contains("is-locked") !== locked) { L.classList.toggle("is-locked", locked); L.querySelector(".lk-shackle").setAttribute("d", locked ? SHACKLE.closed : SHACKLE.open); L.setAttribute("aria-pressed", String(locked)); }
    if (Sv && Sv.classList.contains("is-saved") !== saved) { Sv.classList.toggle("is-saved", saved); Sv.setAttribute("aria-pressed", String(saved)); }
    const ch = targetsOf("chain")[0], C = top.querySelector(".se-ctl-chain"), chained = !!(ch && ch !== "all" && window.SeChain && window.SeChain.isChained(ch));
    if (C && C.classList.contains("is-chained") !== chained) { C.classList.toggle("is-chained", chained); C.setAttribute("aria-pressed", String(chained)); }
  }
  // which super carries the bars (owner, 2026-10-13: "if a super gets bigger than 70% of the page, the control and
  // conditions go to the next layer super"; "because the second canvas is smaller than 70% of the main canvas, the
  // controls and conditions should be on the main canvas"): the main super, unless the super it holds (the second
  // super) covers more than BIG of the page; then that one, and so on down while the next layer (the biggest super held
  // directly by the last one) is itself bigger than BIG of the page
  const BIG = 0.70;
  const pid = (o, p) => o === "site" ? p : o + "/" + p;
  const portAt = (o, p) => { const e = document.querySelector('.se-port[data-pid="' + pid(o, p) + '"]'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width || r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; };
  function boxOf(o) {                                                    // a super's box, from its four ports
    const s = portAt(o, "sync"), c = portAt(o, "condition"), i = portAt(o, "input"), u = portAt(o, "output");
    if (!s || !c) return null;
    const l = i ? i[0] : Math.min(s[0], c[0]), r = u ? u[0] : Math.max(s[0], c[0]);
    return { l, r, t: s[1], b: c[1], area: Math.max(0, r - l) * Math.max(0, c[1] - s[1]) };
  }
  function ownerOf(el) {                                                 // the port owner of a super element
    if (el.classList.contains("se-project")) return "project";
    if (el.classList.contains("lv-node") && el.dataset.id) return "node:" + el.dataset.id;
    if (el.classList.contains("orbit-bubble") && el.dataset.key) return "bubble:" + el.dataset.key;
    if (el.classList.contains("orbit-panel")) { const k = O().keyOf && O().keyOf(el); return k ? "win:" + k : null; }
    return null;
  }
  const area = r => r.width * r.height;
  function inner(o, box) {                                               // the biggest super held directly by o
    const H = window.SeHold; if (!H || !H.hosts) return null;
    let list;
    if (o === "site") {
      const all = [...document.querySelectorAll(".lv-node[data-id], .orbit-bubble.is-group:not([hidden]), .se-project, .orbit-panel:not(.leaving)")].filter(shown);
      list = all.filter(el => { if (H.hostOf(el)) return false; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return x > box.l && x < box.r && y > box.t && y < box.b; });
    } else {
      const el = window.SeSite && window.SeSite.ownerEl ? window.SeSite.ownerEl(o) : null;
      list = el && H.heldBy ? H.heldBy(el).filter(shown) : [];
    }
    const best = list.map(el => ({ el, o: ownerOf(el), a: area(el.getBoundingClientRect()) })).filter(x => x.o && boxOf(x.o)).sort((a, b) => b.a - a.a)[0];
    return best ? best.o : null;
  }
  let carrier = "main";
  function layer() {
    const page = window.innerWidth * window.innerHeight;
    let o = "main", box = boxOf("main");
    for (let i = 0; i < 8 && box; i++) {
      const next = o === "main" ? (boxOf("site") ? "site" : null) : inner(o, box);
      const nb = next && boxOf(next);
      if (!nb || nb.area <= BIG * page) break;                          // the next layer is not that big: the bars stay here
      o = next; box = nb;
    }
    if (o !== carrier) { carrier = o; html.dataset.seBars = o; }
  }
  // either side of the carrying super's sync port (top) and condition port (bottom), just inside its edge
  function place() {
    if (!top) return;
    const vis = on();
    top.hidden = bottom.hidden = !vis; if (!vis) return;
    if (!boxOf(carrier)) carrier = "main";                               // it went away: back to the main super
    const sync = document.querySelector('.se-port[data-pid="' + pid(carrier, "sync") + '"]'), cnd = document.querySelector('.se-port[data-pid="' + pid(carrier, "condition") + '"]');
    const W = window.innerWidth, H = window.innerHeight;
    const sr = sync && sync.getBoundingClientRect(), cr = cnd && cnd.getBoundingClientRect();
    const cx = sr && sr.width ? sr.left + sr.width / 2 : W / 2, ty = sr && sr.width ? sr.top + sr.height / 2 : 3;
    const bx = cr && cr.width ? cr.left + cr.width / 2 : W / 2, by = cr && cr.width ? cr.top + cr.height / 2 : H - 3;
    const st = (el, x, y) => { const l = Math.round(x) + "px", t = Math.round(y) + "px"; if (el.style.left !== l) el.style.left = l; if (el.style.top !== t) el.style.top = t; };
    // clear of the title super (top left): on a narrow screen the bar goes just under it
    let y = Math.max(4, ty + 4);
    const tt = document.querySelector(".orbit-title .se-titlesuper"), l = top.querySelector(".se-ctl-l");
    if (tt && l) { const a = tt.getBoundingClientRect(), b = l.getBoundingClientRect(); if (a.width && b.width && b.left < a.right + 4 && y < a.bottom + 4) y = Math.round(a.bottom + 6); }
    st(top, cx, y); st(bottom, bx, Math.min(H - 4, by - 4));
  }
  function loop() { place(); const now = performance.now(); if (now - markAt > 250) { markAt = now; mark(); layer(); } requestAnimationFrame(loop); }
  function start() {
    build(); if (!top) { setTimeout(start, 400); return; }
    requestAnimationFrame(loop);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // a super wired to the lock control is locked, and stays locked while the wire is there; cut the wire and it unlocks
  // (owner, 2026-10-13: "if I connect them to the lock control, they should stay locked"); one wired to save is saved
  const isSuper = x => x && x !== "all" && x.classList && !x.classList.contains("se-ctl") && !x.classList.contains("se-cond");
  function elOfName(n) {
    if (n === "title") return document.querySelector(".orbit-title .se-titlesuper");
    if ((n === "site" || n === "main") && window.SeLock && window.SeLock.loop) return window.SeLock.loop(n);   // the second and main supers' lock hosts
    if (n === "privacy") return document.querySelector(".se-req");      // privacy choices (super/requests.js)
    if (n.startsWith("pill:")) return document.querySelector('.ob-member[data-key="' + CSS.escape(n.slice(5)) + '"]');
    return window.SeSite && window.SeSite.ownerEl ? window.SeSite.ownerEl(n) : null;
  }
  let settled = false;
  function syncWired() {
    if (!settled || !window.SeLock) return;
    const L = window.SeLock, now = wiredTo("ctl:lock").filter(isSuper);
    // the second and main supers (owner, 2026-10-13: "at initial state the lock is wired but I can still move it, it's a
    // bug"): a wire from the lock to one of their own ports locks that super through its lock host, as for any other
    const ends = (window.SuperLink && window.SuperLink.links ? window.SuperLink.links() : []).map(l => { const a = l.a && l.a.h, b = l.b && l.b.h; return a && a.startsWith("port:ctl:lock/") ? b : b && b.startsWith("port:ctl:lock/") ? a : null; }).filter(Boolean);
    if (L.loop) {
      if (ends.some(h => /^port:(input|output|sync|condition)$/.test(h))) { const h = L.loop("site"); if (h && !now.includes(h)) now.push(h); }
      if (ends.some(h => /^port:main\//.test(h))) { const h = L.loop("main"); if (h && !now.includes(h)) now.push(h); }
    }
    const names = now.map(el => L.nameOf(el)).filter(Boolean);
    let prev = []; try { prev = JSON.parse(localStorage.getItem("se:lockwired") || "[]") || []; } catch (_) { prev = []; }
    now.forEach(el => { if (!L.isLocked(el)) L.set(el, true); });
    prev.filter(n => !names.includes(n)).forEach(n => { const el = elOfName(n); if (el && L.isLocked(el)) L.set(el, false); });
    try { localStorage.setItem("se:lockwired", JSON.stringify(names)); } catch (_) { /* private mode */ }
    if (window.SeSave) wiredTo("ctl:save").filter(isSuper).forEach(el => { if (!window.SeSave.isSaved(el)) window.SeSave.set(el, true); });
    // chained while wired to the chain control, unchained when the wire is cut (as the lock)
    if (window.SeChain) {
      const cw = wiredTo("ctl:chain").filter(isSuper), cn = cw.map(el => L.nameOf(el)).filter(Boolean);
      let cp = []; try { cp = JSON.parse(localStorage.getItem("se:chainwired") || "[]") || []; } catch (_) { cp = []; }
      cw.forEach(el => { if (!window.SeChain.isChained(el)) window.SeChain.set(el, true); });
      cp.filter(n => !cn.includes(n)).forEach(n => { const el = elOfName(n); if (el && window.SeChain.isChained(el)) window.SeChain.set(el, false); });
      try { localStorage.setItem("se:chainwired", JSON.stringify(cn)); } catch (_) { /* private mode */ }
    }
    mark();
  }
  setTimeout(() => { settled = true; syncWired(); }, 4000);              // once the program's wires are on the page
  setInterval(syncWired, 2000);                                          // and whenever the page changes under them
  document.addEventListener("superlink:change", () => setTimeout(() => { mark(); syncWired(); }, 80));
  document.addEventListener("se:select", () => setTimeout(mark, 20));
  window.SeControls = { carrier: () => carrier, act: k => CONTROLS.includes(k) && press(k), wiredTo, how: () => null,
    valueOf: owner => owner.startsWith("cond:") ? condValue(owner.slice(5)) : owner.startsWith("ctl:") ? owner.slice(4) : "",
    conditions: () => Object.assign({}, cond),
    set: (k, v) => { if (!CONDS.includes(k)) return; if (v) cond[k] = String(v); else delete cond[k]; save(); const i = bottom && bottom.querySelector('[data-cond="' + k + '"] input'); if (i) { i.value = cond[k] || ""; fitInput(i); } if (k === "timer") setTimer(); } };
})();
