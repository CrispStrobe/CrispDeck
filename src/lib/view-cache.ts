/**
 * Stale-while-revalidate (SWR) cache for views.
 *
 * Shows cached data instantly on page load, then refreshes from API in the background.
 * Cached data stored in localStorage with a per-view key and timestamp.
 * TTL determines when cached data is considered stale (still shown, but triggers refresh).
 */

const PREFIX = 'crispdeck-vc-';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

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
    if (!raw) return null;
    return JSON.parse(raw);
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
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
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
  localStorage.removeItem(PREFIX + key);
}

/**
 * Remove all view cache entries.
 */
export function clearAllCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
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
