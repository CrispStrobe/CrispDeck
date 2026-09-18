/**
 * Tests for Bluesky and Mastodon embed extraction logic.
 * These functions mirror the logic in Post.svelte — kept in sync.
 */
import { describe, it, expect } from 'vitest';

// ── Replicate embed helpers from Post.svelte ──────────────────────────────

// The accessors under test now live in a module, so this exercises the same
// code Post.svelte renders from rather than a copy of it.
import {
  getBskyImages, getBskyExternal, getBskyQuote, getBskyVideo,
  getMastodonMedia as mastodonMedia, getMastodonCard as mastodonCard,
} from './post-embeds';

/**
 * The local copies these replaced had drifted: getMastodonMedia ignored
 * post.embeds as a source and kept only `type === 'image'`, where the component
 * also accepts video and gifv. Shims keep the existing call sites readable.
 */
const getMastodonMedia = (raw: any) => mastodonMedia(undefined, raw);
const getMastodonCard = (raw: any) => mastodonCard(raw);

describe('getBskyImages', () => {
  it('returns empty for null embeds', () => {
    expect(getBskyImages(null)).toEqual([]);
    expect(getBskyImages(undefined)).toEqual([]);
  });

  it('extracts direct images', () => {
    const embed = {
      $type: 'app.bsky.embed.images#view',
      images: [
        { thumb: 'https://cdn.bsky.app/thumb.jpg', fullsize: 'https://cdn.bsky.app/full.jpg', alt: 'A cat' },
        { thumb: 'https://cdn.bsky.app/thumb2.jpg', fullsize: 'https://cdn.bsky.app/full2.jpg', alt: '' },
      ],
    };
    const result = getBskyImages(embed);
    expect(result).toHaveLength(2);
    expect(result[0].alt).toBe('A cat');
  });

  it('extracts images from recordWithMedia', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: {
        $type: 'app.bsky.embed.images#view',
        images: [{ thumb: 'thumb.jpg', fullsize: 'full.jpg', alt: 'pic' }],
      },
      record: { record: { $type: 'app.bsky.embed.record#viewRecord', author: {} } },
    };
    expect(getBskyImages(embed)).toHaveLength(1);
  });

  it('returns empty for external-only embeds', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: { uri: 'https://example.com', title: 'Example' },
    };
    expect(getBskyImages(embed)).toEqual([]);
  });
});

describe('getBskyExternal', () => {
  it('returns null for null embeds', () => {
    expect(getBskyExternal(null)).toBeNull();
  });

  it('extracts direct external link', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: { uri: 'https://example.com', title: 'Example', description: 'A website', thumb: 'thumb.jpg' },
    };
    const result = getBskyExternal(embed);
    expect(result).not.toBeNull();
    expect(result.uri).toBe('https://example.com');
    expect(result.title).toBe('Example');
  });

  it('extracts external from recordWithMedia', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: {
        $type: 'app.bsky.embed.external#view',
        external: { uri: 'https://example.com', title: 'Link' },
      },
      record: { record: { $type: 'app.bsky.embed.record#viewRecord' } },
    };
    expect(getBskyExternal(embed)?.uri).toBe('https://example.com');
  });

  it('returns null for image-only embeds', () => {
    const embed = {
      $type: 'app.bsky.embed.images#view',
      images: [{ thumb: 't.jpg' }],
    };
    expect(getBskyExternal(embed)).toBeNull();
  });
});

describe('getBskyQuote', () => {
  it('returns null for null embeds', () => {
    expect(getBskyQuote(null)).toBeNull();
  });

  it('extracts direct quote', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewRecord',
        author: { handle: 'alice.bsky.social', displayName: 'Alice' },
        value: { text: 'Original post' },
      },
    };
    const result = getBskyQuote(embed);
    expect(result).not.toBeNull();
    expect(result.author.handle).toBe('alice.bsky.social');
  });

  it('extracts quote from recordWithMedia', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: { $type: 'app.bsky.embed.images#view', images: [] },
      record: {
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          author: { handle: 'bob.bsky.social' },
          value: { text: 'Quoted text' },
        },
      },
    };
    const result = getBskyQuote(embed);
    expect(result).not.toBeNull();
    expect(result.author.handle).toBe('bob.bsky.social');
  });

  it('returns null for non-viewRecord records', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: { $type: 'app.bsky.embed.record#viewNotFound' },
    };
    expect(getBskyQuote(embed)).toBeNull();
  });
});

describe('getBskyVideo', () => {
  it('returns null for null embeds', () => {
    expect(getBskyVideo(null)).toBeNull();
  });

  it('extracts direct video', () => {
    const embed = {
      $type: 'app.bsky.embed.video#view',
      thumbnail: 'thumb.jpg',
      alt: 'A video',
      playlist: 'https://video.bsky.app/playlist.m3u8',
    };
    const result = getBskyVideo(embed);
    expect(result).not.toBeNull();
    expect(result.thumbnail).toBe('thumb.jpg');
    expect(result.alt).toBe('A video');
  });

  it('extracts video from recordWithMedia', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: {
        $type: 'app.bsky.embed.video#view',
        thumbnail: 'vid-thumb.jpg',
        alt: 'Clip',
      },
      record: { record: { $type: 'app.bsky.embed.record#viewRecord' } },
    };
    expect(getBskyVideo(embed)?.thumbnail).toBe('vid-thumb.jpg');
  });

  it('returns null for image embeds', () => {
    const embed = { $type: 'app.bsky.embed.images#view', images: [] };
    expect(getBskyVideo(embed)).toBeNull();
  });
});

describe('getMastodonMedia', () => {
  it('returns empty for no media', () => {
    expect(getMastodonMedia({})).toEqual([]);
  });

  it('extracts camelCase media', () => {
    const raw = {
      mediaAttachments: [
        { type: 'image', url: 'https://example.com/img.jpg', previewUrl: 'https://example.com/small.jpg' },
      ],
    };
    const result = getMastodonMedia(raw);
    expect(result).toHaveLength(1);
    expect(result[0].previewUrl).toBe('https://example.com/small.jpg');
  });

  it('extracts snake_case media from raw fetch', () => {
    const raw = {
      media_attachments: [
        { type: 'image', url: 'https://example.com/img.jpg', preview_url: 'https://example.com/small.jpg' },
      ],
    };
    const result = getMastodonMedia(raw);
    expect(result).toHaveLength(1);
    expect(result[0].previewUrl).toBe('https://example.com/small.jpg');
  });

  /**
   * The previous local copy of this asserted images only, and passed — while
   * Post.svelte has rendered video and gifv for some time. Pinned to what the
   * component actually does.
   */
  it('keeps image, video and gifv, and drops everything else', () => {
    const raw = {
      media_attachments: [
        { type: 'image', url: 'img.jpg' },
        { type: 'video', url: 'vid.mp4' },
        { type: 'gifv', url: 'gif.mp4' },
        { type: 'audio', url: 'sound.mp3' },
        { type: 'unknown', url: 'what.bin' },
      ],
    };
    const kinds = getMastodonMedia(raw).map((m: any) => m.type);
    expect(kinds).toEqual(['image', 'video', 'gifv']);
  });

  it('prefers embeds over the raw attachments when both are present', () => {
    const fromEmbeds = mastodonMedia(
      [{ type: 'image', url: 'from-embeds.jpg' }],
      { media_attachments: [{ type: 'image', url: 'from-raw.jpg' }] },
    );
    expect(fromEmbeds[0].url).toBe('from-embeds.jpg');
  });

  it('handles reblog media', () => {
    const raw = {
      reblog: {
        media_attachments: [
          { type: 'image', url: 'reblog-img.jpg', preview_url: 'reblog-small.jpg' },
        ],
      },
    };
    const result = getMastodonMedia(raw);
    expect(result).toHaveLength(1);
    expect(result[0].previewUrl).toBe('reblog-small.jpg');
  });
});

describe('getMastodonCard', () => {
  it('returns null for no card', () => {
    expect(getMastodonCard({})).toBeNull();
  });

  it('extracts camelCase card', () => {
    const raw = {
      card: { url: 'https://example.com', title: 'Example', description: 'A site', providerName: 'Example.com' },
    };
    const result = getMastodonCard(raw);
    expect(result).not.toBeNull();
    expect(result.title).toBe('Example');
    expect(result.provider_name).toBe('Example.com');
  });

  it('extracts snake_case preview_card', () => {
    const raw = {
      preview_card: { url: 'https://example.com', title: 'Example', provider_name: 'Provider' },
    };
    const result = getMastodonCard(raw);
    expect(result).not.toBeNull();
    expect(result.provider_name).toBe('Provider');
  });

  it('returns null when media attachments exist', () => {
    const raw = {
      card: { url: 'https://example.com', title: 'Example' },
      media_attachments: [{ type: 'image', url: 'img.jpg' }],
    };
    expect(getMastodonCard(raw)).toBeNull();
  });

  it('returns null when mediaAttachments exist (camelCase)', () => {
    const raw = {
      card: { url: 'https://example.com', title: 'Example' },
      mediaAttachments: [{ type: 'image', url: 'img.jpg' }],
    };
    expect(getMastodonCard(raw)).toBeNull();
  });

  it('returns null for card without url', () => {
    const raw = { card: { title: 'No URL' } };
    expect(getMastodonCard(raw)).toBeNull();
  });

  it('handles reblog card', () => {
    const raw = {
      reblog: {
        card: { url: 'https://example.com', title: 'Reblog Card' },
      },
    };
    const result = getMastodonCard(raw);
    expect(result).not.toBeNull();
    expect(result.title).toBe('Reblog Card');
  });
});
