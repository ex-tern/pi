// view.js — renders the public Medicine plan (plan.json) as HTML.
// Shared by the ScholarPi Lib pill (frontend/medicine.js) and the
// standalone page in the Medicine repository (index.html).
// The plan is public by design: remaining courses, timeline, CFU progress
// and to-dos. No grades, exam dates passed or averages are ever included.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function render(p) {
    // byYear already counts the phase items marked done.
    const earned = p.byYear.reduce((a, y) => a + y.earned, 0);
    const items = p.phases.flatMap(ph => ph.items);
    const left = items.filter(i => !i.done);
    const leftCfu = left.reduce((a, i) => a + i.cfu, 0);
    const exams = left.filter(i => i.graded);
    const gap = p.total - earned - leftCfu;
    const pct = Math.round(100 * earned / p.total);

    const bar = (v, max) => '<span class="md-bar"><i style="width:' + (100 * v / max).toFixed(1) + '%"></i></span>';

    let h = '<div class="md-head"><h2>' + esc(p.title) + '</h2>' +
      '<p class="md-lede">' + esc(p.degree) + '. Target: <b>' + esc(p.target) + '</b>, backup ' + esc(p.backup) + '.</p></div>';

    h += '<div class="md-stats">' +
      '<div><b>' + earned + '</b><span>of ' + p.total + ' CFU earned</span></div>' +
      '<div><b>' + pct + '%</b><span>of the degree</span></div>' +
      '<div><b>' + exams.length + '</b><span>exams left (' + exams.reduce((a, i) => a + i.cfu, 0) + ' CFU)</span></div>' +
      '<div><b>' + left.length + '</b><span>activities left (' + leftCfu + ' CFU)</span></div>' +
      '</div>' + bar(earned, p.total);

    h += '<h3>CFU by year</h3><div class="md-years">' + p.byYear.map(y =>
      '<div class="md-year"><span>Year ' + y.year + '</span>' + bar(y.earned, 60) + '<em>' + y.earned + '</em></div>').join("") + '</div>';

    h += '<h3>Timeline</h3><ol class="md-phases">' + p.phases.map(ph => {
      const all = ph.items.every(i => i.done);
      return '<li class="md-phase' + (all ? ' is-done' : '') + '"><div class="md-when">' + esc(ph.when) + '</div>' +
        '<div class="md-what"><b>' + esc(ph.label) + '</b><ul>' + ph.items.map(i =>
          '<li class="' + (i.done ? 'is-done' : '') + '"><span class="md-name">' + esc(i.name) + '</span>' +
          '<span class="md-tag">' + i.cfu + ' CFU' + (i.graded ? ' · exam' : '') + (i.done ? ' · done' : '') + '</span>' +
          (i.note ? '<small>' + esc(i.note) + '</small>' : '') + '</li>').join("") + '</ul></div></li>';
    }).join("") + '</ol>';

    h += '<h3>To do</h3><ul class="md-tasks">' + p.tasks.map(t =>
      '<li><span class="md-when">' + esc(t.when) + '</span><span>' + esc(t.text) + '</span></li>').join("") + '</ul>';

    if (gap > 0) h += '<p class="md-note">' + gap + ' CFU are not yet placed in the plan (' + (earned + leftCfu) + ' of ' + p.total + ').</p>';
    h += '<p class="md-note">Updated ' + esc(p.updated) + '. Grades are deliberately not shown.</p>';
    return h;
  }

  window.MedicineView = { render };
})();
