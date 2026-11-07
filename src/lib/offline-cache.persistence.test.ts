import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedPost } from './types';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const posts: UnifiedPost[] = [{ uri: 'at://offline/post', platform: 'bluesky', text: 'Cached post', author: { handle: 'alice.example' }, createdAt: '2026-11-07T12:00:00Z', isRepost: false }];

describe('offline cache durability', () => {
  it('resolves a cache write only after IndexedDB commits it', async () => {
    const original = IDBDatabase.prototype.transaction;
    let committed = false;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const txn = original.apply(this, args);
      if (txn.mode === 'readwrite') txn.addEventListener('complete', () => { committed = true; });
      return txn;
    });
    const cache = await import('./offline-cache');
    await cache.cacheFeed('account-1', posts);
    expect(committed).toBe(true);
    expect((await cache.loadCachedFeed('account-1'))?.posts).toEqual(posts);
  });

  it('releases its connection for deletion and rebuilds an empty cache afterward', async () => {
    const cache = await import('./offline-cache');
    await cache.cacheFeed('account-1', posts);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('crispdeck-offline');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Offline cache blocked database deletion'));
    });
    expect(await cache.loadCachedFeed('account-1')).toBeNull();
    await cache.cacheFeed('account-1', posts);
    expect((await cache.loadCachedFeed('account-1'))?.posts).toHaveLength(1);
  });
});
