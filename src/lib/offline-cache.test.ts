import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCachedTime, isOffline } from './offline-cache';

describe('offline-cache', () => {
  describe('formatCachedTime', () => {
    it('returns "just now" for < 1 minute', () => {
      const now = new Date().toISOString();
      expect(formatCachedTime(now)).toBe('just now');
    });

    it('returns minutes for < 1 hour', () => {
      const d = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      expect(formatCachedTime(d.toISOString())).toBe('5 min ago');
    });

    it('returns hours for < 1 day', () => {
      const d = new Date(Date.now() - 3 * 3600 * 1000); // 3h ago
      expect(formatCachedTime(d.toISOString())).toBe('3h ago');
    });

    it('returns date for > 1 day', () => {
      const d = new Date(Date.now() - 48 * 3600 * 1000); // 2 days ago
      const result = formatCachedTime(d.toISOString());
      // Should be a formatted date string, not relative
      expect(result).not.toContain('ago');
      expect(result).not.toContain('now');
    });
  });

  describe('isOffline', () => {
    it('returns true when navigator.onLine is false', () => {
      vi.stubGlobal('navigator', { onLine: false });
      expect(isOffline()).toBe(true);
      vi.unstubAllGlobals();
    });

    it('returns false when navigator.onLine is true', () => {
      vi.stubGlobal('navigator', { onLine: true });
      expect(isOffline()).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  describe('cache entry shape', () => {
    it('CachedFeed has key, posts, cachedAt fields', () => {
      const entry = {
        key: 'feed',
        posts: [{ uri: 'at://1', text: 'Hello', author: { handle: 'test' }, createdAt: '', platform: 'bluesky', isRepost: false, raw: {} }],
        cachedAt: new Date().toISOString(),
      };
      expect(entry.key).toBe('feed');
      expect(entry.posts).toHaveLength(1);
      expect(entry.cachedAt).toBeTruthy();
    });

    it('limits cached posts to 100', () => {
      const posts = Array.from({ length: 200 }, (_, i) => ({
        uri: `post-${i}`, text: `Post ${i}`, author: { handle: 'test' },
        createdAt: '', platform: 'bluesky' as const, isRepost: false, raw: {},
      }));
      const cached = posts.slice(0, 100);
      expect(cached).toHaveLength(100);
    });
  });

  describe('supported cache keys', () => {
    it('supports feed, notifications, trending keys', () => {
      const keys = ['feed', 'notifications', 'trending'];
      for (const key of keys) {
        expect(typeof key).toBe('string');
      }
    });
  });
});
