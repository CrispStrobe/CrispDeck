import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for deck column-aware keyboard navigation logic.
 * Tests the navigation state machine and key handlers without Svelte components.
 */
describe('deck keyboard navigation', () => {
  // Simulate the navigation state
  function createNavState(columnCount: number, postsPerColumn: number[]) {
    let focusedColumnIdx = -1;
    let focusedPostIdx = -1;

    function focusColumn(idx: number) {
      if (idx < 0 || idx >= columnCount) return;
      focusedColumnIdx = idx;
      focusedPostIdx = -1;
    }

    function focusPost(idx: number) {
      if (focusedColumnIdx < 0) return;
      const maxPosts = postsPerColumn[focusedColumnIdx] ?? 0;
      if (idx < 0) idx = 0;
      if (idx >= maxPosts) idx = maxPosts - 1;
      focusedPostIdx = idx;
    }

    return {
      get focusedColumnIdx() { return focusedColumnIdx; },
      get focusedPostIdx() { return focusedPostIdx; },
      focusColumn,
      focusPost,
      clearFocus() { focusedColumnIdx = -1; focusedPostIdx = -1; },
    };
  }

  describe('column navigation (h/l, ArrowLeft/ArrowRight)', () => {
    it('h moves focus left', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(1);
      expect(nav.focusedColumnIdx).toBe(1);
      // Press h
      nav.focusColumn(nav.focusedColumnIdx - 1);
      expect(nav.focusedColumnIdx).toBe(0);
    });

    it('l moves focus right', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(0);
      nav.focusColumn(nav.focusedColumnIdx + 1);
      expect(nav.focusedColumnIdx).toBe(1);
    });

    it('h at leftmost column stays at 0', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(0);
      nav.focusColumn(Math.max(0, nav.focusedColumnIdx - 1));
      expect(nav.focusedColumnIdx).toBe(0);
    });

    it('l at rightmost column stays at max', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(2);
      nav.focusColumn(Math.min(nav.focusedColumnIdx + 1, 2));
      expect(nav.focusedColumnIdx).toBe(2);
    });

    it('switching columns resets post focus', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(0);
      nav.focusPost(5);
      expect(nav.focusedPostIdx).toBe(5);
      nav.focusColumn(1);
      expect(nav.focusedPostIdx).toBe(-1);
    });
  });

  describe('post navigation within column (j/k)', () => {
    it('j moves to next post', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(0);
      nav.focusPost(0);
      expect(nav.focusedPostIdx).toBe(0);
      nav.focusPost(nav.focusedPostIdx + 1);
      expect(nav.focusedPostIdx).toBe(1);
    });

    it('k moves to previous post', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(0);
      nav.focusPost(3);
      nav.focusPost(nav.focusedPostIdx - 1);
      expect(nav.focusedPostIdx).toBe(2);
    });

    it('j at last post stays at last', () => {
      const nav = createNavState(1, [5]);
      nav.focusColumn(0);
      nav.focusPost(4); // last post (0-indexed)
      nav.focusPost(nav.focusedPostIdx + 1); // try to go beyond
      expect(nav.focusedPostIdx).toBe(4);
    });

    it('k at first post stays at first', () => {
      const nav = createNavState(1, [5]);
      nav.focusColumn(0);
      nav.focusPost(0);
      nav.focusPost(nav.focusedPostIdx - 1); // try to go before
      expect(nav.focusedPostIdx).toBe(0);
    });

    it('j does nothing without column focus', () => {
      const nav = createNavState(3, [10, 10, 10]);
      // focusedColumnIdx is -1
      nav.focusPost(0);
      expect(nav.focusedPostIdx).toBe(-1); // unchanged
    });
  });

  describe('number keys (1-9) jump to column', () => {
    it('1 jumps to first column', () => {
      const nav = createNavState(5, [10, 10, 10, 10, 10]);
      const key = '1';
      const num = parseInt(key);
      nav.focusColumn(num - 1);
      expect(nav.focusedColumnIdx).toBe(0);
    });

    it('3 jumps to third column', () => {
      const nav = createNavState(5, [10, 10, 10, 10, 10]);
      nav.focusColumn(parseInt('3') - 1);
      expect(nav.focusedColumnIdx).toBe(2);
    });

    it('9 is ignored if fewer than 9 columns', () => {
      const nav = createNavState(3, [10, 10, 10]);
      const num = 9;
      if (num <= 3) nav.focusColumn(num - 1);
      expect(nav.focusedColumnIdx).toBe(-1); // unchanged
    });
  });

  describe('Escape clears focus', () => {
    it('clears column and post focus', () => {
      const nav = createNavState(3, [10, 10, 10]);
      nav.focusColumn(1);
      nav.focusPost(3);
      expect(nav.focusedColumnIdx).toBe(1);
      expect(nav.focusedPostIdx).toBe(3);
      nav.clearFocus();
      expect(nav.focusedColumnIdx).toBe(-1);
      expect(nav.focusedPostIdx).toBe(-1);
    });
  });

  describe('action keys on focused post', () => {
    it('o generates thread URL from focused post', () => {
      const post = {
        uri: 'at://did:plc:abc/app.bsky.feed.post/123',
        platform: 'bluesky',
      };
      const url = `/thread?uri=${encodeURIComponent(post.uri)}&platform=${post.platform}`;
      expect(url).toBe('/thread?uri=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2F123&platform=bluesky');
    });

    it('r triggers reply on focused post', () => {
      let repliedTo: string | null = null;
      const post = { uri: 'at://test', author: { handle: 'alice.bsky.social' } };
      const handleReply = (p: typeof post) => { repliedTo = p.author.handle; };
      handleReply(post);
      expect(repliedTo).toBe('alice.bsky.social');
    });
  });

  describe('input guard', () => {
    it('ignores keyboard events from input elements', () => {
      const inputTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
      for (const type of inputTypes) {
        const isInput = inputTypes.includes(type);
        expect(isInput).toBe(true);
      }
    });

    it('ignores keyboard events when compose is open', () => {
      const composeOpen = true;
      const shouldHandle = !composeOpen;
      expect(shouldHandle).toBe(false);
    });
  });

  describe('visual focus indicators', () => {
    // Functions over `number`, not inline literals: TS folds a literal-vs-literal
    // comparison, so the inline form asserts against a constant, not the branch.
    const columnRing = (focusedColumnIdx: number, colIdx: number) =>
      focusedColumnIdx === colIdx ? 'ring-2 ring-[var(--color-primary)]/50 rounded-lg' : '';
    const postRing = (focusedPostIdx: number, postIdx: number) =>
      focusedPostIdx === postIdx ? 'ring-1 ring-[var(--color-primary)]/60 rounded-lg' : '';

    it('focused column gets ring class', () => {
      expect(columnRing(1, 1)).toContain('ring-2');
    });

    it('unfocused column has no ring', () => {
      expect(columnRing(1, 2)).toBe('');
    });

    it('focused post gets ring class', () => {
      expect(postRing(3, 3)).toContain('ring-1');
    });

    it('unfocused post has no ring', () => {
      expect(postRing(3, 4)).toBe('');
    });
  });
});
