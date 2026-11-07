// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker(scope = 'https://app.example/') {
  const handlers: Record<string, (event: any) => void> = {};
  const store = new Map<string, Response>();
  const key = (request: string | Request) => typeof request === 'string' ? request : request.url;
  const cache = {
    match: vi.fn(async (request: string | Request) => store.get(key(request))),
    put: vi.fn(async (request: string | Request, response: Response) => { store.set(key(request), response); }),
    addAll: vi.fn(async () => undefined),
  };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => [] as string[]), delete: vi.fn(async () => true) };
  const clients = { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => [] as any[]), openWindow: vi.fn(async () => undefined) };
  const fetch = vi.fn(async () => new Response('network'));
  const self = { registration: { scope, showNotification: vi.fn(async () => undefined) }, clients, skipWaiting: vi.fn(), addEventListener: (type: string, handler: (event: any) => void) => { handlers[type] = handler; } };
  runInNewContext(readFileSync('static/sw.js', 'utf8'), { self, caches, fetch, URL, Response });
  async function dispatch(type: string, data: any = {}) {
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers[type]({ ...data, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return result;
  }
  const request = (url: string, mode = 'cors', headers = new Headers()) => ({ url, method: 'GET', mode, headers });
  return { dispatch, request, cache, caches, clients, fetch, self, store };
}

describe('service worker security and offline lifetime', () => {
  it('installs the shell under its actual registration scope', async () => {
    const w = worker('https://app.example/CrispDeck/');
    await w.dispatch('install');
    expect(w.cache.addAll).toHaveBeenCalledWith(['https://app.example/CrispDeck/']);
  });

  it('does not delete other applications or installations caches', async () => {
    const w = worker('https://app.example/CrispDeck/');
    w.caches.keys.mockResolvedValue(['another-app', 'crispdeck:/:old', 'crispdeck:/Other/:old', 'crispdeck:/CrispDeck/:old', 'crispdeck:/CrispDeck/:__SW_VERSION__']);
    await w.dispatch('activate');
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith('crispdeck:/CrispDeck/:old');
    expect(w.clients.claim).toHaveBeenCalledOnce();
  });

  it.each(['https://app.example.evil.test/file.js', 'https://other.example/file.js', 'https://app.example/api/private.json', 'https://app.example/xrpc/private.json', 'https://app.example/oauth/callback?code=secret', 'https://app.example/oauth/bsky-callback?state=secret'])('does not intercept sensitive or external request %s', async url => {
    const w = worker();
    expect(await w.dispatch('fetch', { request: w.request(url, 'navigate') })).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
  });

  it('skips authenticated and outside-scope requests', async () => {
    const w = worker('https://app.example/CrispDeck/');
    await w.dispatch('fetch', { request: w.request('https://app.example/CrispDeck/private.json', 'cors', new Headers({ authorization: 'Bearer secret' })) });
    await w.dispatch('fetch', { request: w.request('https://app.example/Other/file.js') });
    await w.dispatch('fetch', { request: w.request('https://app.example/CrispDeck/api/private.json') });
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it.each(['no-store', 'private, max-age=60'])('does not cache a %s response', async policy => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response('private data', { headers: { 'cache-control': policy } }));
    const result = await w.dispatch('fetch', { request: w.request('https://app.example/settings', 'navigate') });
    expect(await result!.text()).toBe('private data');
    expect(w.cache.put).not.toHaveBeenCalled();
  });

  it('retains a successful network response when cache storage is full', async () => {
    const w = worker();
    w.cache.put.mockRejectedValue(new Error('QuotaExceededError'));
    const result = await w.dispatch('fetch', { request: w.request('https://app.example/feed', 'navigate') });
    expect(await result!.text()).toBe('network');
  });

  it('returns a defined error response for an uncached offline asset', async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new TypeError('offline'));
    const result = await w.dispatch('fetch', { request: w.request('https://app.example/missing.png') });
    expect(result!.type).toBe('error');
  });

  it('falls back to this scope\'s shell offline', async () => {
    const w = worker('https://app.example/CrispDeck/');
    w.store.set('https://app.example/CrispDeck/', new Response('app shell'));
    w.fetch.mockRejectedValue(new TypeError('offline'));
    const result = await w.dispatch('fetch', { request: w.request('https://app.example/CrispDeck/feed', 'navigate') });
    expect(await result!.text()).toBe('app shell');
  });

  it.each(['https://evil.example/phish', 'https://app.example.evil.test/phish', '//evil.example/phish', 'javascript:alert(1)', '/Other/'])('keeps notification target %s inside the app', async url => {
    const w = worker('https://app.example/CrispDeck/');
    await w.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url } }, action: 'open' });
    expect(w.clients.openWindow).toHaveBeenCalledExactlyOnceWith('https://app.example/CrispDeck/notifications');
  });

  it('ignores malformed push payloads', async () => {
    const w = worker();
    await w.dispatch('push', { data: { json: () => { throw new Error('malformed'); } } });
    expect(w.self.registration.showNotification).not.toHaveBeenCalled();
  });
});
