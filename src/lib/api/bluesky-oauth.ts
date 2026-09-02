/**
 * Bluesky OAuth integration using @atproto/oauth-client-browser.
 * Handles DPoP, PAR, PKCE, token refresh automatically.
 * Enables full access including DMs (chat.bsky.convo).
 *
 * Works in both:
 * - Browser (Vercel): uses window.location.origin as client_id base
 * - Tauri desktop: uses http://localhost:1420 (dev) — AT Protocol allows
 *   loopback redirect URIs for native/desktop apps
 * - Sessions stored in IndexedDB, persist across reloads
 */

import {
  BrowserOAuthClient,
  TokenRefreshError,
  TokenRevokedError,
  TokenInvalidError,
} from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';
import { isTauri } from '$lib/platform';
// The very document served at PROD_ORIGIN/client-metadata.json — one source of
// truth for the deployed client's identity.
import clientMetadataJson from '../../../static/client-metadata.json';
import type { OAuthClientMetadataInput } from '@atproto/oauth-types';

/**
 * A JSON import widens every literal — `string[]` where the schema wants a
 * non-empty tuple, `string` where it wants a union — so the shape has to be
 * asserted. The document is the contract regardless: it is what the
 * authorization server fetches from client_id, and BrowserOAuthClient
 * validates it at construction. bluesky-oauth.test.ts checks the fields this
 * code actually depends on.
 */
const DEPLOYED_CLIENT_METADATA = clientMetadataJson as unknown as OAuthClientMetadataInput;

let oauthClientPromise: Promise<BrowserOAuthClient> | null = null;

/**
 * The production origin where client-metadata.json is publicly served.
 * AT Protocol OAuth requires the auth server to fetch client_id as a URL.
 * On preview deployments the SPA rewrite or Vercel auth can block this,
 * so we always point client_id to the production origin.
 * Localhost uses the AT Protocol loopback client_id format instead.
 */
const PROD_ORIGIN = 'https://crispdeck.vercel.app';

/** Entryway used to resolve handles, and to sign in when no handle is given. */
const HANDLE_RESOLVER = 'https://bsky.social';

/** Hosts AT Protocol accepts for the loopback (development) client. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Thrown, rather than returning a client that cannot work, when running inside
 * the Tauri webview. Callers surface `.message` to the user.
 */
export class OAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthUnavailableError';
  }
}

/** Message shown when OAuth cannot be offered. Exported so the UI can pre-empt it. */
export const OAUTH_UNAVAILABLE_IN_APP =
  'Bluesky OAuth is not available in the desktop and mobile apps yet: the ' +
  'sign-in redirect has nowhere to land inside the app window. Use an App ' +
  'Password below — everything works except direct messages.';

async function createOAuthClient(): Promise<BrowserOAuthClient> {
  if (isTauri()) {
    // The webview's origin is `tauri://localhost` (or `http://tauri.localhost`
    // on Windows/Android). Neither can serve a client-metadata document for the
    // authorization server to fetch, and the loopback client the library would
    // otherwise build immediately navigates to `http://127.0.0.1/` — which in a
    // packaged app is a blank window rather than a dev server, so offering it
    // would break the app rather than just fail.
    //
    // The sanctioned native flow (open the system browser, catch the callback
    // on a loopback HTTP server) is buildable here — auth_wait_for_callback
    // already does exactly that for Mastodon — but it is Rust work, not a
    // frontend fix.
    throw new OAuthUnavailableError(OAUTH_UNAVAILABLE_IN_APP);
  }

  const loopback =
    typeof window !== 'undefined' && isLoopbackHost(window.location.hostname);

  if (loopback) {
    // Deliberately no `clientMetadata`: the library derives the loopback client
    // id and its metadata from window.location. Handing it an object instead
    // runs that object through the *deployed* client schema, which requires an
    // https URL with a path component — which is why a hand-built
    // `http://localhost?redirect_uri=…` produced exactly two errors,
    // "URL must use the https: protocol" and "ClientID must contain a path
    // component", and left every Bluesky sign-in button doing nothing on any
    // localhost origin.
    //
    // Note the library will bounce a `localhost` page to `127.0.0.1` on init:
    // AT Protocol's loopback client is defined in terms of the IP, not the
    // name. Browse the dev server on 127.0.0.1 to avoid the hop.
    return new BrowserOAuthClient({ handleResolver: HANDLE_RESOLVER });
  }

  // A discoverable client's metadata *is* the document served at its client_id,
  // so use that file itself rather than a second hand-written copy that can
  // drift out of sync with it. Imported at build time, not fetched:
  // restoreBlueskyOAuthSession() goes through here, and making client creation
  // depend on the network would stop a cached PWA from resuming its session
  // offline.
  return new BrowserOAuthClient({
    clientMetadata: DEPLOYED_CLIENT_METADATA,
    handleResolver: HANDLE_RESOLVER,
  });
}

/** Get or create the OAuth client singleton. */
export function getOAuthClient(): Promise<BrowserOAuthClient> {
  // Memoize the promise, not the client, so concurrent callers share one
  // metadata fetch — but drop it again on failure so a transient network error
  // does not poison every later attempt.
  oauthClientPromise ??= createOAuthClient().catch((err) => {
    oauthClientPromise = null;
    throw err;
  });
  return oauthClientPromise;
}

/** Start the OAuth sign-in flow — redirects the user */
export async function startBlueskyOAuth(handle: string): Promise<void> {
  const client = await getOAuthClient();
  // signIn() resolves an identity, so an empty string is not "let the user
  // type it on Bluesky's page" — it is an unresolvable handle, and it threw
  // `Failed to resolve identity:` with nothing after the colon. Signing in
  // against the entryway is what sends someone to Bluesky's own login form.
  await client.signIn(handle.trim() || HANDLE_RESOLVER, {
    signal: new AbortController().signal,
  });
  // This redirects — execution stops here
}

/**
 * Initialize the OAuth client — handles BOTH:
 * 1. Processing the callback (if current URL has OAuth params)
 * 2. Resuming an existing session (on subsequent page loads)
 *
 * Returns session info if available, null otherwise.
 */
export async function initBlueskyOAuth(): Promise<{
  did: string;
  agent: Agent;
} | null> {
  try {
    const client = await getOAuthClient();
    const result = await client.init();

    if (result?.session) {
      const agent = new Agent(result.session);
      return {
        did: result.session.did,
        agent,
      };
    }
  } catch (e) {
    // Not being able to offer OAuth at all (the Tauri webview) is a fact about
    // the platform, not a failure worth logging on every launch.
    if (!(e instanceof OAuthUnavailableError)) {
      console.error('Bluesky OAuth init failed:', e);
    }
  }
  return null;
}

/** Check if there's an active OAuth session */
export async function hasBlueskyOAuthSession(): Promise<boolean> {
  const result = await initBlueskyOAuth();
  return result !== null;
}

/** Resume an existing session (alias for init) */
export const resumeBlueskyOAuthSession = initBlueskyOAuth;

/**
 * True when an error means the session is permanently dead (refresh token
 * revoked/expired/invalid) and only an interactive or silent re-auth can fix it.
 * Anything else (network flake, timeout, DPoP nonce hiccup) is transient —
 * the tokens in IndexedDB are still good and a retry will succeed.
 */
export function isSessionDeadError(err: unknown): boolean {
  return (
    err instanceof TokenRefreshError ||
    err instanceof TokenRevokedError ||
    err instanceof TokenInvalidError ||
    // Not re-exported by the package index, so match by name
    (err instanceof Error && err.name === 'AuthMethodUnsatisfiableError')
  );
}

export type OAuthRestoreResult =
  | { status: 'ok'; did: string; agent: Agent }
  | { status: 'expired' } // refresh token dead — needs (silent) re-auth
  | { status: 'unavailable' }; // transient failure — do NOT treat as logged out

/**
 * Restore an OAuth session directly by DID (the `sub` of the stored session).
 *
 * This bypasses a footgun in BrowserOAuthClient.init(): init() locates the
 * session via a localStorage pointer that the library deletes on ANY restore
 * error — including transient network failures — even though the (still valid)
 * tokens remain in IndexedDB. Restoring by DID finds those tokens regardless,
 * and on success the library re-writes the localStorage pointer, healing it.
 *
 * Retries transient failures; token refresh happens automatically when the
 * access token is stale.
 */
export async function restoreBlueskyOAuthSession(did: string): Promise<OAuthRestoreResult> {
  let client: BrowserOAuthClient;
  try {
    client = await getOAuthClient();
  } catch (e) {
    // 'unavailable' rather than 'expired': the stored tokens may be perfectly
    // good, this build just cannot use them, and 'expired' would trigger a
    // silent re-auth redirect that cannot complete either.
    if (e instanceof OAuthUnavailableError) return { status: 'unavailable' };
    throw e;
  }
  const delays = [0, 500, 1500];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const session = await client.restore(did);
      return { status: 'ok', did: session.did, agent: new Agent(session) };
    } catch (e) {
      if (isSessionDeadError(e)) {
        console.warn(`Bluesky OAuth session for ${did} is no longer valid:`, e);
        return { status: 'expired' };
      }
      lastErr = e;
    }
  }
  console.warn(`Bluesky OAuth restore for ${did} failed transiently (will retry soon):`, lastErr);
  return { status: 'unavailable' };
}

const SILENT_REAUTH_GUARD_PREFIX = 'crispdeck-bsky-silent-reauth:';
const SILENT_REAUTH_INFLIGHT = 'crispdeck-bsky-silent-reauth-inflight';
export const OAUTH_RETURN_TO_KEY = 'crispdeck-oauth-return-to';
const SILENT_REAUTH_MIN_INTERVAL_MS = 30 * 60 * 1000;

/** True if the current page load is the result of a silent re-auth redirect */
export function wasSilentReauthAttempt(): boolean {
  try {
    return sessionStorage.getItem(SILENT_REAUTH_INFLIGHT) === '1';
  } catch {
    return false;
  }
}

export function clearSilentReauthFlag(): void {
  try {
    sessionStorage.removeItem(SILENT_REAUTH_INFLIGHT);
  } catch {}
}

/**
 * Attempt a silent re-authentication (`prompt=none`) for a dead session.
 * While the user's bsky.social cookie session is alive, this round-trips
 * through the authorization server and back without any user interaction,
 * yielding a brand-new token set — so users never see a login screen.
 *
 * Redirects the page when attempted. Returns false (without redirecting)
 * when a guard is active: at most one attempt per DID per 30 minutes, so a
 * truly logged-out user isn't stuck in a redirect loop.
 */
export async function maybeSilentReauth(handleOrDid: string, did: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const guardKey = `${SILENT_REAUTH_GUARD_PREFIX}${did}`;
  try {
    const last = Number(localStorage.getItem(guardKey) ?? 0);
    if (Date.now() - last < SILENT_REAUTH_MIN_INTERVAL_MS) return false;
    localStorage.setItem(guardKey, String(Date.now()));
    sessionStorage.setItem(SILENT_REAUTH_INFLIGHT, '1');
    sessionStorage.setItem(OAUTH_RETURN_TO_KEY, window.location.pathname + window.location.search);
  } catch {
    return false;
  }
  let client: BrowserOAuthClient;
  try {
    client = await getOAuthClient();
  } catch {
    return false;
  }
  try {
    await client.signIn(handleOrDid, { prompt: 'none' });
    return true; // unreachable — signIn redirects
  } catch (e) {
    // signIn's promise rejects ~5s after a *successful* redirect starts
    // ("User navigated back" watchdog) — the flag must survive that so the
    // callback page knows this was a silent attempt. Only clear it when
    // authorize() genuinely failed before redirecting.
    if (!String(e).includes('User navigated back')) {
      clearSilentReauthFlag();
      console.warn('Silent Bluesky re-auth could not start:', e);
    }
    return false;
  }
}
