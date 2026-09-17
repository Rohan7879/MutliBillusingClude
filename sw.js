// MandiBook PWA service worker. It caches only static app resources; business
// pages and Firebase data always use the network so a shared phone never shows
// a stale signed-in screen or accounting data while offline.
// Bump whenever a core/login script changes so installed phones fetch the
// current authentication and progress experience on their next launch.
const STATIC_CACHE = "mandibook-static-v3";
const STATIC_PATHS = [
  "/manifest.webmanifest",
  "/assets/logo.jpg",
  "/assets/icon-192.jpg",
  "/assets/icon-512.jpg",
  "/css/main.css",
  "/js/core/pwa.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const safeStaticAsset =
    request.method === "GET" &&
    url.origin === self.location.origin &&
    ["script", "style", "image", "font"].includes(request.destination);

  if (!safeStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
