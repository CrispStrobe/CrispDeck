/**
 * Tiny synchronous gate shared by lazy feed collection and the search engine.
 * Reading the opt-in flag must not load IndexedDB, tokenization, or import UI.
 */
import { readJson, readString, writeString } from './safe-storage';

export const SEARCH_CACHE_SETTINGS_KEY = 'crispdeck-search-cache-settings';
export const SEARCH_CACHE_GENERATION_KEY = 'crispdeck-search-cache-generation';
let generation = 0;

/** Full policies are validated by the engine after this inexpensive opt-in check. */
export function isSearchCacheEnabled(source?: 'posts' | 'wallabag'): boolean {
  const saved = readJson<unknown>(SEARCH_CACHE_SETTINGS_KEY, null);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  const settings = saved as Record<string, unknown>;
  if (settings.enabled !== true) return false;
  const policy = source ? settings[source] : undefined;
  // Omitted source switches default to true, just as the validated policy does.
  return !policy || typeof policy !== 'object' || (policy as { enabled?: unknown }).enabled !== false;
}

/** Capture before a fetch, including before the optional engine is loaded. */
export function getSearchCacheGeneration(): number {
  const saved = Number(readString(SEARCH_CACHE_GENERATION_KEY));
  if (Number.isSafeInteger(saved) && saved > generation) generation = saved;
  return generation;
}

export function invalidateSearchCacheGeneration(): void {
  generation = getSearchCacheGeneration() + 1;
  // Share the in-memory counter too: blocked storage must not revive a fetch
  // whose callback enters the engine through the lazy facade later.
  writeString(SEARCH_CACHE_GENERATION_KEY, String(generation));
}
