// The SuperAI runtime: loads the program the site runs (super/pitechlab.super.js) and hands it to the
// modules that build the site from it (orbit.js, super/nodes.js, super/project.js).
//
// A visitor can edit the program in the page (the project super's Program view): their copy is checked,
// kept in their browser as superai:program, and runs instead of the shipped one from the next load. A copy
// that fails the check is set aside and the shipped program runs, so an edit can never leave the site blank.
//
//   SuperAI.program        the program running now
//   SuperAI.shipped        the program as shipped
//   SuperAI.edited         true when the visitor's own copy is running
//   SuperAI.validate(p)    [] when p is a well-formed program, else what is wrong with it
//   SuperAI.save(p)        check p, keep it as the visitor's copy (it runs from the next load)
//   SuperAI.reset()        forget the visitor's copy
//   SuperAI.value(t, j)    a probe's template filled in from a JSON reply (super/project.js)
(function () {
  "use strict";
  const KEY = "superai:program";
  const shipped = window.SUPERAI_PROGRAM;
  const clone = o => JSON.parse(JSON.stringify(o));

  function validate(p) {
    const bad = [];
    const isArr = (v, name) => { if (!Array.isArray(v)) { bad.push(name + " must be a list"); return false; } return true; };
    if (!p || typeof p !== "object") return ["the program must be an object"];
    if (typeof p.language !== "string" || !/^SuperAI/.test(p.language)) bad.push('language must be "SuperAI …"');
    if (isArr(p.sources, "sources")) p.sources.forEach((s, i) => { if (!s || !s.key || !s.name) bad.push("sources[" + i + "] needs a key and a name"); });
    if (isArr(p.bubbles, "bubbles")) p.bubbles.forEach((b, i) => {
      if (!b || !b.title) bad.push("bubbles[" + i + "] needs a title");
      else if (!b.source && !Array.isArray(b.members)) bad.push("bubble " + b.title + " needs a source or members");
      if (b && b.source && !(p.sources || []).some(s => s.key === b.source)) bad.push("bubble " + b.title + ": no source called " + b.source);
    });
    if (!p.titles || typeof p.titles !== "object") bad.push("titles must be an object");
    if (p.merges) isArr(p.merges, "merges");
    if (p.hide != null && (!Array.isArray(p.hide) || p.hide.some(t => typeof t !== "string"))) bad.push("hide must be a list of window titles");
    const d = p.diagram;
    if (!d || typeof d !== "object") bad.push("diagram must be an object");
    else {
      const ids = new Set(["site"]);
      if (isArr(d.supers, "diagram.supers")) d.supers.forEach((s, i) => {
        if (!s || !s.id) { bad.push("diagram.supers[" + i + "] needs an id"); return; }
        if (ids.has(s.id)) bad.push("two supers are called " + s.id);
        ids.add(s.id);
        if (!s.at) bad.push("super " + s.id + " needs at (where it is)");
      });
      if (isArr(d.wires, "diagram.wires")) d.wires.forEach((w, i) => {
        if (!Array.isArray(w) || w.length !== 2) { bad.push("diagram.wires[" + i + "] must be [from, to]"); return; }
        w.forEach(end => {
          const m = /^([\w-]+)\.(input|output|sync|condition)$/.exec(end || "");
          if (!m) bad.push("wire end " + end + ' must be "super.port" (input, output, sync or condition)');
          else if (!ids.has(m[1])) bad.push("wire end " + end + ": no super called " + m[1]);
        });
      });
    }
    const pr = p.project;
    if (!pr || typeof pr !== "object") bad.push("project must be an object");
    else if (isArr(pr.supers, "project.supers")) {
      const ids = new Set(pr.supers.map(s => s && s.id));
      (p.bubbles || []).forEach(b => b && ids.add("b-" + b.title));
      ((pr.siteRow && pr.siteRow.extra) || []).forEach(x => ids.add(x.id));
      pr.supers.forEach((s, i) => { if (!s || !s.id || !s.label || !(s.w > 0) || !(s.h > 0)) bad.push("project.supers[" + i + "] needs id, label, w and h"); });
      if (isArr(pr.wires || [], "project.wires")) (pr.wires || []).forEach(w => {
        // a wire to a bubble that was renamed or removed is simply not drawn; any other missing end is an error
        if (!Array.isArray(w) || w.some(x => !ids.has(x) && !/^b-/.test(x))) bad.push("project wire " + JSON.stringify(w) + " joins a super that does not exist");
      });
    }
    // the Rust engine's own check too (rust/superai), once it has loaded: functions, loops of wires
    const rs = window.SuperAI && window.SuperAI.rs;
    if (rs && rs.ready) (rs.validate(p) || []).forEach(e => { if (!bad.includes(e) && !bad.some(b => e.endsWith(b))) bad.push(e); });
    return bad;
  }

  let program = shipped, edited = false, setAside = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const mine = JSON.parse(raw), bad = validate(mine);
      if (!bad.length) { program = mine; edited = true; }
      else setAside = bad;
    }
  } catch (e) { setAside = [String(e && e.message || e)]; }
  if (setAside) console.warn("SuperAI: your edited program was set aside, the shipped one runs:", setAside);

  // probe templates: {path} a value, {path#} how many (keys or items), {path|N} a number to N decimals,
  // {path?yes:no} a choice; replies from /api/super/engines also have ready and outside (engines answering)
  function get(j, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), j); }
  function value(tpl, j) {
    if (!tpl) return "";
    if (j && Array.isArray(j.engines)) {
      j = Object.assign({}, j, { ready: j.engines.filter(e => e.ready).length, outside: j.engines.filter(e => e.kind === "outside" && e.ready).length });
    }
    return String(tpl).replace(/\{([^}]+)\}/g, (_, expr) => {
      let m;
      if ((m = /^([\w.]+)\?([^:]*):(.*)$/.exec(expr))) return get(j, m[1]) ? m[2] : m[3];
      if ((m = /^([\w.]+)#$/.exec(expr))) { const v = get(j, m[1]); return v == null ? "0" : String(Array.isArray(v) ? v.length : Object.keys(v).length); }
      if ((m = /^([\w.]+)\|(\d)$/.exec(expr))) { const v = +get(j, m[1]); return Number.isFinite(v) ? v.toFixed(+m[2]) : "—"; }
      const v = get(j, expr);
      return v == null || v === "" ? "—" : String(v);
    });
  }

  window.SuperAI = Object.assign(window.SuperAI || {}, {
    program, shipped, edited, setAside, validate, value,
    save(p) { const bad = validate(p); if (bad.length) return bad; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) { return ["this browser does not keep data for this site"]; } return []; },
    reset() { try { localStorage.removeItem(KEY); } catch (_) { /* private mode */ } },
    copy: () => clone(program),
  });
})();
