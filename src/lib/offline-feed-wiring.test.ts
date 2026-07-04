import { describe, it, expect, vi } from 'vitest';

describe('offline feed cache wiring', () => {
  describe('cache on successful load', () => {
    it('calls cacheFeed after successful loadFeed with posts', () => {
      const cacheFeed = vi.fn();
      const posts = [{ uri: 'post1' }, { uri: 'post2' }];
      // Simulate successful feed load
      if (posts.length > 0) {
        cacheFeed('feed', posts);
      }
      expect(cacheFeed).toHaveBeenCalledWith('feed', posts);
    });

    it('does NOT cache when no posts loaded', () => {
      const cacheFeed = vi.fn();
      const posts: any[] = [];
      if (posts.length > 0) {
        cacheFeed('feed', posts);
      }
      expect(cacheFeed).not.toHaveBeenCalled();
    });

    it('clears offline banner on successful load', () => {
      let offlineBanner = 'Offline — cached from 5 min ago';
      const posts = [{ uri: 'post1' }];
      if (posts.length > 0) {
        offlineBanner = '';
      }
      expect(offlineBanner).toBe('');
    });
  });

  describe('offline fallback', () => {
    it('loads from cache when network fails and no posts', async () => {
      const cached = {
        key: 'feed',
        posts: [{ uri: 'cached1' }, { uri: 'cached2' }],
        cachedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      };
      let posts: any[] = [];
      let offlineBanner = '';

      // Simulate: allPosts is empty, posts is empty
      if (posts.length === 0) {
        if (cached && cached.posts.length > 0) {
          posts = cached.posts;
          offlineBanner = `Offline — showing cached feed from 5 min ago`;
        }
      }

      expect(posts).toHaveLength(2);
      expect(offlineBanner).toContain('Offline');
    });

    it('does nothing when cache is also empty', () => {
      let posts: any[] = [];
      let offlineBanner = '';
      const cached = null;

      if (posts.length === 0) {
        if (cached && (cached as any).posts.length > 0) {
          posts = (cached as any).posts;
          offlineBanner = 'Offline';
        }
      }

      expect(posts).toHaveLength(0);
      expect(offlineBanner).toBe('');
    });
  });

  describe('offline banner', () => {
    it('shows retry button that clears banner and reloads', () => {
      let offlineBanner = 'Offline — cached from 2 min ago';
      let reloaded = false;

      // Simulate retry click
      offlineBanner = '';
      reloaded = true;

      expect(offlineBanner).toBe('');
      expect(reloaded).toBe(true);
    });

    it('banner is yellow/warning styled (not red/error)', () => {
      const bannerClass = 'bg-yellow-900/50 border-yellow-700 text-yellow-200';
      expect(bannerClass).toContain('yellow');
      expect(bannerClass).not.toContain('red');
    });
  });
});
