/**
 * Archive storage and search.
 *
 * This previously declared its own ArchiveEntry with snake_case fields
 * (author_handle, created_at, like_count) and filtered arrays of them — a
 * schema the module does not use, so nothing here could fail when searchArchive
 * changed. It now runs against a real IndexedDB.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  toArchiveRecord, archivePosts, searchArchive, getArchiveStats, clearArchive,
  type ArchiveType,
} from './archive';
import type { UnifiedPost, Platform } from './types';

function post(o: Partial<UnifiedPost> & { uri: string }): UnifiedPost {
  return {
    text: 'a post',
    createdAt: '2026-01-10T12:00:00.000Z',
    platform: 'bluesky',
    author: { handle: '@alice.bsky.social', displayName: 'Alice' },
    likeCount: 0, repostCount: 0, replyCount: 0,
    ...o,
  } as UnifiedPost;
}

beforeEach(async () => { await clearArchive(); });
afterEach(() => vi.unstubAllGlobals());

describe('toArchiveRecord', () => {
  it('carries the fields search and display need', () => {
    const record = toArchiveRecord(post({
      uri: 'at://a/1', text: 'hello world', createdAt: '2026-01-10T12:00:00.000Z',
      author: { handle: '@alice.bsky.social', displayName: 'Alice' } as any,
      likeCount: 5, repostCount: 2, replyCount: 1,
    }), 'post');

    expect(record).toMatchObject({
      uri: 'at://a/1',
      text: 'hello world',
      type: 'post',
      platform: 'bluesky',
      authorHandle: '@alice.bsky.social',
      authorName: 'Alice',
      createdAt: '2026-01-10T12:00:00.000Z',
      likeCount: 5, repostCount: 2, replyCount: 1,
    });
    expect(record.indexedAt).toBeTruthy();
  });

  it('records each archive type', () => {
    for (const type of ['post', 'like', 'repost', 'reply'] as ArchiveType[]) {
      expect(toArchiveRecord(post({ uri: `at://a/${type}` }), type).type).toBe(type);
    }
  });

  it('records each platform', () => {
    for (const platform of ['bluesky', 'mastodon', 'threads'] as Platform[]) {
      expect(toArchiveRecord(post({ uri: 'at://a/1', platform }), 'post').platform).toBe(platform);
    }
  });

  it('defaults missing counts to zero rather than undefined', () => {
    const record = toArchiveRecord({
      uri: 'at://a/2', text: 't', createdAt: '2026-01-10T12:00:00.000Z',
      platform: 'bluesky', author: { handle: '@a', displayName: 'A' },
    } as UnifiedPost, 'post');
    expect(record.likeCount).toBe(0);
    expect(record.repostCount).toBe(0);
    expect(record.replyCount).toBe(0);
  });
});

describe('archivePosts', () => {
  it('stores posts and counts them', async () => {
    const added = await archivePosts([post({ uri: 'at://a/1' }), post({ uri: 'at://a/2' })], 'post');
    expect(added).toBe(2);
    expect((await getArchiveStats()).total).toBe(2);
  });

  it('upserts rather than duplicating — the uri is the key', async () => {
    await archivePosts([post({ uri: 'at://a/1', text: 'first' })], 'post');
    await archivePosts([post({ uri: 'at://a/1', text: 'edited' })], 'post');
    const all = await searchArchive({});
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('edited');
  });
});

describe('searchArchive', () => {
  beforeEach(async () => {
    await archivePosts([
      post({ uri: 'at://a/1', text: 'Svelte is good', createdAt: '2026-01-03T00:00:00.000Z' }),
      post({ uri: 'at://a/2', text: 'about RUST', createdAt: '2026-01-02T00:00:00.000Z',
             platform: 'mastodon', author: { handle: '@bob@m.social', displayName: 'Bob' } as any }),
    ], 'post');
    await archivePosts([
      post({ uri: 'at://a/3', text: 'liked svelte thing', createdAt: '2026-01-01T00:00:00.000Z' }),
    ], 'like');
  });

  it('returns everything with no filters', async () => {
    expect(await searchArchive({})).toHaveLength(3);
  });

  it('sorts newest first', async () => {
    expect((await searchArchive({})).map(r => r.uri)).toEqual(['at://a/1', 'at://a/2', 'at://a/3']);
  });

  it('text search is case-insensitive', async () => {
    expect((await searchArchive({ query: 'rust' })).map(r => r.uri)).toEqual(['at://a/2']);
    expect((await searchArchive({ query: 'SVELTE' }))).toHaveLength(2);
  });

  it('filters by type', async () => {
    expect((await searchArchive({ type: 'like' })).map(r => r.uri)).toEqual(['at://a/3']);
  });

  it('filters by platform', async () => {
    expect((await searchArchive({ platform: 'mastodon' })).map(r => r.uri)).toEqual(['at://a/2']);
  });

  /** type + platform each have their own index path; together they must still agree. */
  it('combines type and platform correctly', async () => {
    expect(await searchArchive({ type: 'post', platform: 'mastodon' })).toHaveLength(1);
    expect(await searchArchive({ type: 'like', platform: 'mastodon' })).toHaveLength(0);
  });

  it('combines a text query with a filter', async () => {
    expect((await searchArchive({ query: 'svelte', type: 'like' })).map(r => r.uri))
      .toEqual(['at://a/3']);
  });

  it('filters by author across handle and display name', async () => {
    expect((await searchArchive({ author: 'bob' })).map(r => r.uri)).toEqual(['at://a/2']);
    expect((await searchArchive({ author: 'alice' }))).toHaveLength(2);
  });

  it('filters by date range, inclusive at both ends', async () => {
    const from = await searchArchive({ dateFrom: '2026-01-02T00:00:00.000Z' });
    expect(from.map(r => r.uri)).toEqual(['at://a/1', 'at://a/2']);
    const to = await searchArchive({ dateTo: '2026-01-02T00:00:00.000Z' });
    expect(to.map(r => r.uri)).toEqual(['at://a/2', 'at://a/3']);
  });

  it('returns nothing when nothing matches', async () => {
    expect(await searchArchive({ query: 'nothing matches this' })).toEqual([]);
  });

  it('applies the limit after sorting, so it keeps the newest', async () => {
    expect((await searchArchive({ limit: 2 })).map(r => r.uri)).toEqual(['at://a/1', 'at://a/2']);
  });
});

describe('getArchiveStats', () => {
  it('counts by type and platform and reports the date range', async () => {
    await archivePosts([
      post({ uri: 'at://a/1', createdAt: '2026-01-03T00:00:00.000Z' }),
      post({ uri: 'at://a/2', createdAt: '2026-01-01T00:00:00.000Z', platform: 'mastodon' }),
    ], 'post');
    await archivePosts([post({ uri: 'at://a/3', createdAt: '2026-01-02T00:00:00.000Z' })], 'like');

    const stats = await getArchiveStats();
    expect(stats.total).toBe(3);
    expect(stats.byType.post).toBe(2);
    expect(stats.byType.like).toBe(1);
    expect(stats.byPlatform.bluesky).toBe(2);
    expect(stats.byPlatform.mastodon).toBe(1);
    expect(stats.dateRange).toEqual({
      oldest: '2026-01-01T00:00:00.000Z',
      newest: '2026-01-03T00:00:00.000Z',
    });
  });

  it('is empty for an empty archive', async () => {
    const stats = await getArchiveStats();
    expect(stats.total).toBe(0);
    expect(stats.dateRange).toBeNull();
  });
});

describe('clearArchive', () => {
  it('removes everything', async () => {
    await archivePosts([post({ uri: 'at://a/1' })], 'post');
    await clearArchive();
    expect(await searchArchive({})).toEqual([]);
  });
});
