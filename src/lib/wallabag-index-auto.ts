/** Incremental Wallabag refresh for an explicitly enabled local index.
 * A successful manual sync establishes the checkpoint; this never starts a
 * full historical download on its own. Remote deletions have no API tombstone.
 */
import { get } from 'svelte/store';
import { wallabagAvailability } from './wallabag-availability';
import { isSearchCacheEnabled } from './search-cache-state';

const intervalMs = 10 * 60_000;
export function startWallabagIndexUpdates(): () => void {
  let stopped = false;
  let active: AbortController | undefined;
  const run = async () => {
    if (stopped || active || document.hidden || !navigator.onLine ||
        get(wallabagAvailability).status !== 'ready' || !isSearchCacheEnabled('wallabag')) return;
    const controller = new AbortController(); active = controller;
    try {
      const work = async () => {
        if (stopped || controller.signal.aborted) return;
        const { syncWallabagSearchCache } = await import('./search-cache-ingest');
        await syncWallabagSearchCache({ incremental: true, signal: controller.signal });
      };
      await work();
    } catch { /* Retain the last good index; the next interval retries. */ }
    finally { if (active === controller) active = undefined; }
  };
  const timer = setInterval(() => { void run(); }, intervalMs);
  const initial = setTimeout(() => { void run(); }, 10_000);
  const online = () => { void run(); };
  const visibility = () => { if (!document.hidden) void run(); };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    stopped = true; active?.abort(); clearTimeout(initial); clearInterval(timer);
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', visibility);
  };
}
