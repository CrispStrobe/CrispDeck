/**
 * Coming back online.
 *
 * There were two pieces of offline state and only one of them reacted to the
 * connection returning. The layout kept an `offline` flag with an `online`
 * listener that cleared it; the feed kept an `offlineBanner` string that
 * nothing cleared. So a PWA user who reconnected went on looking at cached
 * posts under an "Offline" banner until they happened to notice the Retry
 * link — which is a worse failure than showing nothing, because it looks like
 * a working feed that has simply gone quiet.
 *
 * Kept out of the components so the wiring is testable without mounting one.
 */

export interface ConnectionHandlers {
  /** The connection came back. Refresh, and take the banner down. */
  onOnline?: () => void;
  /** The connection went away. */
  onOffline?: () => void;
}

/**
 * Listen for the connection changing. Returns the teardown — call it from
 * `onDestroy`, or the handler outlives the page that registered it.
 */
export function watchConnection(handlers: ConnectionHandlers): () => void {
  // Server-side render, or a test environment without a window.
  if (typeof window === 'undefined') return () => {};

  const online = () => handlers.onOnline?.();
  const offline = () => handlers.onOffline?.();

  window.addEventListener('online', online);
  window.addEventListener('offline', offline);

  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}

/**
 * The banner text for data that came out of a cache, or '' when the data is
 * live and nothing should be shown.
 *
 * `offline` and `cachedAt` are separate questions: data can be stale while
 * online (the refresh failed) and fresh while offline (it just loaded). Only
 * the combination of "we are offline" and "this came from a cache" warrants
 * telling the user their feed is not what is actually out there.
 */
export function cachedDataBanner(
  offline: boolean,
  cachedAt: string | number | null,
  template: string,
  formatTime: (value: string) => string
): string {
  if (!offline || cachedAt == null) return '';
  const iso = typeof cachedAt === 'number' ? new Date(cachedAt).toISOString() : cachedAt;
  if (Number.isNaN(Date.parse(iso))) return '';
  return template.replace('{time}', formatTime(iso));
}
