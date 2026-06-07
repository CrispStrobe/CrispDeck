/**
 * CrispDeck Service Worker — minimal offline shell caching.
 * Caches the app shell (HTML, CSS, JS) for installability.
 * Network-first strategy for API calls.
 */

const CACHE_NAME = 'crispdeck-v1';
const SHELL_URLS = ['/', '/feed', '/deck', '/compose'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and API/external requests
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/') || request.url.includes('bsky.') || request.url.includes('mastodon.')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful navigation/asset responses
        if (response.ok && (request.mode === 'navigate' || request.destination === 'script' || request.destination === 'style')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
