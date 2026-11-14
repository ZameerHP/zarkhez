/* eslint-disable no-restricted-globals */
/**
 * ZARKHEZ Service Worker
 *
 * Strategy overview
 *  - Precache: offline page, manifest, icons, logo and the tiny on-device TF.js model.
 *  - /_next/static/*  -> cache-first (content-hashed, immutable build assets).
 *  - icons/images/model/manifest -> stale-while-revalidate.
 *  - Page navigations -> network-first; last good copy of each page shell is kept
 *    for offline use, otherwise the branded /offline.html is shown.
 *
 * Privacy / security rules (never cached, never intercepted):
 *  - Any non-GET request, any cross-origin request (Supabase, Google, weather APIs...).
 *  - /api/* (AI answers, scans, TTS/STT, auth-backed data), /admin, /audio/* (generated speech).
 *  - Requests carrying an Authorization header, OAuth returns (?code=), RSC/flight payloads.
 *  Page shells are safe to cache because every page in this app is a client component:
 *  the server HTML contains only translations/layout, never farmer data. Private data lives
 *  in localStorage / IndexedDB / Supabase and is always fetched client-side.
 *
 * Updates
 *  - The registration URL carries the build version (/sw.js?v=<build>), so every deploy
 *    installs a new worker with fresh cache names. The new worker WAITS until the app asks
 *    it to activate (SKIP_WAITING message from the "Update available" banner) or until all
 *    ZARKHEZ tabs are closed, so a running session is never broken mid-use.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'v2';
const PREFIX = 'zarkhez-';
const PRECACHE = `${PREFIX}precache-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const PAGES_CACHE = `${PREFIX}pages-${VERSION}`;
const CURRENT_CACHES = [PRECACHE, STATIC_CACHE, PAGES_CACHE];

const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/images/zarkhez-logo-mark.png',
  '/model/model.json',
  '/model/weights.bin',
  '/model/metadata.json',
];

const MAX_STATIC_ENTRIES = 300;
const MAX_PAGE_ENTRIES = 40;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
      )
    // NOTE: no skipWaiting() here on purpose. First install activates immediately
    // (there is no previous worker); updates wait for the user (see message handler).
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // Removes every older ZARKHEZ cache, including the legacy "zarkhez-pwa-v1".
          .filter((key) => key.startsWith(PREFIX) && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_) {
          /* not supported */
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  } else if (data.type === 'WARM_SHELL' && Array.isArray(data.urls)) {
    event.waitUntil(warmShellUrls(data.urls));
  }
});

async function warmShellUrls(urls) {
  const cache = await caches.open(PAGES_CACHE);
  const safeUrls = urls
    .filter((u) => typeof u === 'string' && u.startsWith('/') && !u.startsWith('/api/') && !u.includes('/admin'))
    .slice(0, 12);

  await Promise.all(
    safeUrls.map(async (path) => {
      try {
        const key = new Request(self.location.origin + path);
        const existing = await cache.match(key);
        if (existing) return;
        const res = await fetch(key, {
          headers: { Accept: 'text/html' },
          credentials: 'same-origin',
        });
        if (isCacheablePage(res)) {
          await cache.put(key, res);
        }
      } catch (_) {
        /* ignore offline/failed warmup for individual routes */
      }
    })
  );
  await trimCache(PAGES_CACHE, MAX_PAGE_ENTRIES);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function isNeverCache(url, request) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/admin') ||
    url.pathname.startsWith('/audio/') ||
    url.pathname === '/sw.js' ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/_next/image') ||
    url.searchParams.has('code') || // Supabase / Google OAuth return
    url.searchParams.has('_rsc') || // React Server Component payloads
    request.headers.get('RSC') === '1' ||
    request.headers.has('Authorization') ||
    request.headers.has('Range')
  );
}

function isRuntimeAsset(path) {
  return (
    path.startsWith('/icons/') ||
    path.startsWith('/images/') ||
    path.startsWith('/model/') ||
    path.startsWith('/workers/') ||
    path === '/manifest.json' ||
    path === '/icon.svg'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch third-party traffic
  if (isNeverCache(url, request)) return; // go straight to the network, no caching

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event, url));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event, request, STATIC_CACHE));
    return;
  }

  if (isRuntimeAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
  // Everything else falls through to the network untouched.
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

function pageCacheKey(url) {
  // Query strings are dropped so "?source=pwa" etc. don't create duplicates.
  return new Request(url.origin + url.pathname);
}

function isCacheablePage(response) {
  return (
    response &&
    response.ok &&
    response.type === 'basic' &&
    !response.redirected &&
    (response.headers.get('Content-Type') || '').includes('text/html')
  );
}

async function handleNavigation(event, url) {
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (isCacheablePage(response)) {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(PAGES_CACHE)
          .then((cache) => cache.put(pageCacheKey(url), copy))
          .then(() => trimCache(PAGES_CACHE, MAX_PAGE_ENTRIES))
      );
    }
    return response;
  } catch (_) {
    const cache = await caches.open(PAGES_CACHE);
    const candidates = [url.pathname];
    if (url.pathname === '/' || url.pathname === '') {
      candidates.push('/ur', '/en', '/ur/home', '/en/home');
    } else if (!/^\/(ur|en)(\/|$)/.test(url.pathname)) {
      // Support unprefixed manifest shortcuts (e.g. /scan, /assistant, /weather) offline.
      candidates.push(`/ur${url.pathname}`, `/en${url.pathname}`);
    }
    for (const path of candidates) {
      const cached = await cache.match(new Request(url.origin + path));
      if (cached) return cached;
    }
    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ||
      new Response('<h1>ZARKHEZ — Offline</h1>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    event.waitUntil(
      cache.put(request, copy).then(() => trimCache(cacheName, MAX_STATIC_ENTRIES))
    );
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = (await cache.match(request)) || (await caches.match(request));
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        return cache.put(request, copy).then(() => response);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  return response || new Response('', { status: 504, statusText: 'Offline' });
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}
