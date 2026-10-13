// ScholarPi for Zotero 7: a piX column in the item list and a ScholarPi section in the item pane, for every item
// with a DOI that pitechlab.com has assessed (GET /api/dossier/by-doi). Nothing is sent but the DOI.
/* global Zotero */
var ScholarPi;
const API = "https://pitechlab.com";

function install() {}
function uninstall() {}

function doiOf(item) {
  if (!item || !item.isRegularItem || !item.isRegularItem()) return "";
  let doi = "";
  try { doi = item.getField("DOI") || ""; } catch (_) { /* this item type has no DOI field */ }
  if (!doi) {
    const m = String(item.getField("extra") || "").match(/\b10\.\d{4,9}\/\S+/);
    doi = m ? m[0] : "";
  }
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/[.,;]+$/, "").toLowerCase();
}

async function lookup(doi) {
  if (ScholarPi.cache.has(doi)) return ScholarPi.cache.get(doi);
  if (ScholarPi.pending.has(doi)) return ScholarPi.pending.get(doi);
  const p = (async () => {
    try {
      const r = await Zotero.HTTP.request("GET", API + "/api/dossier/by-doi?doi=" + encodeURIComponent(doi),
        { responseType: "json", timeout: 15000, successCodes: [200] });
      const d = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
      ScholarPi.cache.set(doi, d || { found: false });
      return d;
    } catch (e) {
      Zotero.debug("ScholarPi: lookup failed for " + doi + ": " + e);
      return null;                                     // not cached: asked again next time
    } finally {
      ScholarPi.pending.delete(doi);
    }
  })();
  ScholarPi.pending.set(doi, p);
  return p;
}

function html(doc, tag, text, attrs) {
  const el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  if (text) el.textContent = text;
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function renderPane(body, d, doi) {
  const doc = body.ownerDocument;
  body.replaceChildren();
  if (!d) { body.appendChild(html(doc, "div", "pitechlab.com could not be reached.")); return; }
  if (!d.found) {
    body.appendChild(html(doc, "div", "Not assessed on ScholarPi yet."));
    const a = html(doc, "a", "Assess it on pitechlab.com", { href: "#" });
    a.addEventListener("click", e => { e.preventDefault(); Zotero.launchURL(API + "/"); });
    body.appendChild(a);
    return;
  }
  const row = (label, value) => {
    const r = html(doc, "div", "", { style: "display:flex;gap:8px;margin:2px 0" });
    r.appendChild(html(doc, "span", label, { style: "min-width:120px;opacity:.7" }));
    r.appendChild(html(doc, "span", value));
    body.appendChild(r);
  };
  row("piX", d.piX == null ? "–" : (Math.round(d.piX * 10) / 10) + " / 100");
  if (d.piQ != null) row("piQ earned", String(Math.round(d.piQ * 100) / 100));
  if (d.judgement_quality) row("Corroboration", d.judgement_quality);
  if (d.integrity_flag) row("Integrity", "flagged for review");
  const a = html(doc, "a", "Open the full dossier", { href: "#", style: "display:inline-block;margin-top:6px" });
  a.addEventListener("click", e => { e.preventDefault(); Zotero.launchURL(API + d.dossier_url); });
  body.appendChild(a);
}

async function startup({ id, rootURI }) {
  ScholarPi = { id, rootURI, cache: new Map(), pending: new Map(), columnKey: null, paneKey: null };
  ScholarPi.columnKey = await Zotero.ItemTreeManager.registerColumns({
    dataKey: "scholarpi-pix",
    label: "piX",
    pluginID: id,
    dataProvider: item => {
      const doi = doiOf(item);
      if (!doi) return "";
      if (!ScholarPi.cache.has(doi)) {
        lookup(doi).then(() => { try { Zotero.ItemTreeManager.refreshColumns(); } catch (_) { /* older Zotero 7 */ } });
        return "";
      }
      const d = ScholarPi.cache.get(doi);
      return d && d.found && d.piX != null ? (Math.round(d.piX * 10) / 10).toFixed(1) : "";
    },
  });
  ScholarPi.paneKey = Zotero.ItemPaneManager.registerSection({
    paneID: "scholarpi",
    pluginID: id,
    header: { l10nID: "scholarpi-header", icon: rootURI + "icon.svg" },
    sidenav: { l10nID: "scholarpi-sidenav", icon: rootURI + "icon.svg" },
    onItemChange: ({ item, setEnabled }) => setEnabled(!!doiOf(item)),
    onRender: ({ body }) => { body.textContent = "Looking up…"; },
    onAsyncRender: async ({ body, item }) => {
      const doi = doiOf(item);
      if (!doi) return;
      renderPane(body, await lookup(doi), doi);
    },
  });
  Zotero.getMainWindows().forEach(window => onMainWindowLoad({ window }));
}

function onMainWindowLoad({ window }) {
  window.MozXULElement.insertFTLIfNeeded("scholarpi.ftl");
}

function onMainWindowUnload({ window }) {
  const link = window.document.querySelector('[href="scholarpi.ftl"]');
  if (link) link.remove();
}

function shutdown() {
  if (!ScholarPi) return;
  if (ScholarPi.paneKey) Zotero.ItemPaneManager.unregisterSection(ScholarPi.paneKey);
  if (ScholarPi.columnKey) Zotero.ItemTreeManager.unregisterColumns(ScholarPi.columnKey);
  Zotero.getMainWindows().forEach(window => onMainWindowUnload({ window }));
  ScholarPi = undefined;
}
