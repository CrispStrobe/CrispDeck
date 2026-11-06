import type { Account, Platform, UnifiedPost } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';
import { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';
import { normalizePost } from '$lib/api/unified';

export interface ThreadRequest { platform: Platform; uri: string; statusId: string; accountId?: number }
export interface ThreadPage { mainPost: UnifiedPost | null; ancestors: UnifiedPost[]; replies: UnifiedPost[]; externalUrl?: string }

function webUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020]/.test(value)) throw new Error('This post URL is not supported.');
  url.hash = '';
  return url;
}
function threadsUrl(value: string): string | undefined {
  try {
    const url = webUrl(value);
    return url.protocol === 'https:' && ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}

export function parseThreadRequest(params: URLSearchParams): ThreadRequest {
  const uri = params.get('uri') ?? '';
  const statusId = params.get('id') ?? '';
  const rawPlatform = params.get('platform');
  const platform = rawPlatform ?? (uri.startsWith('at://') ? 'bluesky' : uri.startsWith('threads://') || threadsUrl(uri) ? 'threads' : uri ? 'mastodon' : 'bluesky');
  if (platform !== 'bluesky' && platform !== 'mastodon' && platform !== 'threads') throw new Error('This post platform is not supported.');
  const rawAccount = params.get('account');
  if (rawAccount !== null && (!/^[1-9]\d*$/.test(rawAccount) || !Number.isSafeInteger(Number(rawAccount)))) throw new Error('The selected account is not available. Reconnect it in Settings.');
  if (!uri && !statusId) throw new Error('No post URI specified.');
  return { platform, uri, statusId, accountId: rawAccount === null ? undefined : Number(rawAccount) };
}

function selectAccount(request: ThreadRequest, accounts: Account[], clients: Map<number, ClientEntry>): { account: Account; entry: ClientEntry } | undefined {
  const matches = (account: Account) => {
    const entry = clients.get(account.id);
    if (account.platform !== request.platform || entry?.accountId !== account.id || entry.platform !== request.platform || entry.degraded) return false;
    if (request.accountId === undefined && entry.platform === 'bluesky' && !entry.oauthAgent && !(entry.client as BlueskyClient).isAuthenticated()) return false;
    if (request.accountId === undefined && entry.platform === 'mastodon' && !(entry.client as MastodonClient).getAccessToken()) return false;
    return true;
  };
  const account = request.accountId === undefined ? accounts.find(matches) : accounts.find(account => account.id === request.accountId && matches(account));
  if (request.accountId !== undefined && !account) throw new Error('The selected account is not available for this thread. Reconnect it in Settings.');
  return account ? { account, entry: clients.get(account.id)! } : undefined;
}

function camelCase(value: unknown): any {
  if (Array.isArray(value)) return value.map(camelCase);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelCase(item)]));
  return value;
}

export async function loadThreadPage(request: ThreadRequest, accounts: Account[], clients: Map<number, ClientEntry>): Promise<ThreadPage> {
  const selected = selectAccount(request, accounts, clients);
  const result: ThreadPage = { mainPost: null, ancestors: [], replies: [] };
  const normalized = (value: unknown): UnifiedPost => {
    const post = normalizePost(value as any, request.platform);
    if (request.platform === 'mastodon') {
      const status = value as { reblog?: { spoilerText?: string }; spoilerText?: string };
      post.contentWarning = (status.reblog ?? status).spoilerText || undefined;
    }
    return selected ? { ...post, sourceAccountId: selected.account.id, sourceAccount: selected.account.handle } : post;
  };

  if (request.platform === 'bluesky') {
    if (!/^at:\/\/[^/?#]+\/app\.bsky\.feed\.post\/[^/?#]+$/.test(request.uri)) throw new Error('A Bluesky post URI is required.');
    let thread: any;
    if (selected) {
      const client = selected.entry.client as BlueskyClient;
      let agent = selected.entry.oauthAgent;
      if (!agent) {
        await client.login();
        if (!client.isAuthenticated()) throw new Error('Reconnect the selected Bluesky account to view this thread.');
        agent = client.getAgent();
      }
      if (!agent.did || selected.account.did && agent.did !== selected.account.did) throw new Error('Reconnect the selected Bluesky account to view this thread.');
      thread = (await agent.getPostThread({ uri: request.uri, depth: 20, parentHeight: 80 })).data.thread;
    } else {
      thread = await BlueskyClient.readOnly('_').getPostThread(request.uri, 20);
    }
    if (!thread?.post) throw new Error(thread?.$type === 'app.bsky.feed.defs#blockedPost' ? 'This post is blocked for the selected account.' : 'Post not found.');
    result.mainPost = normalized({ post: thread.post });
    let parent = thread.parent;
    const visited = new Set<string>([thread.post.uri]);
    while (parent?.post && !visited.has(parent.post.uri)) {
      visited.add(parent.post.uri); result.ancestors.unshift(normalized({ post: parent.post })); parent = parent.parent;
    }
    function collectReplies(node: any, depth: number) {
      if (depth > 20 || !Array.isArray(node?.replies)) return;
      for (const reply of node.replies) {
        if (reply?.post && !visited.has(reply.post.uri)) {
          visited.add(reply.post.uri); result.replies.push(normalized({ post: reply.post })); collectReplies(reply, depth + 1);
        }
      }
    }
    collectReplies(thread, 0);
    return result;
  }

  if (request.platform === 'threads') {
    result.externalUrl = threadsUrl(request.uri);
    if (!result.externalUrl && selected && /^threads:\/\/\d+$/.test(request.uri)) {
      const post = await (selected.entry.client as ThreadsClient).getPost(request.uri.slice('threads://'.length));
      result.externalUrl = threadsUrl(post.permalink ?? '');
    }
    if (!result.externalUrl) throw new Error('A public Threads post link is required.');
    return result;
  }

  const client = selected?.entry.client as MastodonClient | undefined;
  const targetUrl = request.uri ? webUrl(request.uri) : undefined;
  if (!client && !targetUrl) throw new Error('Select a Mastodon account to open this local status ID.');
  const instance = webUrl(client ? client.getInstanceUrl() : targetUrl!.origin);
  if (instance.pathname !== '/' || instance.search) throw new Error('Reconnect this Mastodon account with its instance URL.');
  const token = client?.getAccessToken();
  if (selected && !token) throw new Error('Reconnect the selected Mastodon account to view this thread.');
  const read = async (path: string, query?: Record<string, string>) => {
    const url = new URL(path, instance.origin);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    const response = await fetch(url.href, { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'error' });
    if (!response.ok) throw new Error(`Could not load this Mastodon thread (${response.status}).`);
    return camelCase(await response.json());
  };
  const samePost = (status: any): boolean => {
    const target = status?.reblog ?? status;
    return [target?.uri, target?.url].some(value => {
      try { return typeof value === 'string' && webUrl(value).href.replace(/\/$/, '') === targetUrl?.href.replace(/\/$/, ''); } catch { return false; }
    });
  };
  let status: any;
  if (request.statusId) {
    if (!/^\d+$/.test(request.statusId)) throw new Error('This Mastodon status ID is not valid.');
    status = await read(`/api/v1/statuses/${request.statusId}`);
    if (targetUrl && !samePost(status)) throw new Error('This local status ID does not match the requested post.');
  } else if (selected) {
    // Resolve on the selected server: a remote URI's numeric suffix is NOT its
    // local status ID, even when a different local status happens to share it.
    const found = await read('/api/v2/search', { q: targetUrl!.href, type: 'statuses', resolve: 'true', limit: '5' });
    status = Array.isArray(found.statuses) ? found.statuses.find(samePost) : undefined;
    if (!status) throw new Error('This post could not be resolved by the selected Mastodon account.');
  } else {
    // Public browsing may read a canonical URL on its own origin. Verify the
    // returned URI/URL so a similarly shaped URL cannot select another post.
    const match = targetUrl!.pathname.match(/^\/(?:@[^/]+|users\/[^/]+\/statuses)\/(\d+)\/?$/);
    if (!match) throw new Error('Connect a Mastodon account to resolve this post URL.');
    status = await read(`/api/v1/statuses/${match[1]}`);
    if (!samePost(status)) throw new Error('This URL does not match the returned Mastodon post.');
  }
  const target = status?.reblog ?? status;
  if (!target?.id || !/^\d+$/.test(String(target.id))) throw new Error('This Mastodon post is unavailable.');
  result.mainPost = normalized(status);
  const context = await read(`/api/v1/statuses/${target.id}/context`);
  result.ancestors = (Array.isArray(context.ancestors) ? context.ancestors : []).map(normalized);
  result.replies = (Array.isArray(context.descendants) ? context.descendants : []).map(normalized);
  return result;
}

/** Avoid exposing credentials or private query strings in a navigation error. */
export function threadErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/https?:\/\/\S+/g, '[URL]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(access_token|app_password|password|token)=\S+/gi, '$1=[redacted]');
}
