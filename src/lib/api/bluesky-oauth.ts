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

import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';

let oauthClient: BrowserOAuthClient | null = null;

/** Get or create the OAuth client singleton */
export function getOAuthClient(): BrowserOAuthClient {
  if (!oauthClient) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://crispdeck.vercel.app';
    oauthClient = new BrowserOAuthClient({
      clientMetadata: {
        client_id: `${origin}/client-metadata.json`,
        client_name: 'CrispDeck',
        client_uri: origin,
        redirect_uris: [`${origin}/oauth/bsky-callback`],
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
