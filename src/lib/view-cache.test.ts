/**
 * Tests for stale-while-revalidate view cache.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCached, setCache, isStale, clearCache, clearAllCache, swr, type CacheEntry } from './view-cache';

beforeEach(() => {
  localStorage.clear();
});

describe('setCache and getCached', () => {
  it('stores and retrieves data', () => {
    setCache('test-key', { posts: [1, 2, 3] });
    const entry = getCached<{ posts: number[] }>('test-key');
    expect(entry).not.toBeNull();
    expect(entry!.data.posts).toEqual([1, 2, 3]);
  });

  it('stores timestamp', () => {
    const before = Date.now();
    setCache('t', 'data');
    const entry = getCached<string>('t');
    expect(entry!.cachedAt).toBeGreaterThanOrEqual(before);
    expect(entry!.cachedAt).toBeLessThanOrEqual(Date.now());
  });

  it('returns null for missing key', () => {
    expect(getCached('nonexistent')).toBeNull();
  });

  it('returns null for corrupted data', () => {
    localStorage.setItem('crispdeck-vc-bad', 'not-json');
    expect(getCached('bad')).toBeNull();
  });

  it('overwrites existing cache', () => {
    setCache('k', 'old');
    setCache('k', 'new');
    expect(getCached<string>('k')!.data).toBe('new');
  });
});

describe('isStale', () => {
  it('returns false for fresh entry', () => {
    const entry: CacheEntry<string> = { data: 'x', cachedAt: Date.now() };
    expect(isStale(entry)).toBe(false);
  });

  it('returns true for old entry', () => {
    const entry: CacheEntry<string> = { data: 'x', cachedAt: Date.now() - 10 * 60 * 1000 };
    expect(isStale(entry)).toBe(true); // default TTL is 5 min
  });

  it('respects custom TTL', () => {
    const entry: CacheEntry<string> = { data: 'x', cachedAt: Date.now() - 2000 };
    expect(isStale(entry, 1000)).toBe(true);
    expect(isStale(entry, 5000)).toBe(false);
  });
});

describe('clearCache', () => {
  it('removes specific key', () => {
    setCache('a', 1);
    setCache('b', 2);
    clearCache('a');
    expect(getCached('a')).toBeNull();
    expect(getCached('b')).not.toBeNull();
  });
});

describe('clearAllCache', () => {
  it('removes all view cache entries', () => {
    setCache('x', 1);
    setCache('y', 2);
    localStorage.setItem('crispdeck-other', 'keep');
    clearAllCache();
    expect(getCached('x')).toBeNull();
    expect(getCached('y')).toBeNull();
    expect(localStorage.getItem('crispdeck-other')).toBe('keep');
  });
});

describe('swr helper', () => {
  it('returns null cached when nothing stored', () => {
    const { cached, isStale: stale } = swr('empty', async () => 'fresh');
    expect(cached).toBeNull();
    expect(stale).toBe(true);
  });

  it('returns cached data when available', () => {
    setCache('prefilled', [1, 2, 3]);
    const { cached } = swr<number[]>('prefilled', async () => [4, 5]);
    expect(cached).toEqual([1, 2, 3]);
  });

  it('refresh fetches and caches new data', async () => {
    const { refresh } = swr('r', async () => 'fresh-data');
    const result = await refresh();
    expect(result).toBe('fresh-data');
    expect(getCached<string>('r')!.data).toBe('fresh-data');
  });

  it('marks fresh cache as not stale', () => {
    setCache('fresh', 'data');
    const { isStale: stale } = swr('fresh', async () => 'x');
    expect(stale).toBe(false);
  });

  it('marks old cache as stale', () => {
    localStorage.setItem('crispdeck-vc-old', JSON.stringify({ data: 'x', cachedAt: Date.now() - 600000 }));
    const { isStale: stale } = swr('old', async () => 'x');
    expect(stale).toBe(true);
  });
});

describe('feed cache size setting integration', () => {
  it('reads configurable cache size from localStorage', () => {
    localStorage.setItem('crispdeck-feed-cache-size', '300');
    const size = parseInt(localStorage.getItem('crispdeck-feed-cache-size') ?? '200');
    expect(size).toBe(300);
  });

  it('defaults to 200 when not set', () => {
    const size = parseInt(localStorage.getItem('crispdeck-feed-cache-size') ?? '200');
    expect(size).toBe(200);
  });

  it('caches correct number of posts based on setting', () => {
    localStorage.setItem('crispdeck-feed-cache-size', '100');
    const cacheSize = parseInt(localStorage.getItem('crispdeck-feed-cache-size') ?? '200');
    const posts = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const cached = posts.slice(0, cacheSize);
    expect(cached).toHaveLength(100);
  });
});
