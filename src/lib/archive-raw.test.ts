/**
 * The archive stores a projection of the raw API payload rather than all of it.
 *
 * The risk is dropping a field something reads, which would show up as a blank
 * or broken archived post rather than an error. So every path the app reads
 * from `post.raw` — enumerated from Post.svelte, feed, deck and catchup — is
 * asserted to survive the projection, against realistic payloads.
 */
import { describe, it, expect } from 'vitest';
import { trimRawForArchive } from './archive-raw';

/** A Mastodon boost, with the shapes the API actually returns. */
const MASTO_REBLOG: any = {
  id: '111222333',
  uri: 'https://mastodon.social/users/alice/statuses/111222333/activity',
  url: 'https://mastodon.social/@alice/111222333',
  content: '',
  createdAt: '2026-01-10T12:00:00.000Z',
  account: {
    id: '1', username: 'booster', acct: 'booster@mastodon.social',
    displayName: 'Booster', url: 'https://mastodon.social/@booster',
    avatar: 'https://cdn/avatar.png',
    // Bulk that should not be archived:
    note: '<p>a very long bio</p>'.repeat(50),
    followersCount: 1234, followingCount: 567, statusesCount: 8901,
    header: 'https://cdn/header.png', fields: [{ name: 'x', value: 'y' }],
    emojis: Array.from({ length: 30 }, (_, i) => ({ shortcode: `e${i}`, url: 'https://cdn/e.png' })),
  },
  reblog: {
    id: '999888777',
    url: 'https://mastodon.social/@original/999888777',
    content: '<p>The original post content</p>',
    createdAt: '2026-01-10T11:00:00.000Z',
    account: { url: 'https://mastodon.social/@original', acct: 'original@mastodon.social',
               note: 'bio'.repeat(200), followersCount: 42 },
    mediaAttachments: [{
      id: 'm1', type: 'image', url: 'https://cdn/full.jpg', previewUrl: 'https://cdn/small.jpg',
      remoteUrl: 'https://remote/full.jpg', description: 'a cat',
      blurhash: 'UBL_:rWB', meta: { original: { width: 4000, height: 3000, size: '4000x3000' } },
    }],
    card: { url: 'https://example.com/a', title: 'A title', description: 'A description',
            image: 'https://cdn/card.png', provider_name: 'Example',
            html: '<iframe>'.repeat(20), embed_url: 'https://example.com/embed' },
    poll: { id: 'p1', expired: false, votesCount: 10,
            options: [{ title: 'yes', votesCount: 6 }, { title: 'no', votesCount: 4 }] },
    tags: Array.from({ length: 20 }, (_, i) => ({ name: `tag${i}`, url: 'https://x' })),
    emojis: Array.from({ length: 20 }, (_, i) => ({ shortcode: `e${i}` })),
  },
};

/** A snake_case Mastodon status, as a raw fetch returns it. */
const MASTO_SNAKE: any = {
  id: '555',
  url: 'https://masto.example/@bob/555',
  content: '<p>hello</p>',
  created_at: '2026-01-10T10:00:00.000Z',
  account: { url: 'https://masto.example/@bob', acct: 'bob' },
  media_attachments: [{ type: 'image', url: 'https://cdn/x.jpg', preview_url: 'https://cdn/xs.jpg',
                        remote_url: null, description: 'desc' }],
  preview_card: { url: 'https://ex.com', title: 'T', provider_name: 'Ex' },
};

const BSKY: any = {
  post: {
    uri: 'at://did:plc:abc/app.bsky.feed.post/3kzz',
    cid: 'bafyreiabc123',
    labels: [{ val: 'spam', src: 'did:plc:mod' }],
    author: { did: 'did:plc:abc', handle: 'alice.bsky.social', displayName: 'Alice',
              description: 'bio'.repeat(200), avatar: 'https://cdn/a.png',
              viewer: { muted: false, blockedBy: false } },
    record: { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-01-10T12:00:00.000Z',
              facets: Array.from({ length: 10 }, () => ({ index: { byteStart: 0, byteEnd: 5 } })) },
    embed: { $type: 'app.bsky.embed.images#view',
             images: Array.from({ length: 4 }, () => ({ thumb: 'https://cdn/t.jpg',
               fullsize: 'https://cdn/f.jpg', alt: 'x', aspectRatio: { width: 1000, height: 800 } })) },
    replyCount: 3, repostCount: 10, likeCount: 42,
    viewer: { like: 'at://did:plc:me/app.bsky.feed.like/1' },
  },
  reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:x' } },
};

const size = (v: unknown) => JSON.stringify(v).length;

describe('trimRawForArchive — Mastodon', () => {
  const trimmed: any = trimRawForArchive(MASTO_REBLOG, 'mastodon');

  it('keeps the fields interactions need', () => {
    // feed/deck/catchup: (post.raw as any).id for favourite/reblog
    expect(trimmed.id).toBe('111222333');
    expect(trimmed.reblog.id).toBe('999888777');
  });

  it('keeps the fields Post.svelte renders', () => {
    // authorUrl: raw.reblog ? raw.reblog.account : raw.account, then .url
    expect(trimmed.reblog.account.url).toBe('https://mastodon.social/@original');
    expect(trimmed.account.url).toBe('https://mastodon.social/@booster');
    // postUrl: raw.reblog ? raw.reblog.url : p.uri
    expect(trimmed.reblog.url).toBe('https://mastodon.social/@original/999888777');
    // content: raw.reblog ? raw.reblog.content : raw.content
    expect(trimmed.reblog.content).toBe('<p>The original post content</p>');
  });

  it('keeps media attachments with every rendered field', () => {
    const media = trimmed.reblog.mediaAttachments[0];
    expect(media).toMatchObject({
      type: 'image', url: 'https://cdn/full.jpg', previewUrl: 'https://cdn/small.jpg',
      remoteUrl: 'https://remote/full.jpg', description: 'a cat',
    });
  });

  it('keeps every link-card field the template reads', () => {
    expect(trimmed.reblog.card).toMatchObject({
      url: 'https://example.com/a', title: 'A title',
      description: 'A description', image: 'https://cdn/card.png', provider_name: 'Example',
    });
  });

  it('keeps the poll whole, because voting writes back into it', () => {
    expect(trimmed.reblog.poll).toEqual(MASTO_REBLOG.reblog.poll);
  });

  it('drops the bulk', () => {
    expect(trimmed.account.note).toBeUndefined();
    expect(trimmed.account.followersCount).toBeUndefined();
    expect(trimmed.account.fields).toBeUndefined();
    expect(trimmed.account.emojis).toBeUndefined();
    expect(trimmed.reblog.tags).toBeUndefined();
    expect(trimmed.reblog.emojis).toBeUndefined();
    expect(trimmed.reblog.card.html).toBeUndefined();
    expect(trimmed.reblog.mediaAttachments[0].meta).toBeUndefined();
  });

  it('is substantially smaller', () => {
    expect(size(trimmed)).toBeLessThan(size(MASTO_REBLOG) / 4);
  });

  it('handles snake_case payloads', () => {
    const t: any = trimRawForArchive(MASTO_SNAKE, 'mastodon');
    expect(t.id).toBe('555');
    expect(t.created_at).toBe('2026-01-10T10:00:00.000Z');
    expect(t.media_attachments[0]).toMatchObject({
      type: 'image', url: 'https://cdn/x.jpg', preview_url: 'https://cdn/xs.jpg', description: 'desc',
    });
    expect(t.preview_card).toMatchObject({ url: 'https://ex.com', title: 'T', provider_name: 'Ex' });
  });

  it('does not invent keys that were absent', () => {
    const t: any = trimRawForArchive({ id: '1', content: 'x' }, 'mastodon');
    expect(t.reblog).toBeUndefined();
    expect(t.poll).toBeUndefined();
    expect(t.card).toBeUndefined();
    expect(t.mediaAttachments).toBeUndefined();
    expect('account' in t).toBe(false);
  });

  it('does not recurse past one reblog level', () => {
    const nested = { id: 'a', reblog: { id: 'b', reblog: { id: 'c' } } };
    const t: any = trimRawForArchive(nested, 'mastodon');
    expect(t.reblog.id).toBe('b');
    expect(t.reblog.reblog).toBeUndefined();
  });
});

describe('trimRawForArchive — Bluesky', () => {
  const trimmed: any = trimRawForArchive(BSKY, 'bluesky');

  it('keeps the identifiers like/repost/quote need', () => {
    // raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid
    expect(trimmed.post.uri).toBe('at://did:plc:abc/app.bsky.feed.post/3kzz');
    expect(trimmed.post.cid).toBe('bafyreiabc123');
  });

  it('keeps labels, which Post.svelte reads', () => {
    // raw?.post?.labels ?? raw?.labels
    expect(trimmed.post.labels).toEqual([{ val: 'spam', src: 'did:plc:mod' }]);
  });

  it('keeps the top-level fallbacks when there is no nested post', () => {
    const flat: any = trimRawForArchive(
      { uri: 'at://x/app.bsky.feed.post/1', cid: 'bafy', labels: [] }, 'bluesky');
    expect(flat.uri).toBe('at://x/app.bsky.feed.post/1');
    expect(flat.cid).toBe('bafy');
    expect(flat.labels).toEqual([]);
  });

  it('drops the bulk', () => {
    expect(trimmed.post.author).toBeUndefined();
    expect(trimmed.post.record).toBeUndefined();
    expect(trimmed.post.embed).toBeUndefined();
    expect(trimmed.post.viewer).toBeUndefined();
    expect(trimmed.reason).toBeUndefined();
  });

  it('is substantially smaller', () => {
    expect(size(trimmed)).toBeLessThan(size(BSKY) / 5);
  });
});

describe('trimRawForArchive — edges', () => {
  it('passes through null and undefined', () => {
    expect(trimRawForArchive(null, 'mastodon')).toBeNull();
    expect(trimRawForArchive(undefined, 'bluesky')).toBeUndefined();
  });

  it('passes through primitives untouched', () => {
    expect(trimRawForArchive('a string', 'mastodon')).toBe('a string');
    expect(trimRawForArchive(42, 'bluesky')).toBe(42);
  });

  it('leaves unknown platforms alone rather than emptying them', () => {
    const payload = { anything: { nested: true } };
    expect(trimRawForArchive(payload, 'threads' as any)).toBe(payload);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(MASTO_REBLOG);
    trimRawForArchive(MASTO_REBLOG, 'mastodon');
    expect(JSON.stringify(MASTO_REBLOG)).toBe(before);
  });

  it('survives an empty object', () => {
    expect(trimRawForArchive({}, 'mastodon')).toEqual({});
    expect(trimRawForArchive({}, 'bluesky')).toEqual({});
  });
});
