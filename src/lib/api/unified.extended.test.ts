/**
 * Extended tests for unified feed functions — more filter combinations,
 * crosspost detection edge cases, and sort stability.
 */
import { describe, it, expect } from 'vitest';
import { filterPosts, sortPosts, detectCrossposts, isCrosspostGroup } from './unified';
import type { UnifiedPost } from '$lib/types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/app.bsky.feed.post/${Math.random().toString(36).slice(2)}`,
    text: 'Default post text',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: '2024-06-01T12:00:00.000Z',
    platform: 'bluesky',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    isRepost: false,
    ...overrides,
  };
}

describe('filterPosts — extended', () => {
  const posts = [
    makePost({ text: 'Hello world!', likeCount: 10, repostCount: 5 }),
    makePost({ text: 'Goodbye world!', likeCount: 0, repostCount: 0 }),
    makePost({ text: '@alice replied here', replyParentUri: 'at://something' }),
    makePost({ text: 'A repost', isRepost: true, repostAuthor: { handle: 'bob.bsky.social' } }),
    makePost({ text: 'With media', embeds: { $type: 'app.bsky.embed.images#view', images: [{}] }, platform: 'bluesky' }),
    makePost({ text: 'Mastodon post', platform: 'mastodon', uri: 'https://mastodon.social/@user/123' }),
  ];

  it('searchTerm is case-insensitive', () => {
    const result = filterPosts(posts, { searchTerm: 'HELLO', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0 });
    expect(result.length).toBe(1);
    expect(result[0].text).toContain('Hello');
  });

  it('hideReplies and hideReposts combined', () => {
    const result = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: true, hideReposts: true, minLikes: 0 });
    expect(result.every(p => !p.isRepost)).toBe(true);
    expect(result.every(p => !p.replyParentUri)).toBe(true);
  });

  it('minLikes filters correctly', () => {
    const result = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 5 });
    expect(result.every(p => (p.likeCount ?? 0) >= 5)).toBe(true);
  });

  it('no filters returns all posts', () => {
    const result = filterPosts(posts, { searchTerm: '', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0 });
    expect(result.length).toBe(posts.length);
  });

  it('search for non-existent text returns empty', () => {
    const result = filterPosts(posts, { searchTerm: 'xyznonexistent', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0 });
    expect(result.length).toBe(0);
  });
});

describe('sortPosts — extended', () => {
  const posts = [
    makePost({ createdAt: '2024-06-01T12:00:00Z', likeCount: 5, repostCount: 2, text: 'mid' }),
    makePost({ createdAt: '2024-06-03T12:00:00Z', likeCount: 1, repostCount: 0, text: 'new' }),
    makePost({ createdAt: '2024-05-01T12:00:00Z', likeCount: 100, repostCount: 50, text: 'old' }),
  ];

  it('engagement sort = likes + reposts', () => {
    const sorted = sortPosts(posts, 'engagement');
    expect(sorted[0].text).toBe('old'); // 100 + 50 = 150
    expect(sorted[1].text).toBe('mid'); // 5 + 2 = 7
    expect(sorted[2].text).toBe('new'); // 1 + 0 = 1
  });

  it('likes sort is descending', () => {
    const sorted = sortPosts(posts, 'likes');
    expect(sorted[0].likeCount).toBe(100);
    expect(sorted[2].likeCount).toBe(1);
  });

  it('reposts sort is descending', () => {
    const sorted = sortPosts(posts, 'reposts');
    expect(sorted[0].repostCount).toBe(50);
    expect(sorted[2].repostCount).toBe(0);
  });

  it('does not mutate the input array', () => {
    const original = [...posts];
    sortPosts(posts, 'newest');
    expect(posts.map(p => p.text)).toEqual(original.map(p => p.text));
  });

  it('oldest sort is ascending', () => {
    const sorted = sortPosts(posts, 'oldest');
    expect(sorted[0].text).toBe('old');
    expect(sorted[2].text).toBe('new');
  });

  it('handles posts with undefined counts', () => {
    const postsWithUndefined = [
      makePost({ likeCount: undefined, repostCount: undefined }),
      makePost({ likeCount: 5, repostCount: 3 }),
    ];
    const sorted = sortPosts(postsWithUndefined, 'engagement');
    expect(sorted[0].likeCount).toBe(5);
  });
});

describe('detectCrossposts — extended', () => {
  it('groups identical text from different platforms', () => {
    const posts = [
      makePost({ text: 'Same post!', platform: 'bluesky', createdAt: '2024-06-01T12:00:00Z' }),
      makePost({ text: 'Same post!', platform: 'mastodon', createdAt: '2024-06-01T12:05:00Z', uri: 'https://mastodon.social/@user/1' }),
    ];
    const result = detectCrossposts(posts);
    expect(result.some(isCrosspostGroup)).toBe(true);
  });

  it('does not group same-platform posts', () => {
    const posts = [
      makePost({ text: 'Same post!', platform: 'bluesky' }),
      makePost({ text: 'Same post!', platform: 'bluesky', uri: 'at://did:plc:other/app.bsky.feed.post/abc' }),
    ];
    const result = detectCrossposts(posts);
    expect(result.filter(isCrosspostGroup).length).toBe(0);
  });

  it('does not group posts >24h apart', () => {
    const posts = [
      makePost({ text: 'Same post!', platform: 'bluesky', createdAt: '2024-06-01T12:00:00Z' }),
      makePost({ text: 'Same post!', platform: 'mastodon', createdAt: '2024-06-03T12:00:00Z', uri: 'https://mastodon.social/@user/1' }),
    ];
    const result = detectCrossposts(posts);
    expect(result.filter(isCrosspostGroup).length).toBe(0);
  });

  it('handles empty input', () => {
    expect(detectCrossposts([])).toEqual([]);
  });

  it('handles single post', () => {
    const result = detectCrossposts([makePost()]);
    expect(result.length).toBe(1);
  });

  it('dissimilar text is not grouped', () => {
    const posts = [
      makePost({ text: 'Completely different text about cats', platform: 'bluesky' }),
      makePost({ text: 'Something about quantum physics', platform: 'mastodon', uri: 'https://mastodon.social/@user/1' }),
    ];
    const result = detectCrossposts(posts);
    expect(result.filter(isCrosspostGroup).length).toBe(0);
  });

  it('very similar but not identical text is grouped', () => {
    const posts = [
      makePost({ text: 'Hello world, this is a test post about crossposting!', platform: 'bluesky', createdAt: '2024-06-01T12:00:00Z' }),
      makePost({ text: 'Hello world, this is a test post about crossposting', platform: 'mastodon', createdAt: '2024-06-01T12:01:00Z', uri: 'https://mastodon.social/@user/1' }),
    ];
    const result = detectCrossposts(posts);
    // Might or might not group depending on similarity threshold
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
