// channel.js — say which build this is when it is not the stable one.
//
// The experimental site (exp.<domain>, deployed from the `experimental`
// branch) changes constantly and may break. A visitor who lands there should
// know at a glance, and be one click from the stable site.
(function () {
  "use strict";
  // The superellipse look (superellipse.css): on se.<domain>, with
  // ?shape=se, or when the server says so (SCHOLARPI_SHAPE=superellipse).
  const se = () => document.documentElement.classList.add("shape-se");
  if (location.hostname.startsWith("se.") || /[?&]shape=se\b/.test(location.search)) se();
  fetch("/api/build", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(b => {
      if (b && b.shape === "superellipse") se();
      if (!b || !b.channel || b.channel === "stable") return;
      document.documentElement.classList.add("is-experimental");
      const stable = b.stable_url || (location.hostname.startsWith("exp.")
        ? location.protocol + "//" + location.hostname.slice(4) : null);
      const bar = document.createElement("div");
      bar.className = "channel-bar";
      bar.setAttribute("role", "note");
      const commit = b.commit && b.commit !== "unknown" ? " " + b.commit.slice(0, 7) : "";
      bar.innerHTML = '<span class="channel-dot" aria-hidden="true"></span><span class="channel-text"></span>';
      const isSe = document.documentElement.classList.contains("shape-se");
      bar.querySelector(".channel-text").textContent = (isSe ? "Superellipse preview" : "Experimental build") + commit + ". It changes often and may break.";
      if (stable) {
        const a = document.createElement("a");
        a.className = "channel-link"; a.href = stable; a.textContent = "Go to the stable site";
        bar.appendChild(a);
      }
      document.body.prepend(bar);
      const meta = document.createElement("meta");
      meta.name = "robots"; meta.content = "noindex, nofollow";
      document.head.appendChild(meta);
    })
    .catch(() => { /* no build info: say nothing rather than guess */ });
})();
