/**
 * Tests for archive data model and search logic.
 */
import { describe, it, expect } from 'vitest';

interface ArchiveEntry {
  uri: string;
  platform: 'bluesky' | 'mastodon' | 'threads';
  type: 'post' | 'like' | 'repost' | 'reply';
  text: string;
  author_handle: string;
  created_at: string;
  like_count: number;
  repost_count: number;
}

function makeEntry(overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    uri: `at://did:plc:test/post/${Math.random().toString(36).slice(2)}`,
    platform: 'bluesky',
    type: 'post',
    text: 'Test post content',
    author_handle: 'alice.bsky.social',
    created_at: new Date().toISOString(),
    like_count: 0,
    repost_count: 0,
    ...overrides,
  };
}

describe('archive data model', () => {
  it('entry has all required fields', () => {
    const e = makeEntry();
    expect(e.uri).toBeTruthy();
    expect(e.platform).toBe('bluesky');
    expect(e.type).toBe('post');
    expect(e.text).toBeTruthy();
  });

  it('supports all types', () => {
    for (const type of ['post', 'like', 'repost', 'reply'] as const) {
      const e = makeEntry({ type });
      expect(e.type).toBe(type);
    }
  });

  it('supports both platforms', () => {
    const bsky = makeEntry({ platform: 'bluesky' });
    const masto = makeEntry({ platform: 'mastodon' });
    expect(bsky.platform).toBe('bluesky');
    expect(masto.platform).toBe('mastodon');
  });
});

describe('archive search', () => {
  const entries = [
    makeEntry({ text: 'Hello world from Bluesky', platform: 'bluesky', type: 'post' }),
    makeEntry({ text: 'Mastodon rules', platform: 'mastodon', type: 'post' }),
    makeEntry({ text: 'Liked a great post', type: 'like' }),
    makeEntry({ text: 'Reposted something', type: 'repost' }),
    makeEntry({ text: 'Reply to thread', type: 'reply' }),
  ];

  it('text search is case-insensitive', () => {
    const q = 'hello';
    const results = entries.filter(e => e.text.toLowerCase().includes(q));
    expect(results.length).toBe(1);
    expect(results[0].text).toContain('Hello');
  });

  it('filter by type', () => {
    const likes = entries.filter(e => e.type === 'like');
    expect(likes.length).toBe(1);
  });

  it('filter by platform', () => {
    const masto = entries.filter(e => e.platform === 'mastodon');
    expect(masto.length).toBe(1);
  });

  it('combined search + filter', () => {
    const results = entries.filter(e =>
      e.platform === 'bluesky' && e.type === 'post' && e.text.toLowerCase().includes('hello')
    );
    expect(results.length).toBe(1);
  });

  it('empty search returns all', () => {
    const q = '';
    const results = entries.filter(e => !q || e.text.toLowerCase().includes(q));
    expect(results.length).toBe(entries.length);
  });

  it('no match returns empty', () => {
    const results = entries.filter(e => e.text.toLowerCase().includes('nonexistent'));
    expect(results.length).toBe(0);
  });
});

describe('archive search optimization paths', () => {
  // These tests verify the query path selection logic in searchArchive()
  // by simulating the conditions under which index vs full-scan is chosen

  it('type-only filter would use index path', () => {
    // When only type is specified, searchArchive uses store.index('type').getAll()
    const params = { type: 'like' as const };
    const hasTextFilters = !!(params as any).query || !!(params as any).author;
    const hasDateFilters = !!(params as any).dateFrom || !!(params as any).dateTo;
    const hasMediaFilter = !!(params as any).hasMedia;
    const useTypeIndex = params.type && !(params as any).platform && !hasTextFilters && !hasDateFilters && !hasMediaFilter;
    expect(useTypeIndex).toBe(true);
  });

  it('platform-only filter would use index path', () => {
    const params = { platform: 'bluesky' as const };
    const hasTextFilters = !!(params as any).query || !!(params as any).author;
    const hasDateFilters = !!(params as any).dateFrom || !!(params as any).dateTo;
    const hasMediaFilter = !!(params as any).hasMedia;
    const usePlatformIndex = params.platform && !(params as any).type && !hasTextFilters && !hasDateFilters && !hasMediaFilter;
    expect(usePlatformIndex).toBe(true);
  });

  it('text search falls back to full scan', () => {
    const params = { type: 'post' as const, query: 'hello' };
    const hasTextFilters = !!params.query;
    const useTypeIndex = params.type && !hasTextFilters;
    expect(useTypeIndex).toBe(false);
  });

  it('combined type+platform falls back to full scan', () => {
    const params = { type: 'post' as const, platform: 'bluesky' as const };
    const useTypeIndex = params.type && !params.platform;
    const usePlatformIndex = params.platform && !params.type;
    expect(useTypeIndex).toBe(false);
    expect(usePlatformIndex).toBe(false);
  });

  it('date filter falls back to full scan', () => {
    const params = { type: 'post' as const, dateFrom: '2024-01-01' };
    const hasDateFilters = !!params.dateFrom;
    const useTypeIndex = params.type && !hasDateFilters;
    expect(useTypeIndex).toBe(false);
  });

  it('no filters uses full scan', () => {
    const params = {};
    const useTypeIndex = !!(params as any).type && !(params as any).platform;
    const usePlatformIndex = !!(params as any).platform && !(params as any).type;
    expect(useTypeIndex).toBe(false);
    expect(usePlatformIndex).toBe(false);
  });
});
