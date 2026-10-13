// super/consent.js: asking first (owner, 2026-10-13: "add ask for permission what site is doing with users when site
// loads"; "use cookies").
//
// On a first visit (no pi_consent cookie, or one from an older version of this notice) the page says plainly what it
// does with visitors and asks before doing anything optional. Until the visitor chooses, the optional things are off.
//   always on   the layout and supers kept in this browser; a sign-in session and, signed in, the layout kept with
//               the account; the server's security (rate limits by IP); this choice, in a cookie
//   optional    count:  count this visit (POST /api/visit: the IP turned into a pseudonymous key)
//               learn:  help PiEn learn (POST /api/pien/learn: which windows are opened, in what order)
//               ext:    outside AI providers (llama, mistral, qwen, gemini, deepseek): with it off, only our own
//                       models (siM, riB, piD, PiEn) answer, and the assessment pipeline, whose jurors are outside, is off
// The choice is a first-party cookie, pi_consent=v1.c1.l0.e1 (a year, SameSite=Lax, Secure on https), so the server
// can honour it too. The page enforces it: super/requests.js asks SeConsent.allows() before every request, and one
// that was declined is not sent (the request indicator lists it as declined). "Your privacy choices" in the request
// indicator's card (the owner) or the "Privacy choices" chip in its place (everyone else) opens this again; so does
// ?consent=1. The boxes start unticked: "Accept all" is one click, but consent is never pre-ticked.
//
//   SeConsent.get()  SeConsent.allows(method, url, body)  SeConsent.open()
(function () {
  "use strict";
  if (window.SeConsent) return;
  const NAME = "pi_consent", VERSION = "v1", YEAR = 365 * 24 * 3600;
  const OUTSIDE = ["llama", "mistral", "qwen", "gemini", "deepseek"];
  function read() {
    const m = document.cookie.match(/(?:^|;\s*)pi_consent=([^;]+)/);
    if (!m) return null;
    const p = decodeURIComponent(m[1]).split(".");
    if (p[0] !== VERSION) return null;                                   // an older notice: ask again
    const o = {}; p.slice(1).forEach(x => { o[x[0]] = x[1] === "1"; });
    return { count: !!o.c, learn: !!o.l, ext: !!o.e };
  }
  function write(c) {
    const v = [VERSION, "c" + (c.count ? 1 : 0), "l" + (c.learn ? 1 : 0), "e" + (c.ext ? 1 : 0)].join(".");
    document.cookie = NAME + "=" + encodeURIComponent(v) + "; Max-Age=" + YEAR + "; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  }
  let choice = read();
  const NONE = { count: false, learn: false, ext: false };
  const now = () => choice || NONE;                                      // not chosen yet: nothing optional
  let visitHeld = false;

  // ---- what a request needs (super/requests.js asks before sending) ----------------------------------
  function allows(method, url, body) {
    let path; try { path = new URL(url, location.href).pathname; } catch (_) { return { ok: true }; }
    const m = String(method || "GET").toUpperCase(), c = now();
    if (path === "/api/visit" && m === "POST" && !c.count) { visitHeld = true; return { ok: false, why: "visit counting is off" }; }
    if (path === "/api/pien/learn" && !c.learn) return { ok: false, why: "PiEn learning is off" };
    if (!c.ext && m !== "GET") {
      if (/^\/api\/assess(\/|$)/.test(path) || /^\/api\/super\/(ask|panel)/.test(path) || /\/review\/llm$/.test(path)) return { ok: false, why: "outside AI providers are off (these use them)" };
      if (/^\/api\/super\/one/.test(path)) {
        try { const j = typeof body === "string" ? JSON.parse(body) : null; if (j && OUTSIDE.includes(String(j.engine || "").toLowerCase())) return { ok: false, why: "outside AI providers are off" }; } catch (_) { /* fine */ }
      }
    }
    return { ok: true };
  }

  // ---- the notice -----------------------------------------------------------------------------------
  let box = null;
  function open() {
    if (box || !document.body) return;
    const c = choice || { count: false, learn: false, ext: false };       // a first visit: nothing ticked (consent is never pre-ticked)
    box = document.createElement("div"); box.className = "se-consent";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "se-consent-h");
    box.innerHTML =
      '<div class="se-consent-card">' +
      '<h2 id="se-consent-h">Before you start: what this site does</h2>' +
      '<p>Pi Tech Lab runs ScholarPi, an AI assessment of research papers. Here is everything it does with you, so you can choose.</p>' +
      '<h3>Always on: the site needs these</h3>' +
      '<ul><li>Your layout and the supers you make are kept in this browser.</li>' +
      '<li>If you sign in, a session keeps you signed in, and your layout is kept with your account.</li>' +
      '<li>Our server sees your IP address to stop abuse (rate limits). It is not sold or shared.</li>' +
      '<li>This choice is kept in a cookie (pi_consent), for a year.</li></ul>' +
      '<h3>Your choice</h3>' +
      '<label><input type="checkbox" data-k="count"' + (c.count ? " checked" : "") + '><span><b>Count my visit.</b> Your IP is turned into a pseudonymous key so we count visitors once. Nothing else about you is kept.</span></label>' +
      '<label><input type="checkbox" data-k="learn"' + (c.learn ? " checked" : "") + '><span><b>Help PiEn learn.</b> Which windows you open, and in what order, train our shared model to suggest the next one. No text you type.</span></label>' +
      '<label><input type="checkbox" data-k="ext"' + (c.ext ? " checked" : "") + '><span><b>Use outside AI providers.</b> What you send to an AI may go to Llama, Mistral, Qwen, Gemini or DeepSeek, to be answered. Off: only our own models (siM, riB, piD, PiEn) answer, and assessing a manuscript, whose panel uses outside jurors, is unavailable.</span></label>' +
      '<p class="se-consent-small">We never sell your data. You can change this any time from <b>Privacy choices</b> in the bottom-left corner.</p>' +
      '<div class="se-consent-btns"><button type="button" data-a="essential">Essential only</button><button type="button" data-a="save">Save my choices</button><button type="button" data-a="all" class="is-main">Accept all</button></div>' +
      "</div>";
    // the page's own gestures (zoom, wiring, typing into supers, making supers) stay out of it
    ["pointerdown", "dblclick", "wheel", "keydown", "contextmenu"].forEach(t => box.addEventListener(t, e => e.stopPropagation(), { passive: t !== "dblclick" && t !== "contextmenu" && t !== "keydown" }));
    box.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("button[data-a]"); if (!a) return;
      const ticks = Object.fromEntries([...box.querySelectorAll("input[data-k]")].map(i => [i.dataset.k, i.checked]));
      decide(a.dataset.a === "all" ? { count: true, learn: true, ext: true } : a.dataset.a === "essential" ? { count: false, learn: false, ext: false } : ticks);
    });
    box.addEventListener("keydown", e => {                               // the keyboard stays inside the notice
      if (e.key !== "Tab") return;
      const f = [...box.querySelectorAll("input, button")], i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(box);
    setTimeout(() => { const b = box && box.querySelector(".is-main"); if (b) b.focus({ preventScroll: true }); }, 50);
  }
  function decide(c) {
    choice = { count: !!c.count, learn: !!c.learn, ext: !!c.ext }; write(choice);
    if (box) { box.remove(); box = null; }
    if (choice.count && visitHeld) { visitHeld = false; try { fetch("/api/visit", { method: "POST" }).catch(() => {}); } catch (_) { /* fine */ } }
    const o = document.querySelector(".lv-out"); if (o) o.textContent = "Saved your choices: " + ["count " + (choice.count ? "on" : "off"), "PiEn learning " + (choice.learn ? "on" : "off"), "outside AI " + (choice.ext ? "on" : "off")].join(", ");
    document.dispatchEvent(new CustomEvent("se:consent", { detail: choice }));
  }
  function start() { if (!choice || /[?&]consent=1\b/.test(location.search)) open(); }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.SeConsent = { get: () => choice ? Object.assign({}, choice) : null, allows, open, decide };
})();
