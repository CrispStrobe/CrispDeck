/**
 * One lazily-loaded handle on @atproto/api, shared by everything that needs it.
 *
 * The SDK is ~221 KB gzipped with zod, multiformats and jose behind it. Taken
 * as a static import it sat in the critical path of every route that talks to
 * Bluesky; taken as a plain dynamic import it moved off that path but started
 * downloading only once the route chunk had loaded and run, which measured 36%
 * SLOWER to first post on a fast connection (963ms -> 1314ms, medians of five)
 * because the browser could no longer fetch it in parallel with the route.
 *
 * So: dynamic, and prefetched. prefetch() starts the download as early as
 * anything knows Bluesky is involved, without making anyone wait for it, which
 * restores the parallelism a static import got for free while keeping the
 * bytes off the path of routes that never make a request.
 */

type AtpModule = typeof import('@atproto/api');

let loaded: AtpModule | null = null;
let pending: Promise<AtpModule> | null = null;

/** Load the SDK, reusing the in-flight import if one is already running. */
export function loadAtprotoSdk(): Promise<AtpModule> {
  if (!pending) {
    pending = import('@atproto/api').then((m) => {
      loaded = m;
      return m;
    });
  }
  return pending;
}

/**
 * Start loading without waiting. Call as soon as it is known the SDK will be
 * wanted; the download then overlaps whatever the caller does next.
 */
export function prefetchAtprotoSdk(): void {
  // Errors are deliberately swallowed: a failed prefetch must not become an
  // unhandled rejection, and the real load will surface the failure properly.
  void loadAtprotoSdk().catch(() => {});
}

/** The module if it is already loaded, for synchronous paths. */
export function atprotoSdkIfLoaded(): AtpModule | null {
  return loaded;
}

type OAuthModule = typeof import('@atproto/oauth-client-browser');

let oauthLoaded: OAuthModule | null = null;
let oauthPending: Promise<OAuthModule> | null = null;

export function loadOAuthSdk(): Promise<OAuthModule> {
  if (!oauthPending) {
    oauthPending = import('@atproto/oauth-client-browser').then((m) => {
      oauthLoaded = m;
      return m;
    });
  }
  return oauthPending;
}

/** Only worth calling once an OAuth account is known to exist. */
export function prefetchOAuthSdk(): void {
  void loadOAuthSdk().catch(() => {});
}

export function oauthSdkIfLoaded(): OAuthModule | null {
  return oauthLoaded;
}
