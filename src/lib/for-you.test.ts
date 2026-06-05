import { describe, it, expect } from 'vitest';
import { buildAffinityMap, scoreForYou, rankForYou } from './for-you';
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

describe('buildAffinityMap', () => {
  it('returns empty map for empty inputs', () => {
    const map = buildAffinityMap([], [], []);
    expect(map.size).toBe(0);
  });

  it('weights likes at 1, reposts at 2, replies at 3', () => {
    const map = buildAffinityMap(
      [{ authorHandle: 'alice' }],
      [{ authorHandle: 'bob' }],
      [{ authorHandle: 'carol' }],
    );
    expect(map.get('alice')).toBe(1);
    expect(map.get('bob')).toBe(2);
    expect(map.get('carol')).toBe(3);
  });

  it('accumulates scores for the same author', () => {
    const map = buildAffinityMap(
      [{ authorHandle: 'alice' }, { authorHandle: 'alice' }, { authorHandle: 'alice' }],
      [{ authorHandle: 'alice' }],
      [{ authorHandle: 'alice' }],
    );
    // 3 likes (3) + 1 repost (2) + 1 reply (3) = 8
    expect(map.get('alice')).toBe(8);
  });

  it('is case-insensitive', () => {
    const map = buildAffinityMap(
      [{ authorHandle: 'Alice' }],
      [{ authorHandle: 'ALICE' }],
      [],
    );
    expect(map.get('alice')).toBe(3); // 1 + 2
  });
});

describe('scoreForYou', () => {
  const now = new Date('2026-06-05T12:00:00Z').getTime();

  it('scores higher for posts by high-affinity authors', () => {
    const map = new Map([['alice.bsky.social', 10], ['bob.bsky.social', 1]]);
    const alice = makePost({ author: { handle: 'alice.bsky.social' }, createdAt: new Date(now).toISOString() });
    const bob = makePost({ author: { handle: 'bob.bsky.social' }, createdAt: new Date(now).toISOString() });
    expect(scoreForYou(alice, map, now)).toBeGreaterThan(scoreForYou(bob, map, now));
  });

  it('scores higher for posts with more engagement', () => {
    const map = new Map<string, number>();
    const popular = makePost({ likeCount: 50, repostCount: 10, createdAt: new Date(now).toISOString() });
    const quiet = makePost({ likeCount: 0, repostCount: 0, createdAt: new Date(now).toISOString() });
    expect(scoreForYou(popular, map, now)).toBeGreaterThan(scoreForYou(quiet, map, now));
  });

  it('decays score with time', () => {
    const map = new Map([['alice.bsky.social', 5]]);
    const recent = makePost({ author: { handle: 'alice.bsky.social' }, createdAt: new Date(now).toISOString() });
    const old = makePost({ author: { handle: 'alice.bsky.social' }, createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString() });
    expect(scoreForYou(recent, map, now)).toBeGreaterThan(scoreForYou(old, map, now));
  });

  it('returns 0 for unknown author with no engagement', () => {
    const map = new Map<string, number>();
    const post = makePost({ likeCount: 0, repostCount: 0, replyCount: 0, createdAt: new Date(now).toISOString() });
    expect(scoreForYou(post, map, now)).toBe(0);
  });

  it('caps engagement score at 100', () => {
    const map = new Map<string, number>();
    const viral = makePost({ likeCount: 10000, repostCount: 5000, createdAt: new Date(now).toISOString() });
    const popular = makePost({ likeCount: 50, repostCount: 25, createdAt: new Date(now).toISOString() });
    // Both should cap at 100 engagement, so scores should be equal
    expect(scoreForYou(viral, map, now)).toBe(scoreForYou(popular, map, now));
  });
});

describe('rankForYou', () => {
  it('returns empty for empty input', () => {
    expect(rankForYou([], new Map())).toEqual([]);
  });

  it('filters out reposts', () => {
    const posts = [
      makePost({ isRepost: false, uri: 'original' }),
      makePost({ isRepost: true, uri: 'repost' }),
    ];
    const result = rankForYou(posts, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('original');
  });

  it('sorts by personalized score', () => {
    const map = new Map([['favorite.bsky.social', 20]]);
    const favorite = makePost({ author: { handle: 'favorite.bsky.social' }, uri: 'fav', likeCount: 0 });
    const stranger = makePost({ author: { handle: 'stranger.bsky.social' }, uri: 'str', likeCount: 10 });
    const result = rankForYou([stranger, favorite], map);
    expect(result[0].uri).toBe('fav'); // affinity beats engagement
  });

  it('includes all non-repost posts', () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      makePost({ uri: `post-${i}` })
    );
    const result = rankForYou(posts, new Map());
    expect(result).toHaveLength(10);
  });
});
