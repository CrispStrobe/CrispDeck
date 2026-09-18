/**
 * initAllClients used to rebuild every client on each call — resuming the
 * Bluesky OAuth session and decrypting each account's credentials — which the
 * layout poll did every 60s and every route did on mount. These tests pin the
 * caching and, more importantly, when it must NOT be used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listAccounts = vi.fn();
const getDecryptedCredentials = vi.fn();
const initBlueskyOAuth = vi.fn();

vi.mock('$lib/db', () => ({
  listAccounts: (...a: any[]) => listAccounts(...a),
  getDecryptedCredentials: (...a: any[]) => getDecryptedCredentials(...a),
}));
vi.mock('./bluesky-oauth', () => ({
  initBlueskyOAuth: (...a: any[]) => initBlueskyOAuth(...a),
}));

const ACCOUNT = {
  id: 1, platform: 'mastodon', handle: '@a@masto.social',
  instance_url: 'https://masto.social', display_name: 'A',
};

async function load() {
  vi.resetModules();
  return {
    factory: await import('./client-factory'),
    bus: await import('./client-cache'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listAccounts.mockResolvedValue([ACCOUNT]);
  getDecryptedCredentials.mockResolvedValue(JSON.stringify({ access_token: 't' }));
  initBlueskyOAuth.mockResolvedValue(null);
  vi.useRealTimers();
});

afterEach(() => vi.useRealTimers());

describe('initAllClients caching', () => {
  it('builds once and reuses the result', async () => {
    const { factory } = await load();
    const a = await factory.initAllClients();
    const b = await factory.initAllClients();
    const c = await factory.initAllClients();

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(getDecryptedCredentials).toHaveBeenCalledTimes(1);
    expect(initBlueskyOAuth).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when an account is added, updated or deleted', async () => {
    const { factory, bus } = await load();
    const a = await factory.initAllClients();

    bus.bumpClientCache();               // what db.ts does on a mutation
    const b = await factory.initAllClients();

    expect(b).not.toBe(a);
    expect(getDecryptedCredentials).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when forced', async () => {
    const { factory } = await load();
    const a = await factory.initAllClients();
    const b = await factory.initAllClients({ force: true });
    expect(b).not.toBe(a);
  });

  it('rebuilds after the TTL expires', async () => {
    const { factory } = await load();
    const a = await factory.initAllClients();

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 6 * 60 * 1000; // past the 5 minute TTL
      const b = await factory.initAllClients();
      expect(b).not.toBe(a);
    } finally {
      Date.now = realNow;
    }
  });

  it('still serves the cache just before the TTL expires', async () => {
    const { factory } = await load();
    const a = await factory.initAllClients();

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 4 * 60 * 1000;
      expect(await factory.initAllClients()).toBe(a);
    } finally {
      Date.now = realNow;
    }
  });

  it('invalidateClients drops the cache', async () => {
    const { factory } = await load();
    const a = await factory.initAllClients();
    factory.invalidateClients();
    expect(await factory.initAllClients()).not.toBe(a);
  });

  it('does not cache a failed build', async () => {
    const { factory } = await load();
    listAccounts.mockRejectedValueOnce(new Error('db down'));
    await expect(factory.initAllClients()).rejects.toThrow('db down');

    // The next call must retry rather than serve a poisoned cache.
    const ok = await factory.initAllClients();
    expect(ok.accounts).toHaveLength(1);
  });

  it('reflects a changed account list after invalidation', async () => {
    const { factory, bus } = await load();
    expect((await factory.initAllClients()).accounts).toHaveLength(1);

    listAccounts.mockResolvedValue([ACCOUNT, { ...ACCOUNT, id: 2, handle: '@b@masto.social' }]);
    bus.bumpClientCache();

    expect((await factory.initAllClients()).accounts).toHaveLength(2);
  });
});

describe('client-cache generation bus', () => {
  it('increments monotonically', async () => {
    const { bus } = await load();
    const start = bus.clientCacheGeneration();
    bus.bumpClientCache();
    bus.bumpClientCache();
    expect(bus.clientCacheGeneration()).toBe(start + 2);
  });
});
