const CACHE_NAME = "halo-control-shell-v7";
const APP_ASSETS = [
  "/manifest.webmanifest",
  "/halo-hisob-manifest.webmanifest",
  "/worker-manifest.webmanifest",
  "/xodim-manifest.webmanifest",
  "/favicon.svg",
  "/icons/halo-180.png",
  "/icons/halo-192.png",
  "/icons/halo-512.png",
  "/icons/halo-xodim-180.png",
  "/icons/halo-xodim-192.png",
  "/icons/halo-xodim-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    event.request.mode === "navigate"
  ) return;

  if (APP_ASSETS.includes(requestUrl.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/xodim";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).pathname === targetUrl);
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
