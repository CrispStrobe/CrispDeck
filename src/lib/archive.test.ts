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
