/**
 * Stale-while-revalidate (SWR) cache for views.
 *
 * Shows cached data instantly on page load, then refreshes from API in the background.
 * Cached data stored in localStorage with a per-view key and timestamp.
 * TTL determines when cached data is considered stale (still shown, but triggers refresh).
 */

import { writeString, removeKey } from './safe-storage';

const PREFIX = 'crispdeck-vc-';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const memory = new Map<string, { raw: string; entry: CacheEntry<unknown> }>();
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key === null) memory.clear();
  else if (event.key.startsWith(PREFIX)) memory.delete(event.key.slice(PREFIX.length));
});

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

/**
 * Get cached data for a view. Returns null if nothing cached.
 */
export function getCached<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) { memory.delete(key); return null; }
    const found = memory.get(key);
    if (found?.raw === raw) return found.entry as CacheEntry<T>;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !Object.hasOwn(entry, 'data') || typeof entry.cachedAt !== 'number' || !Number.isFinite(entry.cachedAt)) {
      memory.delete(key);
      return null;
    }
    memory.set(key, { raw, entry });
    return entry;
  } catch {
    return null;
  }
}

/**
 * Store data in the view cache.
 */
export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    // Feeds include large raw provider responses. Serialize once for both
    // persistent storage and the in-memory comparison.
    const raw = JSON.stringify(entry);
    if (writeString(PREFIX + key, raw)) memory.set(key, { raw, entry });
  } catch {
    // localStorage full or quota exceeded — silently skip
  }
}

/**
 * Check if cached data is stale (older than TTL).
 */
export function isStale(entry: CacheEntry<any>, ttl = DEFAULT_TTL): boolean {
  return Date.now() - entry.cachedAt > ttl;
}

/**
 * Remove cached data for a view.
 */
export function clearCache(key: string): void {
  memory.delete(key);
  removeKey(PREFIX + key);
}

/**
 * Remove all view cache entries.
 */
export function clearAllCache(): void {
  memory.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) removeKey(k);
  } catch {
    // A blocked cache must not break account switching; memory is cleared.
  }
}

/**
 * SWR helper: returns cached data immediately (or null), then calls the fetcher.
 * The caller should:
 *   1. Show cached data if available (instant render)
 *   2. Call the fetcher to get fresh data
 *   3. Update the view when fresh data arrives
 *
 * Usage:
 *   const { cached, refresh } = swr('feed-timeline', () => fetchTimeline());
 *   if (cached) posts = cached;
 *   const fresh = await refresh();
 *   posts = fresh;
 */
export function swr<T>(key: string, fetcher: () => Promise<T>, ttl = DEFAULT_TTL): {
  cached: T | null;
  isStale: boolean;
  refresh: () => Promise<T>;
} {
  const entry = getCached<T>(key);
  const stale = entry ? isStale(entry, ttl) : true;

  return {
    cached: entry?.data ?? null,
    isStale: stale,
    refresh: async () => {
      const data = await fetcher();
      setCache(key, data);
      return data;
    },
  };
}
