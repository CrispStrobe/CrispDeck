/**
 * CrispDeck Service Worker — offline shell + immutable asset caching.
 * - Precaches app shell (HTML) for installability
 * - Caches immutable JS/CSS chunks with cache-first strategy (they have hashed filenames)
 * - Network-first for navigation and mutable assets
 * - Skips API/external requests entirely
 * Cache version rotates on each deploy.
 */

// Version injected at build time by vite.config.js swVersionPlugin
// Falls back to placeholder during dev (no-op since SW is not used in dev)
const VERSION = '__SW_VERSION__';
const CACHE_NAME = `crispdeck-v${VERSION}`;
const SHELL_URLS = ['/'];

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

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const { title, body, icon, badge, tag, data: notifData } = data;

  event.waitUntil(
    self.registration.showNotification(title || 'CrispDeck', {
      body: body || '',
      icon: icon || '/favicon.png',
      badge: badge || '/favicon.png',
      tag: tag,
      data: notifData || {},
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open new window
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and API/external requests
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/xrpc/')) return;
  if (!url.origin.includes(self.location.origin)) return;

  // Immutable assets (hashed filenames) — cache-first, never expires
  if (url.pathname.includes('/_app/immutable/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Static assets (icons, manifest, etc.) — stale-while-revalidate
  if (url.pathname.match(/\.(png|jpg|ico|svg|webp|json|js|css|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Navigation — network-first, fall back to cached shell
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === 'navigate') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
