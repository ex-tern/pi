// Pi Tech Lab, written in SuperAI.
//
// SuperAI is the site's graphical language: LabVIEW-style supers joined by wires, data flowing from
// outputs into inputs, powered by AI engines (the lab's siM, riB, piD and PiEn, and the outside models
// through a judge). This file is the program the front end runs: super/runtime.js loads it (or the
// visitor's own edited copy, kept in their browser) as SuperAI.program, and
//
//   orbit.js           builds the site from  sources, titles, merges and bubbles
//   super/nodes.js     lays out the diagram  diagram.supers and diagram.wires (on a first visit)
//   super/project.js   draws the project map project (the whole project as one super's inside)
//
// Native blocks: a source names a part of the page (index.html) whose cards become the windows a
// bubble holds, the way a LabVIEW program calls built-in VIs. The windows' insides (HAL-OS, the games,
// QuVI, the assessment forms) stay native; the program decides what exists, where, and how it is wired.
//
// The format is plain data (JSON-compatible), so it can be edited in the page (open the project super,
// press Program), downloaded, and checked (SuperAI.validate).
window.SUPERAI_PROGRAM = {
  language: "SuperAI 1",
  name: "Pi Tech Lab",

  // ---- native blocks: where the site's windows come from -------------------------------------------
  sources: [
    { key: "assess", name: "Evaluate", panel: "tab-assess" },
    { key: "journal", name: "Explore", panel: "tab-journal" },
    { key: "analytics", name: "Envision", panel: "tab-analytics" },
    { key: "lab", name: "Lab", panel: "tab-lab" },
    { key: "diagram", name: "Architecture", panel: "tab-diagram" },
    { key: "account", name: "Account", panel: null }
  ],
  // names for cards whose heading does not say what they are
  titles: {
    byId: { signInNotice: "Why sign in", profileCard: "Research profile", resultsSection: "Assessment results",
            historyCard: "Your assessments", ownerResetCard: "Reset platform", claimableCard: "piQ held for you" },
    retitle: { "assess:Assess a Manuscript": "Assess Manuscripts [Pi]", "analytics:Forecast": "Performance",
               "account:SciLM (siM) Assistant": "SciM Assistant" },
    // old names, so what a visitor kept (positions, use, open windows) follows a card that was renamed
    renamed: { "analytics:Key numbers": "analytics:Analytics", "analytics:Forecast": "analytics:Performance",
               "account:SciLM (siM) Assistant": "account:SciM Assistant", "account:siM Assistant": "account:SciM Assistant",
               "assess:ResBD": "assess:RiBD", "assess:Assess a Manuscript": "assess:Assess Manuscripts [Pi]",
               "account:Support ScholarPi": "account:Support Pi", "lib:Lib group": "lib:Library group" }
  },
  // windows switched off: not shown anywhere on the site (their pill, bubble and map super are left out)
  hide: ["SciM Assistant"],
  // cards that read better as one window
  merges: [
    { source: "journal", title: "Leaderboards",
      parts: ["pi-Index (piX) Leaderboard [Top Papers]", "pi-Quotient (piQ) Leaderboard [Top Authors]"] },
    { source: "diagram", title: "Architecture",
      parts: ["Overview", "Scoring Pipeline in Detail", "Stage Reference", "CoARA Compliance & Core Pillars"] }
  ],

  // ---- the site: bubbles, each a super holding pills (windows) ------------------------------------------
  // A bubble with a source holds every window that source makes; members name windows from anywhere.
  bubbles: [
    { title: "Lab", source: "lab" },
    { title: "Tools", members: ["Assess Manuscripts [Pi]"] },
    { title: "Library", key: "lib", members: ["RiBD", "The Global Map of Science"] },
    { title: "Explore", key: "explore", members: ["The journal", "Leaderboards", "Proof-of-Research Ledger Explorer", "Recent assessments"] },
    { title: "About", key: "about", members: ["Architecture", "Whitepaper", "Capabilities", "Performance", "Analytics", "Minting Difficulty", "GitHub"] },
    { title: "Connect", key: "connect", members: ["Why sign in", "Invite a researcher", "Support Pi", "Contact us"] }
  ],

  // ---- the diagram a first visit starts with ---------------------------------------------------------
  // A super: id, kind (engine: a Super AI super; box: a plain one), text typed into it, a hint shown until
  // something is, size (px), and where it is: { center }, { fx, fy } (fractions of the screen),
  // { from: id, dx, dy } (px from another super) or { leftOf: "site.input", dy } (beside a port of the site).
  // A wire: "super.port" to "super.port"; "site" is the inner super, whose ports are input, output, sync
  // and condition, as every super's are.
  diagram: {
    supers: [
      { id: "site-box", kind: "engine", at: { center: true } },
      { id: "start", kind: "engine", hint: "Connect wires to begin", size: 132, at: { fx: 0.126, fy: 0.131 } },
      { id: "open", kind: "engine", text: "open", at: { from: "start", dx: 104, dy: 155 } },
      { id: "close", kind: "engine", text: "close", at: { from: "start", dx: -15, dy: 248 } },
      { id: "run", kind: "engine", text: "run", at: { leftOf: "site.input", dy: -72 } }
    ],
    wires: [
      ["site.input", "site-box.input"],
      ["site.sync", "site-box.sync"],
      ["site-box.output", "site.output"],
      ["site.condition", "site-box.condition"],
      ["run.output", "site.input"]
    ]
  },

  // ---- the project, as one super's inside (super/project.js) -----------------------------------------
  // Drawn at 1000 × 620. kind: in, ai, lab, out, judge, step, site, sink. probe: [GET url, field path or
  // template] read live while the map is open; opens: the window pressing it opens; engine: the engine
  // whose answer it shows when the Prompt runs. The site's row is drawn from the bubbles above.
  project: {
    sections: [
      { label: "one prompt, every engine", x: 14, y: 0, w: 972, h: 270 },
      { label: "the assessment", x: 14, y: 300, w: 972, h: 110 },
      { label: "the site", x: 14, y: 470, w: 972, h: 100 }
    ],
    siteRow: { x: 20, y: 500, w: 960, h: 40, extra: [{ id: "b-account", label: "Your account", opens: "Your account" }] },
    supers: [
      { id: "prompt", label: "Prompt", kind: "in", x: 20, y: 120, w: 150, h: 64, input: true },
      { id: "superai", label: "Super AI", kind: "ai", x: 210, y: 128, w: 96, h: 48, probe: ["/api/super/engines", "{ready} engines"] },
      { id: "sim", label: "siM", kind: "lab", engine: "sim", x: 350, y: 20, w: 74, h: 40, probe: ["/api/scilem/status", "{badge}"], opens: "Capabilities" },
      { id: "rib", label: "riB", kind: "lab", engine: "rib", x: 350, y: 76, w: 74, h: 40, probe: ["/api/engines/status", "{riB.weights#} weights"], opens: "Capabilities" },
      { id: "pid", label: "piD", kind: "lab", engine: "pid", x: 350, y: 132, w: 74, h: 40, probe: ["/api/forecast", "{blocks_recorded} blocks"], opens: "Performance" },
      { id: "pien", label: "PiEn", kind: "lab", engine: "pien", x: 350, y: 188, w: 74, h: 40, probe: ["/api/pien/model", "{interactions} uses"], opens: "Capabilities" },
      { id: "llama", label: "Llama", kind: "out", engine: "llama", x: 470, y: 8, w: 74, h: 40 },
      { id: "mistral", label: "Mistral", kind: "out", engine: "mistral", x: 470, y: 58, w: 74, h: 40 },
      { id: "qwen", label: "Qwen", kind: "out", engine: "qwen", x: 470, y: 108, w: 74, h: 40 },
      { id: "gemini", label: "Gemini", kind: "out", engine: "gemini", x: 470, y: 158, w: 74, h: 40 },
      { id: "deepseek", label: "DeepSeek", kind: "out", engine: "deepseek", x: 470, y: 208, w: 74, h: 40 },
      { id: "judge", label: "Judge", kind: "judge", x: 600, y: 108, w: 74, h: 40, probe: ["/api/super/engines", "{judge?ready:no key}"] },
      { id: "answer", label: "Answer", kind: "sink", x: 720, y: 70, w: 160, h: 118 },
      { id: "live", label: "Live", kind: "site", x: 906, y: 20, w: 74, h: 40, probe: ["/api/live", "{today} today"], opens: "@live" },
      { id: "traffic", label: "Traffic", kind: "site", x: 906, y: 200, w: 74, h: 40, probe: ["/api/traffic", "{today} visits"], opens: "Analytics" },
      { id: "manuscript", label: "Manuscript", kind: "in", x: 20, y: 330, w: 92, h: 46, probe: ["/api/stats/count", "{total_analyzed} assessed"], opens: "Assess Manuscripts [Pi]" },
      { id: "extract", label: "Extract", kind: "step", x: 132, y: 333, w: 88, h: 40, note: "PDF → text" },
      { id: "integrity", label: "Integrity", kind: "step", x: 238, y: 333, w: 88, h: 40, note: "MDAR · RRID" },
      { id: "jurors", label: "Jurors", kind: "step", x: 344, y: 333, w: 88, h: 40, probe: ["/api/super/engines", "{outside} models"] },
      { id: "verdict", label: "Verdict", kind: "judge", x: 450, y: 333, w: 88, h: 40, note: "the judge" },
      { id: "pix", label: "piX", kind: "step", x: 556, y: 333, w: 88, h: 40, probe: ["/api/analytics/summary", "avg {avg_score|0}"], opens: "Whitepaper" },
      { id: "piq", label: "piQ", kind: "step", x: 662, y: 333, w: 88, h: 40, probe: ["/api/emission", "floor {current_quality_floor|1}"], opens: "Minting Difficulty" },
      { id: "ledger", label: "Ledger", kind: "step", x: 768, y: 333, w: 88, h: 40, probe: ["/api/chain/status", "{chain_name} #{block_number}"], opens: "Proof-of-Research Ledger Explorer" },
      { id: "explorer", label: "Explorer", kind: "sink", x: 874, y: 333, w: 106, h: 40, probe: ["/api/explorer/latest", "{count} records"], opens: "Proof-of-Research Ledger Explorer" }
    ],
    wires: [
      ["prompt", "superai"],
      ["superai", "sim"], ["superai", "rib"], ["superai", "pid"], ["superai", "pien"],
      ["superai", "llama"], ["superai", "mistral"], ["superai", "qwen"], ["superai", "gemini"], ["superai", "deepseek"],
      ["llama", "judge"], ["mistral", "judge"], ["qwen", "judge"], ["gemini", "judge"], ["deepseek", "judge"],
      ["judge", "answer"], ["sim", "answer"],
      ["manuscript", "extract"], ["extract", "integrity"], ["integrity", "jurors"], ["jurors", "verdict"],
      ["verdict", "pix"], ["pix", "piq"], ["piq", "ledger"], ["ledger", "explorer"],
      ["pix", "pid"], ["pix", "rib"],
      ["b-Tools", "manuscript"], ["explorer", "b-Explore"], ["ledger", "live"]
    ]
  }
};
