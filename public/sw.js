const CACHE_NAME = 'zarkhez-pwa-v1';
const OFFLINE_ASSETS = [
  '/manifest.json',
  '/icon.svg',
  '/model/model.json',
  '/model/weights.bin',
  '/model/metadata.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Security rule: NEVER cache API responses or admin pages in browser Cache Storage
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/admin')) {
    return;
  }

  // Cache-first for TensorFlow.js model files and static icons
  if (url.pathname.startsWith('/model/') || url.pathname === '/icon.svg') {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Network-first with cache fallback for pages and weather
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
