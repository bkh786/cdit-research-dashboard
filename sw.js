/* Service worker: lets the app install and open offline. Only same-origin static files are cached;
   Google Sheets / Apps Script / Gemini calls always go straight to the network. */
const V = "bri-v3";
const SHELL = ["./", "index.html", "styles.css", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r).then((m) => m || (r.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
