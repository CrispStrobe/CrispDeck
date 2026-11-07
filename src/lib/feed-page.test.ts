import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { Account, UnifiedPost } from './types';
import type { ClientEntry } from './api/client-factory';

const mocks = vi.hoisted(() => ({
  initAllClients: vi.fn(), peekCachedClients: vi.fn(), retryDegradedClients: vi.fn(),
  searchArchive: vi.fn(), getCached: vi.fn(), setCache: vi.fn(),
  cacheFeed: vi.fn(), loadCachedFeed: vi.fn(), watchConnection: vi.fn(),
  getReadPosition: vi.fn(), saveReadPosition: vi.fn(),
  listSavedFeeds: vi.fn(), searchFeedGenerators: vi.fn(),
  toast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/api/client-factory', () => ({
  initAllClients: mocks.initAllClients, peekCachedClients: mocks.peekCachedClients,
  retryDegradedClients: mocks.retryDegradedClients, invalidateClientCache: vi.fn(), getBskyAgent: vi.fn(),
}));
vi.mock('$lib/db', () => ({ listIdentities: async () => [] }));
vi.mock('$lib/archive', () => ({ searchArchive: mocks.searchArchive }));
vi.mock('$lib/bluesky-prefs', () => ({ syncMutedWordsFromServer: vi.fn() }));
vi.mock('$lib/bluesky-feeds', () => ({
  listSavedFeeds: mocks.listSavedFeeds, searchFeedGenerators: mocks.searchFeedGenerators,
  pinFeed: vi.fn(), unpinFeed: vi.fn(), FOLLOWING: { kind: 'timeline', key: 'timeline', title: 'Following' },
}));
vi.mock('$lib/view-cache', () => ({ getCached: mocks.getCached, setCache: mocks.setCache, isStale: () => false }));
vi.mock('$lib/offline-cache', () => ({ cacheFeed: mocks.cacheFeed, loadCachedFeed: mocks.loadCachedFeed, formatCachedTime: () => 'now', isOffline: () => false }));
vi.mock('$lib/offline-status', () => ({ watchConnection: mocks.watchConnection, cachedDataBanner: () => 'Cached data' }));
vi.mock('$lib/read-position', () => ({ getReadPosition: mocks.getReadPosition, saveReadPosition: mocks.saveReadPosition, flushReadPositions: vi.fn() }));
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: vi.fn(), removeBookmark: vi.fn() }));
vi.mock('$lib/toast.svelte', () => ({ toast: mocks.toast }));
import FeedPage from '../routes/feed/+page.svelte';

const accounts = [
  { id: 1, platform: 'bluesky', did: 'did:plc:personal', handle: 'personal.bsky.social' },
  { id: 2, platform: 'bluesky', did: 'did:plc:work', handle: 'work.bsky.social' },
] as Account[];
let unique = 0;
function post(text: string) {
  return { post: { uri: `at://did:plc:writer/app.bsky.feed.post/${++unique}`, cid: `cid-${unique}`,
    author: { did: 'did:plc:writer', handle: 'writer.bsky.social' },
    record: { text, createdAt: '2026-11-07T10:00:00Z' },
  } };
}
function fixture(account: Account) {
  const getTimeline = vi.fn(async () => ({ data: { feed: [] as ReturnType<typeof post>[], cursor: undefined as string | undefined } }));
  const getAuthorFeed = vi.fn(async () => ({ feed: [] as ReturnType<typeof post>[], cursor: undefined as string | undefined }));
  const like = vi.fn(async () => ({ uri: `at://${account.did}/app.bsky.feed.like/one` }));
  const deleteLike = vi.fn(async () => {});
  const repost = vi.fn(async () => ({ uri: `at://${account.did}/app.bsky.feed.repost/one` }));
  const deleteRepost = vi.fn(async () => {});
  const agent = { did: account.did, api: { app: { bsky: { feed: { getTimeline } } } }, like, deleteLike, repost, deleteRepost };
  return { getTimeline, getAuthorFeed, like, deleteLike, repost, deleteRepost,
    entry: { accountId: account.id, platform: account.platform, handle: account.handle,
      client: { getAuthorFeed, getAgent: () => agent }, oauthAgent: agent } as unknown as ClientEntry };
}
let personal: ReturnType<typeof fixture>;
let work: ReturnType<typeof fixture>;
let app: ReturnType<typeof createClassComponent> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.peekCachedClients.mockReturnValue(undefined);
  mocks.retryDegradedClients.mockResolvedValue(undefined);
  mocks.getCached.mockReturnValue(null);
  mocks.getReadPosition.mockReturnValue(null);
  mocks.searchArchive.mockResolvedValue([]);
  mocks.listSavedFeeds.mockResolvedValue([]);
  mocks.searchFeedGenerators.mockResolvedValue([]);
  mocks.loadCachedFeed.mockResolvedValue(null);
  mocks.cacheFeed.mockResolvedValue(undefined);
  mocks.watchConnection.mockReturnValue(vi.fn());
  personal = fixture(accounts[0]); work = fixture(accounts[1]);
  mocks.initAllClients.mockResolvedValue({ accounts, clients: new Map([[1, personal.entry], [2, work.entry]]) });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { app?.$destroy(); app = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
function render() {
  const target = document.createElement('main'); target.id = 'main-content'; document.body.append(target);
  app = createClassComponent({ component: FeedPage, target }); flushSync(); return target;
}
async function ready(target: HTMLElement, text: string) {
  await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain(text); });
}

describe('feed reactions use the source account', () => {
  it('likes and unlikes with the account that supplied the row', async () => {
    const row = post('Work-only post');
    work.getTimeline.mockResolvedValue({ data: { feed: [row], cursor: undefined } });
    const target = render(); await ready(target, 'Work-only post');
    const button = target.querySelector<HTMLButtonElement>('button[aria-label^="Like ("]')!;
    button.click();
    await vi.waitFor(() => expect(work.like).toHaveBeenCalledWith(row.post.uri, row.post.cid));
    await vi.waitFor(() => { flushSync(); expect(button.disabled).toBe(false); });
    button.click();
    await vi.waitFor(() => expect(work.deleteLike).toHaveBeenCalledWith('at://did:plc:work/app.bsky.feed.like/one'));
    expect(personal.like).not.toHaveBeenCalled(); expect(personal.deleteLike).not.toHaveBeenCalled();
  });

  it('reposts and undoes the repost with the source account', async () => {
    const row = post('A post to repost');
    work.getTimeline.mockResolvedValue({ data: { feed: [row], cursor: undefined } });
    const target = render(); await ready(target, 'A post to repost');
    const button = target.querySelector<HTMLButtonElement>('button[aria-label^="Boost ("]')!;
    button.click();
    await vi.waitFor(() => expect(work.repost).toHaveBeenCalledWith(row.post.uri, row.post.cid));
    await vi.waitFor(() => { flushSync(); expect(button.disabled).toBe(false); });
    button.click();
    await vi.waitFor(() => expect(work.deleteRepost).toHaveBeenCalledWith('at://did:plc:work/app.bsky.feed.repost/one'));
    expect(personal.repost).not.toHaveBeenCalled(); expect(personal.deleteRepost).not.toHaveBeenCalled();
  });

  it('reverts a failed source-account action without retrying another identity', async () => {
    const row = post('Private work context');
    personal.getTimeline.mockResolvedValue({ data: { feed: [row], cursor: undefined } });
    personal.like.mockRejectedValue(new Error('Session expired'));
    const target = render(); await ready(target, 'Private work context');
    const button = target.querySelector<HTMLButtonElement>('button[aria-label^="Like ("]')!;
    button.click();
    await vi.waitFor(() => expect(personal.like).toHaveBeenCalledOnce());
    await vi.waitFor(() => { flushSync(); expect(button.disabled).toBe(false); });
    expect(work.like).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
