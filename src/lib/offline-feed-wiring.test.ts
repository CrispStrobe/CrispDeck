/**
 * Offline feed cache.
 *
 * This previously declared `const cacheFeed = vi.fn()` and then asserted that
 * the mock it had just made was called — the "wiring" it claimed to check was
 * simulated inside the test. It now exercises $lib/offline-cache against a real
 * IndexedDB, which is what the feed page calls on every load.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { cacheFeed, loadCachedFeed, formatCachedTime, isOffline } from './offline-cache';
import type { UnifiedPost } from './types';

const post = (uri: string): UnifiedPost => ({
  uri, text: `post ${uri}`, createdAt: '2026-01-10T12:00:00.000Z',
  platform: 'bluesky', author: { handle: '@a', displayName: 'A' },
  likeCount: 0, repostCount: 0, replyCount: 0,
} as UnifiedPost);

beforeEach(async () => { await cacheFeed('feed', []); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('caching a loaded feed', () => {
  it('round-trips the posts', async () => {
    await cacheFeed('feed', [post('a'), post('b')]);
    const cached = await loadCachedFeed('feed');
    expect(cached?.posts.map(p => p.uri)).toEqual(['a', 'b']);
  });

  it('records when it was cached', async () => {
    await cacheFeed('feed', [post('a')]);
    const cached = await loadCachedFeed('feed');
    expect(Date.parse(cached!.cachedAt)).not.toBeNaN();
  });

  it('caps the cache at 100 posts, keeping the newest page', async () => {
    await cacheFeed('feed', Array.from({ length: 250 }, (_, i) => post(`p${i}`)));
    const cached = await loadCachedFeed('feed');
    expect(cached!.posts).toHaveLength(100);
    expect(cached!.posts[0].uri).toBe('p0');
  });

  it('caching an empty feed replaces what was there', async () => {
    await cacheFeed('feed', [post('a')]);
    await cacheFeed('feed', []);
    expect((await loadCachedFeed('feed'))?.posts).toEqual([]);
  });

  it('keeps separate keys apart, so the deck cannot overwrite the feed', async () => {
    await cacheFeed('feed', [post('from-feed')]);
    await cacheFeed('deck:1', [post('from-deck')]);
    expect((await loadCachedFeed('feed'))!.posts[0].uri).toBe('from-feed');
    expect((await loadCachedFeed('deck:1'))!.posts[0].uri).toBe('from-deck');
  });
});

describe('reading the cache', () => {
  it('is null for a key that was never cached', async () => {
    expect(await loadCachedFeed('never-written')).toBeNull();
  });

  /**
   * The feed falls back to this when the network fails, so it must not throw.
   * A fresh module instance is needed because openDB memoises its connection.
   */
  it('resolves rather than throwing when IndexedDB is unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const offline = await import('./offline-cache');
    await expect(offline.loadCachedFeed('feed')).resolves.toBeNull();
    await expect(offline.cacheFeed('feed', [post('a')])).resolves.toBeUndefined();
  });

  /**
   * One failed open used to poison the memoised promise for the rest of the
   * session, silently disabling the cache even once IndexedDB came back.
   */
  it('retries after a failed open instead of staying broken', async () => {
    vi.resetModules();
    const realIndexedDB = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    const offline = await import('./offline-cache');
    await offline.loadCachedFeed('feed');           // fails, clears the memo

    vi.stubGlobal('indexedDB', realIndexedDB);
    await offline.cacheFeed('recovered', [post('a')]);
    expect((await offline.loadCachedFeed('recovered'))?.posts).toHaveLength(1);
  });
});

describe('formatCachedTime', () => {
  it('reads as minutes just after caching', () => {
    const justNow = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(formatCachedTime(justNow)).toMatch(/m|now|min/i);
  });

  it('returns a string for an old timestamp rather than throwing', () => {
    expect(typeof formatCachedTime('2020-01-01T00:00:00.000Z')).toBe('string');
  });
});

describe('isOffline', () => {
  it('follows navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOffline()).toBe(true);
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOffline()).toBe(false);
  });
});
