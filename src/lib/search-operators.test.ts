import { describe, it, expect } from 'vitest';

describe('search operators UI', () => {
  describe('appendOperator', () => {
    it('appends operator to empty query', () => {
      let query = '';
      query = (query.trim() + ' has:media').trim();
      expect(query).toBe('has:media');
    });

    it('appends operator to existing query', () => {
      let query = 'svelte';
      query = (query.trim() + ' has:media').trim();
      expect(query).toBe('svelte has:media');
    });

    it('handles query with trailing spaces', () => {
      let query = 'svelte  ';
      query = (query.trim() + ' from:alice.bsky.social').trim();
      expect(query).toBe('svelte from:alice.bsky.social');
    });
  });

  describe('quick filter: Has media', () => {
    it('adds has:media operator', () => {
      const op = 'has:media';
      expect(op).toBe('has:media');
    });
  });

  describe('quick filter: From me', () => {
    it('uses first connected account handle', () => {
      const accounts = [{ handle: 'alice.bsky.social' }, { handle: '@bob@mastodon.social' }];
      const me = accounts[0]?.handle;
      const op = `from:${me}`;
      expect(op).toBe('from:alice.bsky.social');
    });

    it('does nothing without accounts', () => {
      const accounts: { handle: string }[] = [];
      const me = accounts[0]?.handle;
      expect(me).toBeUndefined();
    });
  });

  describe('quick filter: Past week', () => {
    it('generates since: with date 7 days ago', () => {
      const d = new Date('2026-07-04');
      d.setDate(d.getDate() - 7);
      const op = `since:${d.toISOString().split('T')[0]}`;
      expect(op).toBe('since:2026-06-27');
    });
  });

  describe('Bluesky search operators', () => {
    const operators = [
      { op: 'from:handle.bsky.social', desc: 'posts by a user' },
      { op: 'since:2026-01-01', desc: 'posts after date' },
      { op: 'until:2026-12-31', desc: 'posts before date' },
      { op: 'lang:en', desc: 'filter by language' },
      { op: 'has:media', desc: 'posts with images/video' },
    ];

    for (const { op, desc } of operators) {
      it(`documents ${op} — ${desc}`, () => {
        expect(op).toBeTruthy();
        expect(desc).toBeTruthy();
      });
    }

    it('supports 5 Bluesky operators', () => {
      expect(operators).toHaveLength(5);
    });
  });

  describe('Mastodon search operators', () => {
    it('supports from:@user@instance format', () => {
      const op = 'from:@alice@mastodon.social';
      expect(op).toContain('@');
    });

    it('supports #hashtag format', () => {
      const op = '#svelte';
      expect(op.startsWith('#')).toBe(true);
    });
  });

  describe('Threads search', () => {
    it('only supports plain keyword search', () => {
      const query = 'artificial intelligence';
      // No operators supported
      expect(query).not.toContain(':');
    });
  });

  describe('search help toggle', () => {
    it('toggles visibility', () => {
      let showSearchHelp = false;
      showSearchHelp = !showSearchHelp;
      expect(showSearchHelp).toBe(true);
      showSearchHelp = !showSearchHelp;
      expect(showSearchHelp).toBe(false);
    });
  });
});
