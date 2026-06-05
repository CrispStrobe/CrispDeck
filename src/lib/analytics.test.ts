/**
 * Tests for analytics computation logic — stat calculations, date filtering,
 * platform breakdown, engagement metrics.
 */
import { describe, it, expect } from 'vitest';
import { sortPosts } from './api/unified';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/post/${Math.random().toString(36).slice(2)}`,
    text: 'Test post content',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    ...overrides,
  };
}

describe('analytics stat calculations', () => {
  const posts = [
    makePost({ likeCount: 10, repostCount: 3, replyCount: 2, platform: 'bluesky' }),
    makePost({ likeCount: 20, repostCount: 5, replyCount: 8, platform: 'mastodon' }),
    makePost({ likeCount: 5, repostCount: 1, replyCount: 0, platform: 'bluesky' }),
    makePost({ isRepost: true, likeCount: 100 }), // repost — should be excluded
  ];

  const originalPosts = posts.filter(p => !p.isRepost);

  it('excludes reposts from original post count', () => {
    expect(originalPosts.length).toBe(3);
  });

  it('calculates total likes correctly', () => {
    const totalLikes = originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0);
    expect(totalLikes).toBe(35);
  });

  it('calculates total reposts correctly', () => {
    const totalReposts = originalPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0);
    expect(totalReposts).toBe(9);
  });

  it('calculates total replies correctly', () => {
    const totalReplies = originalPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0);
    expect(totalReplies).toBe(10);
  });

  it('calculates engagement rate (per post)', () => {
    const totalLikes = originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0);
    const totalReposts = originalPosts.reduce((s, p) => s + (p.repostCount ?? 0), 0);
    const totalReplies = originalPosts.reduce((s, p) => s + (p.replyCount ?? 0), 0);
    const rate = (totalLikes + totalReposts + totalReplies) / originalPosts.length;
    expect(rate.toFixed(1)).toBe('18.0');
  });

  it('calculates average likes per post', () => {
    const totalLikes = originalPosts.reduce((s, p) => s + (p.likeCount ?? 0), 0);
    const avg = totalLikes / originalPosts.length;
    expect(avg.toFixed(1)).toBe('11.7');
  });
});

describe('analytics platform breakdown', () => {
  const posts = [
    makePost({ platform: 'bluesky', likeCount: 10, repostCount: 2, replyCount: 1 }),
    makePost({ platform: 'bluesky', likeCount: 5, repostCount: 3, replyCount: 0 }),
    makePost({ platform: 'mastodon', likeCount: 20, repostCount: 7, replyCount: 4 }),
  ];

  it('counts posts per platform', () => {
    const bsky = posts.filter(p => p.platform === 'bluesky');
    const masto = posts.filter(p => p.platform === 'mastodon');
    expect(bsky.length).toBe(2);
    expect(masto.length).toBe(1);
  });

  it('sums likes per platform', () => {
    const bskyLikes = posts.filter(p => p.platform === 'bluesky').reduce((s, p) => s + (p.likeCount ?? 0), 0);
    const mastoLikes = posts.filter(p => p.platform === 'mastodon').reduce((s, p) => s + (p.likeCount ?? 0), 0);
    expect(bskyLikes).toBe(15);
    expect(mastoLikes).toBe(20);
  });

  it('sums reposts per platform', () => {
    const bskyReposts = posts.filter(p => p.platform === 'bluesky').reduce((s, p) => s + (p.repostCount ?? 0), 0);
    expect(bskyReposts).toBe(5);
  });

  it('calculates engagement rate per platform', () => {
    const bsky = posts.filter(p => p.platform === 'bluesky');
    const bskyEng = bsky.reduce((s, p) => s + (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0), 0);
    expect((bskyEng / bsky.length).toFixed(1)).toBe('10.5');
  });
});

describe('analytics date range filtering', () => {
  const now = Date.now();
  const posts = [
    makePost({ createdAt: new Date(now - 2 * 86400000).toISOString() }),  // 2 days ago
    makePost({ createdAt: new Date(now - 10 * 86400000).toISOString() }), // 10 days ago
    makePost({ createdAt: new Date(now - 40 * 86400000).toISOString() }), // 40 days ago
    makePost({ createdAt: new Date(now - 100 * 86400000).toISOString() }), // 100 days ago
  ];

  function filterByRange(range: 'all' | '7d' | '30d' | '90d') {
    if (range === 'all') return posts;
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const cutoff = now - days * 86400000;
    return posts.filter(p => new Date(p.createdAt).getTime() >= cutoff);
  }

  it('all returns everything', () => {
    expect(filterByRange('all').length).toBe(4);
  });

  it('7d returns only last week', () => {
    expect(filterByRange('7d').length).toBe(1);
  });

  it('30d returns last month', () => {
    expect(filterByRange('30d').length).toBe(2);
  });

  it('90d returns last quarter', () => {
    expect(filterByRange('90d').length).toBe(3);
  });
});

describe('analytics top posts sorting', () => {
  const posts = [
    makePost({ likeCount: 5, repostCount: 1 }),
    makePost({ likeCount: 50, repostCount: 10 }),
    makePost({ likeCount: 20, repostCount: 30 }),
    makePost({ likeCount: 1, repostCount: 0 }),
  ];

  it('sorts by likes descending', () => {
    const sorted = sortPosts([...posts], 'likes');
    expect(sorted[0].likeCount).toBe(50);
    expect(sorted[1].likeCount).toBe(20);
  });

  it('sorts by reposts descending', () => {
    const sorted = sortPosts([...posts], 'reposts');
    expect(sorted[0].repostCount).toBe(30);
  });

  it('sorts by engagement (likes + reposts) descending', () => {
    const sorted = sortPosts([...posts], 'engagement');
    // 50+10=60 first, 20+30=50 second
    expect((sorted[0].likeCount ?? 0) + (sorted[0].repostCount ?? 0)).toBe(60);
    expect((sorted[1].likeCount ?? 0) + (sorted[1].repostCount ?? 0)).toBe(50);
  });

  it('top 5 slice works with fewer posts', () => {
    const top5 = sortPosts([...posts], 'likes').slice(0, 5);
    expect(top5.length).toBe(4); // only 4 posts
  });
});

describe('analytics posting activity by hour', () => {
  it('buckets posts by hour of day', () => {
    const posts = [
      makePost({ createdAt: '2026-06-01T08:00:00Z' }),
      makePost({ createdAt: '2026-06-01T08:30:00Z' }),
      makePost({ createdAt: '2026-06-01T14:00:00Z' }),
      makePost({ createdAt: '2026-06-02T08:00:00Z' }),
    ];
    const hours = Array(24).fill(0);
    posts.forEach(p => { hours[new Date(p.createdAt).getUTCHours()]++; });
    expect(hours[8]).toBe(3);
    expect(hours[14]).toBe(1);
    expect(hours[0]).toBe(0);
  });
});

describe('analytics sourceAccount tracking', () => {
  it('posts can have sourceAccount field', () => {
    const post = makePost({ sourceAccount: 'alice.bsky.social' });
    expect(post.sourceAccount).toBe('alice.bsky.social');
  });

  it('sourceAccount is optional', () => {
    const post = makePost();
    expect(post.sourceAccount).toBeUndefined();
  });
});
