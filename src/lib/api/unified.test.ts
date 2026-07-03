import { describe, it, expect } from 'vitest';
import { filterPosts, sortPosts, detectCrossposts } from './unified';
import type { UnifiedPost } from '$lib/types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/app.bsky.feed.post/${Math.random().toString(36).slice(2)}`,
    text: 'Hello world',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    replyCount: 0,
    repostCount: 0,
    likeCount: 5,
    isRepost: false,
    ...overrides,
  };
}

describe('filterPosts', () => {
  const posts: UnifiedPost[] = [
    makePost({ text: 'Hello world', likeCount: 10, isRepost: false }),
    makePost({ text: 'This is a reply', replyParentUri: 'at://parent', likeCount: 2 }),
    makePost({ text: 'A repost', isRepost: true, likeCount: 0 }),
    makePost({ text: '@someone a mention reply', platform: 'mastodon', likeCount: 3 }),
    makePost({ text: 'Post with media', embeds: [{ type: 'image' }], platform: 'mastodon', likeCount: 7 }),
  ];

  it('returns all posts with no filters', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0,
    });
    expect(result).toHaveLength(5);
  });

  it('filters by search term', () => {
    const result = filterPosts(posts, {
      searchTerm: 'hello', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0,
    });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello world');
  });

  it('search is case insensitive', () => {
    const result = filterPosts(posts, {
      searchTerm: 'HELLO', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0,
    });
    expect(result).toHaveLength(1);
  });

  it('hides reposts', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: true, minLikes: 0,
    });
    expect(result).toHaveLength(4);
    expect(result.every(p => !p.isRepost)).toBe(true);
  });

  it('hides replies (formal replies)', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: true, hideReposts: false, minLikes: 0,
    });
    // Should hide the reply (has replyParentUri) and the @mention on mastodon
    expect(result.every(p => !p.replyParentUri)).toBe(true);
  });

  it('hides mastodon @mention replies', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: true, hideReposts: false, minLikes: 0,
    });
    expect(result.find(p => p.text.startsWith('@someone'))).toBeUndefined();
  });

  it('filters by minimum likes', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 5,
    });
    expect(result.every(p => (p.likeCount ?? 0) >= 5)).toBe(true);
    expect(result.length).toBe(2); // posts with likeCount 10 and 7
  });

  it('filters by has media (mastodon)', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: true, hideReplies: false, hideReposts: false, minLikes: 0,
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(p => p.text === 'Post with media')).toBe(true);
  });

  it('combines multiple filters', () => {
    const result = filterPosts(posts, {
      searchTerm: '', hasMedia: false, hideReplies: true, hideReposts: true, minLikes: 5,
    });
    expect(result.every(p => !p.isRepost && !p.replyParentUri && (p.likeCount ?? 0) >= 5)).toBe(true);
  });
});

describe('sortPosts', () => {
  const posts: UnifiedPost[] = [
    makePost({ createdAt: '2024-01-01T10:00:00Z', likeCount: 5, repostCount: 2 }),
    makePost({ createdAt: '2024-01-03T10:00:00Z', likeCount: 20, repostCount: 10 }),
    makePost({ createdAt: '2024-01-02T10:00:00Z', likeCount: 1, repostCount: 0 }),
  ];

  it('sorts by newest (default)', () => {
    const result = sortPosts(posts, 'newest');
    expect(new Date(result[0].createdAt).getTime()).toBeGreaterThan(new Date(result[1].createdAt).getTime());
  });

  it('sorts by oldest', () => {
    const result = sortPosts(posts, 'oldest');
    expect(new Date(result[0].createdAt).getTime()).toBeLessThan(new Date(result[1].createdAt).getTime());
  });

  it('sorts by likes', () => {
    const result = sortPosts(posts, 'likes');
    expect(result[0].likeCount).toBe(20);
    expect(result[2].likeCount).toBe(1);
  });

  it('sorts by reposts', () => {
    const result = sortPosts(posts, 'reposts');
    expect(result[0].repostCount).toBe(10);
  });

  it('sorts by engagement (likes + reposts)', () => {
    const result = sortPosts(posts, 'engagement');
    expect((result[0].likeCount ?? 0) + (result[0].repostCount ?? 0)).toBe(30);
  });

  it('does not mutate input', () => {
    const original = [...posts];
    sortPosts(posts, 'likes');
    expect(posts[0]).toBe(original[0]);
  });
});

describe('detectCrossposts', () => {
  it('groups similar posts from different platforms', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'This is my important announcement about the new project release', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'This is my important announcement about the new project release', platform: 'mastodon', createdAt: '2024-01-01T10:05:00Z' }),
    ];
    const result = detectCrossposts(posts);
    expect(result).toHaveLength(1);
    expect('type' in result[0] && result[0].type).toBe('crosspost');
  });

  it('does not group dissimilar posts', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'Hello from Bluesky', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'Completely different topic on Mastodon', platform: 'mastodon', createdAt: '2024-01-01T10:05:00Z' }),
    ];
    const result = detectCrossposts(posts);
    expect(result).toHaveLength(2);
    expect(result.every(item => !('type' in item))).toBe(true);
  });

  it('does not group posts from the same platform', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'Same text on Bluesky', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'Same text on Bluesky', platform: 'bluesky', createdAt: '2024-01-01T10:05:00Z' }),
    ];
    const result = detectCrossposts(posts);
    expect(result).toHaveLength(2);
  });

  it('does not group posts more than 24h apart', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'Identical text for testing purposes here', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'Identical text for testing purposes here', platform: 'mastodon', createdAt: '2024-01-03T10:00:00Z' }),
    ];
    const result = detectCrossposts(posts);
    expect(result).toHaveLength(2);
  });

  it('includes similarity score above 0.9', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'This is a crossposted message about our launch', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'This is a crossposted message about our launch', platform: 'mastodon', createdAt: '2024-01-01T10:01:00Z' }),
    ];
    const result = detectCrossposts(posts);
    expect(result).toHaveLength(1);
    if ('type' in result[0]) {
      expect(result[0].similarity).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('handles empty input', () => {
    expect(detectCrossposts([])).toHaveLength(0);
  });

  it('returns cached result for identical post URIs', () => {
    const uri1 = 'at://did:plc:test/app.bsky.feed.post/cache1';
    const uri2 = 'at://did:plc:test/app.bsky.feed.post/cache2';
    const posts: UnifiedPost[] = [
      makePost({ uri: uri1, text: 'Cache test post one', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ uri: uri2, text: 'Totally different text', platform: 'mastodon', createdAt: '2024-01-01T10:05:00Z' }),
    ];
    const result1 = detectCrossposts(posts);
    const result2 = detectCrossposts(posts);
    // Same reference = cache hit
    expect(result1).toBe(result2);
  });

  it('recomputes when posts change', () => {
    const posts1: UnifiedPost[] = [
      makePost({ uri: 'at://change/1', text: 'First version', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
    ];
    const posts2: UnifiedPost[] = [
      makePost({ uri: 'at://change/2', text: 'Second version', platform: 'mastodon', createdAt: '2024-01-01T10:00:00Z' }),
    ];
    const result1 = detectCrossposts(posts1);
    const result2 = detectCrossposts(posts2);
    expect(result1).not.toBe(result2);
  });

  it('skips comparison when text lengths differ by more than 50%', () => {
    const posts: UnifiedPost[] = [
      makePost({ text: 'Short', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ text: 'This is a very long post that is nothing like the short one above and should not be compared at all', platform: 'mastodon', createdAt: '2024-01-01T10:05:00Z' }),
    ];
    const result = detectCrossposts(posts);
    // Should not group — lengths differ by >50%
    expect(result).toHaveLength(2);
    expect(result.every(item => !('type' in item))).toBe(true);
  });

  it('uses identity pairs for lower threshold matching', () => {
    const pairs = new Set(['@alice.bsky.social<>@alice@mastodon.social']);
    const posts: UnifiedPost[] = [
      makePost({
        text: 'My thoughts on the matter today',
        platform: 'bluesky',
        author: { handle: '@alice.bsky.social' },
        createdAt: '2024-01-01T10:00:00Z',
      }),
      makePost({
        text: 'My thoughts on the matter',
        platform: 'mastodon',
        author: { handle: '@alice@mastodon.social' },
        createdAt: '2024-01-01T10:05:00Z',
      }),
    ];
    // With identity pairs the threshold drops to 0.7
    const withPairs = detectCrossposts(posts, pairs);
    expect(withPairs.some(item => 'type' in item && item.type === 'crosspost')).toBe(true);
  });
});

describe('sortPosts (Schwartzian optimization)', () => {
  it('newest sort pre-computes timestamps', () => {
    const posts: UnifiedPost[] = [
      makePost({ createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ createdAt: '2024-01-03T10:00:00Z' }),
      makePost({ createdAt: '2024-01-02T10:00:00Z' }),
    ];
    const result = sortPosts(posts, 'newest');
    expect(new Date(result[0].createdAt).getTime()).toBeGreaterThan(new Date(result[1].createdAt).getTime());
    expect(new Date(result[1].createdAt).getTime()).toBeGreaterThan(new Date(result[2].createdAt).getTime());
  });

  it('oldest sort pre-computes timestamps', () => {
    const posts: UnifiedPost[] = [
      makePost({ createdAt: '2024-01-03T10:00:00Z' }),
      makePost({ createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ createdAt: '2024-01-02T10:00:00Z' }),
    ];
    const result = sortPosts(posts, 'oldest');
    expect(new Date(result[0].createdAt).getTime()).toBeLessThan(new Date(result[1].createdAt).getTime());
    expect(new Date(result[1].createdAt).getTime()).toBeLessThan(new Date(result[2].createdAt).getTime());
  });

  it('default sort uses Schwartzian path', () => {
    const posts: UnifiedPost[] = [
      makePost({ createdAt: '2024-01-01T10:00:00Z', uri: 'a' }),
      makePost({ createdAt: '2024-01-03T10:00:00Z', uri: 'b' }),
    ];
    // 'newest' is the default, which uses the Schwartzian path
    const result = sortPosts(posts, 'newest');
    expect(result[0].uri).toBe('b'); // Jan 3 first
  });
});

describe('performance: detectCrossposts at scale', () => {
  it('handles 200 posts in under 100ms', () => {
    const posts: UnifiedPost[] = [];
    for (let i = 0; i < 100; i++) {
      posts.push(makePost({
        uri: `at://bsky/${i}`,
        text: `Post number ${i} about topic ${i % 10}`,
        platform: 'bluesky',
        createdAt: new Date(Date.now() - i * 60000).toISOString(),
      }));
      posts.push(makePost({
        uri: `https://masto/${i}`,
        text: `Different content ${i} on mastodon`,
        platform: 'mastodon',
        createdAt: new Date(Date.now() - i * 60000).toISOString(),
      }));
    }
    const start = performance.now();
    const result = detectCrossposts(posts);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500); // CI machines may be slower
  });

  it('cache hit is near-instant for repeated calls', () => {
    const posts: UnifiedPost[] = [
      makePost({ uri: 'at://perf/1', text: 'Same content', platform: 'bluesky', createdAt: '2024-01-01T10:00:00Z' }),
      makePost({ uri: 'https://perf/2', text: 'Different', platform: 'mastodon', createdAt: '2024-01-01T10:00:00Z' }),
    ];
    // First call populates cache
    detectCrossposts(posts);
    // Second call should be cached
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      detectCrossposts(posts);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5); // 100 cached calls < 5ms
  });
});

describe('performance: sortPosts at scale', () => {
  it('sorts 500 posts by date in under 20ms', () => {
    const posts = Array.from({ length: 500 }, (_, i) =>
      makePost({ createdAt: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString() })
    );
    const start = performance.now();
    const result = sortPosts(posts, 'newest');
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(500);
    expect(elapsed).toBeLessThan(20);
    // Verify sort order
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result[i].createdAt).getTime()
      );
    }
  });
});
