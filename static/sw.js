/** CrispDeck offline shell and assets, isolated to this installation's scope. */
const VERSION = '__SW_VERSION__';
const APP_ROOT = new URL(self.registration.scope);
const CACHE_PREFIX = `crispdeck:${APP_ROOT.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

function inScope(url) {
  return url.origin === APP_ROOT.origin && url.pathname.startsWith(APP_ROOT.pathname);
}

async function cached(request) {
  try { return await (await caches.open(CACHE_NAME)).match(request); }
  catch { return undefined; }
}

async function remember(request, response) {
  // Respect server privacy policy, including same-origin redirect targets.
  if (!response.ok || /(?:no-store|private)/i.test(response.headers.get('cache-control') || '')) return;
  if (response.url && !inScope(new URL(response.url))) return;
  try {
    await (await caches.open(CACHE_NAME)).put(request, response.clone());
  } catch {
    // A full or unavailable cache must not turn a successful fetch into a failure.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([APP_ROOT.href])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    // Older releases cached callback navigations under a shared legacy name.
    // Purge this installation's callback URLs (including codes/state) without
    // removing another app's assets or another CrispDeck mount's callbacks.
    for (const key of keys.filter((name) => name.startsWith('crispdeck-v'))) {
      const legacy = await caches.open(key);
      for (const request of await legacy.keys()) {
        const url = new URL(request.url);
        if (inScope(url) && /^oauth(?:\/|$)/.test(url.pathname.slice(APP_ROOT.pathname.length))) {
          await legacy.delete(request);
        }
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  if (!data || typeof data !== 'object') return;
  const { title, body, icon, badge, tag, data: notifData } = data;
  event.waitUntil(self.registration.showNotification(title || 'CrispDeck', {
    body: body || '',
    icon: icon || new URL('favicon.png', APP_ROOT).href,
    badge: badge || new URL('favicon.png', APP_ROOT).href,
    tag,
    data: notifData || {},
    actions: [{ action: 'open', title: 'Open' }, { action: 'dismiss', title: 'Dismiss' }],
  }));
});

function notificationUrl(value) {
  const fallback = new URL('notifications', APP_ROOT);
  if (typeof value !== 'string') return fallback.href;
  try {
    const url = new URL(value, APP_ROOT);
    return inScope(url) ? url.href : fallback.href;
  } catch { return fallback.href; }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (inScope(new URL(client.url)) && 'focus' in client) {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !inScope(url) || request.headers.has('authorization')) return;
  const path = url.pathname.slice(APP_ROOT.pathname.length);
  // OAuth callback URLs carry one-time codes/state and must never enter a cache.
  if (/^(?:api|xrpc|oauth)(?:\/|$)/.test(path)) return;

  if (path.startsWith('_app/immutable/')) {
    event.respondWith((async () => {
      const hit = await cached(request);
      if (hit) return hit;
      const response = await fetch(request);
      await remember(request, response);
      return response;
    })());
    return;
  }

  if (/\.(png|jpg|ico|svg|webp|json|js|css|woff2?)$/.test(path)) {
    const refresh = fetch(request).then(async (response) => {
      await remember(request, response);
      return response;
    });
    // Keep background refresh/cache writes alive even when serving a cache hit.
    event.waitUntil(refresh.catch(() => undefined));
    event.respondWith((async () => {
      const hit = await cached(request);
      return hit || refresh.catch(() => Response.error());
    })());
    return;
  }

  if (request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      await remember(request, response);
      return response;
    } catch {
      return (await cached(request)) || (await cached(APP_ROOT.href)) || Response.error();
    }
  })());
});
