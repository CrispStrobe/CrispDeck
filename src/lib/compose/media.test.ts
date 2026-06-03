import { describe, it, expect } from 'vitest';
import { validateMediaFile } from './media';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const buffer = new ArrayBuffer(sizeBytes);
  return new File([buffer], name, { type });
}

describe('validateMediaFile', () => {
  it('accepts valid JPEG', () => {
    expect(validateMediaFile(makeFile('photo.jpg', 'image/jpeg', 1024))).toBeNull();
  });

  it('accepts valid PNG', () => {
    expect(validateMediaFile(makeFile('image.png', 'image/png', 2048))).toBeNull();
  });

  it('accepts valid GIF', () => {
    expect(validateMediaFile(makeFile('anim.gif', 'image/gif', 5000))).toBeNull();
  });

  it('accepts valid WebP', () => {
    expect(validateMediaFile(makeFile('photo.webp', 'image/webp', 3000))).toBeNull();
  });

  it('rejects unsupported file type', () => {
    const result = validateMediaFile(makeFile('doc.pdf', 'application/pdf', 1024));
    expect(result).not.toBeNull();
    expect(result).toContain('Unsupported file type');
  });

  it('rejects video files', () => {
    const result = validateMediaFile(makeFile('video.mp4', 'video/mp4', 1024));
    expect(result).toContain('Unsupported file type');
  });

  it('rejects files over 10MB', () => {
    const result = validateMediaFile(makeFile('huge.jpg', 'image/jpeg', 11 * 1024 * 1024));
    expect(result).not.toBeNull();
    expect(result).toContain('too large');
  });

  it('accepts files exactly at 10MB', () => {
    expect(validateMediaFile(makeFile('big.jpg', 'image/jpeg', 10 * 1024 * 1024))).toBeNull();
  });

  it('accepts very small files', () => {
    expect(validateMediaFile(makeFile('tiny.png', 'image/png', 1))).toBeNull();
  });
});
