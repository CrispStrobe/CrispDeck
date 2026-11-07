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
  goto: vi.fn(),
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
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
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
let intersect: IntersectionObserverCallback | undefined;
let intervals: ReturnType<typeof vi.spyOn>;
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
  intersect = undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  intervals = vi.spyOn(globalThis, 'setInterval');
});
afterEach(() => {
  app?.$destroy(); app = undefined; document.body.innerHTML = '';
  for (const result of intervals.mock.results) if (result.type === 'return') clearInterval(result.value);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function render() {
  const target = document.createElement('main'); target.id = 'main-content'; document.body.append(target);
  app = createClassComponent({ component: FeedPage, target }); flushSync(); return target;
}
async function ready(target: HTMLElement, text: string) {
  await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain(text); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); }
function mode(target: HTMLElement, label: string) {
  const button = [...target.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
  expect(button).toBeDefined(); button!.click(); flushSync();
}
function refresh(target: HTMLElement) {
  const feed = target.querySelector('[role=feed]')!;
  for (const [type, clientY] of [['touchstart', 0], ['touchmove', 180], ['touchend', 180]] as const) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientY }] });
    feed.dispatchEvent(event);
  }
  flushSync();
}

describe('feed reactions use the source account', () => {
  it('carries the source account and reply/quote metadata into the full composer', async () => {
    const row = post('Reply as work');
    work.getTimeline.mockResolvedValue({ data: { feed: [row], cursor: undefined } });
    const target = render(); await ready(target, 'Reply as work');
    target.querySelector<HTMLButtonElement>('button[aria-label^="Reply ("]')!.click();
    let params = new URL(mocks.goto.mock.calls[0][0], 'https://crispdeck.example').searchParams;
    expect(params.get('account')).toBe('2'); expect(params.get('replyCid')).toBe(row.post.cid);
    target.querySelector<HTMLButtonElement>('button[title="Quote"]')!.click();
    params = new URL(mocks.goto.mock.calls[1][0], 'https://crispdeck.example').searchParams;
    expect(params.get('account')).toBe('2'); expect(params.get('quoteCid')).toBe(row.post.cid);
  });
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

describe('feed request and cache isolation', () => {
  it('ignores a previous mode\'s slow refresh instead of replacing and caching it as the current feed', async () => {
    const pending = deferred<Awaited<ReturnType<typeof personal.getTimeline>>>();
    personal.getTimeline.mockResolvedValueOnce({ data: { feed: [post('Current timeline')], cursor: undefined } }).mockReturnValueOnce(pending.promise);
    personal.getAuthorFeed.mockResolvedValue({ feed: [post('My own posts')], cursor: undefined });
    const target = render(); await ready(target, 'Current timeline');
    refresh(target); await vi.waitFor(() => expect(personal.getTimeline).toHaveBeenCalledTimes(2));
    mode(target, 'My Posts'); await ready(target, 'My own posts');
    const writes = mocks.setCache.mock.calls.length;
    pending.resolve({ data: { feed: [post('Late old timeline')], cursor: 'old-cursor' } }); await settle();
    expect(target.textContent).toContain('My own posts');
    expect(target.textContent).not.toContain('Late old timeline');
    expect(mocks.setCache).toHaveBeenCalledTimes(writes);
  });

  it('does not append a previous view\'s late pagination page', async () => {
    const pending = deferred<Awaited<ReturnType<typeof personal.getTimeline>>>();
    personal.getTimeline.mockResolvedValueOnce({ data: { feed: [post('Timeline first page')], cursor: 'older' } }).mockReturnValueOnce(pending.promise);
    personal.getAuthorFeed.mockResolvedValue({ feed: [post('My posts only')], cursor: undefined });
    const target = render(); await ready(target, 'Timeline first page');
    intersect?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await vi.waitFor(() => expect(personal.getTimeline).toHaveBeenCalledTimes(2));
    mode(target, 'My Posts'); await ready(target, 'My posts only');
    pending.resolve({ data: { feed: [post('Old timeline pagination')], cursor: undefined } }); await settle();
    expect(target.textContent).not.toContain('Old timeline pagination');
  });

  it('does not install listeners or fetch feeds after an unfinished mount is destroyed', async () => {
    const pending = deferred<{ accounts: Account[]; clients: Map<number, ClientEntry> }>();
    mocks.initAllClients.mockReturnValueOnce(pending.promise);
    render();
    await vi.waitFor(() => expect(mocks.initAllClients).toHaveBeenCalledOnce());
    const subscriptions = mocks.watchConnection.mock.calls.length;
    app!.$destroy(); app = undefined;
    pending.resolve({ accounts, clients: new Map([[1, personal.entry], [2, work.entry]]) }); await settle();
    expect(personal.getTimeline).not.toHaveBeenCalled();
    expect(mocks.watchConnection).toHaveBeenCalledTimes(subscriptions);
  });

  it('keeps offline posts separate for each view and account identity', async () => {
    const stored = new Map<string, UnifiedPost[]>();
    mocks.cacheFeed.mockImplementation(async (key, posts) => { stored.set(key, posts); });
    mocks.loadCachedFeed.mockImplementation(async key => stored.has(key) ? { posts: stored.get(key), cachedAt: '2026-11-07T10:00:00Z' } : null);
    mocks.initAllClients.mockResolvedValue({ accounts: [accounts[0]], clients: new Map([[1, personal.entry]]) });
    personal.getTimeline.mockResolvedValue({ data: { feed: [post('Personal private timeline')], cursor: undefined } });
    personal.getAuthorFeed.mockRejectedValue(new Error('Offline'));
    const target = render(); await ready(target, 'Personal private timeline');
    const timelineKey = mocks.cacheFeed.mock.calls[0][0];
    mode(target, 'My Posts');
    await vi.waitFor(() => expect(mocks.loadCachedFeed).toHaveBeenCalled()); await settle();
    expect(mocks.loadCachedFeed.mock.calls[0][0]).not.toBe(timelineKey);
    expect(target.textContent).not.toContain('Personal private timeline');
    app!.$destroy(); app = undefined; document.body.innerHTML = '';
    // The local ID may be reused after a database reset; the account DID still
    // distinguishes a new login from the formerly cached private feed.
    const replacement = { ...accounts[0], did: 'did:plc:replacement', handle: 'replacement.bsky.social' };
    const next = fixture(replacement);
    next.getTimeline.mockRejectedValue(new Error('Offline')); next.getAuthorFeed.mockRejectedValue(new Error('Offline'));
    mocks.initAllClients.mockResolvedValue({ accounts: [replacement], clients: new Map([[1, next.entry]]) });
    const remounted = render();
    await vi.waitFor(() => expect(mocks.loadCachedFeed).toHaveBeenCalledTimes(2)); await settle();
    expect(mocks.loadCachedFeed.mock.calls[1][0]).not.toBe(timelineKey);
    expect(remounted.textContent).not.toContain('Personal private timeline');
  });

  it('passes cloneable plain posts to IndexedDB caching', async () => {
    personal.getTimeline.mockResolvedValue({ data: { feed: [post('Cache this post')], cursor: undefined } });
    const target = render(); await ready(target, 'Cache this post');
    const cachedPosts = mocks.cacheFeed.mock.calls[0][1];
    expect(() => structuredClone(cachedPosts)).not.toThrow();
  });

  it('clears cached content when a successful refresh reports an empty feed', async () => {
    personal.getTimeline.mockResolvedValueOnce({ data: { feed: [post('A removed post')], cursor: undefined } });
    const target = render(); await ready(target, 'A removed post');
    refresh(target);
    await vi.waitFor(() => expect(personal.getTimeline).toHaveBeenCalledTimes(2)); await settle();
    expect(target.textContent).not.toContain('A removed post');
    expect(mocks.cacheFeed.mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it('defers archive reads until For You is selected and shares the resulting history', async () => {
    personal.getTimeline.mockResolvedValue({ data: { feed: [post('Timeline without history work')], cursor: undefined } });
    const target = render(); await ready(target, 'Timeline without history work');
    expect(mocks.searchArchive).not.toHaveBeenCalled();
    mode(target, 'For You');
    await vi.waitFor(() => expect(mocks.searchArchive).toHaveBeenCalledTimes(3));
    mode(target, 'Timeline'); mode(target, 'For You'); await settle();
    expect(mocks.searchArchive).toHaveBeenCalledTimes(3);
  });
});
