// STREAM PULSE PRO - Service Worker
// Yeni sürüm yayınlarken APP_VERSION değerini artırın.
const APP_VERSION = "1.0.0";
const CACHE_NAME = `stream-pulse-pro-${APP_VERSION}`;

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./pwa-manager.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES))
  );
  // İlk yüklemede kurulumu tamamla; güncellemede kullanıcı onayı beklenir.
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("stream-pulse-pro-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;

  // Radyo akışları, harici CDN'ler, POST ve Range istekleri önbelleğe alınmaz.
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        return (await caches.match(request)) ||
               (await caches.match("./index.html")) ||
               new Response("STREAM PULSE PRO çevrimdışı. Daha önce çevrimiçi açtıktan sonra tekrar deneyin.", {
                 status: 503,
                 headers: { "Content-Type": "text/plain; charset=utf-8" }
               });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // Arka planda güncel kopyayı al; başarısız olursa önbellek kullanılmaya devam eder.
      fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
      }).catch(() => {});
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return new Response("Bu dosya çevrimdışı kullanılamıyor.", { status: 503 });
    }
  })());
});
