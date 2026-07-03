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

let oauthClient: BrowserOAuthClient | null = null;

/**
 * The production origin where client-metadata.json is publicly served.
 * AT Protocol OAuth requires the auth server to fetch client_id as a URL.
 * On preview deployments the SPA rewrite or Vercel auth can block this,
 * so we always point client_id to the production origin.
 * Localhost uses the AT Protocol loopback client_id format instead.
 */
const PROD_ORIGIN = 'https://crispdeck.vercel.app';

/** Get or create the OAuth client singleton */
export function getOAuthClient(): BrowserOAuthClient {
  if (!oauthClient) {
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : PROD_ORIGIN;
    const isLocalhost = currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1');

    // For localhost: use AT Protocol loopback client_id (no server fetch needed)
    // For deployed: always use production origin so the auth server can fetch client-metadata.json
    const clientId = isLocalhost
      ? `http://localhost?redirect_uri=${encodeURIComponent(`${currentOrigin}/oauth/bsky-callback`)}&scope=${encodeURIComponent('atproto transition:generic transition:chat.bsky')}`
      : `${PROD_ORIGIN}/client-metadata.json`;

    oauthClient = new BrowserOAuthClient({
      clientMetadata: {
        client_id: clientId,
        client_name: 'CrispDeck',
        client_uri: PROD_ORIGIN,
        redirect_uris: [`${PROD_ORIGIN}/oauth/bsky-callback`],
        scope: 'atproto transition:generic transition:chat.bsky',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      },
      handleResolver: 'https://bsky.social',
    });
  }
  return oauthClient;
}

/** Start the OAuth sign-in flow — redirects the user */
export async function startBlueskyOAuth(handle: string): Promise<void> {
  const client = getOAuthClient();
  await client.signIn(handle, {
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
    const client = getOAuthClient();
    const result = await client.init();

    if (result?.session) {
      const agent = new Agent(result.session);
      return {
        did: result.session.did,
        agent,
      };
    }
  } catch (e) {
    console.error('Bluesky OAuth init failed:', e);
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
  const client = getOAuthClient();
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
  const client = getOAuthClient();
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
