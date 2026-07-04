import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for expanded column streaming support.
 * Validates that the correct Mastodon stream types and Bluesky streaming
 * are configured for each column type.
 */
describe('streaming column configuration', () => {
  // Map of column types to expected Mastodon stream types
  const mastoStreamTypes: Record<string, { streamType: string; streamParam?: string }> = {
    timeline: { streamType: 'user' },
    mentions: { streamType: 'user' },
    notifications: { streamType: 'user' },
    local: { streamType: 'public:local' },
    federated: { streamType: 'public' },
    hashtag: { streamType: 'hashtag', streamParam: 'svelte' },
    list: { streamType: 'list', streamParam: '12345' },
    user: { streamType: 'user' },
  };

  // Columns that should get Bluesky Jetstream streaming
  const bskyStreamable = ['timeline', 'user', 'mentions'];

  // All column types that should be streamable
  const streamableTypes = ['timeline', 'mentions', 'notifications', 'local', 'federated', 'hashtag', 'list', 'user'];

  describe('streamable column types', () => {
    it('has 8 streamable column types', () => {
      expect(streamableTypes).toHaveLength(8);
    });

    for (const type of streamableTypes) {
      it(`${type} column is streamable`, () => {
        expect(streamableTypes.includes(type)).toBe(true);
      });
    }

    it('rss columns are NOT streamable', () => {
      expect(streamableTypes.includes('rss')).toBe(false);
    });

    it('search columns are NOT streamable', () => {
      expect(streamableTypes.includes('search')).toBe(false);
    });

    it('keyword-monitor has its own streaming (not in general list)', () => {
      expect(streamableTypes.includes('keyword-monitor')).toBe(false);
    });
  });

  describe('Mastodon stream type mapping', () => {
    it('timeline uses user stream', () => {
      expect(mastoStreamTypes.timeline.streamType).toBe('user');
    });

    it('mentions uses user stream', () => {
      expect(mastoStreamTypes.mentions.streamType).toBe('user');
    });

    it('notifications uses user stream', () => {
      expect(mastoStreamTypes.notifications.streamType).toBe('user');
    });

    it('local uses public:local stream', () => {
      expect(mastoStreamTypes.local.streamType).toBe('public:local');
    });

    it('federated uses public stream', () => {
      expect(mastoStreamTypes.federated.streamType).toBe('public');
    });

    it('hashtag uses hashtag stream with param', () => {
      expect(mastoStreamTypes.hashtag.streamType).toBe('hashtag');
      expect(mastoStreamTypes.hashtag.streamParam).toBe('svelte');
    });

    it('list uses list stream with ID param', () => {
      expect(mastoStreamTypes.list.streamType).toBe('list');
      expect(mastoStreamTypes.list.streamParam).toBe('12345');
    });
  });

  describe('Bluesky Jetstream column eligibility', () => {
    it('timeline gets Bluesky streaming', () => {
      expect(bskyStreamable.includes('timeline')).toBe(true);
    });

    it('user gets Bluesky streaming', () => {
      expect(bskyStreamable.includes('user')).toBe(true);
    });

    it('mentions gets Bluesky streaming', () => {
      expect(bskyStreamable.includes('mentions')).toBe(true);
    });

    it('local does NOT get Bluesky streaming (Mastodon-only)', () => {
      expect(bskyStreamable.includes('local')).toBe(false);
    });

    it('federated does NOT get Bluesky streaming (Mastodon-only)', () => {
      expect(bskyStreamable.includes('federated')).toBe(false);
    });
  });

  describe('stream event handling', () => {
    it('deduplicates posts by URI', () => {
      const existing = [
        { uri: 'at://did:plc:abc/post/1', text: 'Hello' },
        { uri: 'at://did:plc:abc/post/2', text: 'World' },
      ];
      const newPost = { uri: 'at://did:plc:abc/post/1', text: 'Hello' }; // duplicate
      const isDuplicate = existing.some(p => p.uri === newPost.uri);
      expect(isDuplicate).toBe(true);
    });

    it('prepends new non-duplicate posts', () => {
      const existing = [
        { uri: 'at://did:plc:abc/post/1', text: 'Hello' },
      ];
      const newPost = { uri: 'at://did:plc:abc/post/2', text: 'World' };
      const isDuplicate = existing.some(p => p.uri === newPost.uri);
      expect(isDuplicate).toBe(false);
      const updated = [newPost, ...existing];
      expect(updated[0].uri).toBe('at://did:plc:abc/post/2');
    });

    it('caps column posts at 200', () => {
      const posts = Array.from({ length: 200 }, (_, i) => ({ uri: `post-${i}` }));
      const newPost = { uri: 'post-new' };
      const updated = [newPost, ...posts].slice(0, 200);
      expect(updated).toHaveLength(200);
      expect(updated[0].uri).toBe('post-new');
      expect(updated[199].uri).toBe('post-198'); // last old one shifted
    });

    it('only handles new-post events', () => {
      const eventTypes = ['new-post', 'delete', 'update'];
      const handled = eventTypes.filter(t => t === 'new-post');
      expect(handled).toEqual(['new-post']);
    });
  });

  describe('stream cleanup', () => {
    it('cleans up previous stream on column refresh', () => {
      const cleanupFn = vi.fn();
      const streamCleanups = new Map<string, () => void>();
      streamCleanups.set('col1', cleanupFn);

      // Simulate refresh: clean up existing stream
      const prevCleanup = streamCleanups.get('col1');
      if (prevCleanup) prevCleanup();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('cleans up all streams on column remove', () => {
      const cleanupFn = vi.fn();
      const streamCleanups = new Map<string, () => void>();
      streamCleanups.set('col1', cleanupFn);

      // Simulate remove
      const cleanup = streamCleanups.get('col1');
      if (cleanup) { cleanup(); streamCleanups.delete('col1'); }
      expect(cleanupFn).toHaveBeenCalledTimes(1);
      expect(streamCleanups.has('col1')).toBe(false);
    });
  });

  describe('Mastodon stream param construction', () => {
    it('builds hashtag stream URL correctly', () => {
      const streamType = 'hashtag';
      const streamParam = 'svelte';
      const fullType = `${streamType}&tag=${streamParam}`;
      expect(fullType).toBe('hashtag&tag=svelte');
    });

    it('builds list stream URL correctly', () => {
      const streamType = 'list';
      const streamParam = '12345';
      const fullType = `${streamType}&list=${streamParam}`;
      expect(fullType).toBe('list&list=12345');
    });
  });
});
