const CACHE_NAME = "paisa-shell-v3";
const APP_SHELL = [
  "./", "./index.html", "./css/style.css", "./js/app.js", "./js/db.js", "./js/utils.js",
  "./js/ui.js", "./js/ui-dashboard.js", "./js/forms.js", "./js/recurring.js",
  "./js/backup.js", "./js/category-actions.js", "./manifest.json", "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    throw new Error("This page is not available offline.");
  }));
});
