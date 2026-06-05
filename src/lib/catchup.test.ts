import { describe, it, expect } from 'vitest';
import { scorePost, buildCatchupFeed, type CatchupWindow } from './catchup';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://post/${Math.random().toString(36).slice(2)}`,
    text: 'Hello world',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    ...overrides,
  };
}

describe('scorePost', () => {
  it('scores a post with no engagement as 0', () => {
    expect(scorePost(makePost())).toBe(0);
  });

  it('weights likes x2, reposts x3, replies x1', () => {
    expect(scorePost(makePost({ likeCount: 10 }))).toBe(20);
    expect(scorePost(makePost({ repostCount: 10 }))).toBe(30);
    expect(scorePost(makePost({ replyCount: 10 }))).toBe(10);
  });

  it('combines all engagement types', () => {
    const post = makePost({ likeCount: 5, repostCount: 3, replyCount: 2 });
    // 5*2 + 3*3 + 2*1 = 10 + 9 + 2 = 21
    expect(scorePost(post)).toBe(21);
  });

  it('handles undefined counts as 0', () => {
    expect(scorePost(makePost({ likeCount: undefined, repostCount: undefined, replyCount: undefined }))).toBe(0);
  });
});

describe('buildCatchupFeed', () => {
  it('returns empty for empty input', () => {
    expect(buildCatchupFeed([], 6)).toEqual([]);
  });

  it('filters out posts older than the window', () => {
    const recent = makePost({ createdAt: new Date().toISOString() });
    const old = makePost({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
    const result = buildCatchupFeed([recent, old], 24);
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe(recent.uri);
  });

  it('filters out reposts', () => {
    const original = makePost({ isRepost: false });
    const repost = makePost({ isRepost: true });
    const result = buildCatchupFeed([original, repost], 24);
    expect(result).toHaveLength(1);
    expect(result[0].isRepost).toBe(false);
  });

  it('sorts by engagement score descending', () => {
    const low = makePost({ likeCount: 1, uri: 'low' });
    const mid = makePost({ likeCount: 5, uri: 'mid' });
    const high = makePost({ likeCount: 20, uri: 'high' });
    const result = buildCatchupFeed([low, high, mid], 24);
    expect(result[0].uri).toBe('high');
    expect(result[1].uri).toBe('mid');
    expect(result[2].uri).toBe('low');
  });

  it('respects different time windows', () => {
    const now = Date.now();
    const twoHoursAgo = makePost({ createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(), uri: '2h' });
    const fiveHoursAgo = makePost({ createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(), uri: '5h' });
    const tenHoursAgo = makePost({ createdAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(), uri: '10h' });

    expect(buildCatchupFeed([twoHoursAgo, fiveHoursAgo, tenHoursAgo], 1)).toHaveLength(0);
    expect(buildCatchupFeed([twoHoursAgo, fiveHoursAgo, tenHoursAgo], 3)).toHaveLength(1);
    expect(buildCatchupFeed([twoHoursAgo, fiveHoursAgo, tenHoursAgo], 6)).toHaveLength(2);
    expect(buildCatchupFeed([twoHoursAgo, fiveHoursAgo, tenHoursAgo], 12)).toHaveLength(3);
  });

  it('includes posts from both platforms', () => {
    const bsky = makePost({ platform: 'bluesky', uri: 'bsky' });
    const masto = makePost({ platform: 'mastodon', uri: 'masto' });
    const result = buildCatchupFeed([bsky, masto], 24);
    expect(result).toHaveLength(2);
  });

  it('posts with equal score maintain stable order', () => {
    const a = makePost({ likeCount: 5, uri: 'a' });
    const b = makePost({ likeCount: 5, uri: 'b' });
    const result = buildCatchupFeed([a, b], 24);
    expect(result).toHaveLength(2);
    // Both should be present regardless of order
    expect(result.map(p => p.uri).sort()).toEqual(['a', 'b']);
  });

  it('returns all posts within window when all are recent', () => {
    const posts = Array.from({ length: 50 }, (_, i) =>
      makePost({ uri: `post-${i}`, likeCount: i })
    );
    const result = buildCatchupFeed(posts, 24);
    expect(result).toHaveLength(50);
    // Most engaging first
    expect(result[0].uri).toBe('post-49');
  });
});
