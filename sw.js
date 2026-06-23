/**
 * Stock Tracker — Service Worker
 *
 * Caching strategy:
 *  - App shell (HTML/CSS/JS): stale-while-revalidate.
 *    Loads instantly from cache, updates in background.
 *  - API calls (Apps Script /exec): network-first with cache fallback.
 *    Tries live first; if offline, serves last successful response.
 *
 * To trigger an update for all users: bump CACHE_VERSION below.
 * The new SW deletes old caches on activate; localStorage is never touched.
 */

const CACHE_VERSION = 'v1.0.2';
const APP_CACHE = 'stock-tracker-app-' + CACHE_VERSION;
const API_CACHE = 'stock-tracker-api-' + CACHE_VERSION;

const APP_FILES = [
  './',
  './index.html',
  './dashboard.html',
  './admin.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_FILES).catch(err => {
        // Don't fail install if any single file is missing
        console.warn('SW: some files not cached', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== APP_CACHE && k !== API_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;  // Only handle GETs

  const url = new URL(req.url);

  // API calls (Apps Script Web App) — network-first
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    event.respondWith(
      fetch(req).then(res => {
        // Only cache successful JSON responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(API_CACHE).then(c => c.put(req, clone)).catch(()=>{});
        }
        return res;
      }).catch(() => {
        // Offline — return cached version if available
        return caches.match(req).then(cached =>
          cached || new Response(
            JSON.stringify({ error: 'Offline and no cached response available', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
        );
      })
    );
    return;
  }

  // App shell (same-origin) — stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const networkPromise = fetch(req).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(APP_CACHE).then(c => c.put(req, clone)).catch(()=>{});
          }
          return res;
        }).catch(() => cached);
        // Return cached immediately if we have it, else wait for network
        return cached || networkPromise;
      })
    );
    return;
  }
});

// Message handler: allows the page to ask SW to update itself
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
