import { describe, it, expect } from 'vitest';
import { analyzePerformance } from './performance-insights';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://post-${Math.random()}`,
    text: overrides.text ?? 'Hello world',
    author: { handle: 'test.bsky.social' },
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    platform: overrides.platform ?? 'bluesky',
    isRepost: false,
    likeCount: overrides.likeCount ?? 5,
    repostCount: overrides.repostCount ?? 1,
    ...overrides,
  };
}

describe('performance insights', () => {
  it('returns empty for fewer than 10 posts', () => {
    const posts = Array(5).fill(null).map(() => makePost());
    expect(analyzePerformance(posts)).toEqual([]);
  });

  it('detects media advantage', () => {
    const posts = [
      ...Array(10).fill(null).map(() => makePost({ embeds: { images: [] }, likeCount: 20 })),
      ...Array(10).fill(null).map(() => makePost({ embeds: undefined, likeCount: 5 })),
    ];
    const insights = analyzePerformance(posts);
    const media = insights.find(i => i.category === 'media');
    expect(media).toBeDefined();
    expect(media!.multiplier).toBeGreaterThan(1);
  });

  it('detects platform differences', () => {
    const posts = [
      ...Array(10).fill(null).map(() => makePost({ platform: 'bluesky', likeCount: 30 })),
      ...Array(10).fill(null).map(() => makePost({ platform: 'mastodon', likeCount: 5 })),
    ];
    const insights = analyzePerformance(posts);
    const platform = insights.find(i => i.category === 'platform');
    expect(platform).toBeDefined();
    expect(platform!.description).toContain('bluesky');
  });

  it('detects hashtag advantage', () => {
    const posts = [
      ...Array(8).fill(null).map(() => makePost({ text: 'Great post #svelte #webdev', likeCount: 25 })),
      ...Array(8).fill(null).map(() => makePost({ text: 'Normal post without tags', likeCount: 5 })),
    ];
    const insights = analyzePerformance(posts);
    const hashtags = insights.find(i => i.category === 'hashtags');
    expect(hashtags).toBeDefined();
  });

  it('sorts by multiplier descending', () => {
    const posts = [
      ...Array(10).fill(null).map(() => makePost({ embeds: { images: [] }, likeCount: 50, text: 'Short #tag' })),
      ...Array(10).fill(null).map(() => makePost({ embeds: undefined, likeCount: 2, text: 'A very long post without any hashtags that goes on for quite a while describing things in detail without media' })),
    ];
    const insights = analyzePerformance(posts);
    if (insights.length >= 2) {
      expect(insights[0].multiplier).toBeGreaterThanOrEqual(insights[1].multiplier!);
    }
  });
});
