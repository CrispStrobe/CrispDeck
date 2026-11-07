import type { UnifiedPost } from './types';
import type { ClientEntry } from './api/client-factory';
import type { BlueskyClient } from './api/bluesky';
import type { MastodonClient } from './api/mastodon';
import type { ThreadsClient } from './api/threads';

type ActionReceipt = { active: boolean; uri?: string };
// A post may appear in more than one column. Queue by authenticated client and
// post/action so an undo waits for the record URI returned by its pending like.
const pending = new WeakMap<ClientEntry, Map<string, Promise<ActionReceipt>>>();

/** Act as the account which fetched the row. Never retry as another identity. */
export async function performDeckAction(post: UnifiedPost, action: 'like' | 'repost', active: boolean, clients: Map<number, ClientEntry>, allowedAccountIds: number[]): Promise<void> {
  const candidates = allowedAccountIds.map(id => clients.get(id)).filter((entry): entry is ClientEntry => !!entry && entry.platform === post.platform);
  const entry = post.sourceAccountId !== undefined
    ? candidates.find(candidate => candidate.accountId === post.sourceAccountId)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!entry || entry.degraded) throw new Error('The source account is unavailable. Reconnect it or choose an account in column settings.');
  let queue = pending.get(entry);
  if (!queue) { queue = new Map(); pending.set(entry, queue); }
  const key = `${post.uri}:${action}`;
  const previous = queue.get(key);
  const task = previous
    ? previous.catch(() => undefined).then(receipt => executeAction(post, action, active, entry, receipt))
    : executeAction(post, action, active, entry);
  queue.set(key, task);
  try { await task; }
  finally { if (queue.get(key) === task) queue.delete(key); }
}

async function executeAction(post: UnifiedPost, action: 'like' | 'repost', active: boolean, entry: ClientEntry, previous?: ActionReceipt): Promise<ActionReceipt> {
  const raw = post.raw as any;
  if (post.platform === 'bluesky') {
    const record = raw?.post ?? raw;
    if (!record?.uri || !record.cid) throw new Error('The post could not be resolved for this account. Refresh the column.');
    const client = entry.client as BlueskyClient;
    const key = action === 'like' ? 'like' : 'repost';
    let uri = previous ? previous.uri : record.viewer?.[key];
    if (active) {
      if (!uri) {
        const response = entry.oauthAgent
          ? await entry.oauthAgent[action === 'like' ? 'like' : 'repost'](record.uri, record.cid)
          : await client[action === 'like' ? 'like' : 'repost'](record.uri, record.cid);
        uri = response.uri;
      }
    } else if (uri) {
      if (entry.oauthAgent) await entry.oauthAgent[action === 'like' ? 'deleteLike' : 'deleteRepost'](uri);
      else await client[action === 'like' ? 'unlike' : 'unrepost'](uri);
      uri = undefined;
    }
    record.viewer = { ...record.viewer, [key]: uri };
    return { active, uri };
  }
  if (post.platform === 'mastodon') {
    const id = raw?.reblog?.id ?? raw?.id;
    if (!id) throw new Error('The post could not be resolved for this account. Refresh the column.');
    const client = entry.client as MastodonClient;
    if (previous?.active !== active) {
      if (action === 'like') await (active ? client.favourite(id) : client.unfavourite(id));
      else await (active ? client.reblog(id) : client.unreblog(id));
    }
    const target = raw.reblog ?? raw;
    target[action === 'like' ? 'favourited' : 'reblogged'] = active;
    return { active };
  }
  if (post.platform === 'threads') {
    if (!raw?.id) throw new Error('The post could not be resolved for this account. Refresh the feed.');
    const client = entry.client as ThreadsClient;
    if (action === 'like') {
      if (previous?.active !== active) await (active ? client.like(raw.id) : client.unlike(raw.id));
      raw.favourited = active;
      return { active };
    }
    if (!active) throw new Error('Undoing a Threads repost is not available in CrispDeck.');
    if (previous?.active) {
      raw.reblogged = true;
      return previous;
    }
    const response = await client.repost(raw.id);
    raw.reblogged = true;
    return { active: true, uri: response.id };
  }
  throw new Error('This network does not expose this action to CrispDeck.');
}
