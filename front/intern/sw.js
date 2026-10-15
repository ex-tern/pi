// Intern's service worker: the app's shell (the page, host.js, ui.wasm, fonts) is kept so the app opens without a
// network, where patients, notes and cases (all in this browser) still work. /api is never cached.
const CACHE = "intern-v2";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // the network first, so a new build arrives at once; the copy when there is no network
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: u.pathname === "/intern/" || u.pathname === "/intern" }).then((r) => r || caches.match("/intern/")))
  );
});

// a notice tapped: back to Intern (the open window if there is one)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((w) => new URL(w.url).pathname.startsWith("/intern"));
    return c ? c.focus() : self.clients.openWindow("/intern/");
  }));
});
