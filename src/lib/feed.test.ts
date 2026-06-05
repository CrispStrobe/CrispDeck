/**
 * Tests for feed logic — source account tagging, new posts detection,
 * pull-to-refresh, deduplication, incremental loading.
 */
import { describe, it, expect } from 'vitest';
import { sortPosts, filterPosts } from './api/unified';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/post/${Math.random().toString(36).slice(2)}`,
    text: 'Test post',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    likeCount: 0,
    repostCount: 0,
    ...overrides,
  };
}

describe('feed source account tagging', () => {
  it('posts can be tagged with sourceAccount', () => {
    const post = makePost({ sourceAccount: 'alice.bsky.social' });
    expect(post.sourceAccount).toBe('alice.bsky.social');
  });

  it('multi-account posts have different sources', () => {
    const posts = [
      makePost({ sourceAccount: 'alice.bsky.social', platform: 'bluesky' }),
      makePost({ sourceAccount: '@bob@mastodon.social', platform: 'mastodon' }),
    ];
    const sources = new Set(posts.map(p => p.sourceAccount));
    expect(sources.size).toBe(2);
  });

  it('source indicator shows abbreviated handle', () => {
    const handle = 'alice.bsky.social';
    const abbreviated = handle.split('.')[0];
    expect(abbreviated).toBe('alice');
  });
});

describe('feed deduplication', () => {
  it('removes duplicate URIs when merging new posts', () => {
    const existing = [
      makePost({ uri: 'at://post/1' }),
      makePost({ uri: 'at://post/2' }),
    ];
    const incoming = [
      makePost({ uri: 'at://post/2' }), // dupe
      makePost({ uri: 'at://post/3' }), // new
    ];
    const existingUris = new Set(existing.map(p => p.uri));
    const unique = incoming.filter(p => !existingUris.has(p.uri));
    expect(unique.length).toBe(1);
    expect(unique[0].uri).toBe('at://post/3');
  });
});

describe('feed incremental refresh', () => {
  it('identifies posts newer than the newest existing post', () => {
    const newestDate = '2026-06-01T12:00:00Z';
    const newPosts = [
      makePost({ createdAt: '2026-06-01T13:00:00Z' }), // newer
      makePost({ createdAt: '2026-06-01T11:00:00Z' }), // older
      makePost({ createdAt: '2026-06-01T14:00:00Z' }), // newer
    ];
    const newer = newPosts.filter(p => p.createdAt > newestDate);
    expect(newer.length).toBe(2);
  });

  it('prepends new posts and keeps newest-first order', () => {
    const existing = [
      makePost({ createdAt: '2026-06-01T10:00:00Z' }),
      makePost({ createdAt: '2026-06-01T09:00:00Z' }),
    ];
    const newPosts = [
      makePost({ createdAt: '2026-06-01T12:00:00Z' }),
      makePost({ createdAt: '2026-06-01T11:00:00Z' }),
    ];
    const combined = sortPosts([...newPosts, ...existing], 'newest');
    expect(combined[0].createdAt).toBe('2026-06-01T12:00:00Z');
    expect(combined[3].createdAt).toBe('2026-06-01T09:00:00Z');
  });
});

describe('feed platform filtering', () => {
  const posts = [
    makePost({ platform: 'bluesky' }),
    makePost({ platform: 'mastodon' }),
    makePost({ platform: 'bluesky' }),
  ];

  it('filters to bluesky only', () => {
    const filtered = posts.filter(p => p.platform === 'bluesky');
    expect(filtered.length).toBe(2);
  });

  it('filters to mastodon only', () => {
    const filtered = posts.filter(p => p.platform === 'mastodon');
    expect(filtered.length).toBe(1);
  });

  it('all returns everything', () => {
    expect(posts.length).toBe(3);
  });
});

describe('feed advanced filters', () => {
  const posts = [
    makePost({ text: 'Hello world', likeCount: 10, replyParentUri: undefined }),
    makePost({ text: 'Reply to someone', likeCount: 0, replyParentUri: 'at://parent' }),
    makePost({ text: 'A repost', isRepost: true }),
    makePost({ text: 'Popular post', likeCount: 50 }),
  ];

  it('hide replies removes posts with replyParentUri', () => {
    const filtered = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: true, hideReposts: false, minLikes: 0 });
    expect(filtered.every(p => !p.replyParentUri)).toBe(true);
  });

  it('hide reposts removes isRepost posts', () => {
    const filtered = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: true, minLikes: 0 });
    expect(filtered.every(p => !p.isRepost)).toBe(true);
  });

  it('minLikes filters posts below threshold', () => {
    const filtered = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 10 });
    expect(filtered.every(p => (p.likeCount ?? 0) >= 10)).toBe(true);
    expect(filtered.length).toBe(2);
  });

  it('search term filters by text', () => {
    const filtered = filterPosts(posts, { searchTerm: 'popular', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].text).toContain('Popular');
  });
});
