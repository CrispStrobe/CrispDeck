/**
 * Comprehensive tests for normalizePost — the core data transformation layer.
 * Tests cover:
 * - Bluesky regular posts, reposts, replies
 * - Mastodon regular posts, reblogs, replies, mentions
 * - Timestamp handling (the repost ordering bug)
 * - HTML stripping
 * - Author extraction
 * - Edge cases (missing fields, empty content)
 */
import { describe, it, expect } from 'vitest';
import { normalizePost } from './unified';

// ── Bluesky mock data factories ──────────────────────────────────────────

function makeBskyPost(overrides: Record<string, any> = {}) {
  return {
    post: {
      uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
      author: {
        handle: 'alice.bsky.social',
        displayName: 'Alice',
        avatar: 'https://cdn.bsky.app/avatar.jpg',
        did: 'did:plc:abc',
      },
      record: {
        text: 'Hello from Bluesky!',
        createdAt: '2024-06-01T12:00:00.000Z',
        ...overrides.record,
      },
      replyCount: 3,
      repostCount: 7,
      likeCount: 42,
      embed: overrides.embed ?? undefined,
      ...overrides.post,
    },
    reason: overrides.reason,
    ...overrides,
  };
}

function makeBskyRepost(repostDate: string, originalDate: string) {
  return makeBskyPost({
    post: {
      uri: 'at://did:plc:original/app.bsky.feed.post/orig1',
      author: { handle: 'bob.bsky.social', displayName: 'Bob', avatar: null, did: 'did:plc:bob' },
      record: { text: 'Original post by Bob', createdAt: originalDate },
      replyCount: 1,
      repostCount: 50,
      likeCount: 200,
    },
    reason: {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: { handle: 'alice.bsky.social', displayName: 'Alice', did: 'did:plc:abc' },
      indexedAt: repostDate,
    },
  });
}

// ── Mastodon mock data factories ─────────────────────────────────────────

function makeMastoPost(overrides: Record<string, any> = {}) {
  return {
    id: '12345',
    uri: 'https://mastodon.social/users/alice/statuses/12345',
    url: 'https://mastodon.social/@alice/12345',
    content: '<p>Hello from Mastodon!</p>',
    createdAt: '2024-06-01T12:00:00.000Z',
    account: {
      acct: 'alice',
      url: 'https://mastodon.social/@alice',
      displayName: 'Alice',
      avatar: 'https://mastodon.social/avatars/alice.jpg',
    },
    repliesCount: 2,
    reblogsCount: 5,
    favouritesCount: 30,
    inReplyToId: null,
    reblog: null,
    mediaAttachments: [],
    card: null,
    ...overrides,
  };
}

function makeMastoReblog(reblogDate: string, originalDate: string) {
  return {
    id: '99999',
    uri: 'https://mastodon.social/users/alice/statuses/99999',
    url: 'https://mastodon.social/@alice/99999',
    content: '',
    createdAt: reblogDate,
    account: {
      acct: 'alice',
      url: 'https://mastodon.social/@alice',
      displayName: 'Alice',
      avatar: 'https://mastodon.social/avatars/alice.jpg',
    },
    repliesCount: 0,
    reblogsCount: 0,
    favouritesCount: 0,
    inReplyToId: null,
    reblog: {
      id: '55555',
      uri: 'https://other.social/users/bob/statuses/55555',
      url: 'https://other.social/@bob/55555',
      content: '<p>Original post by Bob on another instance</p>',
      createdAt: originalDate,
      account: {
        acct: 'bob@other.social',
        url: 'https://other.social/@bob',
        displayName: 'Bob',
        avatar: 'https://other.social/avatars/bob.jpg',
      },
      repliesCount: 10,
      reblogsCount: 100,
      favouritesCount: 500,
      inReplyToId: null,
      mediaAttachments: [],
      card: null,
    },
    mediaAttachments: [],
    card: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('normalizePost — Bluesky', () => {
  it('normalizes a regular post', () => {
    const raw = makeBskyPost();
    const post = normalizePost(raw, 'bluesky');

    expect(post.platform).toBe('bluesky');
    expect(post.uri).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
    expect(post.text).toBe('Hello from Bluesky!');
    expect(post.author.handle).toBe('alice.bsky.social');
    expect(post.author.displayName).toBe('Alice');
    expect(post.author.avatar).toBe('https://cdn.bsky.app/avatar.jpg');
    expect(post.createdAt).toBe('2024-06-01T12:00:00.000Z');
    expect(post.replyCount).toBe(3);
    expect(post.repostCount).toBe(7);
    expect(post.likeCount).toBe(42);
    expect(post.isRepost).toBe(false);
    expect(post.repostAuthor).toBeUndefined();
    expect(post.replyParentUri).toBeUndefined();
  });

  it('uses original post date for regular posts (not reposts)', () => {
    const raw = makeBskyPost({
      record: { text: 'test', createdAt: '2024-03-15T08:30:00.000Z' },
    });
    const post = normalizePost(raw, 'bluesky');
    expect(post.createdAt).toBe('2024-03-15T08:30:00.000Z');
  });

  it('uses REPOST date for reposts, not original post date', () => {
    const repostDate = '2024-06-15T10:00:00.000Z'; // June 15 — when reposted
    const originalDate = '2024-01-01T08:00:00.000Z'; // Jan 1 — when originally posted
    const raw = makeBskyRepost(repostDate, originalDate);
    const post = normalizePost(raw, 'bluesky');

    expect(post.isRepost).toBe(true);
    expect(post.createdAt).toBe(repostDate); // Should be June 15, NOT Jan 1
    expect(post.createdAt).not.toBe(originalDate);
  });

  it('repost has correct repostAuthor', () => {
    const raw = makeBskyRepost('2024-06-15T10:00:00.000Z', '2024-01-01T08:00:00.000Z');
    const post = normalizePost(raw, 'bluesky');

    expect(post.repostAuthor).toBeDefined();
    expect(post.repostAuthor!.handle).toBe('alice.bsky.social');
    expect(post.author.handle).toBe('bob.bsky.social'); // Original author
  });

  it('repost falls back to record.createdAt if indexedAt missing', () => {
    const raw = makeBskyPost({
      post: {
        uri: 'at://did:plc:x/app.bsky.feed.post/y',
        author: { handle: 'x.bsky.social', displayName: 'X', avatar: null, did: 'did:plc:x' },
        record: { text: 'test', createdAt: '2024-01-01T00:00:00.000Z' },
        replyCount: 0, repostCount: 0, likeCount: 0,
      },
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: { handle: 'alice.bsky.social', displayName: 'Alice', did: 'did:plc:abc' },
        // indexedAt intentionally missing
      },
    });
    const post = normalizePost(raw, 'bluesky');
    expect(post.createdAt).toBe('2024-01-01T00:00:00.000Z'); // Falls back
  });

  it('normalizes a reply', () => {
    const raw = makeBskyPost({
      record: {
        text: 'This is a reply',
        createdAt: '2024-06-01T12:00:00.000Z',
        reply: { parent: { uri: 'at://did:plc:xyz/app.bsky.feed.post/parent1' } },
      },
    });
    const post = normalizePost(raw, 'bluesky');
    expect(post.replyParentUri).toBe('at://did:plc:xyz/app.bsky.feed.post/parent1');
  });

  it('handles empty text', () => {
    const raw = makeBskyPost({ record: { text: '', createdAt: '2024-01-01T00:00:00.000Z' } });
    const post = normalizePost(raw, 'bluesky');
    expect(post.text).toBe('');
  });
});

describe('normalizePost — Mastodon', () => {
  it('normalizes a regular post', () => {
    const raw = makeMastoPost();
    const post = normalizePost(raw, 'mastodon');

    expect(post.platform).toBe('mastodon');
    expect(post.uri).toBe('https://mastodon.social/users/alice/statuses/12345');
    expect(post.text).toBe('Hello from Mastodon!'); // HTML stripped
    expect(post.author.handle).toBe('@alice@mastodon.social');
    expect(post.author.displayName).toBe('Alice');
    expect(post.createdAt).toBe('2024-06-01T12:00:00.000Z');
    expect(post.replyCount).toBe(2);
    expect(post.repostCount).toBe(5);
    expect(post.likeCount).toBe(30);
    expect(post.isRepost).toBe(false);
    expect(post.repostAuthor).toBeUndefined();
  });

  it('strips HTML tags from content', () => {
    const raw = makeMastoPost({
      content: '<p>Hello <a href="https://example.com">world</a>!</p><p>Second paragraph</p>',
    });
    const post = normalizePost(raw, 'mastodon');
    expect(post.text).toBe('Hello world!Second paragraph');
    expect(post.text).not.toContain('<');
    expect(post.text).not.toContain('>');
  });

  it('uses REBLOG date for reblogs, not original post date', () => {
    const reblogDate = '2024-06-15T10:00:00.000Z'; // June 15 — when reblogged
    const originalDate = '2023-12-01T08:00:00.000Z'; // Dec 2023 — original post
    const raw = makeMastoReblog(reblogDate, originalDate);
    const post = normalizePost(raw, 'mastodon');

    expect(post.isRepost).toBe(true);
    expect(post.createdAt).toBe(reblogDate); // Should be June 15, NOT Dec 2023
    expect(post.createdAt).not.toBe(originalDate);
  });

  it('reblog has correct author (original) and repostAuthor (reblogger)', () => {
    const raw = makeMastoReblog('2024-06-15T10:00:00.000Z', '2023-12-01T08:00:00.000Z');
    const post = normalizePost(raw, 'mastodon');

    expect(post.author.handle).toContain('bob'); // Original author
    expect(post.repostAuthor).toBeDefined();
    expect(post.repostAuthor!.handle).toContain('alice'); // Reblogger
  });

  it('reblog uses original post URI and text', () => {
    const raw = makeMastoReblog('2024-06-15T10:00:00.000Z', '2023-12-01T08:00:00.000Z');
    const post = normalizePost(raw, 'mastodon');

    expect(post.uri).toBe('https://other.social/users/bob/statuses/55555');
    expect(post.text).toBe('Original post by Bob on another instance');
  });

  it('normalizes a reply', () => {
    const raw = makeMastoPost({ inReplyToId: '11111' });
    const post = normalizePost(raw, 'mastodon');
    expect(post.replyParentUri).toBe('11111');
  });

  it('handles null inReplyToId', () => {
    const raw = makeMastoPost({ inReplyToId: null });
    const post = normalizePost(raw, 'mastodon');
    expect(post.replyParentUri).toBeUndefined();
  });

  it('handles federated accounts (user@other.instance)', () => {
    const raw = makeMastoPost({
      account: {
        acct: 'remote_user@fosstodon.org',
        url: 'https://fosstodon.org/@remote_user',
        displayName: 'Remote User',
        avatar: null,
      },
    });
    const post = normalizePost(raw, 'mastodon');
    expect(post.author.handle).toBe('@remote_user@fosstodon.org');
  });
});

describe('normalizePost — timestamp ordering invariants', () => {
  it('reposts of old Bluesky posts get recent timestamps', () => {
    // Simulate: alice reposts a 6-month-old post today
    const today = '2024-06-15T10:00:00.000Z';
    const sixMonthsAgo = '2024-01-01T08:00:00.000Z';

    const repost = normalizePost(makeBskyRepost(today, sixMonthsAgo), 'bluesky');
    const regularPost = normalizePost(makeBskyPost({
      record: { text: 'Regular recent post', createdAt: '2024-06-14T10:00:00.000Z' },
    }), 'bluesky');

    // The repost should be MORE RECENT than yesterday's regular post
    expect(new Date(repost.createdAt).getTime())
      .toBeGreaterThan(new Date(regularPost.createdAt).getTime());
  });

  it('reblogs of old Mastodon posts get recent timestamps', () => {
    const today = '2024-06-15T10:00:00.000Z';
    const yearAgo = '2023-06-01T08:00:00.000Z';

    const reblog = normalizePost(makeMastoReblog(today, yearAgo), 'mastodon');
    const regularPost = normalizePost(makeMastoPost({
      createdAt: '2024-06-14T10:00:00.000Z',
    }), 'mastodon');

    expect(new Date(reblog.createdAt).getTime())
      .toBeGreaterThan(new Date(regularPost.createdAt).getTime());
  });

  it('a mixed feed with reposts sorts correctly by date', () => {
    const posts = [
      normalizePost(makeBskyPost({
        record: { text: 'Regular A', createdAt: '2024-06-10T10:00:00.000Z' },
      }), 'bluesky'),
      normalizePost(makeBskyRepost('2024-06-12T10:00:00.000Z', '2024-01-01T00:00:00.000Z'), 'bluesky'),
      normalizePost(makeMastoPost({ createdAt: '2024-06-11T10:00:00.000Z', content: '<p>Regular B</p>' }), 'mastodon'),
      normalizePost(makeMastoReblog('2024-06-13T10:00:00.000Z', '2023-01-01T00:00:00.000Z'), 'mastodon'),
    ];

    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Expected order: Mastodon reblog (Jun 13), Bsky repost (Jun 12), Masto regular (Jun 11), Bsky regular (Jun 10)
    expect(posts[0].createdAt).toBe('2024-06-13T10:00:00.000Z');
    expect(posts[1].createdAt).toBe('2024-06-12T10:00:00.000Z');
    expect(posts[2].createdAt).toBe('2024-06-11T10:00:00.000Z');
    expect(posts[3].createdAt).toBe('2024-06-10T10:00:00.000Z');

    // Verify the reposts are in correct positions
    expect(posts[0].isRepost).toBe(true); // Mastodon reblog
    expect(posts[1].isRepost).toBe(true); // Bluesky repost
    expect(posts[2].isRepost).toBe(false); // Regular Mastodon
    expect(posts[3].isRepost).toBe(false); // Regular Bluesky
  });
});

// ── Mastodon custom emoji ───────────────────────────────────────────────

describe('Mastodon custom emoji in normalizePost', () => {
  it('populates emojis array from status emojis', () => {
    const post = makeMastoPost({
      emojis: [
        { shortcode: 'blobcat', url: 'https://mastodon.social/emoji/blobcat.png', static_url: 'https://mastodon.social/emoji/blobcat_static.png' },
        { shortcode: 'fire', url: 'https://mastodon.social/emoji/fire.gif' },
      ],
    });
    const result = normalizePost(post as any, 'mastodon');
    expect(result.emojis).toHaveLength(2);
    expect(result.emojis![0].shortcode).toBe('blobcat');
    expect(result.emojis![0].url).toBe('https://mastodon.social/emoji/blobcat.png');
    expect(result.emojis![1].shortcode).toBe('fire');
  });

  it('handles posts with no emojis', () => {
    const post = makeMastoPost();
    const result = normalizePost(post as any, 'mastodon');
    expect(result.emojis).toBeUndefined();
  });

  it('handles posts with empty emojis array', () => {
    const post = makeMastoPost({ emojis: [] });
    const result = normalizePost(post as any, 'mastodon');
    expect(result.emojis).toHaveLength(0);
  });
});

// ── Bluesky self-labeling ───────────────────────────────────────────────

describe('Bluesky posts preserve labels', () => {
  it('normalizes posts with labels in raw data', () => {
    const post = makeBskyPost();
    (post.post as any).labels = [{ val: 'nudity', neg: false }];
    const result = normalizePost(post as any, 'bluesky');
    expect(result.raw).toBeDefined();
    const raw = result.raw as any;
    expect(raw.post.labels[0].val).toBe('nudity');
  });
});
