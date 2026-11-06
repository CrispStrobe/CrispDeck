import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImageDimensions } from './image-dimensions';

const file = new File(['image bytes'], 'photo.png', { type: 'image/png' });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('gallery image dimensions', () => {
  it('returns the decoded aspect ratio and releases the bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1800, height: 1200, close }));
    await expect(readImageDimensions(file)).resolves.toEqual({ width: 1800, height: 1200 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an undecodable image instead of inventing a square aspect ratio', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 0, height: 0, close }));
    await expect(readImageDimensions(file)).rejects.toThrow('Could not read the dimensions of photo.png');
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses the browser image decoder when bitmap decoding is unavailable and releases its URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gallery-photo');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.stubGlobal('Image', class {
      naturalWidth = 900; naturalHeight = 1600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    await expect(readImageDimensions(file)).resolves.toEqual({ width: 900, height: 1600 });
    expect(revoke).toHaveBeenCalledWith('blob:gallery-photo');
  });
});
