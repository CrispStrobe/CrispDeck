import type { Account, Platform } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';

/** Handles can change or be reused. These are the identities authorized to post. */
export type DestinationIdentity =
  | { platform: 'bluesky'; did: string }
  | { platform: 'mastodon'; origin: string; userId: string }
  | { platform: 'threads'; userId: string };

export interface IdentifiedDestination {
  accountId: number;
  platform: Platform;
  handle: string;
  /** Absent only on jobs prepared by older releases. */
  identity?: DestinationIdentity;
}

const cleanHandle = (value: string) => value.trim().replace(/^@/, '').toLowerCase();
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function instanceOrigin(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Reconnect this Mastodon account with its instance URL.');
  }
  return url.origin;
}

export function accountDestinationIdentity(account: Account): DestinationIdentity | undefined {
  if (account.platform === 'bluesky' && account.did?.startsWith('did:')) return { platform: 'bluesky', did: account.did };
  if (account.platform === 'threads' && nonempty(account.threads_user_id)) return { platform: 'threads', userId: account.threads_user_id };
  if (account.platform === 'mastodon' && nonempty(account.mastodon_id) && account.instance_url) {
    return { platform: 'mastodon', origin: instanceOrigin(account.instance_url), userId: account.mastodon_id };
  }
  return undefined;
}

function sameIdentity(expected: DestinationIdentity, actual: DestinationIdentity): boolean {
  if (expected.platform !== actual.platform) return false;
  if (expected.platform === 'bluesky' && actual.platform === 'bluesky') return expected.did === actual.did;
  if (expected.platform === 'mastodon' && actual.platform === 'mastodon') return expected.origin === actual.origin && expected.userId === actual.userId;
  return expected.platform === 'threads' && actual.platform === 'threads' && expected.userId === actual.userId;
}

interface VerifiedIdentity { identity: DestinationIdentity; handle?: string }

/** Verify the authenticated client, rather than trusting the map key or label. */
async function verifyClient(entry: ClientEntry, needHandle: boolean): Promise<VerifiedIdentity> {
  if (entry.degraded) throw new Error('The account session needs to be reconnected.');
  if (entry.platform === 'bluesky') {
    const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
    const did = agent.did ?? (agent as { session?: { did?: string } }).session?.did;
    if (!did?.startsWith('did:')) throw new Error('The Bluesky session has no authenticated identity.');
    if (!needHandle) return { identity: { platform: 'bluesky', did } };
    const profile = (await agent.getProfile({ actor: did })).data;
    if (profile.did !== did || !nonempty(profile.handle)) throw new Error('The Bluesky profile did not match its session.');
    return { identity: { platform: 'bluesky', did }, handle: cleanHandle(profile.handle) };
  }
  if (entry.platform === 'threads') {
    const client = entry.client as ThreadsClient;
    const userId = client.getUserId();
    if (!nonempty(userId)) throw new Error('The Threads session has no user ID.');
    // The configured user ID is the target of every container write. Verify it
    // against the authenticated profile before accepting it for this delivery.
    const profile = await client.getProfile();
    if (String(profile.id) !== userId || !nonempty(profile.username)) throw new Error('The Threads profile did not match its session.');
    return { identity: { platform: 'threads', userId }, handle: cleanHandle(profile.username) };
  }
  const client = entry.client as MastodonClient;
  const origin = instanceOrigin(client.getInstanceUrl());
  const token = client.getAccessToken();
  if (!token) throw new Error('The Mastodon session has no access token.');
  const response = await fetch(new URL('/api/v1/accounts/verify_credentials', origin).href, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
  });
  if (!response.ok) throw new Error(`Could not verify the Mastodon account (${response.status}).`);
  const profile = await response.json() as { id?: string; acct?: string; username?: string };
  const username = profile.acct ?? profile.username;
  if (!nonempty(profile.id) || !nonempty(username)) throw new Error('The Mastodon session returned an incomplete profile.');
  const handle = cleanHandle(username);
  return {
    identity: { platform: 'mastodon', origin, userId: profile.id },
    handle: handle.includes('@') ? handle : `${handle}@${new URL(origin).hostname}`,
  };
}

/** An account missing an ID must prove its current profile before a new job is frozen. */
export async function identifyAccount(account: Account, entry: ClientEntry | undefined): Promise<DestinationIdentity> {
  if (!entry || entry.accountId !== account.id || entry.platform !== account.platform || cleanHandle(entry.handle) !== cleanHandle(account.handle)) {
    throw new Error(`Reconnect ${account.handle} before preparing this delivery.`);
  }
  let verified: VerifiedIdentity;
  try { verified = await verifyClient(entry, true); }
  catch { throw new Error(`Reconnect ${account.handle} before preparing this delivery. Its authenticated identity could not be verified.`); }
  let expectedHandle = cleanHandle(account.handle);
  if (account.platform === 'mastodon') {
    if (!account.instance_url || verified.identity.platform !== 'mastodon' || instanceOrigin(account.instance_url) !== verified.identity.origin) {
      throw new Error(`The connected instance does not match ${account.handle}. Reconnect this account.`);
    }
    if (!expectedHandle.includes('@')) expectedHandle += `@${new URL(verified.identity.origin).hostname}`;
  }
  if (verified.handle !== expectedHandle) throw new Error(`The connected profile does not match ${account.handle}. Reconnect this account.`);
  return verified.identity;
}

/**
 * Reconnects may get a new local ID, but may never change the remote identity.
 * Old jobs have no immutable identity: upgrade only their original local entry,
 * after checking its authenticated profile against the saved full handle.
 */
export async function resolveDestinationClient(destination: IdentifiedDestination, entries: Map<number, ClientEntry>): Promise<ClientEntry> {
  const reconnect = () => new Error(`Reconnect ${destination.handle} in Settings, then retry. The connected account identity could not be verified.`);
  const exact = entries.get(destination.accountId);
  if (!destination.identity) {
    if (!exact || exact.accountId !== destination.accountId || exact.platform !== destination.platform || cleanHandle(exact.handle) !== cleanHandle(destination.handle)) throw reconnect();
    let verified: VerifiedIdentity;
    try { verified = await verifyClient(exact, true); } catch { throw reconnect(); }
    // Without a saved instance, an unqualified Mastodon name cannot establish
    // which server the author originally selected. Leave that legacy job intact.
    if (destination.platform === 'mastodon' && !cleanHandle(destination.handle).includes('@')) throw reconnect();
    if (verified.handle !== cleanHandle(destination.handle)) throw reconnect();
    destination.identity = verified.identity;
    return exact;
  }
  if (destination.identity.platform !== destination.platform) throw reconnect();
  const candidates = [...entries.entries()].filter(([key, entry]) => key === entry.accountId && entry.platform === destination.platform && !entry.degraded);
  candidates.sort(([, a], [, b]) => Number(b === exact) - Number(a === exact));
  for (const [, entry] of candidates) {
    try {
      // A different instance is a different identity even if user IDs coincide.
      if (destination.identity.platform === 'mastodon' && instanceOrigin((entry.client as MastodonClient).getInstanceUrl()) !== destination.identity.origin) continue;
      if (destination.identity.platform === 'threads' && (entry.client as ThreadsClient).getUserId() !== destination.identity.userId) continue;
      const verified = await verifyClient(entry, false);
      if (sameIdentity(destination.identity, verified.identity)) return entry;
    } catch { /* A failed candidate never permits a label-only fallback. */ }
  }
  throw reconnect();
}
