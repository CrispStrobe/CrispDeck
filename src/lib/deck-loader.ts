import type { Agent, AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api';
import type { mastodon } from 'masto';
import type { Account, UnifiedPost } from './types';
import type { DeckColumnConfig } from './deck-layouts';
import type { ClientEntry } from './api/client-factory';
import type { BlueskyClient } from './api/bluesky';
import type { MastodonClient } from './api/mastodon';
import type { ThreadsClient, ThreadsPost } from './api/threads';
import type { UnifiedNotification } from './notification-grouping';
import { normalizePost } from './api/unified';
import { columnAccounts } from './deck-accounts';
import { requiresQuery } from './deck-columns';
import { fetchJson, fetchOk, safeUrl } from './http';
import { parseKeywords, buildKeywordMatcher } from './keyword-monitor';

/** Missing means the first page; null means this source has been exhausted. */
export type DeckCursors = Record<string, string | null>;

export interface DeckNotification extends UnifiedNotification {
  sourceAccount: string;
  sourceAccountId: number;
}

export interface DeckPage {
  posts: UnifiedPost[];
  notifications?: DeckNotification[];
  cursors: DeckCursors;
  errors: { accountId: number; message: string }[];
  hasMore: boolean;
}

const PAGINATED_TYPES = new Set<string>([
  'timeline', 'my-posts', 'search', 'hashtag', 'tag-group', 'user', 'list',
  'feed', 'local', 'federated', 'likes', 'mentions', 'notifications', 'activity', 'followers',
  'keyword-monitor', 'threads-search',
]);

export function supportsDeckLoader(type: string): boolean {
  return PAGINATED_TYPES.has(type);
}

export function supportsDeckPagination(type: string): boolean {
  return PAGINATED_TYPES.has(type);
}

interface SourcePage {
  posts: UnifiedPost[];
  notifications?: DeckNotification[];
  cursor: string | null;
}

interface DeckSource {
  key: string;
  account: Account;
  column: DeckColumnConfig;
}

/**
 * Load one page from every selected account, without replacing existing posts.
 * The caller owns merging, filtering, and scroll anchoring. Each account (and
 * each tag in a tag group) advances independently, so a failure cannot reset
 * another account to its first page or make a completed source start again.
 */
export async function loadDeckPage(
  column: DeckColumnConfig,
  accounts: Account[],
  clients: Map<number, ClientEntry>,
  cursors?: DeckCursors,
): Promise<DeckPage> {
  if (!supportsDeckLoader(column.type)) throw new Error(`Unsupported deck column: ${column.type}`);

  const selected = columnAccounts(column, accounts);
  const tags = column.type === 'tag-group'
    ? [...new Set((column.query ?? '').split(',').map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean))]
    : [];
  const keywords = column.type === 'keyword-monitor' ? parseKeywords(column.query ?? '') : [];
  const keywordMatcher = column.type === 'keyword-monitor' ? buildKeywordMatcher(keywords) : undefined;
  const searchTerms = [...new Set(keywords.filter(keyword => !keyword.isRegex).map(keyword => keyword.value))];
  const sources: DeckSource[] = selected.flatMap(account => {
    if (column.type === 'tag-group' && tags.length) {
      return tags.map(tag => ({ key: `${account.id}:${tag}`, account, column: { ...column, type: 'hashtag' as const, query: tag } }));
    }
    if (column.type === 'keyword-monitor' && keywords.length) {
      const keywordSources: DeckSource[] = searchTerms.map(term => ({
        key: `${account.id}:keyword:${term}`, account,
        column: { ...column, type: 'search', query: term },
      }));
      if (keywords.some(keyword => keyword.isRegex)) {
        // These APIs do not offer regex search. Backfill from an available
        // timeline, then apply the same matcher used by incoming live posts.
        keywordSources.push({
          key: `${account.id}:regex`, account,
          column: { ...column, type: account.platform === 'threads' ? 'my-posts' : account.platform === 'mastodon' ? 'federated' : 'timeline' },
        });
      }
      return keywordSources;
    }
    return [{ key: String(account.id), account, column }];
  });
  const page: DeckPage = {
    posts: [], cursors: {}, errors: [], hasMore: false,
    ...(['notifications', 'activity', 'followers'].includes(column.type) ? { notifications: [] } : {}),
  };
  // Copy only the current sources. A removed account/tag must not keep the
  // column's "load older" button alive through a stale cursor.
  for (const source of sources) {
    if (cursors && Object.hasOwn(cursors, source.key)) page.cursors[source.key] = cursors[source.key];
  }
  const pending = sources.filter(source => page.cursors[source.key] !== null);
  const results = await Promise.allSettled(pending.map(async source => {
    const entry = clients.get(source.account.id);
    if (!entry || entry.accountId !== source.account.id || entry.platform !== source.account.platform) {
      throw new Error('This account is disconnected. Reconnect it in Settings.');
    }
    if (requiresQuery(source.column.type) && !source.column.query?.trim()) {
      throw new Error('Enter a query for this column.');
    }
    if (source.column.type === 'tag-group') throw new Error('Enter at least one hashtag for this column.');
    if (source.column.type === 'keyword-monitor') throw new Error('Enter at least one keyword for this column.');
    const cursor = page.cursors[source.key] ?? undefined;
    switch (source.account.platform) {
      case 'bluesky': return loadBlueskyPage(source.column, source.account, entry, cursor);
      case 'mastodon': return loadMastodonPage(source.column, source.account, entry.client as MastodonClient, cursor);
      case 'threads': return loadThreadsPage(source.column, source.account, entry.client as ThreadsClient, cursor);
    }
  }));
  for (const [index, result] of results.entries()) {
    const source = pending[index];
    if (result.status === 'fulfilled') {
      page.posts.push(...(keywordMatcher ? result.value.posts.filter(post => keywordMatcher(post.text)) : result.value.posts));
      if (result.value.notifications) page.notifications?.push(...result.value.notifications);
      page.cursors[source.key] = result.value.cursor;
    } else {
      page.errors.push({
        accountId: source.account.id,
        message: safeError(result.reason, clients.get(source.account.id)),
      });
      // Keep the prior cursor, including an absent first-page cursor, for retry.
    }
  }
  page.hasMore = sources.some(source => page.cursors[source.key] !== null);
  return page;
}

function withSource(post: UnifiedPost, account: Account): UnifiedPost {
  return { ...post, sourceAccount: account.handle, sourceAccountId: account.id };
}

function nextCursor(value: unknown, previous?: string): string | null {
  // A broken provider must not leave the reader requesting one page forever.
  return typeof value === 'string' && value.length > 0 && value !== previous ? value : null;
}

function arrayResponse<T>(value: unknown, provider: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${provider} returned an invalid response.`);
  return value as T[];
}

/** Never display/log URLs with query credentials or an echoed access token. */
function safeError(reason: unknown, entry?: ClientEntry): string {
  let message = reason instanceof Error ? reason.message : 'Unable to load this account.';
  if (entry && entry.platform !== 'bluesky') {
    const token = (entry.client as MastodonClient | ThreadsClient).getAccessToken();
    if (token) message = message.split(token).join('[redacted]');
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/g, url => safeUrl(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|accessJwt|refreshJwt|app_password|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 300);
}

const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc/';
type BskyNotification = AppBskyNotificationListNotifications.Notification;
const POST_REASONS = new Set(['mention', 'reply', 'quote']);
const ACTIVITY_REASONS = new Set(['like', 'repost', 'quote', 'like-via-repost', 'repost-via-repost']);

async function blueskyAgent(entry: ClientEntry): Promise<Agent | undefined> {
  if (entry.oauthAgent) return entry.oauthAgent;
  const client = entry.client as BlueskyClient;
  // Both ready() and login() are lazy in this client. In particular, a public
  // OAuth fallback has no synchronously initialized agent to reach into.
  await client.login();
  return client.isAuthenticated() ? client.getAgent() : undefined;
}

async function loadBlueskyPage(
  column: DeckColumnConfig,
  account: Account,
  entry: ClientEntry,
  cursor?: string,
): Promise<SourcePage> {
  const client = entry.client as BlueskyClient;
  const agent = await blueskyAgent(entry);
  const query = column.query?.trim() ?? '';
  const params = { limit: 50, ...(cursor ? { cursor } : {}) };
  const actor = account.did ?? account.handle;
  let data: { feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string };

  switch (column.type) {
    case 'timeline':
      if (!agent) throw new Error('Reconnect this Bluesky account in Settings to load its home timeline.');
      data = (await agent.api.app.bsky.feed.getTimeline(params)).data;
      break;
    case 'my-posts':
    case 'user': {
      const target = column.type === 'my-posts' ? actor : query.replace(/^@/, '');
      data = agent
        ? (await agent.api.app.bsky.feed.getAuthorFeed({ actor: target, filter: 'posts_with_replies', ...params })).data
        : await client.getAuthorFeed(target, cursor);
      break;
    }
    case 'search':
    case 'hashtag': {
      const q = column.type === 'hashtag' ? `#${query.replace(/^#+/, '')}` : query;
      const found = agent
        ? (await agent.api.app.bsky.feed.searchPosts({ q, sort: 'latest', ...params })).data
        : await client.searchPosts(q, cursor);
      data = { feed: arrayResponse<AppBskyFeedDefs.PostView>(found.posts, 'Bluesky').map(post => ({ post })), cursor: found.cursor };
      break;
    }
    case 'list':
      data = agent
        ? (await agent.api.app.bsky.feed.getListFeed({ list: query, ...params })).data
        : await client.getListFeed(query, cursor);
      break;
    case 'feed':
      if (agent) {
        data = (await agent.api.app.bsky.feed.getFeed({ feed: query, ...params })).data;
      } else {
        const url = new URL('app.bsky.feed.getFeed', BSKY_PUBLIC_API);
        url.searchParams.set('feed', query);
        url.searchParams.set('limit', '50');
        if (cursor) url.searchParams.set('cursor', cursor);
        data = await fetchJson(url.href, { redirect: 'error' }, 'Load Bluesky feed');
      }
      break;
    case 'likes':
      if (!agent) throw new Error('Reconnect this Bluesky account in Settings to load its likes.');
      data = (await agent.api.app.bsky.feed.getActorLikes({ actor, ...params })).data;
      break;
    case 'notifications':
    case 'mentions':
    case 'activity':
    case 'followers': {
      if (!agent) throw new Error('Reconnect this Bluesky account in Settings to load its notifications.');
      const response = (await agent.api.app.bsky.notification.listNotifications(params)).data;
      const notifications = arrayResponse<BskyNotification>(response.notifications, 'Bluesky');
      const next = nextCursor(response.cursor, cursor);
      if (column.type === 'notifications') {
        return { posts: [], notifications: notifications.map(n => blueskyNotification(n, account)), cursor: next };
      }
      if (column.type === 'mentions') {
        const uris = [...new Set(notifications.filter(n => n.reason === 'mention' || n.reason === 'reply').map(n => n.uri))];
        // Notification records are not PostViews. Hydrate them so replies keep
        // media, facets, CIDs and viewer state, just like a normal feed post.
        const postViews: AppBskyFeedDefs.PostView[] = [];
        for (let start = 0; start < uris.length; start += 25) {
          const result = await agent.api.app.bsky.feed.getPosts({ uris: uris.slice(start, start + 25) });
          postViews.push(...arrayResponse<AppBskyFeedDefs.PostView>(result.data.posts, 'Bluesky'));
        }
        return { posts: postViews.map(post => withSource(normalizePost({ post }, 'bluesky'), account)), cursor: next };
      }
      const matches = notifications.filter(n => column.type === 'followers' ? n.reason === 'follow' : ACTIVITY_REASONS.has(n.reason));
      return { posts: matches.map(n => blueskyActivityPost(n, account, column.type)), notifications: matches.map(n => blueskyNotification(n, account)), cursor: next };
    }
    default: throw new Error(`Bluesky does not support this column: ${column.type}`);
  }
  return {
    posts: arrayResponse<AppBskyFeedDefs.FeedViewPost>(data.feed, 'Bluesky').map(post => withSource(normalizePost(post, 'bluesky'), account)),
    cursor: nextCursor(data.cursor, cursor),
  };
}

function blueskyNotification(notification: BskyNotification, account: Account): DeckNotification {
  const record = notification.record as { text?: string };
  return {
    id: `bsky-${account.id}-${notification.reason}-${notification.uri}`,
    platform: 'bluesky', type: notification.reason, createdAt: notification.indexedAt,
    author: { handle: notification.author.handle, displayName: notification.author.displayName, avatar: notification.author.avatar },
    text: record?.text,
    postUri: POST_REASONS.has(notification.reason) ? notification.uri : notification.reasonSubject,
    sourceAccount: account.handle, sourceAccountId: account.id,
  };
}

function blueskyActivityPost(notification: BskyNotification, account: Account, type: string): UnifiedPost {
  const name = notification.author.displayName || notification.author.handle;
  const verb = notification.reason.startsWith('like') ? 'liked' : notification.reason.startsWith('repost') ? 'reposted' : 'quoted';
  return withSource({
    uri: `${type === 'followers' ? 'follower' : 'activity'}:bsky:${account.id}:${notification.uri}`,
    text: type === 'followers' ? `${name} followed you` : `${name} ${verb} your post`,
    author: { handle: notification.author.handle, displayName: notification.author.displayName, avatar: notification.author.avatar },
    createdAt: notification.indexedAt, platform: 'bluesky', isRepost: false, raw: notification,
  }, account);
}

/** Mastodon's wire format is snake_case; Post.svelte consumes masto's camelCase. */
function camelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelCase);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), camelCase(item)]));
  }
  return value;
}

function mastodonPost(status: mastodon.v1.Status, account: Account): UnifiedPost {
  const post = withSource(normalizePost(status, 'mastodon'), account);
  const warning = (status.reblog ?? status).spoilerText;
  if (warning) post.contentWarning = warning;
  return post;
}

function instanceOrigin(client: MastodonClient): string {
  const url = new URL(client.getInstanceUrl());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('This account has an invalid Mastodon server address.');
  }
  return url.origin;
}

async function mastodonRequest(client: MastodonClient, path: string, params: URLSearchParams): Promise<{ data: unknown; response: Response; url: URL }> {
  const token = client.getAccessToken();
  if (!token) throw new Error('Reconnect this Mastodon account in Settings.');
  const url = new URL(path, instanceOrigin(client));
  url.search = params.toString();
  const response = await fetchOk(url.href, {
    headers: { Authorization: `Bearer ${token}` },
    // Never forward an authenticated request to a redirect target. Pagination
    // below also reads only a cursor, never fetches a server-provided URL.
    redirect: 'error',
  }, 'Load Mastodon column');
  return { data: camelCase(await response.json()), response, url };
}

function mastodonNextCursor(response: Response, requested: URL, items: { id: string }[], previous: string | undefined, requireLink = false): string | null {
  const links = response.headers.get('Link');
  if (links !== null) {
    for (const match of links.matchAll(/<([^>]+)>\s*((?:;[^,]*)?)/g)) {
      const rel = /;\s*rel\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(match[2]);
      if (!(rel?.[1] ?? rel?.[2] ?? '').split(/\s+/).includes('next')) continue;
      let next: URL;
      try { next = new URL(match[1], requested); } catch { return null; }
      if (next.origin !== requested.origin || next.pathname !== requested.pathname || next.username || next.password) return null;
      return nextCursor(next.searchParams.get('max_id'), previous);
    }
    return null;
  }
  // Favourites are paged by an internal favourite id, NOT the status id. Only
  // the Link header can provide that cursor. Timelines may use their last id
  // when a compatible instance fails to expose Link through CORS.
  return requireLink ? null : nextCursor(items.at(-1)?.id, previous);
}

async function loadMastodonPage(
  column: DeckColumnConfig,
  account: Account,
  client: MastodonClient,
  cursor?: string,
): Promise<SourcePage> {
  const query = column.query?.trim() ?? '';
  const params = new URLSearchParams({ limit: '40' });
  let path: string;
  let searchOffset = 0;
  switch (column.type) {
    case 'timeline': path = '/api/v1/timelines/home'; break;
    case 'my-posts':
    case 'user': {
      let id = column.type === 'my-posts' ? account.mastodon_id : null;
      if (!id) {
        const lookup = await mastodonRequest(client, '/api/v1/accounts/lookup', new URLSearchParams({ acct: (column.type === 'my-posts' ? account.handle : query).replace(/^@/, '') }));
        const actor = lookup.data as { id?: unknown };
        if (typeof actor?.id !== 'string' || !actor.id) throw new Error('Mastodon could not find this profile.');
        id = actor.id;
      }
      path = `/api/v1/accounts/${encodeURIComponent(id)}/statuses`;
      break;
    }
    case 'search':
      path = '/api/v2/search';
      params.set('q', query);
      params.set('type', 'statuses');
      if (cursor) {
        if (!/^offset:\d+$/.test(cursor)) throw new Error('Invalid search page. Refresh this column.');
        searchOffset = Number(cursor.slice('offset:'.length));
        if (!Number.isSafeInteger(searchOffset)) throw new Error('Invalid search page. Refresh this column.');
        params.set('offset', String(searchOffset));
      }
      break;
    case 'hashtag': path = `/api/v1/timelines/tag/${encodeURIComponent(query.replace(/^#+/, ''))}`; break;
    case 'list': path = `/api/v1/timelines/list/${encodeURIComponent(query)}`; break;
    case 'local': params.set('local', 'true'); path = '/api/v1/timelines/public'; break;
    case 'federated': path = '/api/v1/timelines/public'; break;
    case 'likes': path = '/api/v1/favourites'; break;
    case 'mentions': params.append('types[]', 'mention'); path = '/api/v1/notifications'; break;
    case 'followers': params.append('types[]', 'follow'); path = '/api/v1/notifications'; break;
    case 'activity':
      params.append('types[]', 'favourite'); params.append('types[]', 'reblog');
      path = '/api/v1/notifications';
      break;
    case 'notifications': path = '/api/v1/notifications'; break;
    default: throw new Error(`Mastodon does not support this column: ${column.type}`);
  }
  if (cursor && column.type !== 'search') params.set('max_id', cursor);
  const { data, response, url } = await mastodonRequest(client, path, params);
  if (column.type === 'search') {
    const statuses = arrayResponse<mastodon.v1.Status>((data as { statuses?: unknown })?.statuses, 'Mastodon');
    return {
      posts: statuses.map(status => mastodonPost(status, account)),
      cursor: statuses.length ? `offset:${searchOffset + statuses.length}` : null,
    };
  }
  if (path === '/api/v1/notifications') {
    const notifications = arrayResponse<mastodon.v1.Notification>(data, 'Mastodon');
    const next = mastodonNextCursor(response, url, notifications, cursor);
    if (column.type === 'notifications') {
      return { posts: [], notifications: notifications.map(n => mastodonNotification(n, account, url)), cursor: next };
    }
    if (column.type === 'mentions') {
      return { posts: notifications.filter(n => n.type === 'mention' && n.status).map(n => mastodonPost(n.status!, account)), cursor: next };
    }
    const matches = notifications.filter(n => column.type === 'followers' ? n.type === 'follow' : n.type === 'favourite' || n.type === 'reblog');
    return { posts: matches.map(n => mastodonActivityPost(n, account, column.type, url)), notifications: matches.map(n => mastodonNotification(n, account, url)), cursor: next };
  }
  const statuses = arrayResponse<mastodon.v1.Status>(data, 'Mastodon');
  return {
    posts: statuses.map(status => mastodonPost(status, account)),
    cursor: mastodonNextCursor(response, url, statuses, cursor, column.type === 'likes'),
  };
}

function mastodonAuthor(actor: mastodon.v1.Account, instance: URL) {
  const acct = actor.acct.replace(/^@/, '');
  return {
    handle: `@${acct.includes('@') ? acct : `${acct}@${instance.hostname}`}`,
    displayName: actor.displayName, avatar: actor.avatar, accountId: actor.id,
  };
}

function mastodonNotification(notification: mastodon.v1.Notification, account: Account, instance: URL): DeckNotification {
  return {
    id: `masto-${account.id}-${notification.id}`,
    platform: 'mastodon', type: notification.type, createdAt: notification.createdAt,
    author: mastodonAuthor(notification.account, instance),
    text: notification.status ? mastodonPost(notification.status, account).text : undefined,
    postUri: notification.status?.uri,
    sourceAccount: account.handle, sourceAccountId: account.id,
  };
}

function mastodonActivityPost(notification: mastodon.v1.Notification, account: Account, type: string, instance: URL): UnifiedPost {
  const name = notification.account.displayName || notification.account.acct;
  return withSource({
    uri: `${type === 'followers' ? 'follower' : 'activity'}:masto:${account.id}:${notification.id}`,
    text: type === 'followers' ? `${name} followed you` : `${name} ${notification.type === 'favourite' ? 'liked' : 'boosted'} your post`,
    author: mastodonAuthor(notification.account, instance),
    createdAt: notification.createdAt, platform: 'mastodon', isRepost: false, raw: notification,
  }, account);
}

const THREADS_API = 'https://graph.threads.net/v1.0';
const THREADS_FIELDS = 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,thumbnail_url,is_quote_post';

async function loadThreadsPage(column: DeckColumnConfig, account: Account, client: ThreadsClient, cursor?: string): Promise<SourcePage> {
  const token = client.getAccessToken();
  if (!token) throw new Error('Reconnect this Threads account in Settings.');
  const query = column.query?.trim() ?? '';
  let path: string;
  const params = new URLSearchParams({ fields: THREADS_FIELDS, limit: '50' });
  switch (column.type) {
    case 'my-posts':
      path = `/${encodeURIComponent(client.getUserId() || 'me')}/threads`;
      params.set('fields', `${THREADS_FIELDS},shortcode,children,reposted_post,quoted_post`);
      break;
    case 'user':
      path = '/profile_posts';
      params.set('username', query.replace(/^@/, ''));
      params.set('fields', `${THREADS_FIELDS},reposted_post,quoted_post`);
      break;
    case 'search':
    case 'threads-search':
    case 'hashtag':
      path = '/keyword_search';
      params.set('q', column.type === 'hashtag' ? `#${query.replace(/^#+/, '')}` : query);
      params.set('search_type', 'RECENT');
      break;
    default: throw new Error(`Threads does not support this column: ${column.type}`);
  }
  if (cursor) params.set('after', cursor);
  const data = await fetchJson<{ data: ThreadsPost[]; paging?: { cursors?: { after?: string } } }>(`${THREADS_API}${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
  }, 'Load Threads column');
  const posts = arrayResponse<ThreadsPost>(data?.data, 'Threads');
  return {
    posts: posts.map(post => withSource(normalizePost(post, 'threads'), account)),
    // Meta can omit paging entirely (notably for keyword search). Only offer
    // another page when the provider actually supplies a new opaque cursor.
    cursor: posts.length ? nextCursor(data.paging?.cursors?.after, cursor) : null,
  };
}
