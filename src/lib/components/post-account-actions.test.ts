import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { UnifiedPost } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';

const boundaries = vi.hoisted(() => ({
  initAllClients: vi.fn(), addBookmark: vi.fn(), removeBookmark: vi.fn(),
  warning: vi.fn(), error: vi.fn(), success: vi.fn(), translateText: vi.fn(),
}));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: boundaries.initAllClients }));
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: boundaries.addBookmark, removeBookmark: boundaries.removeBookmark }));
vi.mock('$lib/toast.svelte', () => ({ toast: { warning: boundaries.warning, error: boundaries.error, success: boundaries.success } }));
vi.mock('$lib/translate', () => ({ translateText: boundaries.translateText }));
import Post from './Post.svelte';

const post: UnifiedPost = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/1', text: 'A saved post', createdAt: '2026-01-01T00:00:00Z',
  platform: 'bluesky', sourceAccountId: 2, sourceAccount: 'work.bsky.social', author: { handle: 'alice.bsky.social' }, isRepost: false,
  raw: { post: { uri: 'at://did:plc:alice/app.bsky.feed.post/1', cid: 'post-cid' } },
};
let instance: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  boundaries.addBookmark.mockResolvedValue(undefined); boundaries.removeBookmark.mockResolvedValue(undefined);
  boundaries.translateText.mockResolvedValue({ translated: 'Fallback translation', sourceLang: 'de', provider: 'Configured provider' });
});
afterEach(async () => { if (instance) await unmount(instance); instance = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

async function render(value = post, props: { feedPreview?: boolean } = {}) {
  const target = document.createElement('div'); document.body.append(target);
  instance = mount(Post, { target, props: { post: value, ...props } }); flushSync();
  const bookmark = target.querySelector<HTMLButtonElement>('[aria-label="Bookmark this post"]')!;
  await vi.waitFor(() => { flushSync(); expect(bookmark.disabled).toBe(false); });
  return { target, bookmark };
}
function blueskyClients() {
  const first = { did: 'did:plc:personal', call: vi.fn().mockResolvedValue({}) };
  const second = { did: 'did:plc:work', call: vi.fn().mockResolvedValue({}) };
  const clients = new Map<number, ClientEntry>([
    [1, { accountId: 1, platform: 'bluesky', handle: 'personal.bsky.social', oauthAgent: first } as unknown as ClientEntry],
    [2, { accountId: 2, platform: 'bluesky', handle: 'work.bsky.social', oauthAgent: second } as unknown as ClientEntry],
  ]);
  boundaries.initAllClients.mockResolvedValue({ accounts: [], clients });
  return { first, second, clients };
}
function mastodonClients() {
  const first = { getAccessToken: () => 'personal-token', getInstanceUrl: () => 'https://personal.example', votePoll: vi.fn() };
  const second = { getAccessToken: () => 'work-token', getInstanceUrl: () => 'https://work.example', votePoll: vi.fn() };
  const clients = new Map<number, ClientEntry>([
    [1, { accountId: 1, platform: 'mastodon', handle: 'personal@personal.example', client: first } as unknown as ClientEntry],
    [2, { accountId: 2, platform: 'mastodon', handle: 'work@work.example', client: second } as unknown as ClientEntry],
  ]);
  boundaries.initAllClients.mockResolvedValue({ accounts: [], clients });
  const value: UnifiedPost = { ...post, platform: 'mastodon', sourceAccount: 'work@work.example', uri: 'https://remote.example/@alice/remote-id',
    raw: { id: 'boost-id', reblog: { id: 'local-original-id', uri: 'https://remote.example/users/alice/statuses/remote-id', content: '<p>A poll</p>',
      poll: { id: 'local-poll-id', options: [{ title: 'First choice', votesCount: 0 }, { title: 'Second choice', votesCount: 0 }], votesCount: 0, voted: false, expired: false } } } };
  return { first, second, clients, value };
}

describe('post actions use their source account', () => {
  it.each([
    { platform: 'bluesky' as const, parent: 'at://did:plc:parent/app.bsky.feed.post/2', parameter: 'uri' },
    { platform: 'mastodon' as const, parent: '123456', parameter: 'id' },
    { platform: 'mastodon' as const, parent: 'https://remote.example/users/alice/statuses/789', parameter: 'uri' },
  ])('retains the source account in $platform reply-context navigation for $parameter', async ({ platform, parent, parameter }) => {
    const { target } = await render({ ...post, platform, replyParentUri: parent }, { feedPreview: true });
    const href = new URL(target.querySelector<HTMLAnchorElement>('.reply-context')!.href);
    expect(href.searchParams.get('account')).toBe('2');
    expect(href.searchParams.get('platform')).toBe(platform);
    expect(href.searchParams.get(parameter)).toBe(parent);
    expect(href.searchParams.has(parameter === 'id' ? 'uri' : 'id')).toBe(false);
  });

  it('creates and removes a native Bluesky bookmark using the second account only', async () => {
    const { first, second } = blueskyClients();
    const { bookmark } = await render();
    bookmark.click(); flushSync();
    await vi.waitFor(() => expect(second.call).toHaveBeenCalledTimes(1));
    expect(second.call).toHaveBeenCalledWith('app.bsky.bookmark.createBookmark', undefined, { uri: post.uri, cid: 'post-cid' }, { encoding: 'application/json' });
    await vi.waitFor(() => { flushSync(); expect(bookmark.disabled).toBe(false); });
    bookmark.click(); flushSync();
    await vi.waitFor(() => expect(second.call).toHaveBeenCalledTimes(2));
    expect(second.call).toHaveBeenLastCalledWith('app.bsky.bookmark.deleteBookmark', undefined, { uri: post.uri }, { encoding: 'application/json' });
    expect(first.call).not.toHaveBeenCalled();
    expect(boundaries.removeBookmark).toHaveBeenCalledWith(post.uri);
  });

  it('prevents rapid toggles while local storage and native sync are pending', async () => {
    const { second } = blueskyClients();
    let finishLocal!: () => void; let finishSync!: () => void;
    boundaries.addBookmark.mockReturnValue(new Promise<void>(resolve => finishLocal = resolve));
    second.call.mockReturnValue(new Promise<void>(resolve => finishSync = resolve));
    const { bookmark } = await render();
    bookmark.click(); flushSync(); bookmark.click(); flushSync();
    expect(bookmark.disabled).toBe(true); expect(bookmark.getAttribute('aria-busy')).toBe('true');
    expect(boundaries.addBookmark).toHaveBeenCalledTimes(1);
    finishLocal();
    await vi.waitFor(() => expect(second.call).toHaveBeenCalledTimes(1));
    bookmark.click(); flushSync();
    expect(boundaries.removeBookmark).not.toHaveBeenCalled();
    finishSync();
    await vi.waitFor(() => { flushSync(); expect(bookmark.disabled).toBe(false); });
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['missing', 'degraded', 'reused-id', 'ambiguous'] as const)('keeps the bookmark local when its account is %s without writing as another identity', async scenario => {
    const { first, second, clients } = blueskyClients();
    let value = post;
    if (scenario === 'missing') clients.delete(2);
    if (scenario === 'degraded') clients.get(2)!.degraded = true;
    if (scenario === 'reused-id') clients.get(2)!.handle = 'someone-else.bsky.social';
    if (scenario === 'ambiguous') value = { ...post, sourceAccountId: undefined, sourceAccount: undefined };
    const { bookmark } = await render(value);
    bookmark.click(); flushSync();
    await vi.waitFor(() => expect(boundaries.warning).toHaveBeenCalledTimes(1));
    expect(boundaries.addBookmark).toHaveBeenCalledTimes(1);
    expect(first.call).not.toHaveBeenCalled(); expect(second.call).not.toHaveBeenCalled();
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
  });

  it('votes on a boosted poll through the source Mastodon account and keeps its thread link scoped', async () => {
    const { first, second, value } = mastodonClients();
    second.votePoll.mockResolvedValue({ id: 'local-poll-id', voted: true, own_votes: [0], votes_count: 1,
      options: [{ title: 'First choice', votes_count: 1 }, { title: 'Second choice', votes_count: 0 }] });
    const { target } = await render(value);
    const option = [...target.querySelectorAll('button')].find(button => button.textContent?.trim() === 'First choice')!;
    option.click(); flushSync(); option.click(); flushSync();
    await vi.waitFor(() => expect(second.votePoll).toHaveBeenCalledTimes(1));
    expect(second.votePoll).toHaveBeenCalledWith('local-poll-id', [0]);
    expect(first.votePoll).not.toHaveBeenCalled();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('100%'); });
    expect(target.querySelector('a[href*="/thread?"]')?.getAttribute('href')).toContain('id=local-original-id&platform=mastodon&account=2');
  });

  it('authenticates server translation on the source instance using the original local status ID', async () => {
    const { value } = mastodonClients();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: '<p>Translated by source instance</p>', detected_source_language: 'de' }) });
    vi.stubGlobal('fetch', fetch);
    const { target } = await render(value);
    target.querySelector<HTMLButtonElement>('[aria-label="Translate post"]')!.click(); flushSync();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('https://work.example/api/v1/statuses/local-original-id/translate', {
      method: 'POST', headers: { Authorization: 'Bearer work-token' }, redirect: 'error',
    });
    expect(boundaries.translateText).not.toHaveBeenCalled();
  });
});
