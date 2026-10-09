// capabilities.js — the "Capabilities" pill: everything Pi Tech Lab can do, in
// one window, grouped by purpose. Each entry opens its own window. Only what
// this visitor can use right now is listed (owner tools appear for the owner).
(function () {
  "use strict";
  // [title of the pill it opens, what it does]
  const GROUPS = [
    ["Assess research", [
      ["Assess a Manuscript", "Upload a paper or give a DOI: a staged, AI-assisted assessment with a score you can trace step by step."],
      ["Intern", "An AI electronic health record for doctors (iOS app), in the Tools bubble."],
      ["Assessment results", "Your latest assessment, stage by stage."],
      ["RiBD", "Your research mentor: what to read next and what to fix first, from your profile and the corpus."],
      ["Research profile", "Your fields and interests, which shape suggestions."],
    ]],
    ["Explore the record", [
      ["The journal", "Every assessed manuscript, searchable."],
      ["Recent assessments", "Every assessment on the site, signed in or not: field, score and day only."],
      ["Leaderboards", "Top papers by piX, and top authors by piQ."],
      ["Proof-of-Research Ledger Explorer", "The public ledger of assessments and rewards."],
    ]],
    ["See the field", [
      ["The Global Map of Science", "Research laid out as a map you can fly through and play."],
      ["Performance", "Where the corpus is heading, and how well PiEN is learning: how often its suggestions are followed."],
      ["Analytics", "Papers, piQ minted, average score, authors and visitors."],
      ["Minting Difficulty", "How hard piQ is to earn right now, and why."],
    ]],
    ["Lab", [
      ["HAL-OS", "A bare-metal ternary network booting in your browser: feed it images and watch it learn."],
      ["QuVI", "Build quantum circuits and inspect probabilities, Bloch spheres and entanglement."],
      ["Unigyro", "Unigyro II, Murtaza Vefadar's single-seater robot vehicle: his video."],
      ["NeuroFrenzy", "A game: fill in neuroscience blanks before the clock runs out."],
      ["Private projects", "Owner-only work in progress."],
      ["Permission requests", "Ask authors for permission, with a link they answer."],
    ]],
    ["Ask and understand", [
      ["SciM Assistant", "Ask questions about the corpus and the method, right from its pill."],
      ["Architecture", "How a paper is assessed, as a six-step flowchart, and how judging stays fair."],
      ["Whitepaper", "The full method."],
    ]],
    ["The site itself", [
      ["π and friends", "π computed live for as long as you stay, with e, φ and γ."],
      [null, "PiEN, the mark in the middle, learns which card tends to come next and suggests it with a soft halo. See how it is doing under Performance."],
      [null, "Drag anything; pills move only when pushed. Sign in and your layout follows you to any device."],
      ["Your account", "Sign in with a wallet or ORCID, and manage your account."],
      ["Invite a researcher", "Bring a colleague in."],
      ["Support ScholarPi", "Help keep it running."],
      ["Contact us", "Questions, bugs and ideas."],
    ]],
  ];

  const content = document.createElement("div");
  content.className = "cap";

  function render() {
    const have = new Set(window.PiOrbit.pillTitles());
    have.add("π and friends");
    content.innerHTML = '<p class="cap-intro">Everything Pi Tech Lab can do. Pick one to open it.</p>';
    GROUPS.forEach(([name, entries]) => {
      const list = entries.filter(([t]) => t === null || have.has(t));
      if (!list.length) return;
      const g = document.createElement("section");
      g.className = "cap-group";
      const h = document.createElement("h3"); h.textContent = name; g.appendChild(h);
      const ul = document.createElement("ul");
      list.forEach(([t, what]) => {
        const li = document.createElement("li");
        if (t) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "cap-open"; b.textContent = t.replace(/ \[.*\]$/, "");
          b.addEventListener("click", () => window.PiOrbit.openTitle(t));
          li.appendChild(b);
        }
        const p = document.createElement("span"); p.className = "cap-what"; p.textContent = what;
        li.appendChild(p);
        ul.appendChild(li);
      });
      g.appendChild(ul);
      content.appendChild(g);
    });
  }

  let last = "";
  function refresh() {                 // pills come and go with sign-in; keep the list honest
    const now = window.PiOrbit.pillTitles().join("|");
    if (now !== last) { last = now; render(); }
  }

  function start() {
    render();
    window.PiOrbit.addPill({ key: "about:Capabilities", section: { key: "about", name: "About" }, title: "Capabilities", content });
    setInterval(refresh, 2000);
  }
  if (window.PiOrbit) start(); else document.addEventListener("orbit:ready", start, { once: true });
})();
