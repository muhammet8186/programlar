const CACHE_NAME = 'online-radyo-pwa-v1';
const APP_SHELL = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/stream' || url.pathname === '/health') return;
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
  } else {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
