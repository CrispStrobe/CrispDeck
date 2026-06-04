/**
 * Extended tests for media validation — edge cases, GIF support,
 * and preview URL lifecycle.
 */
import { describe, it, expect } from 'vitest';
import { validateMediaFile, isVideoFile, createPreviewUrl, revokePreviewUrl } from './media';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const buffer = new ArrayBuffer(sizeBytes);
  return new File([buffer], name, { type });
}

describe('validateMediaFile — extended', () => {
  describe('GIF support', () => {
    it('accepts GIF images', () => {
      expect(validateMediaFile(makeFile('cat.gif', 'image/gif', 500_000))).toBeNull();
    });

    it('accepts small GIFs', () => {
      expect(validateMediaFile(makeFile('tiny.gif', 'image/gif', 1))).toBeNull();
    });

    it('rejects oversized GIFs (>10MB)', () => {
      const result = validateMediaFile(makeFile('huge.gif', 'image/gif', 11 * 1024 * 1024));
      expect(result).toContain('too large');
    });

    it('accepts GIF at exactly 10MB', () => {
      expect(validateMediaFile(makeFile('max.gif', 'image/gif', 10 * 1024 * 1024))).toBeNull();
    });
  });

  describe('WebP support', () => {
    it('accepts WebP images', () => {
      expect(validateMediaFile(makeFile('photo.webp', 'image/webp', 1_000_000))).toBeNull();
    });
  });

  describe('video types', () => {
    it('accepts MOV/QuickTime', () => {
      expect(validateMediaFile(makeFile('clip.mov', 'video/quicktime', 50_000_000))).toBeNull();
    });

    it('rejects AVI', () => {
      const result = validateMediaFile(makeFile('clip.avi', 'video/x-msvideo', 1000));
      expect(result).toContain('Unsupported');
    });

    it('rejects MKV', () => {
      const result = validateMediaFile(makeFile('clip.mkv', 'video/x-matroska', 1000));
      expect(result).toContain('Unsupported');
    });

    it('rejects TIFF', () => {
      const result = validateMediaFile(makeFile('photo.tiff', 'image/tiff', 1000));
      expect(result).toContain('Unsupported');
    });

    it('rejects SVG', () => {
      const result = validateMediaFile(makeFile('icon.svg', 'image/svg+xml', 1000));
      expect(result).toContain('Unsupported');
    });
  });

  describe('edge cases', () => {
    it('rejects application/pdf', () => {
      const result = validateMediaFile(makeFile('doc.pdf', 'application/pdf', 1000));
      expect(result).toContain('Unsupported');
    });

    it('rejects text/plain', () => {
      const result = validateMediaFile(makeFile('readme.txt', 'text/plain', 100));
      expect(result).toContain('Unsupported');
    });

    it('rejects empty type', () => {
      const result = validateMediaFile(makeFile('unknown', '', 100));
      expect(result).toContain('Unsupported');
    });

    it('video at exactly 100MB is accepted', () => {
      expect(validateMediaFile(makeFile('max.mp4', 'video/mp4', 100 * 1024 * 1024))).toBeNull();
    });

    it('video at 101MB is rejected', () => {
      const result = validateMediaFile(makeFile('huge.mp4', 'video/mp4', 101 * 1024 * 1024));
      expect(result).toContain('too large');
    });

    it('error message includes file size', () => {
      const result = validateMediaFile(makeFile('big.jpg', 'image/jpeg', 15 * 1024 * 1024));
      expect(result).toContain('15.0MB');
    });
  });
});

describe('isVideoFile', () => {
  it('MP4 is video', () => {
    expect(isVideoFile(makeFile('a.mp4', 'video/mp4', 1))).toBe(true);
  });

  it('WebM is video', () => {
    expect(isVideoFile(makeFile('a.webm', 'video/webm', 1))).toBe(true);
  });

  it('QuickTime is video', () => {
    expect(isVideoFile(makeFile('a.mov', 'video/quicktime', 1))).toBe(true);
  });

  it('JPEG is not video', () => {
    expect(isVideoFile(makeFile('a.jpg', 'image/jpeg', 1))).toBe(false);
  });

  it('GIF is not video', () => {
    expect(isVideoFile(makeFile('a.gif', 'image/gif', 1))).toBe(false);
  });
});

describe('preview URL lifecycle', () => {
  it('createPreviewUrl returns a blob URL', () => {
    const file = makeFile('test.jpg', 'image/jpeg', 100);
    const url = createPreviewUrl(file);
    expect(url).toMatch(/^blob:/);
  });

  it('revokePreviewUrl does not throw', () => {
    const file = makeFile('test.jpg', 'image/jpeg', 100);
    const url = createPreviewUrl(file);
    expect(() => revokePreviewUrl(url)).not.toThrow();
  });

  it('revokePreviewUrl on invalid URL does not throw', () => {
    expect(() => revokePreviewUrl('not-a-valid-url')).not.toThrow();
  });
});
