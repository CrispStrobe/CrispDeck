import { describe, it, expect, vi, afterEach } from 'vitest';
import { columnAccounts } from './deck-accounts';
import { filterColumnPosts, filterColumnNotifications, postHasMedia } from './deck-filters';
import { mergeColumnPosts, withoutDeletedPosts } from './deck-state';
import { matchesBlueskyColumn, subscribeDeckColumn } from './deck-live';
import { performDeckAction } from './deck-actions';
import { groupNotifications } from './notification-grouping';
import { streamManager } from './streaming';
import type { Account, UnifiedPost } from './types';
import type { DeckColumnConfig } from './deck-layouts';
import type { ClientEntry } from './api/client-factory';

const account = (id: number, platform: Account['platform'] = 'bluesky'): Account => ({ id, platform, handle: `account${id}.test`, did: `did:plc:${id}`, instance_url: 'https://masto.test', is_primary: id === 1, avatar_url: null, display_name: null, mastodon_id: String(id), threads_user_id: null, created_at: '', updated_at: '' });
const column = (patch: Partial<DeckColumnConfig> = {}): DeckColumnConfig => ({ id: 'one', title: 'Test', type: 'timeline', ...patch });
const post = (uri: string, patch: Partial<UnifiedPost> = {}): UnifiedPost => ({ uri, text: 'Svelte release', platform: 'bluesky', author: { handle: 'alice.test' }, createdAt: '2026-11-06T10:00:00Z', isRepost: false, ...patch });

afterEach(() => { streamManager.disconnectAll(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('column account boundaries', () => {
  const accounts = [account(1), account(2), account(3, 'mastodon'), account(4, 'threads')];
  it('merges eligible accounts by default and respects explicit scope', () => {
    expect(columnAccounts(column(), accounts).map(a => a.id)).toEqual([1, 2, 3]);
    expect(columnAccounts(column({ accountIds: [2, 3], platform: 'bluesky' }), accounts).map(a => a.id)).toEqual([2]);
  });
  it('does not widen disconnected or empty selections', () => {
    expect(columnAccounts(column({ accountIds: [] }), accounts)).toEqual([]);
    expect(columnAccounts(column({ accountIds: [99] }), accounts)).toEqual([]);
  });
  it('understands Bluesky and Mastodon list sources', () => {
    expect(columnAccounts(column({ type: 'list', query: 'at://did:plc:1/app.bsky.graph.list/list1' }), accounts).map(a => a.id)).toEqual([1, 2]);
    expect(columnAccounts(column({ type: 'list', query: '23' }), accounts).map(a => a.id)).toEqual([3]);
  });
  it('supports cross-network search, but excludes Threads-only limitations', () => {
    expect(columnAccounts(column({ type: 'search' }), accounts)).toHaveLength(4);
    expect(columnAccounts(column({ type: 'messages' }), accounts).map(a => a.id)).toEqual([1, 2, 3]);
  });
});

describe('persistent filters apply identically to loaded and live rows', () => {
  const rows = [post('one', { likeCount: 12, repostCount: 3, embeds: { images: [{}] }, raw: { post: { record: { langs: ['en-US'] } } } }), post('two', { text: 'Svelte spoiler', isRepost: true }), post('three', { text: 'A reply', replyParentUri: 'parent' })];
  it('combines text, excluded text, author, language, media and engagement filters', () => {
    const filters = { searchTerm: 'svelte', excludeText: 'spoiler, advertisement', author: '@alice', language: 'en', hasMedia: true, minLikes: 10, minReposts: 2, hideReplies: true, hideReposts: true };
    expect(filterColumnPosts(rows, filters).map(p => p.uri)).toEqual(['one']);
    expect(filterColumnPosts([rows[0]], filters)).toEqual([rows[0]]);
  });
  it('counts images/video including record-with-media but not link cards', () => {
    expect(postHasMedia(post('a', { embeds: { external: { uri: 'https://example.test' } } }))).toBe(false);
    expect(postHasMedia(post('b', { embeds: { media: { playlist: 'https://video.test/a.m3u8' } } }))).toBe(true);
    expect(postHasMedia(post('c', { platform: 'mastodon', embeds: [{ type: 'image' }] }))).toBe(true);
    expect(postHasMedia(post('d', { embeds: { $type: 'app.bsky.embed.gallery#view', items: [{ $type: 'app.bsky.embed.gallery#viewImage', fullsize: 'https://image.test/1' }] } }))).toBe(true);
  });
  it('resets stateful regexes between rows and ignores empty mute lines', () => {
    expect(filterColumnPosts([post('a'), post('b'), post('c', { text: 'fine' })], {}, ['/Svelte/g', ''])).toEqual([post('c', { text: 'fine' })]);
  });
  it('filters grouped notification actors, text and types', () => {
    const groups = groupNotifications([
      { id: '1', type: 'favourite', platform: 'mastodon', createdAt: '2026-11-06', author: { handle: 'alice.test' }, text: 'Svelte' },
      { id: '2', type: 'follow', platform: 'bluesky', createdAt: '2026-11-06', author: { handle: 'bob.test' } },
    ]);
    expect(filterColumnNotifications(groups, { notificationTypes: ['like'], author: 'alice', searchTerm: 'svelte' })).toHaveLength(1);
    expect(filterColumnNotifications(groups, { notificationTypes: [] })).toEqual([]);
    expect(filterColumnNotifications(groups, {}, ['Svelte']).map(g => g.type)).toEqual(['follow']);
  });
});

describe('continuous reading', () => {
  it('prepends arrivals, updates duplicate rows and retains older pages', () => {
    const old = [post('b'), post('c'), post('d')];
    const next = mergeColumnPosts(old, [post('a'), post('b', { likeCount: 20 })]);
    expect(next.map(p => p.uri)).toEqual(['a', 'b', 'c', 'd']);
    expect(next[1].likeCount).toBe(20);
    expect(old[0].likeCount).toBeUndefined();
  });
  it('appends older rows without duplicating a page boundary', () => {
    expect(mergeColumnPosts([post('a'), post('b')], [post('b'), post('c'), post('c')], true).map(p => p.uri)).toEqual(['a', 'b', 'c']);
  });
  it('prevents in-flight responses from resurrecting deleted posts', () => {
    expect(withoutDeletedPosts([post('a'), post('b')], new Set(['a']))).toEqual([post('b')]);
  });
});

describe('scoped Bluesky live signals', () => {
  const event = (did: string, record: unknown = { text: 'hello' }) => ({ type: 'new-post' as const, platform: 'bluesky' as const, payload: { did, record, uri: `at://${did}/app.bsky.feed.post/1` } });
  it('rejects unrelated firehose authors for home and user columns', () => {
    const followed = new Set(['did:plc:friend']);
    expect(matchesBlueskyColumn(column(), event('did:plc:stranger'), 'did:plc:me', followed)).toBe(false);
    expect(matchesBlueskyColumn(column(), event('did:plc:friend'), 'did:plc:me', followed)).toBe(true);
    expect(matchesBlueskyColumn(column({ type: 'user' }), event('did:plc:stranger'), null, followed)).toBe(false);
  });
  it('accepts mentions only when the target DID is present', () => {
    const mention = event('did:plc:writer', { facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:me' }] }] });
    expect(matchesBlueskyColumn(column({ type: 'mentions' }), mention, 'did:plc:me')).toBe(true);
    expect(matchesBlueskyColumn(column({ type: 'mentions' }), mention, 'did:plc:other')).toBe(false);
  });
  it('accepts keyword matches and rejects unrelated notifications', () => {
    expect(matchesBlueskyColumn(column({ type: 'keyword-monitor', query: 'svelte' }), event('did:plc:writer', { text: 'Svelte news' }))).toBe(true);
    expect(matchesBlueskyColumn(column({ type: 'notifications' }), event('did:plc:writer'))).toBe(false);
  });
  it('does not establish a late subscription after a workspace has closed', async () => {
    let resolve!: (value: unknown) => void;
    const entry = { accountId: 42, platform: 'bluesky', client: { getFollows: vi.fn(() => new Promise(r => resolve = r)) } } as unknown as ClientEntry;
    const subscribe = vi.spyOn(streamManager, 'enableColumn');
    const cleanup = subscribeDeckColumn(column(), [account(42)], new Map([[42, entry]]), vi.fn(), vi.fn());
    cleanup(); resolve({ follows: [] });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe('actions stay with their source account', () => {
  it('uses the selected OAuth account, supports undo, and never tries another account on failure', async () => {
    const first = { accountId: 1, platform: 'bluesky', oauthAgent: { like: vi.fn() }, client: {} } as unknown as ClientEntry;
    const second = { accountId: 2, platform: 'bluesky', oauthAgent: { like: vi.fn().mockResolvedValue({ uri: 'at://like/1' }), deleteLike: vi.fn() }, client: {} } as unknown as ClientEntry;
    const row = post('at://post/1', { sourceAccountId: 2, raw: { post: { uri: 'at://post/1', cid: 'cid' } } });
    const clients = new Map([[1, first], [2, second]]);
    await performDeckAction(row, 'like', true, clients, [1, 2]);
    expect(second.oauthAgent!.like).toHaveBeenCalledWith(row.uri, 'cid');
    expect(first.oauthAgent!.like).not.toHaveBeenCalled();
    await performDeckAction(row, 'like', false, clients, [1, 2]);
    expect(second.oauthAgent!.deleteLike).toHaveBeenCalledWith('at://like/1');
    vi.mocked(second.oauthAgent!.like).mockRejectedValueOnce(new Error('expired'));
    await expect(performDeckAction(row, 'like', true, clients, [1, 2])).rejects.toThrow('expired');
    expect(first.oauthAgent!.like).not.toHaveBeenCalled();
  });
  it('refuses ambiguous or removed source accounts', async () => {
    const clients = new Map([[1, { accountId: 1, platform: 'bluesky' } as ClientEntry], [2, { accountId: 2, platform: 'bluesky' } as ClientEntry]]);
    await expect(performDeckAction(post('1'), 'like', true, clients, [1, 2])).rejects.toThrow('source account');
    await expect(performDeckAction(post('1', { sourceAccountId: 3 }), 'like', true, clients, [1, 2])).rejects.toThrow('source account');
  });
  it('uses Mastodon undo endpoints on the correct source instance', async () => {
    const client = { favourite: vi.fn(), unfavourite: vi.fn(), reblog: vi.fn(), unreblog: vi.fn() };
    const entry = { accountId: 3, platform: 'mastodon', client } as unknown as ClientEntry;
    const row = post('https://masto.test/1', { platform: 'mastodon', sourceAccountId: 3, raw: { id: '1' } });
    await performDeckAction(row, 'like', false, new Map([[3, entry]]), [3]);
    await performDeckAction(row, 'repost', false, new Map([[3, entry]]), [3]);
    expect(client.unfavourite).toHaveBeenCalledWith('1');
    expect(client.unreblog).toHaveBeenCalledWith('1');
  });
});

describe('private stream isolation and cleanup', () => {
  function sockets() {
    const opened: any[] = [];
    class Socket {
      readyState = 1;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      close = vi.fn();
      constructor(public url: string) { opened.push(this); }
    }
    vi.stubGlobal('WebSocket', Socket);
    return opened;
  }
  it('never shares authenticated user events between accounts on one Mastodon instance', () => {
    const opened = sockets();
    const first = vi.fn(), second = vi.fn();
    const one = streamManager.enableColumn({ columnId: 'one', platform: 'mastodon', instanceUrl: 'https://same.test', accessToken: 'one+&secret', streamType: 'user' }, first);
    const two = streamManager.enableColumn({ columnId: 'two', platform: 'mastodon', instanceUrl: 'https://same.test', accessToken: 'second', streamType: 'user' }, second);
    expect(opened).toHaveLength(2);
    expect(new URL(opened[0].url).searchParams.get('access_token')).toBe('one+&secret');
    opened[0].onmessage({ data: JSON.stringify({ event: 'notification', payload: JSON.stringify({ id: '1', type: 'mention' }) }) });
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ type: 'notification', payload: { id: '1', type: 'mention' } }));
    expect(second).not.toHaveBeenCalled();
    one(); two();
    expect(opened.every(socket => socket.close.mock.calls.length === 1)).toBe(true);
  });
  it('keeps shared sockets until the last subscriber leaves and disables by column ID', () => {
    const opened = sockets();
    const config = { platform: 'mastodon' as const, instanceUrl: 'https://same.test', accessToken: 'same', streamType: 'user' };
    streamManager.enableColumn({ ...config, columnId: 'first' }, vi.fn());
    streamManager.enableColumn({ ...config, columnId: 'second' }, vi.fn());
    expect(opened).toHaveLength(1);
    streamManager.disableColumn('first');
    expect(opened[0].close).not.toHaveBeenCalled();
    streamManager.disableColumn('second');
    expect(opened[0].close).toHaveBeenCalledTimes(1);
  });
});


describe('concurrent deck actions', () => {
  it('waits for a pending like before undoing from another column', async () => {
    let finish!: (value: { uri: string }) => void;
    const like = vi.fn(() => new Promise<{ uri: string }>(resolve => finish = resolve));
    const deleteLike = vi.fn().mockResolvedValue(undefined);
    const entry = { accountId: 5, platform: 'bluesky', client: {}, oauthAgent: { like, deleteLike } } as unknown as ClientEntry;
    const one = post('at://post/concurrent', { sourceAccountId: 5, raw: { post: { uri: 'at://post/concurrent', cid: 'cid' } } });
    const two = structuredClone(one);
    const clients = new Map([[5, entry]]);
    const adding = performDeckAction(one, 'like', true, clients, [5]);
    const removing = performDeckAction(two, 'like', false, clients, [5]);
    expect(deleteLike).not.toHaveBeenCalled();
    finish({ uri: 'at://like/pending' });
    await Promise.all([adding, removing]);
    expect(like).toHaveBeenCalledTimes(1);
    expect(deleteLike).toHaveBeenCalledWith('at://like/pending');
    expect((two.raw as any).post.viewer.like).toBeUndefined();
  });

  it('does not lose one viewer record when like and repost finish together', async () => {
    const entry = { accountId: 5, platform: 'bluesky', client: {}, oauthAgent: { like: vi.fn().mockResolvedValue({ uri: 'like' }), repost: vi.fn().mockResolvedValue({ uri: 'repost' }) } } as unknown as ClientEntry;
    const row = post('at://post/parallel', { sourceAccountId: 5, raw: { post: { uri: 'at://post/parallel', cid: 'cid' } } });
    const clients = new Map([[5, entry]]);
    await Promise.all([performDeckAction(row, 'like', true, clients, [5]), performDeckAction(row, 'repost', true, clients, [5])]);
    expect((row.raw as any).post.viewer).toEqual({ like: 'like', repost: 'repost' });
  });
});

describe('Threads source-account actions', () => {
  it('likes, unlikes and reposts through the account that supplied the post', async () => {
    const client = { like: vi.fn().mockResolvedValue(undefined), unlike: vi.fn().mockResolvedValue(undefined), repost: vi.fn().mockResolvedValue({ id: 'repost-id' }) };
    const other = { like: vi.fn() };
    const clients = new Map<number, ClientEntry>([[1, { accountId: 1, platform: 'threads', client } as unknown as ClientEntry], [2, { accountId: 2, platform: 'threads', client: other } as unknown as ClientEntry]]);
    const item = post('threads://42', { platform: 'threads', sourceAccountId: 1, raw: { id: '42' } });
    await performDeckAction(item, 'like', true, clients, [1, 2]);
    await performDeckAction(item, 'like', false, clients, [1, 2]);
    await performDeckAction(item, 'repost', true, clients, [1, 2]);
    await expect(performDeckAction(item, 'repost', false, clients, [1, 2])).rejects.toThrow('Undoing a Threads repost');
    expect(client.like).toHaveBeenCalledWith('42'); expect(client.unlike).toHaveBeenCalledWith('42');
    expect(client.repost).toHaveBeenCalledWith('42'); expect(other.like).not.toHaveBeenCalled();
  });
});
