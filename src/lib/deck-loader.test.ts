import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import type { Account, Platform } from './types';
import type { DeckColumnConfig } from './deck-layouts';
import type { ClientEntry } from './api/client-factory';
import { loadDeckPage, supportsDeckLoader, supportsDeckPagination } from './deck-loader';

function account(id: number, platform: Platform = 'bluesky', overrides: Partial<Account> = {}): Account {
  return {
    id, platform,
    handle: platform === 'bluesky' ? `reader${id}.bsky.social` : platform === 'mastodon' ? `@reader${id}@social.example` : `reader${id}`,
    display_name: null, avatar_url: null,
    did: platform === 'bluesky' ? `did:plc:reader${id}` : null,
    mastodon_id: platform === 'mastodon' ? `${id}00` : null,
    threads_user_id: platform === 'threads' ? `${id}000` : null,
    instance_url: platform === 'mastodon' ? 'https://social.example' : null,
    is_primary: id === 1, created_at: '', updated_at: '', ...overrides,
  };
}

function column(type: DeckColumnConfig['type'], overrides: Partial<DeckColumnConfig> = {}): DeckColumnConfig {
  return { id: 'test-column', title: 'Test', type, ...overrides };
}

function postView(id: string, text = 'A post') {
  return {
    uri: `at://did:plc:author/app.bsky.feed.post/${id}`, cid: `cid-${id}`,
    author: { did: 'did:plc:author', handle: 'author.bsky.social', displayName: 'Author', avatar: 'https://cdn.example/avatar.jpg' },
    record: { $type: 'app.bsky.feed.post', text, createdAt: '2026-06-01T12:00:00.000Z', langs: ['en'] },
    indexedAt: '2026-06-01T12:00:00.000Z', likeCount: 7, repostCount: 2, replyCount: 3,
  };
}

function bskyNotification(id: string, reason: string) {
  const post = postView(id);
  return { ...post, reason, reasonSubject: 'at://did:plc:reader/app.bsky.feed.post/parent', isRead: false };
}

function bskyFixture(acct: Account, oauth = true) {
  const getTimeline = vi.fn().mockResolvedValue({ data: { feed: [] } });
  const getAuthorFeed = vi.fn().mockResolvedValue({ data: { feed: [] } });
  const searchPosts = vi.fn().mockResolvedValue({ data: { posts: [] } });
  const getListFeed = vi.fn().mockResolvedValue({ data: { feed: [] } });
  const getFeed = vi.fn().mockResolvedValue({ data: { feed: [] } });
  const getActorLikes = vi.fn().mockResolvedValue({ data: { feed: [] } });
  const getPosts = vi.fn().mockResolvedValue({ data: { posts: [] } });
  const listNotifications = vi.fn().mockResolvedValue({ data: { notifications: [] } });
  const agent = {
    did: acct.did,
    api: { app: { bsky: { feed: { getTimeline, getAuthorFeed, searchPosts, getListFeed, getFeed, getActorLikes, getPosts }, notification: { listNotifications } } } },
  } as unknown as Agent;
  const client = {
    login: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(!oauth),
    getAgent: vi.fn().mockReturnValue(agent),
    getAuthorFeed: vi.fn().mockResolvedValue({ feed: [] }),
    searchPosts: vi.fn().mockResolvedValue({ posts: [] }),
    getListFeed: vi.fn().mockResolvedValue({ feed: [] }),
  };
  const entry = { accountId: acct.id, platform: acct.platform, handle: acct.handle, client, ...(oauth ? { oauthAgent: agent } : {}) } as unknown as ClientEntry;
  return { entry, client, agent, getTimeline, getAuthorFeed, searchPosts, getListFeed, getFeed, getActorLikes, getPosts, listNotifications };
}

function networkEntry(acct: Account, token = 'secret-token'): ClientEntry {
  return {
    accountId: acct.id, platform: acct.platform, handle: acct.handle,
    client: {
      getAccessToken: () => token,
      getInstanceUrl: () => acct.instance_url,
      getUserId: () => acct.threads_user_id,
    },
  } as unknown as ClientEntry;
}

function status(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, uri: `https://social.example/users/author/statuses/${id}`,
    url: `https://social.example/@author/${id}`, content: '<p>A Mastodon post</p>',
    created_at: '2026-06-01T12:00:00.000Z',
    account: { id: '44', acct: 'author@social.example', display_name: 'Author', avatar: 'https://social.example/avatar.jpg', url: 'https://social.example/@author' },
    favourites_count: 8, reblogs_count: 2, replies_count: 3, reblog: null,
    in_reply_to_id: null, media_attachments: [], ...overrides,
  };
}

function response(data: unknown, link?: string, statusCode = 200) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json', ...(link === undefined ? {} : { Link: link }) },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('account-scoped loading and independent cursors', () => {
  it('uses only the explicitly selected account and keeps its publishing context on posts', async () => {
    const first = account(1), second = account(2), masto = account(3, 'mastodon');
    const a = bskyFixture(first), b = bskyFixture(second);
    b.getTimeline.mockResolvedValue({ data: { feed: [{ post: postView('second') }], cursor: 'second-page' } });
    const result = await loadDeckPage(column('timeline', { accountIds: [2, 3], platform: 'bluesky' }), [first, second, masto], new Map([[1, a.entry], [2, b.entry], [3, networkEntry(masto)]]));
    expect(a.getTimeline).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.posts[0]).toMatchObject({ sourceAccount: second.handle, sourceAccountId: 2, uri: postView('second').uri });
    expect(result.cursors).toEqual({ '2': 'second-page' });
    expect(result.errors).toEqual([]);
  });

  it('does not turn an empty account selection into all accounts', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    const result = await loadDeckPage(column('timeline', { accountIds: [] }), [acct], new Map([[1, fixture.entry]]));
    expect(fixture.getTimeline).not.toHaveBeenCalled();
    expect(result).toMatchObject({ posts: [], cursors: {}, errors: [], hasMore: false });
  });

  it('retries a failed first page while advancing successful sources and never restarting exhausted ones', async () => {
    const first = account(1), second = account(2);
    const a = bskyFixture(first), b = bskyFixture(second);
    a.getTimeline.mockResolvedValueOnce({ data: { feed: [{ post: postView('a1') }], cursor: 'a2' } }).mockResolvedValueOnce({ data: { feed: [{ post: postView('a2') }] } });
    b.getTimeline.mockRejectedValueOnce(new Error('Rate limit reached')).mockResolvedValueOnce({ data: { feed: [{ post: postView('b1') }], cursor: 'b2' } }).mockResolvedValueOnce({ data: { feed: [{ post: postView('b2') }] } });
    const clients = new Map([[1, a.entry], [2, b.entry]]);
    const initial = await loadDeckPage(column('timeline'), [first, second], clients);
    expect(initial.posts.map(post => post.uri)).toEqual([postView('a1').uri]);
    expect(initial.errors).toEqual([{ accountId: 2, message: 'Rate limit reached' }]);
    expect(initial.cursors).toEqual({ '1': 'a2' });
    expect(initial.hasMore).toBe(true);

    const secondPage = await loadDeckPage(column('timeline'), [first, second], clients, initial.cursors);
    expect(a.getTimeline).toHaveBeenLastCalledWith({ limit: 50, cursor: 'a2' });
    expect(b.getTimeline).toHaveBeenLastCalledWith({ limit: 50 });
    expect(secondPage.cursors).toEqual({ '1': null, '2': 'b2' });
    expect(initial.cursors).toEqual({ '1': 'a2' });

    const final = await loadDeckPage(column('timeline'), [first, second], clients, secondPage.cursors);
    expect(a.getTimeline).toHaveBeenCalledTimes(2);
    expect(b.getTimeline).toHaveBeenLastCalledWith({ limit: 50, cursor: 'b2' });
    expect(final.cursors).toEqual({ '1': null, '2': null });
    expect(final.hasMore).toBe(false);
  });

  it('preserves a failed later-page cursor and ignores cursor keys from removed sources', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.getTimeline.mockRejectedValue(new Error('Temporary service problem'));
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[1, fixture.entry]]), { '1': 'resume-here', '99': 'stale-account' });
    expect(result.cursors).toEqual({ '1': 'resume-here' });
    expect(result.errors).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('reports disconnected accounts instead of presenting them as empty timelines', async () => {
    const acct = account(1);
    const result = await loadDeckPage(column('timeline'), [acct], new Map());
    expect(result.errors[0]).toMatchObject({ accountId: 1, message: expect.stringContaining('Reconnect') });
    expect(result.cursors).toEqual({});
    expect(result.hasMore).toBe(true);
  });

  it('rejects a client entry belonging to another account', async () => {
    const acct = account(1), other = bskyFixture(account(2));
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[1, other.entry]]));
    expect(other.getTimeline).not.toHaveBeenCalled();
    expect(result.errors[0].accountId).toBe(1);
  });
});

describe('Bluesky authentication and post representations', () => {
  it('uses the OAuth agent for search and keeps PostView media, facets, and viewer state', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    const post = { ...postView('search'), embed: { $type: 'app.bsky.embed.images#view', images: [{ alt: 'Alt text', fullsize: 'https://cdn.example/photo.jpg' }] }, viewer: { like: 'at://like' } };
    fixture.searchPosts.mockResolvedValue({ data: { posts: [post], cursor: 'next-search' } });
    const result = await loadDeckPage(column('search', { query: 'climate' }), [acct], new Map([[1, fixture.entry]]), { '1': 'previous' });
    expect(fixture.searchPosts).toHaveBeenCalledWith({ q: 'climate', sort: 'latest', limit: 50, cursor: 'previous' });
    expect(fixture.client.login).not.toHaveBeenCalled();
    expect(fixture.client.searchPosts).not.toHaveBeenCalled();
    expect(result.posts[0]).toMatchObject({ embeds: post.embed, raw: { post }, likeCount: 7, sourceAccountId: 1 });
  });

  it('waits for app-password login before obtaining the authenticated agent', async () => {
    const acct = account(1), fixture = bskyFixture(acct, false);
    let loggedIn = false;
    fixture.client.login.mockImplementation(async () => { await Promise.resolve(); loggedIn = true; });
    fixture.client.getAgent.mockImplementation(() => {
      if (!loggedIn) throw new Error('Agent not ready');
      return fixture.agent;
    });
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[1, fixture.entry]]));
    expect(result.errors).toEqual([]);
    expect(fixture.client.login).toHaveBeenCalledOnce();
    expect(fixture.getTimeline).toHaveBeenCalledOnce();
  });

  it.each([
    ['my-posts', undefined, 'getAuthorFeed', { actor: 'did:plc:reader1', filter: 'posts_with_replies' }],
    ['user', '@other.bsky.social', 'getAuthorFeed', { actor: 'other.bsky.social', filter: 'posts_with_replies' }],
    ['likes', undefined, 'getActorLikes', { actor: 'did:plc:reader1' }],
    ['list', 'at://did:plc:owner/app.bsky.graph.list/list1', 'getListFeed', { list: 'at://did:plc:owner/app.bsky.graph.list/list1' }],
    ['feed', 'at://did:plc:owner/app.bsky.feed.generator/feed1', 'getFeed', { feed: 'at://did:plc:owner/app.bsky.feed.generator/feed1' }],
  ] as const)('uses the selected OAuth account for %s columns', async (type, query, method, expected) => {
    const acct = account(1), fixture = bskyFixture(acct);
    const result = await loadDeckPage(column(type, { query }), [acct], new Map([[1, fixture.entry]]), { '1': 'older' });
    expect(fixture[method]).toHaveBeenCalledWith({ ...expected, limit: 50, cursor: 'older' });
    expect(result.errors).toEqual([]);
  });

  it('allows public profile reads after OAuth expires but clearly fails authenticated timelines', async () => {
    const acct = account(1), fixture = bskyFixture(acct, false);
    fixture.client.isAuthenticated.mockReturnValue(false);
    fixture.client.getAuthorFeed.mockResolvedValue({ feed: [{ post: postView('public') }] });
    const clients = new Map([[1, { ...fixture.entry, degraded: true }]]);
    const timeline = await loadDeckPage(column('timeline'), [acct], clients);
    expect(timeline.errors[0].message).toContain('Reconnect');
    expect(fixture.getTimeline).not.toHaveBeenCalled();
    const profile = await loadDeckPage(column('user', { query: 'other.bsky.social' }), [acct], clients);
    expect(profile.posts[0].uri).toBe(postView('public').uri);
    expect(fixture.client.getAuthorFeed).toHaveBeenCalledWith('other.bsky.social', undefined);
  });

  it('hydrates mentions as actual posts instead of passing notification records into post actions', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    const mention = bskyNotification('mention', 'mention'), reply = bskyNotification('reply', 'reply');
    fixture.listNotifications.mockResolvedValue({ data: { notifications: [mention, bskyNotification('like', 'like'), reply], cursor: 'older-notifications' } });
    const hydrated = { ...postView('mention'), embed: { $type: 'app.bsky.embed.images#view', images: [] } };
    fixture.getPosts.mockResolvedValue({ data: { posts: [hydrated, postView('reply')] } });
    const result = await loadDeckPage(column('mentions'), [acct], new Map([[1, fixture.entry]]));
    expect(fixture.getPosts).toHaveBeenCalledWith({ uris: [mention.uri, reply.uri] });
    expect(result.posts[0]).toMatchObject({ raw: { post: { cid: hydrated.cid } }, embeds: hydrated.embed, sourceAccountId: 1 });
    expect(result.cursors).toEqual({ '1': 'older-notifications' });
  });

  it('does not advance a mention page when post hydration fails', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.listNotifications.mockResolvedValue({ data: { notifications: [bskyNotification('mention', 'mention')], cursor: 'after-page' } });
    fixture.getPosts.mockRejectedValue(new Error('Post service unavailable'));
    const result = await loadDeckPage(column('mentions'), [acct], new Map([[1, fixture.entry]]), { '1': 'before-page' });
    expect(result.posts).toEqual([]);
    expect(result.cursors).toEqual({ '1': 'before-page' });
    expect(result.errors[0].message).toBe('Post service unavailable');
  });

  it('preserves pagination through a notifications page without matching mentions', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.listNotifications.mockResolvedValue({ data: { notifications: [bskyNotification('like', 'like')], cursor: 'more' } });
    const result = await loadDeckPage(column('mentions'), [acct], new Map([[1, fixture.entry]]));
    expect(result.posts).toEqual([]);
    expect(fixture.getPosts).not.toHaveBeenCalled();
    expect(result.hasMore).toBe(true);
  });

  it('scopes notification IDs to the receiving account and links replies to the reply itself', async () => {
    const first = account(1), second = account(2);
    const a = bskyFixture(first), b = bskyFixture(second);
    const reply = bskyNotification('reply', 'reply');
    for (const fixture of [a, b]) fixture.listNotifications.mockResolvedValue({ data: { notifications: [reply] } });
    const result = await loadDeckPage(column('notifications'), [first, second], new Map([[1, a.entry], [2, b.entry]]));
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications?.[0].id).not.toBe(result.notifications?.[1].id);
    expect(result.notifications?.[0]).toMatchObject({ postUri: reply.uri, sourceAccountId: 1 });
    expect(result.notifications?.[1]).toMatchObject({ sourceAccountId: 2 });
  });

  it.each([['activity', 'like'], ['followers', 'follow']] as const)('returns both grouped-notification input and account-aware rows for %s', async (type, reason) => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.listNotifications.mockResolvedValue({ data: { notifications: [bskyNotification('event', reason), bskyNotification('mention', 'mention')], cursor: 'next' } });
    const result = await loadDeckPage(column(type), [acct], new Map([[1, fixture.entry]]));
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].sourceAccountId).toBe(1);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications?.[0].type).toBe(reason);
    expect(result.cursors['1']).toBe('next');
  });

  it('stops a provider that repeats its previous cursor', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.getTimeline.mockResolvedValue({ data: { feed: [{ post: postView('same') }], cursor: 'same-page' } });
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[1, fixture.entry]]), { '1': 'same-page' });
    expect(result.hasMore).toBe(false);
  });
});

describe('Mastodon wire normalization and secure pagination', () => {
  it('normalizes nested wire fields, media, content warnings, and the reblog timestamp', async () => {
    const acct = account(2, 'mastodon');
    const original = status('10', { spoiler_text: 'Content warning', media_attachments: [{ type: 'image', url: 'https://cdn.example/image.jpg', preview_url: 'https://cdn.example/preview.jpg' }] });
    const reblog = status('20', { created_at: '2026-06-02T13:00:00.000Z', reblog: original });
    fetchMock.mockResolvedValueOnce(response([reblog], '<https://social.example/api/v1/timelines/home?max_id=19>; rel="next"'));
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(result.posts[0]).toMatchObject({
      uri: original.uri, isRepost: true, createdAt: '2026-06-02T13:00:00.000Z',
      embeds: [{ previewUrl: 'https://cdn.example/preview.jpg' }], contentWarning: 'Content warning',
      raw: { reblog: { mediaAttachments: [{ previewUrl: 'https://cdn.example/preview.jpg' }] } }, sourceAccountId: 2,
    });
    expect(result.cursors).toEqual({ '2': '19' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer secret-token' }, redirect: 'error' });
  });

  it('uses the internal favourite cursor from Link instead of the returned status ID', async () => {
    const acct = account(2, 'mastodon');
    const clients = new Map([[2, networkEntry(acct)]]);
    fetchMock.mockResolvedValueOnce(response([status('post-900')], '<https://social.example/api/v1/favourites?min_id=fav-90>; rel="prev", <https://social.example/api/v1/favourites?max_id=fav-75>; type="application/json"; rel="next"'));
    const initial = await loadDeckPage(column('likes'), [acct], clients);
    expect(initial.cursors).toEqual({ '2': 'fav-75' });
    fetchMock.mockResolvedValueOnce(response([], '<https://social.example/api/v1/favourites?min_id=fav-75>; rel="prev"'));
    const older = await loadDeckPage(column('likes'), [acct], clients, initial.cursors);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('max_id')).toBe('fav-75');
    expect(older.hasMore).toBe(false);
  });

  it('does not invent favourite cursors when a server omits Link', async () => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response([status('900')]));
    const result = await loadDeckPage(column('likes'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(result.cursors['2']).toBeNull();
  });

  it.each([
    'https://attacker.example/api/v1/favourites?max_id=stolen',
    'https://social.example/api/v1/accounts?max_id=wrong-endpoint',
    'https://other-user:password@social.example/api/v1/favourites?max_id=unexpected',
  ])('never follows unsafe pagination links: %s', async link => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response([status('900')], `<${link}>; rel="next"`));
    const result = await loadDeckPage(column('likes'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(result.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe('https://social.example');
  });

  it('uses the outer status ID for timeline fallback, and stops when that ID no longer advances', async () => {
    const acct = account(2, 'mastodon'), clients = new Map([[2, networkEntry(acct)]]);
    fetchMock.mockResolvedValueOnce(response([status('20', { reblog: status('10') })]));
    const initial = await loadDeckPage(column('timeline'), [acct], clients);
    expect(initial.cursors['2']).toBe('20');
    fetchMock.mockResolvedValueOnce(response([status('20', { reblog: status('10') })]));
    const older = await loadDeckPage(column('timeline'), [acct], clients, initial.cursors);
    expect(older.hasMore).toBe(false);
  });

  it('resolves a profile on the selected instance and paginates its statuses with encoded identifiers', async () => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response({ id: 'other/profile' })).mockResolvedValueOnce(response([status('90')], ''));
    const result = await loadDeckPage(column('user', { query: '@other@remote.example&admin=true' }), [acct], new Map([[2, networkEntry(acct)]]), { '2': 'older' });
    const lookup = new URL(String(fetchMock.mock.calls[0][0]));
    const posts = new URL(String(fetchMock.mock.calls[1][0]));
    expect(lookup.origin).toBe('https://social.example');
    expect(lookup.searchParams.get('acct')).toBe('other@remote.example&admin=true');
    expect(lookup.searchParams.has('admin')).toBe(false);
    expect(posts.pathname).toBe('/api/v1/accounts/other%2Fprofile/statuses');
    expect(posts.searchParams.get('max_id')).toBe('older');
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['local', undefined, '/api/v1/timelines/public', 'true'],
    ['federated', undefined, '/api/v1/timelines/public', null],
    ['hashtag', '#cats & dogs', '/api/v1/timelines/tag/cats%20%26%20dogs', null],
    ['list', '42', '/api/v1/timelines/list/42', null],
    ['my-posts', undefined, '/api/v1/accounts/200/statuses', null],
  ] as const)('loads %s from the selected authenticated Mastodon instance', async (type, query, path, local) => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response([]));
    const result = await loadDeckPage(column(type, { query }), [acct], new Map([[2, networkEntry(acct)]]), { '2': '80' });
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname).toBe(path);
    expect(requested.searchParams.get('local')).toBe(local);
    expect(requested.searchParams.get('max_id')).toBe('80');
    expect(result.errors).toEqual([]);
  });

  it('preserves Mastodon notification actors and hydrates mention statuses from snake_case', async () => {
    const acct = account(2, 'mastodon');
    const mention = { id: '500', type: 'mention', created_at: '2026-06-02T00:00:00.000Z', account: status('90').account, status: status('90', { media_attachments: [{ type: 'image', preview_url: 'https://cdn.example/thumb' }] }) };
    fetchMock.mockResolvedValueOnce(response([mention], '<https://social.example/api/v1/notifications?max_id=400>; rel="next"'));
    const notifications = await loadDeckPage(column('notifications'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(notifications.notifications?.[0]).toMatchObject({ author: { accountId: '44', displayName: 'Author' }, postUri: mention.status.uri, sourceAccountId: 2 });
    fetchMock.mockResolvedValueOnce(response([mention], ''));
    const mentions = await loadDeckPage(column('mentions'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.getAll('types[]')).toEqual(['mention']);
    expect(mentions.posts[0].embeds).toEqual([{ type: 'image', previewUrl: 'https://cdn.example/thumb' }]);
  });

  it('returns HTTP failures without exposing credentials and leaves the page retryable', async () => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response({ error: 'Token secret-token rejected at https://social.example/check?access_token=secret-token' }, undefined, 403));
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(result.errors[0].message).toContain('403');
    expect(result.errors[0].message).not.toContain('secret-token');
    expect(result.errors[0].message).not.toContain('access_token=');
    expect(result.cursors).toEqual({});
    expect(result.hasMore).toBe(true);
  });

  it('does not silently turn a malformed provider response into an empty feed', async () => {
    const acct = account(2, 'mastodon');
    fetchMock.mockResolvedValueOnce(response({ error: 'unexpected shape' }));
    const result = await loadDeckPage(column('timeline'), [acct], new Map([[2, networkEntry(acct)]]));
    expect(result.errors[0].message).toContain('invalid response');
    expect(result.cursors).toEqual({});
  });
});

describe('cross-network search and Threads cursors', () => {
  it('searches every eligible account and preserves distinct pagination mechanisms', async () => {
    const bsky = account(1), masto = account(2, 'mastodon'), threads = account(3, 'threads');
    const fixture = bskyFixture(bsky);
    fixture.searchPosts.mockResolvedValue({ data: { posts: [postView('bsky-search', 'cats')], cursor: 'bsky-next' } });
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.origin === 'https://social.example') return response({ statuses: [status('90')] });
      if (url.origin === 'https://graph.threads.net') return response({ data: [{ id: '333', username: 'threadsauthor', text: 'cats', timestamp: '2026-06-01T12:00:00.000Z' }], paging: { cursors: { after: 'threads-next' } } });
      throw new Error('Unexpected provider');
    });
    const result = await loadDeckPage(column('search', { query: 'cats' }), [bsky, masto, threads], new Map([[1, fixture.entry], [2, networkEntry(masto)], [3, networkEntry(threads)]]));
    expect(result.posts.map(post => [post.platform, post.sourceAccountId])).toEqual([['bluesky', 1], ['mastodon', 2], ['threads', 3]]);
    expect(result.cursors).toEqual({ '1': 'bsky-next', '2': 'offset:1', '3': 'threads-next' });
    const mastodonUrl = new URL(String(fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://social.example'))?.[0]));
    const threadsCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://graph.threads.net'))!;
    expect(mastodonUrl.searchParams.get('q')).toBe('cats');
    expect(mastodonUrl.searchParams.get('type')).toBe('statuses');
    expect(new URL(String(threadsCall[0])).searchParams.get('search_type')).toBe('RECENT');
    expect(String(threadsCall[0])).not.toContain('secret-token');
    expect(threadsCall[1]).toMatchObject({ headers: { Authorization: 'Bearer secret-token' }, redirect: 'error' });
  });

  it('advances Mastodon search offsets without treating status IDs as search cursors', async () => {
    const acct = account(2, 'mastodon'), clients = new Map([[2, networkEntry(acct)]]);
    fetchMock.mockResolvedValueOnce(response({ statuses: [status('90'), status('10')] }));
    const initial = await loadDeckPage(column('search', { query: 'cats' }), [acct], clients);
    fetchMock.mockResolvedValueOnce(response({ statuses: [] }));
    const older = await loadDeckPage(column('search', { query: 'cats' }), [acct], clients, initial.cursors);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('offset')).toBe('2');
    expect(older.hasMore).toBe(false);
  });

  it('loads older Threads posts using the server cursor without following its next URL', async () => {
    const acct = account(3, 'threads'), clients = new Map([[3, networkEntry(acct)]]);
    fetchMock.mockResolvedValueOnce(response({ data: [{ id: '1', text: 'First' }], paging: { cursors: { after: 'opaque+cursor' }, next: 'https://attacker.example/?access_token=secret-token' } }));
    const initial = await loadDeckPage(column('my-posts'), [acct], clients);
    fetchMock.mockResolvedValueOnce(response({ data: [{ id: '2', text: 'Older' }] }));
    const older = await loadDeckPage(column('my-posts'), [acct], clients, initial.cursors);
    const requested = new URL(String(fetchMock.mock.calls[1][0]));
    expect(requested.origin).toBe('https://graph.threads.net');
    expect(requested.pathname).toBe('/v1.0/3000/threads');
    expect(requested.searchParams.get('after')).toBe('opaque+cursor');
    expect(older.posts[0].text).toBe('Older');
    expect(older.hasMore).toBe(false);
  });

  it('does not invent pagination for a Threads search without provider cursors', async () => {
    const acct = account(3, 'threads'), bsky = account(1), fixture = bskyFixture(bsky);
    fetchMock.mockResolvedValueOnce(response({ data: [{ id: '1', text: 'cats' }] }));
    const result = await loadDeckPage(column('threads-search', { query: 'cats' }), [bsky, acct], new Map([[1, fixture.entry], [3, networkEntry(acct)]]));
    expect(result.hasMore).toBe(false);
    expect(fixture.searchPosts).not.toHaveBeenCalled();
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1.0/keyword_search');
  });

  it('keeps a failed Threads search visible even when another network succeeded', async () => {
    const acct = account(3, 'threads'), bsky = account(1), fixture = bskyFixture(bsky);
    fixture.searchPosts.mockResolvedValue({ data: { posts: [postView('ok')] } });
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'Missing permission' } }, undefined, 403));
    const result = await loadDeckPage(column('search', { query: 'cats' }), [bsky, acct], new Map([[1, fixture.entry], [3, networkEntry(acct)]]));
    expect(result.posts).toHaveLength(1);
    expect(result.errors).toEqual([{ accountId: 3, message: expect.stringContaining('403') }]);
    expect(result.cursors).toEqual({ '1': null });
    expect(result.hasMore).toBe(true);
  });
});

describe('multi-query monitoring sources', () => {
  it('tracks each tag independently and advances even when another tag fails', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.searchPosts.mockImplementation(async ({ q, cursor }: { q: string; cursor?: string }) => {
      if (q === '#dogs' && !cursor) throw new Error('Try again');
      return { data: { posts: [postView(q, q)], cursor: `${q}-older` } };
    });
    const result = await loadDeckPage(column('tag-group', { query: ' #cats, dogs, cats ' }), [acct], new Map([[1, fixture.entry]]));
    expect(fixture.searchPosts).toHaveBeenCalledTimes(2);
    expect(result.posts).toHaveLength(1);
    expect(result.cursors).toEqual({ '1:cats': '#cats-older' });
    expect(result.errors[0]).toMatchObject({ accountId: 1, message: 'Try again' });
    expect(result.hasMore).toBe(true);
  });

  it('searches plain monitor terms separately and applies the same local matcher to each page', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.searchPosts.mockImplementation(async ({ q }: { q: string }) => ({ data: { posts: [postView(q, q === 'cats' ? 'CATS in the garden' : 'Unrelated search result')], cursor: `${q}-older` } }));
    const result = await loadDeckPage(column('keyword-monitor', { query: 'cats, dogs' }), [acct], new Map([[1, fixture.entry]]));
    expect(fixture.searchPosts.mock.calls.map(([params]) => params.q)).toEqual(['cats', 'dogs']);
    expect(result.posts.map(post => post.text)).toEqual(['CATS in the garden']);
    expect(result.cursors).toEqual({ '1:keyword:cats': 'cats-older', '1:keyword:dogs': 'dogs-older' });
  });

  it('does not send a regex as unsupported search syntax and filters available timeline backfill', async () => {
    const acct = account(1), fixture = bskyFixture(acct);
    fixture.getTimeline.mockResolvedValue({ data: { feed: [{ post: postView('match', 'cat 42') }, { post: postView('ignore', 'dog') }], cursor: 'timeline-next' } });
    const result = await loadDeckPage(column('keyword-monitor', { query: '/cat \\d+/' }), [acct], new Map([[1, fixture.entry]]));
    expect(fixture.searchPosts).not.toHaveBeenCalled();
    expect(result.posts.map(post => post.text)).toEqual(['cat 42']);
    expect(result.cursors).toEqual({ '1:regex': 'timeline-next' });
  });

  it.each(['search', 'hashtag', 'tag-group', 'keyword-monitor'] as const)('reports missing %s configuration without making network requests', async type => {
    const acct = account(1), fixture = bskyFixture(acct);
    const result = await loadDeckPage(column(type, { query: '  ' }), [acct], new Map([[1, fixture.entry]]));
    expect(result.errors[0].message).toContain('query');
    expect(fixture.searchPosts).not.toHaveBeenCalled();
    expect(fixture.getTimeline).not.toHaveBeenCalled();
  });

  it('declares only loader-backed column types as paginated', () => {
    for (const type of ['timeline', 'search', 'tag-group', 'keyword-monitor', 'threads-search', 'list', 'notifications', 'likes']) {
      expect(supportsDeckLoader(type)).toBe(true);
      expect(supportsDeckPagination(type)).toBe(true);
    }
    for (const type of ['rss', 'messages', 'trending', 'unknown']) {
      expect(supportsDeckLoader(type)).toBe(false);
      expect(supportsDeckPagination(type)).toBe(false);
    }
  });
});
