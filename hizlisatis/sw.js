const CACHE_NAME = 'hizli-pos-shell-v1';
const APP_BASE = new URL('./', self.registration.scope);
const INDEX_URL = new URL('index.html', APP_BASE).href;
const SHELL_URLS = [APP_BASE.href, INDEX_URL, new URL('manifest.webmanifest', APP_BASE).href, new URL('app-icon-192.png', APP_BASE).href, new URL('app-icon-512.png', APP_BASE).href];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hizli-pos-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(INDEX_URL, copy)); } return response; }).catch(async () => (await caches.match(request)) || (await caches.match(INDEX_URL)) || Response.error()));
    return;
  }
  if (SHELL_URLS.includes(url.href)) event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});