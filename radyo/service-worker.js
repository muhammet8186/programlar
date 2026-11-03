const CACHE_NAME = 'online-radyo-pwa-v2';
const APP_BASE = new URL('./', self.location.href);
const APP_SHELL = [
  new URL('./', APP_BASE).href,
  new URL('./manifest.json', APP_BASE).href,
  new URL('./icons/icon-192.png', APP_BASE).href,
  new URL('./icons/icon-512.png', APP_BASE).href
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API, canlı yayın ve kayıt dosyalarını cache'e alma.
  if (
    url.pathname.includes('/api/') ||
    url.pathname.endsWith('/stream') ||
    url.pathname.endsWith('/health')
  ) return;

  // Sayfa gezinmeleri: önce ağ, çevrimdışında önbellek.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(APP_BASE.href))
    );
    return;
  }

  // Uygulama kabuğu ve statik dosyalar.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
