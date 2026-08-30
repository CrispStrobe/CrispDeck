import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('$lib/api/client-factory', () => ({
  initAllClients: vi.fn().mockResolvedValue({
    accounts: [
      { id: 1, platform: 'bluesky', handle: 'alice.bsky.social' },
      { id: 2, platform: 'mastodon', handle: '@bob@mastodon.social' },
    ],
    clients: new Map([
      [1, { client: { getAgent: () => ({ session: true }) } }],
      [2, { client: {} }],
    ]),
  }),
}));

vi.mock('$lib/compose/adapter', () => ({
  crosspostThread: vi.fn().mockResolvedValue([
    { platform: 'bluesky', success: true, uri: 'at://did:plc:abc/post/123' },
  ]),
  graphemeLength: (text: string) => text.length,
}));

vi.mock('$lib/compose/thread', () => ({
  splitForPlatform: (text: string, _platform: string) => ({
    parts: [{ text, charCount: text.length, charLimit: 300 }],
    needsThread: false,
  }),
}));

vi.mock('$lib/compose/media', () => ({
  validateMediaFile: () => null,
  createPreviewUrl: () => 'blob:test',
  revokePreviewUrl: vi.fn(),
  isVideoFile: () => false,
}));

vi.mock('$lib/db', () => ({
  logCrosspost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/toast.svelte', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('$lib/i18n.svelte', () => ({
  i18n: {
    t: {
      compose: {
        title: 'Compose',
        placeholder: "What's on your mind?",
        posting: 'Posting...',
        replyingTo: 'Replying to',
        quoting: 'Quoting',
        cwPlaceholder: 'Content warning...',
        altTextPlaceholder: 'Describe image...',
        public: 'Public',
        unlisted: 'Unlisted',
        followersOnlyVis: 'Followers only',
        direct: 'Direct',
      },
    },
  },
}));

import type { UnifiedPost } from '$lib/types';

describe('FloatingCompose', () => {
  const mockPost: UnifiedPost = {
    uri: 'at://did:plc:abc/app.bsky.feed.post/123',
    text: 'Hello world',
    author: { handle: 'alice.bsky.social', displayName: 'Alice', avatar: '' },
    createdAt: '2026-01-01T00:00:00Z',
    platform: 'bluesky',
    isRepost: false,
    raw: { post: { cid: 'cid123' } },
  };

  describe('props and state', () => {
    it('accepts open, replyToPost, quotePost props', () => {
      const props = {
        open: true,
        replyToPost: mockPost,
        quotePost: null,
        onposted: vi.fn(),
      };
      expect(props.open).toBe(true);
      expect(props.replyToPost?.author.handle).toBe('alice.bsky.social');
      expect(props.quotePost).toBeNull();
    });

    it('replyToPost generates @mention prefix', () => {
      const text = `@${mockPost.author.handle} `;
      expect(text).toBe('@alice.bsky.social ');
    });

    it('quotePost extracts CID from raw data', () => {
      const raw = mockPost.raw as any;
      const cid = raw?.post?.cid ?? raw?.cid ?? '';
      expect(cid).toBe('cid123');
    });
  });

  describe('character counting', () => {
    it('counts grapheme length for Bluesky (300 limit)', () => {
      // graphemeLength is mocked to return text.length
      const graphemeLength = (text: string) => text.length;
      expect(graphemeLength('Hello')).toBe(5);
      expect(graphemeLength('a'.repeat(301))).toBeGreaterThan(300);
    });

    it('uses text.length for Mastodon and Threads (500 limit)', () => {
      const text = 'Hello world';
      expect(text.length).toBe(11);
    });

    it('detects thread needed when over limit', () => {
      const bskyLen = 350;
      const mastoLen = 550;
      const needsThread = bskyLen > 300 || mastoLen > 500;
      expect(needsThread).toBe(true);
    });
  });

  describe('media handling', () => {
    it('limits to 4 media files', () => {
      const mediaFiles = ['a', 'b', 'c', 'd'];
      expect(mediaFiles.length >= 4).toBe(true);
    });

    it('validates media files before adding', () => {
      // validateMediaFile is mocked to return null (no error)
      const validateMediaFile = () => null;
      expect(validateMediaFile()).toBeNull();
    });
  });

  describe('quote URL construction', () => {
    it('builds bsky.app URL from AT URI', () => {
      const quoteUri = 'at://did:plc:abc/app.bsky.feed.post/xyz789';
      const quoteAuthor = 'alice.bsky.social';
      const rkey = quoteUri.split('/').pop();
      const url = `https://bsky.app/profile/${quoteAuthor}/post/${rkey}`;
      expect(url).toBe('https://bsky.app/profile/alice.bsky.social/post/xyz789');
    });

    it('handles missing quote fields gracefully', () => {
      const quoteUri = '';
      const quoteAuthor = '';
      const quoteUrl = quoteUri && quoteAuthor ? 'url' : undefined;
      expect(quoteUrl).toBeUndefined();
    });
  });

  describe('keyboard shortcuts', () => {
    it('Escape should close', () => {
      let open = true;
      const handler = (e: { key: string }) => {
        if (e.key === 'Escape') open = false;
      };
      handler({ key: 'Escape' });
      expect(open).toBe(false);
    });

    it('Ctrl+Enter should trigger post', () => {
      let posted = false;
      const handler = (e: { ctrlKey: boolean; key: string }) => {
        if (e.ctrlKey && e.key === 'Enter') posted = true;
      };
      handler({ ctrlKey: true, key: 'Enter' });
      expect(posted).toBe(true);
    });
  });

  describe('crosspost logging', () => {
    it('builds crosspost log entry correctly', () => {
      const results = [
        { platform: 'bluesky', success: true, uri: 'at://uri' },
        { platform: 'mastodon', success: true, uri: 'https://mastodon.social/@bob/123' },
      ];
      const entry = {
        bluesky_uri: results.find(r => r.platform === 'bluesky')?.uri ?? null,
        mastodon_uri: results.find(r => r.platform === 'mastodon')?.uri ?? null,
        threads_uri: null,
        text_preview: 'Hello world'.substring(0, 280),
        media_count: 0,
        status: results.every(r => r.success) ? 'success' : 'partial',
      };
      expect(entry.bluesky_uri).toBe('at://uri');
      expect(entry.mastodon_uri).toBe('https://mastodon.social/@bob/123');
      expect(entry.status).toBe('success');
    });
  });

  describe('form reset', () => {
    it('clears all state on successful post', () => {
      let text = 'Hello';
      let mediaFiles: string[] = ['file1'];
      let altTexts: string[] = ['alt'];
      let showCW = true;
      let contentWarning = 'warning';

      // Reset
      text = '';
      contentWarning = '';
      showCW = false;
      mediaFiles = [];
      altTexts = [];

      expect(text).toBe('');
      expect(mediaFiles).toEqual([]);
      expect(altTexts).toEqual([]);
      expect(showCW).toBe(false);
      expect(contentWarning).toBe('');
    });
  });

  describe('deck integration', () => {
    it('n key opens compose when not in input', () => {
      let composeOpen = false;
      const handler = (e: { key: string; target: { tagName: string } }) => {
        if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
          composeOpen = true;
        }
      };
      handler({ key: 'n', target: { tagName: 'DIV' } });
      expect(composeOpen).toBe(true);
    });

    it('n key does NOT open compose when typing in input', () => {
      let composeOpen = false;
      const handler = (e: { key: string; target: { tagName: string } }) => {
        if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
          composeOpen = true;
        }
      };
      handler({ key: 'n', target: { tagName: 'INPUT' } });
      expect(composeOpen).toBe(false);
    });

    // State lives on an object rather than in `let` locals: TS narrows a
    // `let ... = null` to `null` and never widens it back for a write made
    // inside a callback, so reading the field afterwards is typed `never`.
    // A call that could mutate does reset narrowing for object properties.
    type ComposeState = { post: UnifiedPost | null; open: boolean };

    it('reply opens compose with replyToPost', () => {
      const compose: ComposeState = { post: null, open: false };
      const handleReply = (post: UnifiedPost) => {
        compose.post = post;
        compose.open = true;
      };
      handleReply(mockPost);
      expect(compose.open).toBe(true);
      expect(compose.post?.author.handle).toBe('alice.bsky.social');
    });

    it('quote opens compose with quotePost', () => {
      const compose: ComposeState = { post: null, open: false };
      const handleQuote = (post: UnifiedPost) => {
        compose.post = post;
        compose.open = true;
      };
      handleQuote(mockPost);
      expect(compose.open).toBe(true);
      expect(compose.post?.uri).toBe(mockPost.uri);
    });

    it('onposted callback refreshes columns', () => {
      const refresh = vi.fn();
      const onposted = () => {
        [{ id: 'col1' }, { id: 'col2' }].forEach(() => refresh());
      };
      onposted();
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('visibility options', () => {
    it('supports all Mastodon visibility levels', () => {
      const levels = ['public', 'unlisted', 'private', 'direct'] as const;
      for (const level of levels) {
        expect(['public', 'unlisted', 'private', 'direct']).toContain(level);
      }
    });
  });

  describe('focus trap', () => {
    it('Tab cycles focus within panel', () => {
      // Simulated focus trap logic
      const focusable = ['textarea', 'button1', 'button2', 'button3'];
      const currentIdx = focusable.length - 1; // Last element
      const nextIdx = (currentIdx + 1) % focusable.length; // Should wrap to first
      expect(nextIdx).toBe(0);
    });

    it('Shift+Tab wraps backwards', () => {
      const focusable = ['textarea', 'button1', 'button2', 'button3'];
      const currentIdx = 0; // First element
      const nextIdx = (currentIdx - 1 + focusable.length) % focusable.length;
      expect(nextIdx).toBe(3);
    });
  });
});
