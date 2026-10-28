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

import type { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { writeString } from '$lib/safe-storage';
import { swallow } from '$lib/debug-log';
import type { Agent } from '@atproto/api';
import { isTauri } from '$lib/platform';
import { getOAuthWindowMode, authorizeInWindow, authorizeInBrowser, BLUESKY_APP_REDIRECT } from '$lib/oauth-window';
// The very document served at this deployment's /client-metadata.json — one
// source of truth for the deployed client's identity. The origin lives in the
// file rather than in a constant here, so a build served from somewhere other
// than the Vercel deployment (scripts/mount-at-base.mjs rewrites it) gets a
// client_id and redirect_uri on its own origin. Pointing at another origin
// would land the user back on that other deployment after signing in.
import clientMetadataJson from '../../../static/client-metadata.json';
import nativeClientMetadataJson from '../../../static/client-metadata-native.json';
import type { OAuthClientMetadataInput } from '@atproto/oauth-types';

/**
 * The OAuth stack and the AT Protocol SDK, loaded on demand.
 *
 * Both were static imports, which put roughly 221 KB gzipped -- the SDK plus
 * zod, multiformats, jose and the OAuth client -- into the static closure of
 * every route that initialises a client, which is all of them. None of it is
 * needed to render a page; it is needed to make a request.
 *
 * The module handles are cached, so concurrent callers share one import.
 */
import { loadAtprotoSdk, loadOAuthSdk, oauthSdkIfLoaded } from './atproto-sdk';

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
  'Bluesky OAuth is not available here. Use an App Password below — ' +
  'everything works except direct messages.';

/**
 * The app's client: a native AT Protocol client whose metadata is published at
 * crispdeck.vercel.app and which returns to the app's URL scheme. Imported at
 * build time for the same reason as the web one. Tokens are bound to the
 * client id, so this must not change once people have signed in with it.
 */
const APP_CLIENT_METADATA = nativeClientMetadataJson as unknown as OAuthClientMetadataInput;

/** Where BrowserOAuthClient keeps the DID of the current session. */
const SESSION_POINTER_KEY = '@@atproto/oauth-client-browser(sub)';

async function createOAuthClient(): Promise<BrowserOAuthClient> {
  if (isTauri()) {
    // The webview's origin (`tauri://localhost`, `http://tauri.localhost`)
    // can neither serve a client-metadata document nor receive a redirect, so
    // the app signs in as a native client instead: the authorization page
    // opens in a sign-in window or the system browser, and the redirect to
    // app.vercel.crispdeck: comes back to the app (see oauth-window.ts).
    const { BrowserOAuthClient } = await loadOAuthSdk();
    return new BrowserOAuthClient({
      clientMetadata: APP_CLIENT_METADATA,
      responseMode: 'query',
      handleResolver: HANDLE_RESOLVER,
      onDelete: renewAfterDeath,
    });
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
    const { BrowserOAuthClient } = await loadOAuthSdk();
    return new BrowserOAuthClient({ handleResolver: HANDLE_RESOLVER });
  }

  // A discoverable client's metadata *is* the document served at its client_id,
  // so use that file itself rather than a second hand-written copy that can
  // drift out of sync with it. Imported at build time, not fetched:
  // restoreBlueskyOAuthSession() goes through here, and making client creation
  // depend on the network would stop a cached PWA from resuming its session
  // offline.
  const { BrowserOAuthClient } = await loadOAuthSdk();
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
  const input = handle.trim() || HANDLE_RESOLVER;
  if (isTauri()) {
    await signInInApp(client, input);
    return;
  }
  await client.signIn(input, {
    signal: new AbortController().signal,
  });
  // This redirects — execution stops here
}

/**
 * Authorize in the app and complete the session in the webview, which holds
 * the state and PKCE verifier. Uses a sign-in window, or the system browser
 * and a deep link back (see oauth-window.ts).
 */
async function authorizeInApp(
  client: BrowserOAuthClient,
  input: string,
  opts: { prompt?: 'none'; hidden?: boolean } = {},
) {
  const url = await client.authorize(input, {
    redirect_uri: BLUESKY_APP_REDIRECT,
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
  });
  let query: string | null = null;
  if (opts.hidden || getOAuthWindowMode() === 'window') {
    try {
      query = await authorizeInWindow(url.href, BLUESKY_APP_REDIRECT, { hidden: opts.hidden });
    } catch (e) {
      if (opts.hidden || !String(e).includes('could not open the sign-in window')) {
        await client.abortRequest(url).catch(() => {});
        throw e;
      }
    }
  }
  query ??= await authorizeInBrowser(url.href, BLUESKY_APP_REDIRECT);
  const { session } = await client.callback(new URLSearchParams(query), {
    redirect_uri: BLUESKY_APP_REDIRECT,
  });
  writeString(SESSION_POINTER_KEY, session.sub);
  return session;
}

/** Interactive sign-in in the app, landing on the page that stores the account. */
async function signInInApp(client: BrowserOAuthClient, input: string): Promise<void> {
  await authorizeInApp(client, input);
  const { goto } = await import('$app/navigation');
  const { base } = await import('$app/paths');
  await goto(`${base}/oauth/bsky-callback`);
}

/**
 * The app's automatic re-login for a session whose refresh token died.
 *
 * Runs `prompt=none` in a hidden sign-in window. The window shares the app's
 * cookie store, so while Bluesky still remembers the user from the last
 * sign-in it answers with a fresh code and nobody sees anything. When it
 * would need the user (login_required), this resolves null and the account
 * falls back to the usual "reconnect in Settings" state.
 *
 * Guarded like maybeSilentReauth: at most one attempt per DID per 30 minutes.
 * Not on mobile, where there is no hidden window to use. Runs at startup
 * (client-factory) and whenever a session dies mid-use (renewAfterDeath).
 */
export function silentReauthInApp(handleOrDid: string, did: string): Promise<Agent | null> {
  if (!isTauri() || getOAuthWindowMode() !== 'window') return Promise.resolve(null);
  // A session that dies mid-use and the startup restore can both ask at once;
  // they share one attempt rather than the second being turned away by the
  // guard while the first is still running.
  const inFlight = renewals.get(did);
  if (inFlight) return inFlight;
  const guardKey = `${SILENT_REAUTH_GUARD_PREFIX}${did}`;
  try {
    const last = Number(localStorage.getItem(guardKey) ?? 0);
    if (Date.now() - last < SILENT_REAUTH_MIN_INTERVAL_MS) return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
  writeString(guardKey, String(Date.now()));
  const attempt = (async () => {
    try {
      const client = await getOAuthClient();
      const session = await authorizeInApp(client, handleOrDid, { prompt: 'none', hidden: true });
      if (session.sub !== did) return null;
      const { Agent } = await loadAtprotoSdk();
      return new Agent(session);
    } catch (e) {
      swallow(`bluesky-oauth.silentReauthInApp:${did}`, e);
      return null;
    } finally {
      renewals.delete(did);
    }
  })();
  renewals.set(did, attempt);
  return attempt;
}

const renewals = new Map<string, Promise<Agent | null>>();

/** Fired on window after a session was renewed in the background. */
export const SESSION_RENEWED_EVENT = 'crispdeck:bluesky-session-renewed';

/**
 * The OAuth client's onDelete hook, in the app: a session whose refresh just
 * failed mid-use is renewed in the background instead of waiting for the next
 * launch. Listeners (client-factory) rebuild their clients on the event.
 *
 * Not for a revoked session — the user, or Bluesky, ended that on purpose.
 */
function renewAfterDeath(sub: string, cause: unknown): void {
  const name = cause instanceof Error ? cause.name : '';
  if (name !== 'TokenRefreshError' && name !== 'TokenInvalidError') return;
  void silentReauthInApp(sub, sub).then((agent) => {
    if (agent && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SESSION_RENEWED_EVENT, { detail: { did: sub } }));
    }
  });
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
    // init() would look for callback params in the window URL and insist on a
    // loopback http origin; in the app the callback is completed in
    // signInInApp, so only restoring is left to do.
    const result = isTauri() ? await restoreFromPointer(client) : await client.init();

    if (result?.session) {
      const { Agent } = await loadAtprotoSdk();
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
      swallow('bluesky-oauth.init', e);
    }
  }
  return null;
}

async function restoreFromPointer(client: BrowserOAuthClient) {
  let sub: string | null = null;
  try {
    sub = localStorage.getItem(SESSION_POINTER_KEY);
  } catch { /* storage unavailable: no session */ }
  return sub ? { session: await client.restore(sub) } : undefined;
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
  if (!(err instanceof Error)) return false;

  // instanceof against the cached module. Every path that reaches here has
  // already built an OAuth client, so the module is loaded.
  const m = oauthSdkIfLoaded();
  if (
    m &&
    (err instanceof m.TokenRefreshError ||
      err instanceof m.TokenRevokedError ||
      err instanceof m.TokenInvalidError)
  ) {
    return true;
  }

  // AuthMethodUnsatisfiableError is not re-exported by the package index, so
  // it was always matched by name; the other three are listed as a fallback
  // for the case where this is somehow reached before the module loads.
  return (
    err.name === 'AuthMethodUnsatisfiableError' ||
    err.name === 'TokenRefreshError' ||
    err.name === 'TokenRevokedError' ||
    err.name === 'TokenInvalidError'
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
      const { Agent } = await loadAtprotoSdk();
      return { status: 'ok', did: session.did, agent: new Agent(session) };
    } catch (e) {
      if (isSessionDeadError(e)) {
        swallow(`bluesky-oauth.restore:${did}`, e);
        return { status: 'expired' };
      }
      lastErr = e;
    }
  }
  // Transient: the caller retries on the next page load.
  swallow(`bluesky-oauth.restoreTransient:${did}`, lastErr);
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
  } catch (e) { swallow('bluesky-oauth.clearSilentReauthFlag', e); }
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
  // A prompt=none redirect would navigate the app window away; the app's
  // redirect lands in Rust, not in a page. The user reconnects from Settings.
  if (typeof window === 'undefined' || isTauri()) return false;
  const guardKey = `${SILENT_REAUTH_GUARD_PREFIX}${did}`;
  try {
    const last = Number(localStorage.getItem(guardKey) ?? 0);
    if (Date.now() - last < SILENT_REAUTH_MIN_INTERVAL_MS) return false;
    writeString(guardKey, String(Date.now()));
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
      swallow('bluesky-oauth.silentReauth', e);
    }
    return false;
  }
}
