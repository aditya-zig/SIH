/* SurakshaAR WebAR service worker.
   Caches: application shell, local runtime chunks, static assets, and
   versioned downloaded package resources requested by the app.
   Never caches: authenticated API traffic (Supabase REST/RPC/functions),
   non-GET requests, or cross-origin responses. No tokens or secrets live here.
   IndexedDB attempt state lives in dashboard/src/webar/offline/attemptQueue.ts. */
const CACHE = "surakshaar-webar-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];

function isApiRequest(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/functions/v1")) return true;
  if (url.pathname.startsWith("/rest/v1")) return true;
  if (url.pathname.startsWith("/auth/v1")) return true;
  if (request.headers.has("authorization")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
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
  const { request } = event;
  if (isApiRequest(request)) return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    // Shell-first for SPA routes with an offline fallback to the shell.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
