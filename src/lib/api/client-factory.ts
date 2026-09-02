/**
 * Shared client factory — creates the right client for each account,
 * handling both app-password and OAuth Bluesky accounts.
 */

import { BlueskyClient } from './bluesky';
import { MastodonClient } from './mastodon';
import { ThreadsClient } from './threads';
import { initBlueskyOAuth, restoreBlueskyOAuthSession, maybeSilentReauth } from './bluesky-oauth';
import { listAccounts, getDecryptedCredentials } from '$lib/db';
import { Agent } from '@atproto/api';
import type { Account, Platform } from '$lib/types';

export interface ClientEntry {
  accountId: number;
  platform: Platform;
  handle: string;
  client: BlueskyClient | MastodonClient | ThreadsClient;
  /** For OAuth Bluesky accounts — the Agent with full access including DMs */
  oauthAgent?: Agent;
  /**
   * True when this is a Bluesky OAuth account whose session could not be
   * restored during this init, so `client` is a read-only public client.
   * Anything needing auth (home timeline, likes, DMs) is unavailable until a
   * later re-init succeeds — see `retryDegradedClients`.
   */
  degraded?: boolean;
}

// Module-level cache: avoids re-initializing clients when navigating between pages
let _cachedResult: { accounts: Account[]; clients: Map<number, ClientEntry> } | null = null;
let _cacheTime = 0;
let _cacheTtl = 300000; // 5 minutes; shortened when an OAuth restore failed transiently

/**
 * Initialize clients for all accounts.
 * Caches result for 5 minutes to avoid redundant DB reads and login calls
 * when navigating between feed/deck/notifications pages.
 * For Bluesky: tries OAuth session first, falls back to app password.
 * For Mastodon: uses access token.
 */
export async function initAllClients(): Promise<{ accounts: Account[]; clients: Map<number, ClientEntry> }> {
  const now = Date.now();
  if (_cachedResult && now - _cacheTime < _cacheTtl) return _cachedResult;
  const accounts = await listAccounts();
  const clients = new Map<number, ClientEntry>();
  let transientOAuthFailure = false;

  // Process a pending OAuth callback (if the URL has params) and resume the
  // "current" session. Accounts not covered by this are restored by DID below.
  //
  // Only when there is actually an OAuth account to resume. Constructing the
  // client has a side effect on a loopback origin: AT Protocol defines the
  // loopback client in terms of 127.0.0.1, so init() *navigates* a page served
  // from `localhost` to the IP. Doing that on every load bounced the dev server
  // between two origins for everyone, including people with no Bluesky account
  // at all. It also spares everyone else an IndexedDB open they never needed.
  let oauthSession: { did: string; agent: Agent } | null = null;
  // Any Bluesky account is reason enough to try: whether a given one is OAuth
  // or app-password is only knowable after decrypting its credentials, which
  // the loop below does anyway.
  if (accounts.some((a) => a.platform === 'bluesky')) {
    try {
      oauthSession = await initBlueskyOAuth();
    } catch {}
  }

  // Init all accounts in parallel — each app-password login / OAuth restore
  // is a network round-trip, and doing them sequentially delays the first
  // feed fetch by the sum of all of them.
  const entries = await Promise.all(accounts.map(async (acct): Promise<ClientEntry | null> => {
    try {
      const credsJson = await getDecryptedCredentials(acct.id);
      const creds = JSON.parse(credsJson);

      if (acct.platform === 'bluesky') {
        // OAuth accounts: use the already-resumed session if it matches,
        // otherwise restore this account's session directly by DID.
        let oauthAgent: Agent | undefined;
        let oauthDead = false;
        const did = acct.did ?? creds.did;
        if (creds.auth_method === 'oauth' && did) {
          if (oauthSession && oauthSession.did === did) {
            oauthAgent = oauthSession.agent;
          } else {
            const restored = await restoreBlueskyOAuthSession(did);
            if (restored.status === 'ok') {
              oauthAgent = restored.agent;
            } else if (restored.status === 'expired') {
              oauthDead = true;
            } else {
              transientOAuthFailure = true;
            }
          }
        }

        if (oauthAgent) {
          return {
            accountId: acct.id,
            platform: 'bluesky',
            handle: acct.handle,
            client: BlueskyClient.readOnly(acct.handle),
            oauthAgent,
          };
        }
        if (oauthDead && did && (await maybeSilentReauth(acct.handle, did))) {
          // Refresh token is dead but the user likely still has a live
          // bsky.social cookie — silent re-auth redirects and comes back
          // with a fresh session, no user interaction needed.
          // (maybeSilentReauth redirects the page; we won't get here.)
          return null;
        }
        if (creds.app_password) {
          // App password auth
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          return {
            accountId: acct.id,
            platform: 'bluesky',
            handle: acct.handle,
            client,
          };
        }
        // OAuth account but session expired, or no credentials
        // Use read-only client — pages will show appropriate messages
        if (creds.auth_method === 'oauth') {
          console.warn(`OAuth session expired for ${acct.handle}. Reconnect in Settings > Account.`);
        }
        return {
          accountId: acct.id,
          platform: 'bluesky',
          handle: acct.handle,
          client: BlueskyClient.readOnly(acct.handle),
          degraded: creds.auth_method === 'oauth',
        };
      } else if (acct.platform === 'threads') {
        return {
          accountId: acct.id,
          platform: 'threads',
          handle: acct.handle,
          client: new ThreadsClient(creds.access_token, creds.user_id ?? acct.threads_user_id ?? ''),
        };
      } else {
        return {
          accountId: acct.id,
          platform: 'mastodon',
          handle: acct.handle,
          client: new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ),
        };
      }
    } catch (e) {
      console.error(`Failed to init client for ${acct.handle}:`, e);
      return null;
    }
  }));
  // Insert in account order so "first bluesky/mastodon entry" stays deterministic
  for (const entry of entries) {
    if (entry) clients.set(entry.accountId, entry);
  }

  _cachedResult = { accounts, clients };
  _cacheTime = Date.now();
  // A transient OAuth failure must not lock users into a degraded read-only
  // state for 5 minutes — retry on the next navigation instead.
  _cacheTtl = transientOAuthFailure ? 15000 : 300000;
  return _cachedResult;
}

/** Invalidate the client cache (e.g. after adding/removing an account) */
export function invalidateClientCache(): void {
  _cachedResult = null;
  _cacheTime = 0;
}

/** True when any entry fell back to a read-only client despite being an OAuth account. */
export function hasDegradedClients(clients: Map<number, ClientEntry>): boolean {
  for (const entry of clients.values()) {
    if (entry.degraded) return true;
  }
  return false;
}

let _lastDegradedRetry = 0;
const DEGRADED_RETRY_MIN_INTERVAL_MS = 15000;

/**
 * Re-initialize clients when a previous init left an OAuth account degraded.
 *
 * A transient restore failure (network flake, DPoP nonce hiccup) drops the
 * account to a public read-only client for the rest of the page's life, which
 * silently downgrades the home timeline to "your posts only". Calling this
 * before a feed load gives the session a chance to come back without a reload.
 *
 * Rate-limited to one attempt per 15s. Returns the fresh result when a retry
 * ran, or null when there was nothing to retry / the rate limit applied.
 */
export async function retryDegradedClients(
  clients: Map<number, ClientEntry>,
): Promise<{ accounts: Account[]; clients: Map<number, ClientEntry> } | null> {
  if (!hasDegradedClients(clients)) return null;
  const now = Date.now();
  if (now - _lastDegradedRetry < DEGRADED_RETRY_MIN_INTERVAL_MS) return null;
  _lastDegradedRetry = now;
  invalidateClientCache();
  return await initAllClients();
}

/**
 * Get the best Bluesky agent — prefers OAuth (full access), falls back to app password agent.
 */
export function getBskyAgent(clients: Map<number, ClientEntry>): Agent | null {
  for (const entry of clients.values()) {
    if (entry.platform === 'bluesky') {
      if (entry.oauthAgent) return entry.oauthAgent;
      try { return (entry.client as BlueskyClient).getAgent(); } catch {}
    }
  }
  return null;
}

/**
 * Get the Bluesky client for reading (works with both OAuth and app-password).
 */
export function getBskyClient(clients: Map<number, ClientEntry>): BlueskyClient | null {
  for (const entry of clients.values()) {
    if (entry.platform === 'bluesky') return entry.client as BlueskyClient;
  }
  return null;
}

/**
 * Get the Mastodon client.
 */
export function getMastoClient(clients: Map<number, ClientEntry>): MastodonClient | null {
  for (const entry of clients.values()) {
    if (entry.platform === 'mastodon') return entry.client as MastodonClient;
  }
  return null;
}

/**
 * Get the Threads client.
 */
export function getThreadsClient(clients: Map<number, ClientEntry>): ThreadsClient | null {
  for (const entry of clients.values()) {
    if (entry.platform === 'threads') return entry.client as ThreadsClient;
  }
  return null;
}
