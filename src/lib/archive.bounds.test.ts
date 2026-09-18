/**
 * The archive is bounded and its stats are index-driven.
 *
 * Growth mattered because browsers evict IndexedDB a whole database at a time
 * under storage pressure: an unbounded archive doesn't degrade, it disappears.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  archivePosts, pruneArchive, clearArchive, getArchiveStats, getArchiveUsage,
  getArchiveCap, DEFAULT_ARCHIVE_CAP, searchArchive, type ArchiveType,
} from './archive';
import type { UnifiedPost, Platform } from './types';

const store: Record<string, string> = {};
beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  await clearArchive();
});
afterEach(() => vi.unstubAllGlobals());

function posts(n: number, opts: { from?: number; platform?: Platform } = {}): UnifiedPost[] {
  const base = Date.UTC(2026, 0, 1);
  const from = opts.from ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    uri: `at://p/${String(from + i).padStart(6, '0')}`,
    text: `post number ${from + i}`,
    // Index i is older than index i+1, so the oldest are pruned first.
    createdAt: new Date(base + (from + i) * 60_000).toISOString(),
    platform: opts.platform ?? 'bluesky',
    author: { handle: '@a.bsky.social', displayName: 'A' },
    likeCount: 0, repostCount: 0, replyCount: 0,
  } as UnifiedPost));
}

describe('getArchiveCap', () => {
  it('defaults when nothing is configured', () => {
    expect(getArchiveCap()).toBe(DEFAULT_ARCHIVE_CAP);
  });

  it('honours a configured cap', () => {
    store['crispdeck-archive-cap'] = '500';
    expect(getArchiveCap()).toBe(500);
  });

  it('ignores a nonsense cap', () => {
    for (const bad of ['0', '-10', 'abc', '']) {
      store['crispdeck-archive-cap'] = bad;
      expect(getArchiveCap(), bad).toBe(DEFAULT_ARCHIVE_CAP);
    }
  });

  it('survives localStorage being blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(getArchiveCap()).toBe(DEFAULT_ARCHIVE_CAP);
  });
});

describe('pruneArchive', () => {
  it('does nothing while under the cap', async () => {
    await archivePosts(posts(10), 'post');
    expect(await pruneArchive(100)).toBe(0);
    expect((await getArchiveStats()).total).toBe(10);
  });

  it('drops the oldest records past the cap', async () => {
    store['crispdeck-archive-cap'] = '10000'; // keep archivePosts from pruning
    await archivePosts(posts(50), 'post');

    expect(await pruneArchive(20)).toBe(30);

    const remaining = await searchArchive({});
    expect(remaining).toHaveLength(20);
    // The survivors are the 20 newest.
    const kept = remaining.map((r) => r.uri).sort();
    expect(kept[0]).toBe('at://p/000030');
    expect(kept[19]).toBe('at://p/000049');
  });

  it('archivePosts enforces the cap automatically', async () => {
    store['crispdeck-archive-cap'] = '25';
    await archivePosts(posts(40), 'post');
    expect((await getArchiveStats()).total).toBe(25);

    // A later batch keeps it bounded too.
    await archivePosts(posts(40, { from: 100 }), 'post');
    expect((await getArchiveStats()).total).toBe(25);

    // And the newest survive.
    const newest = (await searchArchive({ limit: 1 }))[0];
    expect(newest.uri).toBe('at://p/000139');
  });

  it('is a no-op on an empty archive', async () => {
    expect(await pruneArchive(10)).toBe(0);
  });

  it('can prune down to a single record', async () => {
    store['crispdeck-archive-cap'] = '10000';
    await archivePosts(posts(10), 'post');
    expect(await pruneArchive(1)).toBe(9);
    expect((await getArchiveStats()).total).toBe(1);
  });
});

describe('getArchiveStats', () => {
  it('counts by type and platform', async () => {
    store['crispdeck-archive-cap'] = '10000';
    await archivePosts(posts(7), 'post');
    await archivePosts(posts(3, { from: 100 }), 'like');
    await archivePosts(posts(2, { from: 200, platform: 'mastodon' }), 'repost');

    const stats = await getArchiveStats();
    expect(stats.total).toBe(12);
    expect(stats.byType).toEqual({ post: 7, like: 3, repost: 2, reply: 0 });
    expect(stats.byPlatform.bluesky).toBe(10);
    expect(stats.byPlatform.mastodon).toBe(2);
  });

  it('reports the true date range', async () => {
    store['crispdeck-archive-cap'] = '10000';
    await archivePosts(posts(25), 'post');
    const stats = await getArchiveStats();
    const all = await searchArchive({});
    const sorted = all.map((r) => r.createdAt).sort();
    expect(stats.dateRange).toEqual({ oldest: sorted[0], newest: sorted[sorted.length - 1] });
  });

  it('returns a null range for an empty archive', async () => {
    const stats = await getArchiveStats();
    expect(stats.total).toBe(0);
    expect(stats.dateRange).toBeNull();
    expect(stats.byType).toEqual({ post: 0, like: 0, repost: 0, reply: 0 });
  });

  it('reads far fewer records than the store holds', async () => {
    store['crispdeck-archive-cap'] = '10000';
    await archivePosts(posts(800), 'post');

    let materialised = 0;
    const origStoreGetAll = IDBObjectStore.prototype.getAll;
    const origIndexGetAll = IDBIndex.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...a: any[]) {
      const r = origStoreGetAll.apply(this, a as any);
      r.addEventListener('success', () => { materialised += (r.result as any[]).length; });
      return r;
    };
    IDBIndex.prototype.getAll = function (...a: any[]) {
      const r = origIndexGetAll.apply(this, a as any);
      r.addEventListener('success', () => { materialised += (r.result as any[]).length; });
      return r;
    };
    try {
      await getArchiveStats();
      // count() and two single-step cursors: no bulk read at all.
      expect(materialised).toBe(0);
    } finally {
      IDBObjectStore.prototype.getAll = origStoreGetAll;
      IDBIndex.prototype.getAll = origIndexGetAll;
    }
  });
});

describe('getArchiveUsage', () => {
  it('reports record count and cap', async () => {
    store['crispdeck-archive-cap'] = '10000';
    await archivePosts(posts(12), 'post');
    const usage = await getArchiveUsage();
    expect(usage.records).toBe(12);
    expect(usage.cap).toBe(10000);
  });

  it('passes through the storage estimate when available', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1234, quota: 99999 }) } });
    const usage = await getArchiveUsage();
    expect(usage.usageBytes).toBe(1234);
    expect(usage.quotaBytes).toBe(99999);
  });

  it('degrades to nulls when the Storage API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const usage = await getArchiveUsage();
    expect(usage.usageBytes).toBeNull();
    expect(usage.quotaBytes).toBeNull();
  });

  it('degrades to nulls when estimate() throws', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('denied'); } } });
    const usage = await getArchiveUsage();
    expect(usage.usageBytes).toBeNull();
  });
});
