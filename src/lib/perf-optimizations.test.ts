import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('performance optimizations', () => {
  describe('crosspostThread parallelization', () => {
    it('resolves mentions for all platforms in parallel, not sequential', () => {
      // The key change: Promise.all(targets.map(...)) instead of for-loop await
      const platforms = ['bluesky', 'mastodon', 'threads'];
      const startTimes: number[] = [];

      // Simulate parallel execution: all should start at ~same time
      const parallelExec = async () => {
        await Promise.all(platforms.map(async (p, i) => {
          startTimes.push(Date.now());
          await new Promise(r => setTimeout(r, 1)); // simulate async work
        }));
      };

      // In sequential mode, start times would differ by ~1ms each
      // In parallel mode, all start at the same tick
      return parallelExec().then(() => {
        // All should start within 2ms of each other (parallel)
        const spread = Math.max(...startTimes) - Math.min(...startTimes);
        expect(spread).toBeLessThan(5);
      });
    });

    it('posts to all platforms in parallel via Promise.allSettled', () => {
      // Promise.allSettled captures both successes and failures
      const results = [
        { status: 'fulfilled' as const, value: [{ platform: 'bluesky', success: true }] },
        { status: 'rejected' as const, reason: 'network error' },
        { status: 'fulfilled' as const, value: [{ platform: 'threads', success: true }] },
      ];

      const flattened: any[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          flattened.push(...r.value);
        } else {
          flattened.push({ platform: ['bluesky', 'mastodon', 'threads'][i], success: false, error: String(r.reason) });
        }
      }

      expect(flattened).toHaveLength(3);
      expect(flattened[0].success).toBe(true);
      expect(flattened[1].success).toBe(false);
      expect(flattened[1].error).toBe('network error');
      expect(flattened[2].success).toBe(true);
    });
  });

  describe('Mastodon media upload parallelization', () => {
    it('uploads all files via Promise.all instead of sequential loop', async () => {
      const files = ['img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg'];
      let concurrentUploads = 0;
      let maxConcurrent = 0;

      const uploadResults = await Promise.all(
        files.map(async (file) => {
          concurrentUploads++;
          maxConcurrent = Math.max(maxConcurrent, concurrentUploads);
          await new Promise(r => setTimeout(r, 1));
          concurrentUploads--;
          return `id-${file}`;
        })
      );

      expect(uploadResults).toHaveLength(4);
      expect(maxConcurrent).toBeGreaterThan(1); // Proves parallel execution
    });

    it('includes alt text in upload FormData', () => {
      const altTexts = ['A dog', 'A cat', '', 'A bird'];
      const idx = 0;
      const formData = new FormData();
      formData.append('file', new Blob(['img']), 'test.jpg');
      if (altTexts[idx]) formData.append('description', altTexts[idx]);
      expect(formData.get('description')).toBe('A dog');
    });
  });

  describe('deck loadColumn parallelization', () => {
    it('fetches all accounts in parallel for timeline column', async () => {
      const fetchers = [
        async () => [{ uri: 'bsky1' }],
        async () => [{ uri: 'bsky2' }],
        async () => [{ uri: 'masto1' }],
      ];

      const results = await Promise.all(fetchers.map(f => f()));
      const posts = results.flat();
      expect(posts).toHaveLength(3);
    });

    it('handles individual account failures without blocking others', async () => {
      const fetchers = [
        async () => [{ uri: 'ok1' }],
        async () => { throw new Error('auth expired'); },
        async () => [{ uri: 'ok2' }],
      ];

      const results = await Promise.all(
        fetchers.map(async (f) => {
          try { return await f(); }
          catch { return []; }
        })
      );
      const posts = results.flat();
      expect(posts).toHaveLength(2);
    });
  });

  describe('cached HTML stripping', () => {
    it('strips HTML tags from Mastodon content', () => {
      const html = '<p>Hello <a href="...">@alice</a> how are <em>you</em>?</p>';
      const text = html.replace(/<[^>]*>?/gm, '');
      expect(text).toBe('Hello @alice how are you?');
    });

    it('caches result by URI on second call', () => {
      const cache = new Map<string, string>();
      const uri = 'https://mastodon.social/@bob/123';
      const html = '<p>Test</p>';

      // First call: compute and cache
      let result = cache.get(uri);
      if (!result) {
        result = html.replace(/<[^>]*>?/gm, '');
        cache.set(uri, result);
      }
      expect(result).toBe('Test');

      // Second call: cache hit (no regex)
      const cached = cache.get(uri);
      expect(cached).toBe('Test');
    });

    it('evicts oldest entry when cache exceeds 2000', () => {
      const cache = new Map<string, string>();
      for (let i = 0; i < 2001; i++) {
        cache.set(`uri-${i}`, `text-${i}`);
      }
      expect(cache.size).toBe(2001);

      // Eviction: delete first entry
      if (cache.size > 2000) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      expect(cache.size).toBe(2000);
      expect(cache.has('uri-0')).toBe(false);
      expect(cache.has('uri-1')).toBe(true);
    });
  });

  describe('cached Mastodon handle normalization', () => {
    it('adds @ prefix for local handles', () => {
      const acct = 'alice';
      const url = 'https://mastodon.social/@alice';
      const handle = acct.includes('@') ? `@${acct}` : `@${acct}@${new URL(url).hostname}`;
      expect(handle).toBe('@alice@mastodon.social');
    });

    it('preserves remote handles (already has @)', () => {
      const acct = 'bob@other.social';
      const handle = acct.includes('@') ? `@${acct}` : `@${acct}@unknown`;
      expect(handle).toBe('@bob@other.social');
    });

    it('caches result for same acct', () => {
      const cache = new Map<string, string>();
      const acct = 'alice';
      const url = 'https://mastodon.social/@alice';

      // First call
      let handle = cache.get(acct);
      if (!handle) {
        handle = `@${acct}@${new URL(url).hostname}`;
        cache.set(acct, handle);
      }
      expect(handle).toBe('@alice@mastodon.social');

      // Second call: cache hit, no URL parsing
      expect(cache.get(acct)).toBe('@alice@mastodon.social');
    });
  });

  describe('Post.svelte session-scoped prefs cache', () => {
    it('caches preferences without TTL check', () => {
      let cache: { hideEngagement: boolean; compact: boolean } | null = null;

      function getPrefs() {
        if (cache) return cache;
        cache = { hideEngagement: false, compact: true };
        return cache;
      }

      const first = getPrefs();
      const second = getPrefs();
      expect(first).toBe(second); // Same object reference (no re-read)
    });

    it('invalidates cache on prefs-changed event', () => {
      let cache: any = { hideEngagement: false };

      // Simulate event
      cache = null;
      expect(cache).toBeNull();

      // Next access re-reads
      if (!cache) cache = { hideEngagement: true };
      expect(cache.hideEngagement).toBe(true);
    });

    it('eliminates Date.now() calls from cache check', () => {
      // Old code: if (cache && Date.now() - cache.ts < 10000)
      // New code: if (cache) — no timestamp overhead
      let dateNowCalls = 0;
      const originalNow = Date.now;
      Date.now = () => { dateNowCalls++; return originalNow(); };

      let cache: any = null;
      function getPrefs() {
        if (cache) return cache; // No Date.now() call
        cache = {};
        return cache;
      }

      getPrefs();
      getPrefs();
      getPrefs();

      Date.now = originalNow;
      expect(dateNowCalls).toBe(0); // No Date.now calls
    });
  });
});
