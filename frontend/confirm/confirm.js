// confirm.js — answer a permission request from its private link.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("t") || "";
  const api = "/api/consent/r/" + encodeURIComponent(token);
  let decision = "granted";

  function show(id) {
    ["loading", "request", "done", "problem"].forEach(k => { $(k).hidden = k !== id; });
  }
  function problem(text) {
    $("problem").innerHTML = '<h1>This link can’t be used</h1><p class="quiet"></p>';
    $("problem").querySelector("p").textContent = text;
    show("problem");
  }
  function fmt(iso) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }); }
    catch (_) { return iso; }
  }

  function render(r) {
    document.title = r.title + " · PiTechLab";
    $("title").textContent = r.title;
    $("from").textContent = r.requester ? "From " + r.requester : "";
    $("to").textContent = "To " + r.recipient;
    const msg = $("message");
    msg.innerHTML = "";
    (r.message || "").split(/\n{2,}/).filter(Boolean).forEach(par => {
      const p = document.createElement("p"); p.textContent = par.trim(); msg.appendChild(p);
    });
    $("terms").innerHTML = "";
    r.terms.forEach(t => { const li = document.createElement("li"); li.textContent = t; $("terms").appendChild(li); });
    $("name").value = (r.answer && r.answer.name) || r.recipient || "";
    if (r.answer) {
      const cur = $("current");
      cur.className = "current " + r.answer.decision;
      cur.textContent = (r.answer.decision === "granted" ? "You gave permission on " : "You declined on ") +
        fmt(r.answer.answered_at) + ". You can change your answer below.";
      cur.hidden = false;
    }
    if (r.closed) {
      $("form").hidden = true;
      const cur = $("current");
      cur.className = "current";
      cur.style.background = "#efefec";
      cur.textContent = "This request has been closed by its sender." +
        (r.answer ? " Your last answer was: " + (r.answer.decision === "granted" ? "permission given." : "declined.") : "");
      cur.hidden = false;
    }
    show("request");
  }

  function done(res, name) {
    const ok = res.decision === "granted";
    $("done").innerHTML =
      '<div class="result ' + res.decision + '"><h1></h1><p class="what"></p><p class="receipt"></p></div>' +
      '<p class="small">Keep this page or the receipt for your records. <button type="button" class="linklike" id="change">Change my answer</button></p>';
    $("done").querySelector("h1").textContent = ok ? "Thank you. Permission given." : "Your answer has been recorded.";
    $("done").querySelector(".what").textContent =
      (ok ? "Recorded as given by " : "Recorded as declined by ") + name + " on " + fmt(res.answered_at) + ".";
    $("done").querySelector(".receipt").textContent = "Receipt " + res.receipt;
    show("done");
    $("change").addEventListener("click", load);
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return problem("The link is incomplete. Please use the full link from the email.");
    show("loading");
    try {
      const r = await fetch(api, { cache: "no-store" });
      if (r.status === 404) return problem("The link is not valid. Please use the full link from the email.");
      if (!r.ok) throw new Error("HTTP " + r.status);
      render(await r.json());
    } catch (_) {
      problem("The request could not be loaded just now. Please try again in a moment.");
    }
  }

  document.querySelectorAll("button[data-decision]").forEach(b =>
    b.addEventListener("click", () => { decision = b.dataset.decision; }));

  $("form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("name").value.trim();
    const err = $("error");
    if (name.length < 2) { err.textContent = "Please enter your name."; err.hidden = false; $("name").focus(); return; }
    err.hidden = true;
    const buttons = document.querySelectorAll("#form button");
    buttons.forEach(b => { b.disabled = true; });
    try {
      const r = await fetch(api, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, name, note: $("note").value.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || "Your answer could not be saved. Please try again.");
      done(body, name);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  });

  load();
})();
