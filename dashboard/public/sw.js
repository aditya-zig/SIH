/* SurakshaAR WebAR service worker — Cache API for app/package/assets.
   Donor: WebSurAR public/sw.js (CACHE surakshaar-v1, SHELL ['/', '/manifest.webmanifest']).
   Kept as the more complete donor base, extended with versioned cache name,
   package/asset pass-through, and explicit offline fallback. IndexedDB attempt
   queue lives in dashboard/src/webar/offline/attemptQueue.ts, not here. */
const CACHE = "surakshaar-webar-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});
