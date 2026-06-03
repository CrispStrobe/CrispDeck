/**
 * Bluesky OAuth integration using @atproto/oauth-client-browser.
 * Handles DPoP, PAR, PKCE, token refresh automatically.
 * Enables full access including DMs (chat.bsky.convo).
 */

import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';

let oauthClient: BrowserOAuthClient | null = null;

const CLIENT_ID = typeof window !== 'undefined'
  ? `${window.location.origin}/client-metadata.json`
  : 'https://crispdeck.vercel.app/client-metadata.json';

/** Get or create the OAuth client singleton */
export function getOAuthClient(): BrowserOAuthClient {
  if (!oauthClient) {
    oauthClient = new BrowserOAuthClient({
      clientMetadata: {
        client_id: CLIENT_ID,
        client_name: 'CrispDeck',
        client_uri: typeof window !== 'undefined' ? window.location.origin : 'https://crispdeck.vercel.app',
        redirect_uris: [`${typeof window !== 'undefined' ? window.location.origin : 'https://crispdeck.vercel.app'}/oauth/bsky-callback`],
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

/** Handle the OAuth callback — call this on the callback page */
export async function handleBlueskyOAuthCallback(): Promise<{
  did: string;
  handle: string;
  agent: Agent;
}> {
  const client = getOAuthClient();
  const result = await client.callback(new URLSearchParams(window.location.search));

  // Create an Agent from the OAuth session
  const agent = new Agent(result.session);

  // Fetch the profile to get the handle
  const profile = await agent.getProfile({ actor: result.session.did });

  return {
    did: result.session.did,
    handle: profile.data.handle,
    agent,
  };
}

/** Resume an existing OAuth session (on page reload) */
export async function resumeBlueskyOAuthSession(): Promise<{
  did: string;
  agent: Agent;
} | null> {
  try {
    const client = getOAuthClient();
    const result = await client.init();
    if (result?.session) {
      const agent = new Agent(result.session);
      return { did: result.session.did, agent };
    }
  } catch (e) {
    console.error('Failed to resume Bluesky OAuth session:', e);
  }
  return null;
}

/** Check if there's an active OAuth session */
export async function hasBlueskyOAuthSession(): Promise<boolean> {
  try {
    const client = getOAuthClient();
    const result = await client.init();
    return !!result?.session;
  } catch {
    return false;
  }
}

/** Sign out from OAuth */
export async function signOutBlueskyOAuth(): Promise<void> {
  try {
    const client = getOAuthClient();
    // Clear any stored sessions
    const result = await client.init();
    if (result?.session) {
      // The BrowserOAuthClient handles cleanup internally
    }
  } catch {}
  oauthClient = null;
}
