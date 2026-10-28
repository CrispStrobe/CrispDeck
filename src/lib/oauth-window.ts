/**
 * Where the app runs an OAuth authorization page, and how it gets the
 * redirect back. App-only; the web build redirects the page itself.
 *
 * Both services return to the app's own URL scheme, `app.vercel.crispdeck:`
 * (the reverse of crispdeck.vercel.app, which AT Protocol requires of a native
 * client; see static/client-metadata-native.json). No port is ever opened.
 *
 * - 'window' (desktop default): a CrispDeck window of its own. Rust cancels
 *   the redirect before it loads and hands over its query. The window shares
 *   the app's cookies, which is what lets an expired Bluesky session be
 *   renewed silently (see silentReauthInApp).
 * - 'browser': the system browser; the OS hands the redirect to the app as a
 *   deep link. The only option on mobile, and the fallback when the window
 *   cannot be opened — or when the user prefers their own browser (password
 *   manager, existing login).
 */
import { readString, writeString } from '$lib/safe-storage';

export const APP_SCHEME = 'app.vercel.crispdeck';

/** Must match redirect_uris in static/client-metadata-native.json. */
export const BLUESKY_APP_REDIRECT = `${APP_SCHEME}:/oauth/callback`;

/**
 * The app's Mastodon return address. Fixed, so one registration per instance
 * can be reused (see mastodon-app.ts). With `//`, unlike Bluesky's: that is the
 * form Mastodon clients use, and the instance's validator wants a host.
 */
export const MASTODON_APP_REDIRECT = `${APP_SCHEME}://oauth/mastodon`;

export type OAuthWindowMode = 'window' | 'browser';

const MODE_KEY = 'crispdeck-oauth-mode';

/** iPadOS reports itself as a Mac, hence the touch check. */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function getOAuthWindowMode(): OAuthWindowMode {
  if (isMobile()) return 'browser';
  return readString(MODE_KEY) === 'browser' ? 'browser' : 'window';
}

export function setOAuthWindowMode(mode: OAuthWindowMode): void {
  writeString(MODE_KEY, mode);
}

/** Seconds a visible sign-in may take; a hidden one gets far less. */
const INTERACTIVE_TIMEOUT = 300;
const SILENT_TIMEOUT = 20;

/**
 * Open `authUrl` in a sign-in window and resolve with the query string of
 * the redirect to `redirectUri`.
 */
export async function authorizeInWindow(
  authUrl: string,
  redirectUri: string,
  opts: { hidden?: boolean } = {},
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('auth_in_app_window', {
    authUrl,
    redirectPrefix: redirectUri,
    hidden: !!opts.hidden,
    timeoutSecs: opts.hidden ? SILENT_TIMEOUT : INTERACTIVE_TIMEOUT,
  });
}

/**
 * Open `authUrl` in the system browser and resolve with the query string of
 * the deep link back to `redirectUri`. Listens before opening, so the browser
 * cannot come back first.
 */
export async function authorizeInBrowser(authUrl: string, redirectUri: string): Promise<string> {
  const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = new Promise<string>((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('timed out waiting for the sign-in to come back from the browser')),
      INTERACTIVE_TIMEOUT * 1000,
    );
    onOpenUrl((urls) => {
      const hit = urls.find((u) => u.startsWith(redirectUri));
      if (hit) resolve(queryOf(hit));
    }).then((u) => { unlisten = u; }, reject);
  });
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(authUrl);
    return await query;
  } finally {
    clearTimeout(timer);
    unlisten?.();
  }
}

/** The query of a redirect URL; custom-scheme URLs do not all parse as URL. */
export function queryOf(url: string): string {
  const i = url.indexOf('?');
  if (i < 0) return '';
  const hash = url.indexOf('#', i);
  return url.slice(i + 1, hash < 0 ? undefined : hash);
}
