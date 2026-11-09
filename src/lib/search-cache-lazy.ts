/** Keep the optional search engine off the ordinary feed/deck download path. */
import type { UnifiedPost } from './types';
import type { SearchCacheInput } from './search-cache';
import { swallow } from './debug-log';
import { getSearchCacheGeneration, isSearchCacheEnabled } from './search-cache-state';

export { getSearchCacheGeneration, isSearchCacheEnabled } from './search-cache-state';

let ingestion: Promise<typeof import('./search-cache-ingest')> | undefined;
function loadIngestion(): Promise<typeof import('./search-cache-ingest')> {
  return ingestion ??= import('./search-cache-ingest').catch(error => {
    ingestion = undefined;
    throw error;
  });
}

/** Recheck after loading: a clear or settings change can race the import. */
export function queuePostsForSearchCache(posts: UnifiedPost[], generation = getSearchCacheGeneration()): void {
  if (!posts.length || !isSearchCacheEnabled('posts') || generation !== getSearchCacheGeneration()) return;
  void loadIngestion().then(module => {
    if (isSearchCacheEnabled('posts') && generation === getSearchCacheGeneration()) {
      module.queuePostsForSearchCache(posts, generation);
    }
  }).catch(error => swallow('search-cache.lazy.ingest', error));
}

/** RSS already has a text projection; load storage only after opting in. */
export async function cacheSearchItems(inputs: SearchCacheInput[], options: { generation?: number; strict?: boolean } = {}): Promise<number> {
  const generation = options.generation ?? getSearchCacheGeneration();
  if (!inputs.length || !isSearchCacheEnabled() || generation !== getSearchCacheGeneration()) return 0;
  const module = await import('./search-cache');
  if (!isSearchCacheEnabled() || generation !== getSearchCacheGeneration()) return 0;
  return module.cacheSearchItems(inputs, { ...options, generation });
}

/** Explicit source removal still waits for the engine's durable revocation. */
export async function removeSearchCacheScope(scope: string): Promise<void> {
  const module = await import('./search-cache');
  await module.removeSearchCacheScope(scope);
}
