import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';
const publicReader = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/bluesky', () => ({ BlueskyClient: { readOnly: publicReader } }));
import { loadThreadPage, parseThreadRequest, threadErrorMessage } from './thread-loader';

const bskyAccounts = [
  { id: 1, platform: 'bluesky', did: 'did:plc:personal', handle: 'personal.bsky.social' },
  { id: 2, platform: 'bluesky', did: 'did:plc:work', handle: 'work.bsky.social' },
] as Account[];
const mastoAccounts = [
  { id: 3, platform: 'mastodon', handle: '@writer@one.example', instance_url: 'https://one.example' },
  { id: 4, platform: 'mastodon', handle: '@writer@two.example', instance_url: 'https://two.example' },
] as Account[];
const uri = 'at://did:plc:author/app.bsky.feed.post/main';
function bskyPost(id: string, text = id) {
  return { uri: `at://did:plc:author/app.bsky.feed.post/${id}`, cid: `cid-${id}`, record: { text, createdAt: '2026-01-01T00:00:00Z' }, author: { did: 'did:plc:author', handle: 'author.bsky.social' }, viewer: { like: 'at://did:plc:work/app.bsky.feed.like/1' } };
}
function bskyEntry(account: Account, oauth = true) {
  const getPostThread = vi.fn(async () => ({ data: { thread: { post: bskyPost('main', `Viewed as ${account.handle}`), parent: { post: bskyPost('parent') }, replies: [{ post: bskyPost('reply') }] } } }));
  const agent = { did: account.did, getPostThread };
  const client = { login: vi.fn(async () => {}), isAuthenticated: () => true, getAgent: vi.fn(() => agent), getPostThread: vi.fn() };
  const entry = { accountId: account.id, platform: 'bluesky', handle: account.handle, client, ...(oauth ? { oauthAgent: agent } : {}) } as unknown as ClientEntry;
  return { entry, getPostThread, client };
}
function mastoEntry(account: Account) {
  return { accountId: account.id, platform: 'mastodon', handle: account.handle, client: { getInstanceUrl: () => account.instance_url, getAccessToken: () => `token-${account.id}` } } as unknown as ClientEntry;
}
function status(id: string, origin = 'https://two.example', text = `Status ${id}`) {
  return { id, uri: `${origin}/users/author/statuses/${id}`, url: `${origin}/@author/${id}`, content: `<p>${text}</p>`, created_at: '2026-01-01T00:00:00Z', spoiler_text: 'Private context', visibility: 'direct', account: { acct: 'author', url: `${origin}/@author`, display_name: 'Author', avatar: '' }, media_attachments: [{ id: 'image', type: 'image', url: `${origin}/image.png` }] };
}
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
const request = (query: string) => parseThreadRequest(new URLSearchParams(query));

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

describe('thread account selection', () => {
  it('reads Bluesky main, ancestors, and replies through the exact OAuth account and stamps all posts', async () => {
    const personal = bskyEntry(bskyAccounts[0]); const work = bskyEntry(bskyAccounts[1]);
    const result = await loadThreadPage(request(`platform=bluesky&account=2&uri=${encodeURIComponent(uri)}`), bskyAccounts, new Map([[1, personal.entry], [2, work.entry]]));
    expect(work.getPostThread).toHaveBeenCalledWith({ uri, depth: 20, parentHeight: 80 });
    expect(personal.getPostThread).not.toHaveBeenCalled();
    expect(work.client.getPostThread).not.toHaveBeenCalled(); expect(work.client.getAgent).not.toHaveBeenCalled();
    for (const post of [result.mainPost!, ...result.ancestors, ...result.replies]) expect(post).toMatchObject({ sourceAccountId: 2, sourceAccount: 'work.bsky.social' });
    expect((result.mainPost!.raw as any).post.viewer.like).toBeTruthy();
  });

  it('supports an app-password account through its own authenticated agent', async () => {
    const work = bskyEntry(bskyAccounts[1], false);
    await loadThreadPage(request(`platform=bluesky&account=2&uri=${encodeURIComponent(uri)}`), bskyAccounts, new Map([[2, work.entry]]));
    expect(work.client.login).toHaveBeenCalledOnce(); expect(work.getPostThread).toHaveBeenCalledOnce();
  });

  it('retains long author continuations through the scoped OAuth loader', async () => {
    const work = bskyEntry(bskyAccounts[1]);
    const thread: any = { post: bskyPost('main'), replies: [] };
    let parent = thread;
    for (let index = 1; index <= 12; index++) {
      const post = bskyPost(`part-${index}`);
      const child = { post: { ...post, record: { ...post.record, reply: { parent: { uri: parent.post.uri, cid: parent.post.cid }, root: { uri, cid: 'cid-main' } } } }, replies: [] };
      parent.replies.push(child);
      parent = child;
    }
    // A malformed duplicate must not turn traversal into an infinite cycle.
    parent.replies.push(thread);
    work.getPostThread.mockResolvedValueOnce({ data: { thread } });
    const result = await loadThreadPage(request(`account=2&uri=${encodeURIComponent(uri)}`), bskyAccounts, new Map([[2, work.entry]]));
    expect(result.replies).toHaveLength(12);
    expect(result.replies.at(-1)).toMatchObject({ text: 'part-12', sourceAccountId: 2, replyParentUri: 'at://did:plc:author/app.bsky.feed.post/part-11' });
  });

  it.each([99, 3])('never substitutes another account when scoped account %s is unavailable or belongs to a different network', async accountId => {
    const personal = bskyEntry(bskyAccounts[0]);
    await expect(loadThreadPage(request(`platform=bluesky&account=${accountId}&uri=${encodeURIComponent(uri)}`), [...bskyAccounts, ...mastoAccounts], new Map([[1, personal.entry], [3, mastoEntry(mastoAccounts[0])]]))).rejects.toThrow('selected account');
    expect(personal.getPostThread).not.toHaveBeenCalled(); expect(publicReader).not.toHaveBeenCalled();
  });

  it('does not fall back for an expired or mismatched scoped OAuth session', async () => {
    const work = bskyEntry(bskyAccounts[1]);
    work.entry.degraded = true;
    await expect(loadThreadPage(request(`account=2&uri=${encodeURIComponent(uri)}`), bskyAccounts, new Map([[2, work.entry]]))).rejects.toThrow('selected account');
    work.entry.degraded = false; (work.entry.oauthAgent as any).did = 'did:plc:someone-else';
    await expect(loadThreadPage(request(`account=2&uri=${encodeURIComponent(uri)}`), bskyAccounts, new Map([[2, work.entry]]))).rejects.toThrow('Reconnect');
    expect(work.getPostThread).not.toHaveBeenCalled(); expect(publicReader).not.toHaveBeenCalled();
  });

  it('keeps unscoped public Bluesky browsing available without a connected account', async () => {
    const getPostThread = vi.fn(async () => ({ post: bskyPost('main') }));
    publicReader.mockReturnValue({ getPostThread });
    const result = await loadThreadPage(request(`uri=${encodeURIComponent(uri)}`), [], new Map());
    expect(getPostThread).toHaveBeenCalledWith(uri, 20); expect(result.mainPost?.sourceAccountId).toBeUndefined();
  });
});

describe('Mastodon local IDs and remote URIs', () => {
  it('loads the same numeric ID only on the selected instance using its token, including private context and media', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/context') ? json({ ancestors: [status('8')], descendants: [status('10')] }) : json(status('9', 'https://two.example', 'Private second account')));
    const result = await loadThreadPage(request('platform=mastodon&account=4&id=9'), mastoAccounts, new Map(mastoAccounts.map(account => [account.id, mastoEntry(account)])));
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://two.example');
      expect(options).toMatchObject({ headers: { Authorization: 'Bearer token-4' }, redirect: 'error' });
    }
    expect(result.mainPost).toMatchObject({ text: 'Private second account', sourceAccountId: 4, contentWarning: 'Private context', embeds: [{ id: 'image' }] });
    for (const post of [...result.ancestors, ...result.replies]) expect(post.sourceAccountId).toBe(4);
  });

  it('resolves a remote URI on the selected server instead of using its unrelated numeric suffix', async () => {
    const remote = status('9', 'https://remote.example');
    const localView = { ...remote, id: '12345' };
    vi.mocked(fetch).mockImplementation(async input => new URL(String(input)).pathname === '/api/v2/search' ? json({ statuses: [status('9'), localView] }) : json({ ancestors: [], descendants: [] }));
    const result = await loadThreadPage(request(`platform=mastodon&account=4&uri=${encodeURIComponent(remote.uri)}`), mastoAccounts, new Map([[4, mastoEntry(mastoAccounts[1])]]));
    const search = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(search.origin).toBe('https://two.example'); expect(search.searchParams.get('q')).toBe(remote.uri); expect(search.searchParams.get('resolve')).toBe('true');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://two.example/api/v1/statuses/12345/context');
    expect((result.mainPost?.raw as any).id).toBe('12345'); expect(result.mainPost?.uri).toBe(remote.uri);
  });

  it('rejects a local ID that does not match the supplied canonical URI', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(status('9')));
    await expect(loadThreadPage(request(`platform=mastodon&account=4&id=9&uri=${encodeURIComponent('https://remote.example/@author/9')}`), mastoAccounts, new Map([[4, mastoEntry(mastoAccounts[1])]]))).rejects.toThrow('does not match');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores search hits which only mention the URL and never loads a same-suffix local post', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ statuses: [status('9')] }));
    await expect(loadThreadPage(request(`platform=mastodon&account=4&uri=${encodeURIComponent('https://remote.example/@author/9')}`), mastoAccounts, new Map([[4, mastoEntry(mastoAccounts[1])]]))).rejects.toThrow('could not be resolved');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps public canonical-URL browsing on the origin server without sending credentials', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/context') ? json({ ancestors: [], descendants: [] }) : json(status('9', 'https://remote.example')));
    const result = await loadThreadPage(request('platform=mastodon&uri=https%3A%2F%2Fremote.example%2F%40author%2F9'), [], new Map());
    expect(result.mainPost?.sourceAccountId).toBeUndefined();
    for (const [url, options] of vi.mocked(fetch).mock.calls) { expect(new URL(String(url)).origin).toBe('https://remote.example'); expect(options?.headers).toEqual({}); }
  });

  it('returns API failures without silently showing an empty thread', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: 'Not authorized' }, 403));
    await expect(loadThreadPage(request('platform=mastodon&account=4&id=9'), mastoAccounts, new Map([[4, mastoEntry(mastoAccounts[1])]]))).rejects.toThrow('(403)');
  });
});

describe('thread navigation validation', () => {
  it.each(['', '0', '-1', '2x', '1.5'])('rejects invalid explicit account IDs (%s) without converting them into unscoped reads', value => {
    expect(() => request(`account=${value}&uri=${encodeURIComponent(uri)}`)).toThrow('selected account');
  });
  it('only accepts real Threads domains for external viewing', async () => {
    expect((await loadThreadPage(request('platform=threads&uri=https%3A%2F%2Fwww.threads.com%2F%40author%2Fpost%2F123'), [], new Map())).externalUrl).toContain('www.threads.com');
    await expect(loadThreadPage(request('platform=threads&uri=https%3A%2F%2Fthreads.com.evil.example%2Fpost%2F123'), [], new Map())).rejects.toThrow('public Threads');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('redacts private URLs and bearer values in navigation errors', () => {
    expect(threadErrorMessage(new Error('https://example.test/?access_token=secret Bearer also-secret'))).toBe('[URL] Bearer [redacted]');
  });
});
