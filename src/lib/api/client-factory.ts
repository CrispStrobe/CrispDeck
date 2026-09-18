/**
 * Shared client factory — creates the right client for each account,
 * handling both app-password and OAuth Bluesky accounts.
 */

import { BlueskyClient } from './bluesky';
import { swallow } from '$lib/debug';
import { MastodonClient } from './mastodon';
import { ThreadsClient } from './threads';
import { initBlueskyOAuth } from './bluesky-oauth';
import { listAccounts, getDecryptedCredentials } from '$lib/db';
import { clientCacheGeneration } from './client-cache';
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

export interface InitAllClientsResult {
  accounts: Account[];
  clients: Map<number, ClientEntry>;
}

/**
 * Building the client set means resuming the Bluesky OAuth session and
 * decrypting each account's credentials. That was repeated on every route mount
 * and every 60s from the layout's unread poll, always producing the same
 * clients. The result is cached and reused.
 *
 * The cache is dropped when accounts change (db.ts bumps the generation on
 * add/update/delete) and after TTL_MS, so a session that has been revoked
 * elsewhere is re-resumed rather than held forever.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { generation: number; at: number; result: InitAllClientsResult } | null = null;

/** Drop the cached clients; the next call rebuilds them. */
export function invalidateClients(): void {
  cache = null;
}

/**
 * Initialize clients for all accounts.
 * For Bluesky: tries OAuth session first, falls back to app password.
 * For Mastodon: uses access token.
 *
 * Pass { force: true } to bypass the cache (e.g. after re-authenticating).
 */
export async function initAllClients(options?: { force?: boolean }): Promise<InitAllClientsResult> {
  if (!options?.force && cache &&
      cache.generation === clientCacheGeneration() &&
      Date.now() - cache.at < TTL_MS) {
    return cache.result;
  }
  const built = await buildAllClients();
  cache = { generation: clientCacheGeneration(), at: Date.now(), result: built };
  return built;
}

async function buildAllClients(): Promise<InitAllClientsResult> {
  const accounts = await listAccounts();
  const clients = new Map<number, ClientEntry>();

  // Try to resume a Bluesky OAuth session
  let oauthSession: { did: string; agent: Agent } | null = null;
  try {
    oauthSession = await initBlueskyOAuth();
  } catch (e) { swallow('client-factory.buildAllClients', e); }

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
      try { return (entry.client as BlueskyClient).getAgent(); } catch (e) { swallow('client-factory.getBskyAgent', e); }
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
