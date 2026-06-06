/**
 * Shared client factory — creates the right client for each account,
 * handling both app-password and OAuth Bluesky accounts.
 */

import { BlueskyClient } from './bluesky';
import { MastodonClient } from './mastodon';
import { ThreadsClient } from './threads';
import { initBlueskyOAuth } from './bluesky-oauth';
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
}

/**
 * Initialize clients for all accounts.
 * For Bluesky: tries OAuth session first, falls back to app password.
 * For Mastodon: uses access token.
 */
export async function initAllClients(): Promise<{ accounts: Account[]; clients: Map<number, ClientEntry> }> {
  const accounts = await listAccounts();
  const clients = new Map<number, ClientEntry>();

  // Try to resume a Bluesky OAuth session
  let oauthSession: { did: string; agent: Agent } | null = null;
  try {
    oauthSession = await initBlueskyOAuth();
  } catch {}

  for (const acct of accounts) {
    try {
      const credsJson = await getDecryptedCredentials(acct.id);
      const creds = JSON.parse(credsJson);

      if (acct.platform === 'bluesky') {
        // Check if this account has an active OAuth session
        if (creds.auth_method === 'oauth' && oauthSession && oauthSession.did === acct.did) {
          // Create a BlueskyClient backed by the OAuth agent for public reads
          // The OAuth agent is used for authenticated operations
          const client = BlueskyClient.readOnly(acct.handle);
          clients.set(acct.id, {
            accountId: acct.id,
            platform: 'bluesky',
            handle: acct.handle,
            client,
            oauthAgent: oauthSession.agent,
          });
        } else if (creds.app_password) {
          // App password auth
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          clients.set(acct.id, {
            accountId: acct.id,
            platform: 'bluesky',
            handle: acct.handle,
            client,
          });
        } else {
          // OAuth account but no active session — use read-only
          const client = BlueskyClient.readOnly(acct.handle);
          clients.set(acct.id, {
            accountId: acct.id,
            platform: 'bluesky',
            handle: acct.handle,
            client,
          });
        }
      } else if (acct.platform === 'threads') {
        const client = new ThreadsClient(creds.access_token, creds.user_id ?? acct.threads_user_id ?? '');
        clients.set(acct.id, {
          accountId: acct.id,
          platform: 'threads',
          handle: acct.handle,
          client,
        });
      } else {
        const client = new MastodonClient(
          acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
          creds.access_token,
        );
        clients.set(acct.id, {
          accountId: acct.id,
          platform: 'mastodon',
          handle: acct.handle,
          client,
        });
      }
    } catch (e) {
      console.error(`Failed to init client for ${acct.handle}:`, e);
    }
  }

  return { accounts, clients };
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
