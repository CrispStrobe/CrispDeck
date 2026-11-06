import { streamManager, type StreamEvent } from './streaming';
import { mastodonStreamFor } from './deck-streaming';
import { columnAccounts } from './deck-accounts';
import { parseKeywords, buildKeywordMatcher } from './keyword-monitor';
import type { DeckColumnConfig } from './deck-layouts';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';
import type { BlueskyClient } from './api/bluesky';
import type { MastodonClient } from './api/mastodon';
import { swallow } from './debug-log';

const following = new Map<number, { expires: number; value: Promise<Set<string>> }>();

async function followedDids(account: Account, entry: ClientEntry): Promise<Set<string>> {
  const cached = following.get(account.id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = (async () => {
    const dids = new Set<string>(account.did ? [account.did] : []);
    let cursor: string | undefined;
    const visited = new Set<string>();
    do {
      const result = entry.oauthAgent
        ? (await entry.oauthAgent.api.app.bsky.graph.getFollows({ actor: account.did ?? account.handle, limit: 100, cursor })).data
        : await (entry.client as BlueskyClient).getFollows(account.did ?? account.handle, cursor);
      for (const actor of result.follows) dids.add(actor.did);
      cursor = result.cursor;
      if (cursor && visited.has(cursor)) break;
      if (cursor) visited.add(cursor);
    } while (cursor);
    return dids;
  })();
  following.set(account.id, { expires: Date.now() + 300_000, value });
  try { return await value; } catch (error) { following.delete(account.id); throw error; }
}

/** Jetstream contains the whole network. It is a refresh signal, never a feed. */
export function matchesBlueskyColumn(column: DeckColumnConfig, event: StreamEvent, accountDid?: string | null, dids = new Set<string>()): boolean {
  if (event.type === 'delete') return true;
  if (event.type !== 'new-post') return false;
  const payload = event.payload;
  if (column.type === 'keyword-monitor') return buildKeywordMatcher(parseKeywords(column.query ?? ''))(payload.record?.text ?? '');
  if (column.type === 'timeline' || column.type === 'user') return dids.has(payload.did);
  if (column.type === 'mentions' && accountDid) {
    return payload.record?.reply?.parent?.uri?.startsWith(`at://${accountDid}/`) ||
      (payload.record?.facets ?? []).some((facet: any) => (facet.features ?? []).some((feature: any) => feature.$type === 'app.bsky.richtext.facet#mention' && feature.did === accountDid));
  }
  return false;
}

export function subscribeDeckColumn(column: DeckColumnConfig, accounts: Account[], clients: Map<number, ClientEntry>, onEvent: (event: StreamEvent, accountId: number) => void, onReady: (ready: boolean) => void): () => void {
  let disposed = false;
  const cleanups: (() => void)[] = [];
  if (column.paused || column.streaming === false) return () => {};
  for (const account of columnAccounts(column, accounts)) {
    const entry = clients.get(account.id);
    if (!entry || entry.degraded) continue;
    if (account.platform === 'mastodon') {
      const spec = column.type === 'keyword-monitor' ? { streamType: 'public' } : mastodonStreamFor(column.type, column.query);
      if (!spec) continue;
      const client = entry.client as MastodonClient;
      const token = client.getAccessToken();
      if (!token) continue;
      const matches = column.type === 'keyword-monitor' ? buildKeywordMatcher(parseKeywords(column.query ?? '')) : null;
      cleanups.push(streamManager.enableColumn({ columnId: `${column.id}:${account.id}`, platform: 'mastodon', instanceUrl: client.getInstanceUrl(), accessToken: token, ...spec }, event => {
        if (disposed) return;
        if (event.type === 'delete') { onEvent(event, account.id); return; }
        if (column.type === 'notifications' || column.type === 'mentions') {
          if (event.type !== 'notification' || (column.type === 'mentions' && event.payload.type !== 'mention')) return;
        } else if (event.type === 'notification') return;
        if (matches && !matches(event.payload.content ?? '')) return;
        if (column.type === 'user') {
          const handle = String(event.payload.account?.acct ?? '').toLowerCase().replace(/^@/, '');
          const query = column.query?.toLowerCase().replace(/^@/, '') ?? '';
          if (handle !== query && `${handle}@${new URL(client.getInstanceUrl()).hostname}` !== query) return;
        }
        onEvent(event, account.id);
      }));
      onReady(true);
    } else if (account.platform === 'bluesky' && ['timeline', 'user', 'mentions', 'keyword-monitor'].includes(column.type)) {
      const prepare = async () => {
        let dids = new Set<string>();
        if (column.type === 'timeline') dids = await followedDids(account, entry);
        if (column.type === 'user') {
          const profile = entry.oauthAgent
            ? (await entry.oauthAgent.api.app.bsky.actor.getProfile({ actor: column.query!.replace(/^@/, '') })).data
            : await (entry.client as BlueskyClient).getProfile(column.query!.replace(/^@/, ''));
          dids.add(profile.did);
        }
        if (disposed) return;
        cleanups.push(streamManager.enableColumn({ columnId: `${column.id}:${account.id}`, platform: 'bluesky', firehose: true }, event => {
          if (!disposed && matchesBlueskyColumn(column, event, account.did, dids)) onEvent(event, account.id);
        }));
        onReady(true);
      };
      void prepare().catch(error => swallow('deck.liveSetup', error));
    }
  }
  return () => { disposed = true; for (const cleanup of cleanups) cleanup(); onReady(false); };
}
