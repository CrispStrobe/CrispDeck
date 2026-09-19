/**
 * Tests for alt text extraction helpers used by the ALT badge overlay in Post.svelte.
 * Validates that alt text is correctly identified from Bluesky and Mastodon post data.
 */
import { describe, it, expect } from 'vitest';

// ── Replicate alt text extraction logic from Post.svelte ─────────────────

/** Extract alt text from Bluesky image objects */

// These now come from the modules the component renders from, rather than
// copies kept alongside them.
import {
  hasAltText, getBskyImageAltTexts, getMastodonMediaAltTexts,
} from './alt-text';

describe('Bluesky alt text extraction', () => {
  it('returns empty array for null embeds', () => {
    expect(getBskyImageAltTexts(null)).toEqual([]);
    expect(getBskyImageAltTexts(undefined)).toEqual([]);
  });

  it('extracts alt text from direct images', () => {
    const embed = {
      $type: 'app.bsky.embed.images#view',
      images: [
        { thumb: 'thumb1.jpg', fullsize: 'full1.jpg', alt: 'A cute cat' },
        { thumb: 'thumb2.jpg', fullsize: 'full2.jpg', alt: '' },
        { thumb: 'thumb3.jpg', fullsize: 'full3.jpg', alt: 'Sunset over the ocean' },
      ],
    };
    const alts = getBskyImageAltTexts(embed);
    expect(alts).toEqual(['A cute cat', '', 'Sunset over the ocean']);
  });

  it('extracts alt text from recordWithMedia images', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: {
        $type: 'app.bsky.embed.images#view',
        images: [
          { thumb: 'thumb.jpg', fullsize: 'full.jpg', alt: 'Screenshot of code' },
        ],
      },
      record: { record: { $type: 'app.bsky.embed.record#viewRecord' } },
    };
    const alts = getBskyImageAltTexts(embed);
    expect(alts).toEqual(['Screenshot of code']);
  });

  it('returns empty for non-image embeds', () => {
    const embed = {
      $type: 'app.bsky.embed.external#view',
      external: { uri: 'https://example.com', title: 'Example' },
    };
    expect(getBskyImageAltTexts(embed)).toEqual([]);
  });

  it('handles missing alt field gracefully', () => {
    const embed = {
      $type: 'app.bsky.embed.images#view',
      images: [{ thumb: 'thumb.jpg', fullsize: 'full.jpg' }],
    };
    const alts = getBskyImageAltTexts(embed);
    expect(alts).toEqual(['']);
  });
});

describe('Mastodon alt text extraction', () => {
  it('returns empty array for no media', () => {
    expect(getMastodonMediaAltTexts({})).toEqual([]);
  });

  it('extracts description from camelCase media', () => {
    const raw = {
      mediaAttachments: [
        { type: 'image', url: 'img.jpg', description: 'A photo of a dog' },
        { type: 'image', url: 'img2.jpg', description: null },
      ],
    };
    const alts = getMastodonMediaAltTexts(raw);
    expect(alts).toEqual(['A photo of a dog', '']);
  });

  it('extracts description from snake_case media', () => {
    const raw = {
      media_attachments: [
        { type: 'image', url: 'img.jpg', description: 'Alt text here' },
      ],
    };
    const alts = getMastodonMediaAltTexts(raw);
    expect(alts).toEqual(['Alt text here']);
  });

  it('handles reblog media descriptions', () => {
    const raw = {
      reblog: {
        media_attachments: [
          { type: 'image', url: 'img.jpg', description: 'Reblogged image description' },
        ],
      },
    };
    const alts = getMastodonMediaAltTexts(raw);
    expect(alts).toEqual(['Reblogged image description']);
  });

  it('includes video and gifv descriptions', () => {
    const raw = {
      media_attachments: [
        { type: 'video', url: 'vid.mp4', description: 'Video description' },
        { type: 'gifv', url: 'gif.mp4', description: 'Animated gif' },
      ],
    };
    const alts = getMastodonMediaAltTexts(raw);
    expect(alts).toEqual(['Video description', 'Animated gif']);
  });
});

describe('hasAltText', () => {
  it('returns true for non-empty alt text', () => {
    expect(hasAltText('A photo of a cat')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasAltText('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(hasAltText('   ')).toBe(false);
    expect(hasAltText('\n\t')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(hasAltText(null)).toBe(false);
    expect(hasAltText(undefined)).toBe(false);
  });

  it('returns true for alt text with leading/trailing spaces', () => {
    expect(hasAltText('  Valid alt text  ')).toBe(true);
  });
});
