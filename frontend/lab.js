// lab.js — the Lab tab: projects hosted inside ScholarPi.
//
// Kept out of app.js on purpose. The Lab is a host for other projects, and the
// less it is entangled with the assessment app the easier both are to change.
// It relies on exactly two things from app.js: the generic tab handler (which
// shows #tab-lab for the .tab-btn with data-tab="lab"), and the fetch wrapper
// that adds the session token to same-origin /api/ calls.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const tabBtn = document.querySelector('.tab-btn[data-tab="lab"]');
  if (!tabBtn) return;

  // ------------------------------------------------------------ HAL-OS
  // The iframe is loaded on first open and paused whenever the Lab is not the
  // visible tab, so an x86 emulator never runs behind a hidden panel.
  const halFrame = $("halFrame");
  function halMessage(msg) {
    try { halFrame.contentWindow && halFrame.contentWindow.postMessage(msg, location.origin); } catch (_) { /* not loaded yet */ }
  }
  function openLab() {
    if (halFrame && !halFrame.src) halFrame.src = halFrame.dataset.src;
    else halMessage({ hal: "resume" });
    loadPrivate();
    try { history.replaceState(null, "", "#lab"); } catch (_) { /* file:// or sandboxed */ }
  }
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    if (btn.dataset.tab === "lab") openLab();
    else {
      halMessage({ hal: "pause" });
      if (location.hash === "#lab") try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* ignore */ }
    }
  }));
  // Deep link: /#lab opens the tab, on load or when the hash changes in place.
  if (location.hash === "#lab") setTimeout(() => tabBtn.click(), 0);
  window.addEventListener("hashchange", () => { if (location.hash === "#lab" && !tabBtn.classList.contains("active")) tabBtn.click(); });

  // ------------------------------------------------------------ private projects
  const API = "/api/lab/private";
  const card = $("labPrivate"), body = $("labPrivateBody");
  let loadedFor = null;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const titleOf = id => id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const fileUrl = (p, n) => API + "/" + encodeURIComponent(p) + "/" + encodeURIComponent(n);

  async function isOwner() {
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store" });
      return r.ok && (await r.json()).is_owner === true;
    } catch (_) { return false; }
  }

  async function loadPrivate(force) {
    const token = localStorage.getItem("sp_token") || "";
    if (!force && loadedFor === token) return;
    loadedFor = token;
    if (!token || !(await isOwner())) { card.classList.add("hidden"); body.innerHTML = ""; return; }
    card.classList.remove("hidden");
    body.innerHTML = '<p class="hint">Loading…</p>';
    let data;
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "HTTP " + r.status);
      data = await r.json();
    } catch (e) {
      body.innerHTML = '<p class="hint">Could not load private projects: ' + esc(e.message) + "</p>";
      return;
    }
    if (!data.projects.length) {
      body.innerHTML = '<p class="hint">No private projects yet. Upload your files below — for the Graduation Plan, ' +
        "choose <code>Road-to-Graduation.html</code>, <code>libretto.csv</code>, <code>README.md</code> and the email draft.</p>";
      return;
    }
    body.innerHTML = data.projects.map(p => {
      const files = p.files.map(f =>
        '<button class="btn btn-outline lab-file" data-p="' + esc(p.id) + '" data-n="' + esc(f.name) + '">' + esc(f.name) + "</button>").join("");
      return '<div class="lab-project"><h3>' + esc(titleOf(p.id)) + '</h3><div class="lab-files">' + files +
        '</div><div class="lab-view" id="view-' + esc(p.id) + '"></div></div>';
    }).join("");
    // Open the most useful file of each project straight away: an HTML page
    // first (it is the project's own UI), else its README.
    data.projects.forEach(p => {
      const pick = p.files.find(f => /\.html?$/i.test(f.name)) || p.files.find(f => /^readme/i.test(f.name)) || p.files[0];
      if (pick) showFile(p.id, pick.name);
    });
  }

  body.addEventListener("click", e => {
    const b = e.target.closest(".lab-file");
    if (b) showFile(b.dataset.p, b.dataset.n);
  });

  async function showFile(project, name) {
    const view = $("view-" + project);
    if (!view) return;
    body.querySelectorAll('.lab-file[data-p="' + CSS.escape(project) + '"]').forEach(b => b.classList.toggle("active", b.dataset.n === name));
    view.innerHTML = '<p class="hint">Loading ' + esc(name) + "…</p>";
    let r;
    try { r = await fetch(fileUrl(project, name), { cache: "no-store" }); } catch (e) { view.innerHTML = '<p class="hint">' + esc(e.message) + "</p>"; return; }
    if (!r.ok) { view.innerHTML = '<p class="hint">Could not open ' + esc(name) + " (HTTP " + r.status + ").</p>"; return; }
    const ext = (name.split(".").pop() || "").toLowerCase();
    const actions = '<div class="lab-view-actions"><button class="btn btn-ghost" data-dl="1">Download</button></div>';
    if (ext === "html" || ext === "htm") return showHtml(view, project, name, await r.text(), actions);
    if (ext === "csv") return showCsv(view, await r.text(), actions, name);
    if (ext === "md" || ext === "txt" || ext === "json") {
      const text = await r.text();
      view.innerHTML = actions + '<pre class="lab-text"></pre>';
      view.querySelector("pre").textContent = text;
      bindDownload(view, new Blob([text], { type: "text/plain" }), name);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    view.innerHTML = actions + (ext === "pdf"
      // Not sandboxed: browsers refuse to run their PDF viewer in a sandboxed
      // frame. The blob carries the PDF type, so it is never parsed as HTML.
      ? '<embed class="lab-doc" type="application/pdf" src="' + url + '" title="' + esc(name) + '">'
      : '<img class="lab-img" alt="' + esc(name) + '" src="' + url + '">');
    bindDownload(view, blob, name);
  }

  function bindDownload(view, blob, name) {
    const b = view.querySelector("[data-dl]");
    if (!b) return;
    b.addEventListener("click", () => {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ""));
  }
  function showCsv(view, text, actions, name) {
    const rows = parseCsv(text);
    const head = rows.shift() || [];
    view.innerHTML = actions + '<div class="table-scroll"><table class="data-table"><thead><tr>' +
      head.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map(r => "<tr>" + r.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    bindDownload(view, new Blob([text], { type: "text/csv" }), name);
  }

  // HTML runs in a sandboxed iframe WITHOUT allow-same-origin: it can run its
  // own scripts, but it cannot read this page's storage (the session token
  // lives there) or call the API as the owner.
  //
  // Pages built as Claude artifacts save themselves through window.claude
  // ("artifact" -> publish(html)). The stand-in below gives them the same
  // call, answered by the parent, which writes the new HTML back to the same
  // private file. Everything else about the page is untouched.
  const SHIM = "<script>(function(){var n=0;window.claude={use:function(c){if(c!=='artifact')return Promise.reject({code:'capability_disabled'});" +
    "return Promise.resolve({publish:function(html){return new Promise(function(res,rej){var id='s'+(++n)+Math.random();" +
    "function on(e){if(e.source!==parent||!e.data||e.data.labSaveAck!==id)return;removeEventListener('message',on);e.data.ok?res():rej({code:e.data.code||'error'})}" +
    "addEventListener('message',on);parent.postMessage({labSave:id,html:String(html)},'*')})}})}}})();<\/script>";

  const frames = new Map();   // iframe window -> {project, name}
  function showHtml(view, project, name, html, actions) {
    view.innerHTML = actions + '<iframe class="lab-doc" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" title="' + esc(name) + '"></iframe>';
    const frame = view.querySelector("iframe");
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + SHIM) : SHIM + html;
    frame.srcdoc = doc;
    frames.set(frame, { project, name });
    bindDownload(view, new Blob([html], { type: "text/html" }), name);
  }

  window.addEventListener("message", async e => {
    if (!e.data || typeof e.data.labSave !== "string") return;
    let target = null;
    frames.forEach((meta, frame) => { if (frame.isConnected && frame.contentWindow === e.source) target = meta; });
    if (!target) return;   // only frames this script created may save, and only to their own file
    let ok = false, code = "error";
    try {
      const form = new FormData();
      form.append("file", new Blob([e.data.html], { type: "text/html" }), target.name);
      const r = await fetch(fileUrl(target.project, target.name), { method: "PUT", body: form });
      ok = r.ok;
      if (r.status === 403 || r.status === 503) code = "not_writer";
    } catch (_) { /* network: reported as error */ }
    try { e.source.postMessage({ labSaveAck: e.data.labSave, ok, code }, "*"); } catch (_) { /* frame gone */ }
  });

  $("labUpload").addEventListener("click", async () => {
    const project = $("labProject").value.trim().toLowerCase();
    const files = Array.from($("labFiles").files || []);
    const msg = $("labUploadMsg");
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(project)) { msg.textContent = "Project names use lowercase letters, digits and dashes."; return; }
    if (!files.length) { msg.textContent = "Choose at least one file."; return; }
    let done = 0; const failed = [];
    for (const f of files) {
      const form = new FormData();
      form.append("file", f, f.name);
      try {
        const r = await fetch(fileUrl(project, f.name), { method: "PUT", body: form });
        if (r.ok) done++; else failed.push(f.name + " (" + ((await r.json().catch(() => ({}))).detail || r.status) + ")");
      } catch (e) { failed.push(f.name); }
    }
    msg.textContent = done + " uploaded" + (failed.length ? "; failed: " + failed.join(", ") : ".");
    $("labFiles").value = "";
    loadPrivate(true);
  });

  // Sign-in and sign-out happen in the sidebar without a reload; re-check
  // ownership whenever the Lab is visible and the token changes.
  window.addEventListener("storage", e => { if (e.key === "sp_token" && document.getElementById("tab-lab").classList.contains("active")) loadPrivate(true); });
  setInterval(() => {
    if (document.getElementById("tab-lab").classList.contains("active") && loadedFor !== (localStorage.getItem("sp_token") || "")) loadPrivate(true);
  }, 2000);
})();
