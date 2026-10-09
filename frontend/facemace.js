// facemace.js — FaceMace, in the Tools bubble: sort photos by face.
//
// A browser port of neurophilic/FaceID ("Auto Face Discovery & Sorter", a
// Streamlit app). Choose a folder or some photos; FaceMace finds the faces,
// learns who is who as it goes, and groups the photos by person, exactly as
// face_sorter.py does (see facemace/worker.js). The result can be downloaded as
// a ZIP of folders (Auto_Sorted_Faces/Person_1, ..., No_Faces_Detected) or,
// where the browser allows, written straight into a folder you pick.
//
// Everything runs on this device: photos are read in the browser and never
// uploaded, which matters, since faces are personal data.
(function () {
  "use strict";
  const IMG = /\.(jpe?g|png)$/i;           // the same file types as the original
  const root = document.createElement("div");
  root.className = "fm";
  root.innerHTML =
    '<h2>FaceMace</h2>' +
    '<p class="fm-lede">Sort photos by face. Choose a folder or some photos: FaceMace finds the faces, learns who is who, and groups the photos by person. ' +
    '<b>Everything happens on this device; no photo is uploaded.</b></p>' +
    '<div class="fm-drop" tabindex="0">' +
    '<p>Drop photos or a folder here</p>' +
    '<div class="fm-pick"><label class="fm-btn">Choose a folder<input type="file" class="fm-dir" webkitdirectory multiple hidden></label>' +
    '<label class="fm-btn fm-ghost">Choose photos<input type="file" class="fm-files" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple hidden></label></div>' +
    '<p class="fm-count"></p></div>' +
    '<div class="fm-settings"><label>Match strictness <output class="fm-th">75</output>' +
    '<input type="range" class="fm-range" min="40" max="120" value="75"></label>' +
    '<p>Lower is stricter (more people, each photo set smaller); higher is looser (more photos grouped together). ' +
    'Faces are found once, so trying another strictness is quick.</p></div>' +
    '<button type="button" class="fm-go" disabled>Sort by face</button>' +
    '<div class="fm-progress" hidden><div class="fm-bar"><i></i></div><p></p></div>' +
    '<div class="fm-results"></div>';

  let files = [], worker = null, last = null;
  const $ = s => root.querySelector(s);
  const sig = () => files.map(f => f.name + ":" + f.size + ":" + f.lastModified).join("|");

  function setFiles(list) {
    files = [...list].filter(f => IMG.test(f.name)).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    $(".fm-count").textContent = files.length ? files.length + " photo" + (files.length === 1 ? "" : "s") + " ready" : "No JPG or PNG files found there.";
    $(".fm-go").disabled = !files.length;
    $(".fm-results").innerHTML = ""; last = null;
  }
  async function filesFromDrop(dt) {
    const out = [];
    const walk = entry => new Promise(res => {
      if (entry.isFile) entry.file(f => { out.push(f); res(); }, () => res());
      else if (entry.isDirectory) {
        const r = entry.createReader(), all = [];
        const more = () => r.readEntries(async ents => { if (!ents.length) { for (const e of all) await walk(e); res(); } else { all.push(...ents); more(); } }, () => res());
        more();
      } else res();
    });
    const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e); return out; }
    return [...dt.files];
  }

  function run() {
    if (!files.length) return;
    if (typeof OffscreenCanvas === "undefined" || !window.Worker) {
      $(".fm-results").innerHTML = '<p class="fm-warn">This browser cannot run FaceMace (it needs OffscreenCanvas). Try a recent Chrome, Edge, Firefox or Safari.</p>';
      return;
    }
    worker = worker || new Worker("facemace/worker.js");
    const th = +$(".fm-range").value;
    const pr = $(".fm-progress"); pr.hidden = false;
    $(".fm-go").disabled = true;
    pr.querySelector("p").textContent = "Starting…";
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === "progress") {
        pr.querySelector("i").style.width = (100 * m.done / m.total) + "%";
        pr.querySelector("p").textContent = "Scanning photo " + m.done + " of " + m.total + "…";
      } else if (m.type === "done") {
        pr.hidden = true; $(".fm-go").disabled = false; last = m; show(m, th);
      } else if (m.type === "error") {
        pr.hidden = true; $(".fm-go").disabled = false;
        $(".fm-results").innerHTML = '<p class="fm-warn">Could not sort: ' + m.message + '</p>';
      }
    };
    worker.postMessage({ files, threshold: th, sig: sig() });
  }

  const label = k => k === "No_Faces_Detected" ? "No faces found" : k.replace("_", " ");
  function show(m, th) {
    const box = $(".fm-results");
    const keys = Object.keys(m.groups).sort((a, b) => (a === "No_Faces_Detected") - (b === "No_Faces_Detected") || +a.split("_")[1] - +b.split("_")[1]);
    box.innerHTML =
      '<div class="fm-metrics"><div><b>' + files.length + '</b><span>photos</span></div>' +
      '<div><b>' + m.people + '</b><span>people found</span></div>' +
      '<div><b>' + m.faces + '</b><span>faces</span></div>' +
      '<div><b>' + (m.ms / 1000).toFixed(1) + ' s</b><span>at strictness ' + th + '</span></div></div>' +
      '<div class="fm-save"><button type="button" class="fm-btn fm-zip">Download as ZIP</button>' +
      (window.showDirectoryPicker ? '<button type="button" class="fm-btn fm-ghost fm-dirsave">Save into a folder…</button>' : '') +
      '<span class="fm-saved"></span></div>' +
      (m.unreadable.length ? '<p class="fm-warn">' + m.unreadable.length + ' file(s) could not be read and were skipped.</p>' : '');
    keys.forEach(k => {
      const idx = m.groups[k];
      const g = document.createElement("section");
      g.className = "fm-group";
      g.innerHTML = '<h3></h3><div class="fm-thumbs"></div>';
      g.querySelector("h3").textContent = label(k) + " · " + idx.length + " photo" + (idx.length === 1 ? "" : "s");
      const t = g.querySelector(".fm-thumbs");
      idx.slice(0, 12).forEach(i => {
        const im = document.createElement("img");
        im.loading = "lazy"; im.alt = files[i].name; im.title = files[i].name;
        im.src = URL.createObjectURL(files[i]);
        im.onload = () => URL.revokeObjectURL(im.src);
        t.appendChild(im);
      });
      if (idx.length > 12) { const more = document.createElement("span"); more.className = "fm-more"; more.textContent = "+" + (idx.length - 12); t.appendChild(more); }
      box.appendChild(g);
    });
    box.querySelector(".fm-zip").addEventListener("click", () => downloadZip(m));
    const ds = box.querySelector(".fm-dirsave");
    if (ds) ds.addEventListener("click", () => saveToFolder(m));
  }

  // ------------------------------------------------------------ output, as the original's folders
  function plan(m) {
    const out = [];
    for (const [k, idx] of Object.entries(m.groups)) {
      const used = new Set();
      idx.forEach(i => {
        let name = files[i].name, n = 1;
        while (used.has(name)) name = files[i].name.replace(/(\.[^.]+)$/, " (" + (++n) + ")$1");
        used.add(name);
        out.push({ path: "Auto_Sorted_Faces/" + k + "/" + name, file: files[i] });
      });
    }
    return out;
  }
  async function saveToFolder(m) {
    const saved = $(".fm-saved");
    try {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      let n = 0;
      for (const { path, file } of plan(m)) {
        const parts = path.split("/"); let d = dir;
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable(); await w.write(file); await w.close(); n++;
      }
      saved.textContent = "Saved " + n + " files into Auto_Sorted_Faces.";
    } catch (e) { if (e && e.name !== "AbortError") saved.textContent = "Could not save: " + (e.message || e); }
  }
  // A plain "stored" ZIP (no compression: photos are already compressed).
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function downloadZip(m) {
    const saved = $(".fm-saved"); saved.textContent = "Packing…";
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const { path, file } of plan(m)) {
      const data = new Uint8Array(await file.arrayBuffer()), name = enc.encode(path), crc = crc32(data);
      const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(head, name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += head.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0), count = central.length / 2;
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(cdSize), ...u32(off), ...u16(0)]);
    const blob = new Blob([...parts, ...central, end], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "Auto_Sorted_Faces.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    saved.textContent = "Downloaded " + count + " files.";
  }

  // ------------------------------------------------------------ wiring
  $(".fm-dir").addEventListener("change", e => setFiles(e.target.files));
  $(".fm-files").addEventListener("change", e => setFiles(e.target.files));
  const drop = $(".fm-drop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async e => { e.preventDefault(); drop.classList.remove("over"); setFiles(await filesFromDrop(e.dataTransfer)); });
  $(".fm-range").addEventListener("input", e => { $(".fm-th").textContent = e.target.value; });
  $(".fm-go").addEventListener("click", run);

  function start() {
    window.PiOrbit.addPill({ key: "assess:FaceMace", section: { key: "assess", name: "Tools" }, title: "FaceMace", content: root, inGroup: "Tools" });
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
