/**
 * Pinned posts — pin important posts to the top of feeds/columns.
 * Stored in localStorage.
 */

const STORAGE_KEY = 'crispdeck-pinned-posts';

export interface PinnedPost {
  uri: string;
  text: string;
  authorHandle: string;
  authorName: string;
  platform: string;
  pinnedAt: string;
}

export function listPinnedPosts(): PinnedPost[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function pinPost(post: { uri: string; text: string; author: { handle: string; displayName?: string }; platform: string }): void {
  const pins = listPinnedPosts();
  if (pins.some(p => p.uri === post.uri)) return;
  pins.unshift({
    uri: post.uri,
    text: post.text.substring(0, 200),
    authorHandle: post.author.handle,
    authorName: post.author.displayName ?? post.author.handle,
    platform: post.platform,
    pinnedAt: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  _pinnedUriCache = null; // invalidate cache
}

export function unpinPost(uri: string): void {
  const pins = listPinnedPosts().filter(p => p.uri !== uri);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  _pinnedUriCache = null; // invalidate cache
}

/**
 * Cached pinned URI set — avoids repeated JSON.parse for every Post component.
 * Invalidated on pin/unpin.
 */
let _pinnedUriCache: Set<string> | null = null;

function getPinnedUriSet(): Set<string> {
  if (!_pinnedUriCache) {
    _pinnedUriCache = new Set(listPinnedPosts().map(p => p.uri));
  }
  return _pinnedUriCache;
}

export function isPinned(uri: string): boolean {
  return getPinnedUriSet().has(uri);
}
