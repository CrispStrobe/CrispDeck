import { describe, it, expect } from 'vitest';
import { computeBestHour, formatHour } from './posting-times';

describe('computeBestHour', () => {
  it('returns null for insufficient data', () => {
    expect(computeBestHour([], 'bluesky')).toBeNull();
    expect(computeBestHour([
      { createdAt: '2026-06-05T10:00:00Z', likeCount: 5, repostCount: 1, platform: 'bluesky' as const },
    ], 'bluesky')).toBeNull(); // only 1 post, need at least 5
  });

  it('finds the hour with highest avg engagement', () => {
    const posts = [
      // 10:00 — low engagement
      ...Array.from({ length: 5 }, () => ({ createdAt: '2026-06-05T10:00:00Z', likeCount: 1, repostCount: 0, platform: 'bluesky' as const })),
      // 14:00 — high engagement
      ...Array.from({ length: 5 }, () => ({ createdAt: '2026-06-05T14:00:00Z', likeCount: 20, repostCount: 5, platform: 'bluesky' as const })),
    ];
    const result = computeBestHour(posts, 'bluesky');
    expect(result).not.toBeNull();
    expect(result!.bestHour).toBe(14);
    expect(result!.avgEngagement).toBe(25); // 20 + 5
  });

  it('filters by platform', () => {
    const posts = [
      ...Array.from({ length: 5 }, () => ({ createdAt: '2026-06-05T10:00:00Z', likeCount: 50, repostCount: 0, platform: 'bluesky' as const })),
      ...Array.from({ length: 5 }, () => ({ createdAt: '2026-06-05T20:00:00Z', likeCount: 50, repostCount: 0, platform: 'mastodon' as const })),
    ];
    expect(computeBestHour(posts, 'bluesky')!.bestHour).toBe(10);
    expect(computeBestHour(posts, 'mastodon')!.bestHour).toBe(20);
  });

  it('returns null when all engagement is 0', () => {
    const posts = Array.from({ length: 10 }, () => ({
      createdAt: '2026-06-05T12:00:00Z', likeCount: 0, repostCount: 0, platform: 'bluesky' as const,
    }));
    expect(computeBestHour(posts, 'bluesky')).toBeNull();
  });
});

describe('formatHour', () => {
  it('formats AM hours', () => {
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(1)).toBe('1:00 AM');
    expect(formatHour(11)).toBe('11:00 AM');
  });

  it('formats PM hours', () => {
    expect(formatHour(12)).toBe('12:00 PM');
    expect(formatHour(13)).toBe('1:00 PM');
    expect(formatHour(23)).toBe('11:00 PM');
  });
});
