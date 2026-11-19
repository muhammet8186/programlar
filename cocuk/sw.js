/* Çocuk Tüpü - offline service worker */
'use strict';

const CACHE_NAME = 'cocuk-tupu-offline-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

// CDN dosyalarını ilk çevrimiçi kurulumda önbelleğe al.
// Bazı CDN yanıtları opaque olabilir; cache.put bunları destekler.
const REMOTE_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Mali:wght@500;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(REMOTE_ASSETS.map(async url => {
      const response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('cocuk-tupu-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Sayfa gezinmesi: önce ağ, bağlantı yoksa kayıtlı uygulama.
  if (request.mode === 'navigate' && isSameOrigin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await caches.match(request)) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./'));
      }
    })());
    return;
  }

  // Aynı alan adındaki uygulama dosyaları ve harici tasarım kaynakları:
  // önbellek varsa onu kullan, yoksa ağdan alıp kaydet.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      if (isSameOrigin) {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
