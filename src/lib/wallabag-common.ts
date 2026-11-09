/** Invalidate reader availability/content; this never signals readiness. */
export const WALLABAG_CONNECTION_CHANGED = 'crispdeck:wallabag-connection-changed';

export class WallabagError extends Error {
  constructor(message: string, readonly authenticationFailed = false) { super(message); }
}

/** Shared URL validation without loading credential storage or the API client. */
export function normalizeWallabagServer(value: string): string {
  try {
    const trimmed = value.trim();
    if (trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error();
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new WallabagError('Wallabag requires HTTPS');
    return url.href.replace(/\/+$/, '');
  } catch (error) {
    if (error instanceof WallabagError) throw error;
    throw new WallabagError('Invalid Wallabag server URL');
  }
}
