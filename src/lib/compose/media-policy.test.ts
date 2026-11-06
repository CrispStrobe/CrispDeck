import { describe, expect, it } from 'vitest';
import { BLUESKY_IMAGE_MAX_BYTES, mediaAttachmentLimit, parseMediaUrls, validateMediaForPlatform } from './media-policy';
const images = (count: number) => Array.from({ length: count }, (_, index) => new File(['photo'], `photo-${index}.png`, { type: 'image/png' }));

describe('media destination policy', () => {
  it('permits ten Bluesky images and uses the smallest limit for crossposts', () => {
    expect(mediaAttachmentLimit(['bluesky'])).toBe(10);
    expect(mediaAttachmentLimit(['bluesky', 'mastodon'])).toBe(4);
    expect(mediaAttachmentLimit([])).toBe(10);
    expect(validateMediaForPlatform('bluesky', images(10))).toBeNull();
    expect(validateMediaForPlatform('bluesky', images(11))).toContain('10');
    expect(validateMediaForPlatform('mastodon', images(5))).toContain('4');
  });
  it('rejects mixed Bluesky video/image selections and oversized image blobs', () => {
    const video = new File(['video'], 'video.mp4', { type: 'video/mp4' });
    expect(validateMediaForPlatform('bluesky', [video])).toBeNull();
    expect(validateMediaForPlatform('bluesky', [video, ...images(1)])).toContain('single video');
    const large = new File([new Uint8Array(BLUESKY_IMAGE_MAX_BYTES + 1)], 'large.png', { type: 'image/png' });
    expect(validateMediaForPlatform('bluesky', [large])).toContain('2 MB');
    expect(validateMediaForPlatform('mastodon', [large])).toBeNull();
  });
  it('preserves the order and full text of multiline media URLs', () => {
    expect(parseMediaUrls(' https://a.example/1.png\r\n\nhttps://a.example/2.png?a=b,c ')).toEqual(['https://a.example/1.png', 'https://a.example/2.png?a=b,c']);
  });
  it('requires a matching public URL for every Threads attachment', () => {
    expect(validateMediaForPlatform('threads', images(2), ['https://a.example/1.png'])).toContain('every Threads attachment');
    expect(validateMediaForPlatform('threads', images(2), ['https://a.example/1.png', 'https://a.example/2.png'])).toBeNull();
    expect(validateMediaForPlatform('threads', [], ['https://a.example/photo.png'])).toBeNull();
    expect(validateMediaForPlatform('threads', [], ['https://a.example/photo.png', 'http://a.example/2.png'])).toContain('HTTPS');
    expect(validateMediaForPlatform('threads', [], Array.from({ length: 11 }, (_, i) => `https://a.example/${i}.png`))).toContain('10');
  });
});
