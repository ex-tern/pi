// SPDX-License-Identifier: LicenseRef-PiTechLab-Proprietary
// The host for ScholarPi's Rust front end (back/rust/ui, built to ui.wasm).
//
// WebAssembly cannot touch the page by itself, so this lends it the DOM, the network and storage as numbered
// handles. It holds no views, no text and no logic of the site: all of that is in the Rust crate.
const nodes = [null], freed = [], forms = [null], files = [null];
const enc = new TextEncoder(), dec = new TextDecoder();
let W;

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

const host = {
  create: (p, l) => keep(document.createElement(str(p, l))),
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
    else if (k === "files") n.addEventListener("change", () => { const v = fileList(n.files); n.value = ""; send(id, k, v); });
    else if (k === "drop") {
      n.addEventListener("dragover", (e) => e.preventDefault());
      n.addEventListener("drop", (e) => { e.preventDefault(); send(id, k, fileList(e.dataTransfer.files)); });
    } else n.addEventListener(k, () => send(id, k, n.type === "checkbox" ? (n.checked ? "1" : "0") : (n.value ?? "")));
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
};

const wasm = new URL("ui.wasm" + new URL(import.meta.url).search, import.meta.url);
const bytes = await (await fetch(wasm)).arrayBuffer();
W = (await WebAssembly.instantiate(bytes, { host })).instance.exports;
addEventListener("hashchange", () => W.nav());
W.start();
