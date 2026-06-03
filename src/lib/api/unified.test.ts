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
});
