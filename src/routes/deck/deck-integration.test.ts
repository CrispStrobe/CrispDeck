import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import DeckPage from './+page.svelte';
import { initAllClients } from '$lib/api/client-factory';
import { loadDeckPage, type DeckPage as LoadedPage } from '$lib/deck-loader';
import { loadPublishingEntries } from '$lib/deck-publishing';
import { loadConversationInbox } from '$lib/messages';
import { notifyColumn } from '$lib/column-notify';
import { i18n } from '$lib/i18n.svelte';
import type { DeckColumnConfig } from '$lib/deck-layouts';
import type { Account, UnifiedPost } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';
import { createLayout, getLayout, listLayouts, setActiveLayoutName } from '$lib/deck-layouts';
import { listAccounts } from '$lib/db';
import { subscribeDeckColumn } from '$lib/deck-live';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/components/Post.svelte', async () => ({ default: (await import('$lib/components/deck/test-fixtures/PostStub.svelte')).default }));
vi.mock('$lib/components/FloatingCompose.svelte', async () => ({ default: (await import('$lib/components/deck/test-fixtures/EmptyStub.svelte')).default }));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn(), invalidateClientCache: vi.fn() }));
vi.mock('$lib/deck-loader', () => ({ loadDeckPage: vi.fn(), supportsDeckLoader: (type: string) => !['messages', 'trending', 'rss'].includes(type) }));
vi.mock('$lib/deck-live', () => ({ subscribeDeckColumn: vi.fn(() => () => {}) }));
vi.mock('$lib/jetstream', () => ({ jetstream: { setEnabled: vi.fn() } }));
vi.mock('$lib/streaming', () => ({ streamManager: { disconnectAll: vi.fn() } }));
vi.mock('$lib/column-notify', () => ({ notifyColumn: vi.fn(), playColumnSound: vi.fn() }));
vi.mock('$lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('$lib/toast.svelte', () => ({ toast: { error: vi.fn() } }));
vi.mock('$lib/messages', () => ({ loadConversationInbox: vi.fn() }));
vi.mock('$lib/db', async importOriginal => ({ ...await importOriginal<typeof import('$lib/db')>(), listAccounts: vi.fn() }));
vi.mock('$lib/deck-publishing', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/deck-publishing')>(), loadPublishingEntries: vi.fn(),
}));

const accounts = [
  { id: 1, platform: 'bluesky', handle: 'writer.bsky', did: 'did:plc:writer' },
  { id: 2, platform: 'mastodon', handle: 'writer@masto.test' },
] as Account[];
const row = (uri: string, patch: Partial<UnifiedPost> = {}): UnifiedPost => ({ uri, text: `Post ${uri}`, author: { handle: 'friend.test' }, platform: 'bluesky', createdAt: '2026-11-06', isRepost: false, ...patch });
const page = (patch: Partial<LoadedPage> = {}): LoadedPage => ({ posts: [], cursors: { '1': null }, errors: [], hasMore: false, ...patch });
const notification = (id: string, type = 'mention', text = id) => ({ id, type, text, createdAt: '2026-11-06', platform: 'bluesky' as const, author: { handle: 'friend.test' }, sourceAccount: accounts[0].handle, sourceAccountId: 1 });
let instance: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  localStorage.setItem('crispdeck-live-counters', 'false');
  vi.mocked(listAccounts).mockReset().mockResolvedValue(accounts);
  vi.mocked(initAllClients).mockReset().mockResolvedValue({ accounts, clients: new Map() });
  vi.mocked(loadDeckPage).mockReset().mockResolvedValue(page());
  vi.mocked(loadPublishingEntries).mockReset().mockResolvedValue([]);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(async () => {
  if (instance) await unmount(instance); instance = undefined;
  document.body.innerHTML = ''; vi.restoreAllMocks();
});

async function settle() { for (let index = 0; index < 6; index++) await tick(); }
async function render(column: Partial<DeckColumnConfig> | DeckColumnConfig[] = {}) {
  const columns = Array.isArray(column) ? column : [{ id: 'column', title: 'Test column', type: 'timeline', ...column }];
  localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
  const target = document.createElement('div'); document.body.appendChild(target);
  instance = mount(DeckPage, { target }); flushSync(); await settle();
  return target;
}
async function refresh(target: ParentNode) {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t.common.refreshColumn}"]`)!;
  flushSync(() => button.click()); await settle();
}

describe('deck integration boundaries', () => {
  it('prevents workspace writes during local restore, then saves restored columns while network clients are still initializing', async () => {
    const saved: DeckColumnConfig[] = [{ id: 'restored', title: 'Saved column', type: 'timeline', accountIds: [2] }];
    createLayout('Existing', saved); setActiveLayoutName('Existing');
    let restore!: (value: Account[]) => void;
    vi.mocked(listAccounts).mockImplementationOnce(() => new Promise(resolve => { restore = resolve; }));
    vi.mocked(initAllClients).mockImplementationOnce(() => new Promise(() => {}));
    const target = await render(saved);
    const button = (name: string) => [...target.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === name)!;
    const workspaces = button(i18n.t.deck.manageWorkspaces);
    expect(workspaces.disabled).toBe(true);
    expect(button(i18n.t.workflow.starterWorkspaces).disabled).toBe(true);
    expect(button('Add Column').disabled).toBe(true);
    flushSync(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
    expect(button('Home Timeline')).toBeUndefined();
    flushSync(() => workspaces.click());
    expect(target.querySelector('dialog')).toBeNull();
    expect(listLayouts().map(layout => layout.name)).toEqual(['Existing']);
    expect(getLayout('Existing')?.columns).toEqual(saved);
    expect(JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)).toEqual(saved);
    restore(accounts); await settle();
    expect(workspaces.disabled).toBe(false);
    expect(target.querySelector('[role="region"][aria-label="Saved column"]')).not.toBeNull();
    expect(button('Home Timeline')).toBeUndefined();
    const addColumn = button('Add Column');
    addColumn.focus();
    flushSync(() => addColumn.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
    expect(button('Home Timeline')).toBeDefined();
    flushSync(() => addColumn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    flushSync(() => workspaces.click());
    const input = target.querySelector<HTMLInputElement>('#workspace-name')!;
    flushSync(() => { input.value = 'Monitoring'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    flushSync(() => button(i18n.t.deck.saveCurrentWorkspace).click());
    expect(getLayout('Monitoring')?.columns).toEqual(saved);
    expect(getLayout('Monitoring')?.columns[0].accountIds).toEqual([2]);
    expect(loadDeckPage).not.toHaveBeenCalled();
  });

  it('keeps setup controls protected after initialization fails instead of saving the initial empty array', async () => {
    const saved: DeckColumnConfig[] = [{ id: 'restored', title: 'Saved column', type: 'timeline', accountIds: [2] }];
    createLayout('Existing', saved); setActiveLayoutName('Existing');
    vi.mocked(listAccounts).mockRejectedValueOnce(new Error('Account storage unavailable'));
    const target = await render(saved);
    const controls = [...target.querySelectorAll<HTMLButtonElement>('button')].filter(button => [i18n.t.deck.manageWorkspaces, i18n.t.workflow.starterWorkspaces, 'Add Column'].includes(button.textContent?.trim() ?? ''));
    expect(controls).toHaveLength(3);
    expect(controls.every(button => button.disabled)).toBe(true);
    expect(getLayout('Existing')?.columns).toEqual(saved);
    expect(JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)).toEqual(saved);
  });

  it('allows workspace management after an intentionally empty deck has initialized', async () => {
    const target = await render([]);
    const workspaces = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === i18n.t.deck.manageWorkspaces)!;
    expect(workspaces.disabled).toBe(false);
  });

  it('keeps a workspace switched during a slow login when the client result eventually arrives', async () => {
    const switched: DeckColumnConfig[] = [{ id: 'switched', title: 'Switched while waiting', type: 'timeline', accountIds: [1] }];
    createLayout('Other workspace', switched);
    let initialize!: (value: Awaited<ReturnType<typeof initAllClients>>) => void;
    vi.mocked(initAllClients).mockImplementationOnce(() => new Promise(resolve => { initialize = resolve; }));
    const target = await render({ id: 'original', title: 'Original column', accountIds: [2] });
    const select = target.querySelector<HTMLSelectElement>('select')!;
    flushSync(() => { select.value = 'Other workspace'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    initialize({ accounts, clients: new Map() }); await settle();
    expect(target.querySelector('[role="region"][aria-label="Switched while waiting"]')).not.toBeNull();
    expect(target.querySelector('[role="region"][aria-label="Original column"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)).toEqual(switched);
    expect(getLayout('Other workspace')?.columns).toEqual(switched);
  });

  it('keeps a locally restored workspace editable if later network-client initialization fails', async () => {
    vi.mocked(initAllClients).mockRejectedValueOnce(new Error('Provider unavailable'));
    const target = await render({ title: 'Offline workspace', accountIds: [2] });
    const workspaces = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === i18n.t.deck.manageWorkspaces)!;
    expect(workspaces.disabled).toBe(false);
    expect(target.querySelector('[role="region"][aria-label="Offline workspace"]')).not.toBeNull();
    flushSync(() => workspaces.click());
    expect(target.querySelector('dialog[open]')).not.toBeNull();
  });

  it('refreshes changed account metadata and clients while retaining older pages and pagination', async () => {
    const cleanupStream = vi.fn();
    vi.mocked(subscribeDeckColumn).mockReturnValueOnce(cleanupStream);
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ posts: [row('head')], hasMore: true, cursors: { '1': 'page-two' } }))
      .mockResolvedValueOnce(page({ posts: [row('older')], hasMore: true, cursors: { '1': 'page-three' } }))
      .mockResolvedValueOnce(page({ posts: [row('new-head')], hasMore: true, cursors: { '1': 'fresh-head-cursor' } }))
      .mockResolvedValueOnce(page());
    const saved: DeckColumnConfig = { id: 'column', title: 'Following', type: 'timeline', accountIds: [1] };
    const target = await render([saved]);
    const olderButton = () => [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === i18n.t.deck.loadOlder)!;
    flushSync(() => olderButton().click()); await settle();
    const updatedAccounts = [{ ...accounts[0], display_name: 'Updated profile', avatar_url: 'https://avatar.example/new.png' }, accounts[1]];
    const clients = new Map<number, ClientEntry>([[1, { accountId: 1, platform: 'bluesky', handle: accounts[0].handle, client: {} as ClientEntry['client'] }]]);
    vi.mocked(listAccounts).mockResolvedValue(updatedAccounts);
    vi.mocked(initAllClients).mockResolvedValue({ accounts: updatedAccounts, clients });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: false } }));
    await settle();
    expect(cleanupStream).toHaveBeenCalledOnce();
    expect(loadDeckPage).toHaveBeenNthCalledWith(3, saved, updatedAccounts, clients, undefined);
    expect(target.querySelector('[data-post-uri="older"]')).not.toBeNull();
    expect(target.querySelector('[data-post-uri="new-head"]')).not.toBeNull();
    flushSync(() => olderButton().click()); await settle();
    expect(vi.mocked(loadDeckPage).mock.calls[3][3]).toEqual({ '1': 'page-three' });
    expect(JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)).toEqual([saved]);
    await unmount(instance!); instance = undefined;
    const calls = vi.mocked(initAllClients).mock.calls.length;
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    await settle(); expect(initAllClients).toHaveBeenCalledTimes(calls);
  });

  it('retires removed-account rows, streams and in-flight pages without widening an explicit selection', async () => {
    const cleanupStream = vi.fn();
    vi.mocked(subscribeDeckColumn).mockReturnValueOnce(cleanupStream);
    let finishPage!: (value: LoadedPage) => void;
    let finishClients!: (value: Awaited<ReturnType<typeof initAllClients>>) => void;
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ posts: [row('removed-account', { platform: 'mastodon', sourceAccountId: 2 })] }))
      .mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
    const saved: DeckColumnConfig = { id: 'column', title: 'Account two only', type: 'timeline', accountIds: [2] };
    const target = await render([saved]);
    await refresh(target);
    vi.mocked(listAccounts).mockResolvedValue([accounts[0]]);
    vi.mocked(initAllClients).mockImplementationOnce(() => new Promise(resolve => { finishClients = resolve; }));
    flushSync(() => window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } })));
    expect(target.querySelector('[data-post-uri="removed-account"]')).toBeNull();
    expect(cleanupStream).toHaveBeenCalledOnce();
    await settle();
    finishPage(page({ posts: [row('stale-private-row', { platform: 'mastodon', sourceAccountId: 2 })] })); await settle();
    expect(target.querySelector('[data-post-uri="stale-private-row"]')).toBeNull();
    finishClients({ accounts: [accounts[0]], clients: new Map() }); await settle();
    expect(target.textContent).toContain(i18n.t.deck.noSelectedAccounts);
    expect(loadDeckPage).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem('crispdeck-deck-columns')!)).toEqual([saved]);
  });

  it('clears old identity data on a metadata event when the remote account identity changed', async () => {
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ posts: [row('previous-identity', { sourceAccountId: 1 })], hasMore: true, cursors: { '1': 'old-identity-cursor' } }))
      .mockResolvedValueOnce(page({ posts: [row('new-identity', { sourceAccountId: 1 })] }));
    const target = await render({ accountIds: [1] });
    const rebound = [{ ...accounts[0], did: 'did:plc:replacement' }, accounts[1]];
    let finishClients!: (value: Awaited<ReturnType<typeof initAllClients>>) => void;
    vi.mocked(listAccounts).mockResolvedValue(rebound);
    vi.mocked(initAllClients).mockImplementationOnce(() => new Promise(resolve => { finishClients = resolve; }));
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: false } })); await settle();
    expect(target.querySelector('[data-post-uri="previous-identity"]')).toBeNull();
    finishClients({ accounts: rebound, clients: new Map() }); await settle();
    expect(target.querySelector('[data-post-uri="new-identity"]')).not.toBeNull();
    expect(vi.mocked(loadDeckPage).mock.calls[1][3]).toBeUndefined();
    expect([...target.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent?.trim() === i18n.t.deck.loadOlder)).toBe(false);
  });

  it('ignores a stale initial client result after a newer account change has loaded the deck', async () => {
    let finishOldClients!: (value: Awaited<ReturnType<typeof initAllClients>>) => void;
    vi.mocked(initAllClients).mockImplementationOnce(() => new Promise(resolve => { finishOldClients = resolve; }));
    const target = await render({ accountIds: [2] });
    vi.mocked(listAccounts).mockResolvedValue([accounts[0]]);
    vi.mocked(initAllClients).mockResolvedValue({ accounts: [accounts[0]], clients: new Map() });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } })); await settle();
    expect(target.textContent).toContain(i18n.t.deck.noSelectedAccounts);
    finishOldClients({ accounts, clients: new Map() }); await settle();
    expect(loadDeckPage).not.toHaveBeenCalled();
    expect(target.textContent).toContain(i18n.t.deck.noSelectedAccounts);
  });

  it('reorders from the dedicated keyboard and drag handle while respecting pinned columns', async () => {
    const saved: DeckColumnConfig[] = [
      { id: 'one', title: 'One', type: 'timeline' },
      { id: 'two', title: 'Two', type: 'timeline' },
      { id: 'pinned', title: 'Pinned', type: 'timeline', pinned: true },
    ];
    const target = await render(saved);
    const region = (name: string) => target.querySelector<HTMLElement>(`[role="region"][aria-label="${name}"]`)!;
    const handle = (name: string) => region(name).querySelector<HTMLButtonElement>('.drag-handle')!;
    const order = () => JSON.parse(localStorage.getItem('crispdeck-deck-columns')!).map((col: DeckColumnConfig) => col.id);
    expect(region('One').draggable).toBe(false);
    expect(handle('One').draggable).toBe(true);
    expect(handle('Pinned').draggable).toBe(false);
    flushSync(() => handle('One').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(order()).toEqual(['two', 'one', 'pinned']);
    flushSync(() => handle('One').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(order()).toEqual(['two', 'one', 'pinned']);
    flushSync(() => handle('One').dispatchEvent(new Event('dragstart', { bubbles: true })));
    flushSync(() => region('Two').parentElement!.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true })));
    expect(region('Two').parentElement!.className).toContain('ring-2');
    flushSync(() => region('Two').parentElement!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })));
    expect(order()).toEqual(['one', 'two', 'pinned']);
    expect(region('Two').parentElement!.className).not.toContain('ring-2');
  });

  it('alerts and counts only matching new notifications, never the first load or an older page', async () => {
    const first = notification('first');
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ notifications: [first], hasMore: true, cursors: { '1': 'older' } }))
      .mockResolvedValueOnce(page({ notifications: [first, notification('hidden-like', 'like'), notification('muted', 'mention', 'spoiler'), notification('new-mention')], hasMore: true, cursors: { '1': 'older' } }))
      .mockResolvedValueOnce(page({ notifications: [notification('older-mention')] }));
    const target = await render({ type: 'notifications', notify: 'both', filters: { notificationTypes: ['mention'] }, muteWords: ['spoiler'] });
    expect(notifyColumn).not.toHaveBeenCalled();
    await refresh(target);
    expect(notifyColumn).toHaveBeenCalledTimes(1);
    expect(notifyColumn).toHaveBeenCalledWith('both', 'Test column', 'new-mention');
    expect(target.textContent).toContain(i18n.t.deck.newPosts.replace('{count}', '1'));
    expect(target.textContent).not.toContain('hidden-like'); expect(target.textContent).not.toContain('spoiler');
    const older = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === i18n.t.deck.loadOlder)!;
    flushSync(() => older.click()); await settle();
    expect(notifyColumn).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('older-mention');
  });

  it('uses the latest notification mode if the user changes it during a request', async () => {
    let finish!: (value: LoadedPage) => void;
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ notifications: [notification('first')] }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const target = await render({ type: 'notifications', notify: 'both' });
    await refresh(target);
    flushSync(() => target.querySelector<HTMLButtonElement>('button[title="Notifications: both"]')!.click());
    finish(page({ notifications: [notification('first'), notification('new')] })); await settle();
    expect(notifyColumn).toHaveBeenCalledWith('off', 'Test column', 'new');
  });

  it.each([
    ['mastodon', undefined, [2]],
    ['mastodon', [], []],
    ['threads', undefined, []],
    ['all', undefined, undefined],
  ] as const)('passes the effective %s publishing account selection without widening it', async (platform, accountIds, expected) => {
    await render({ type: 'drafts', platform, accountIds: accountIds ? [...accountIds] : undefined });
    expect(vi.mocked(loadPublishingEntries).mock.calls.at(-1)).toEqual(['drafts', expected]);
  });

  it('replays a head refresh requested while the previous request was still loading', async () => {
    let finish!: (value: LoadedPage) => void;
    vi.mocked(loadDeckPage).mockResolvedValueOnce(page({ posts: [row('first')] }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(page({ posts: [row('latest'), row('first')] }));
    const target = await render();
    await refresh(target);
    document.dispatchEvent(new Event('visibilitychange'));
    finish(page({ posts: [row('first')] })); await settle();
    expect(loadDeckPage).toHaveBeenCalledTimes(3);
    expect(target.querySelector('[data-post-uri="latest"]')).not.toBeNull();
  });

  it('keeps keyboard focus within rendered rows rather than acting on a hidden fifty-first post', async () => {
    vi.mocked(loadDeckPage).mockResolvedValue(page({ posts: Array.from({ length: 60 }, (_, index) => row(`row-${index}`)) }));
    const target = await render();
    for (let index = 0; index < 55; index++) flushSync(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
    const rows = target.querySelectorAll('.deck-post');
    expect(rows).toHaveLength(50);
    expect(rows[49].className).toContain('ring-1');
  });

  it('opens a focused message through its conversation link instead of a fake post thread', async () => {
    vi.mocked(loadConversationInbox).mockResolvedValue({ conversations: [{ id: 'private-conversation', platform: 'bluesky', accountId: 1, participant: { handle: 'friend.test' }, lastMessage: 'Hello', lastDate: '2026-11-06', unread: true }], errors: [] });
    const target = await render({ type: 'messages', accountIds: [1] });
    const link = target.querySelector<HTMLAnchorElement>('[data-post-uri]')!;
    const click = vi.spyOn(link, 'click').mockImplementation(() => {});
    flushSync(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
    flushSync(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true })));
    expect(click).toHaveBeenCalledOnce();
    expect(link.getAttribute('href')).toBe('/messages?account=1&conversation=private-conversation&platform=bluesky');
  });

  it('removes a confirmed unlike only from the acting account’s likes columns and retains other rows, counts and older-page cursors', async () => {
    const otherAccount = { ...accounts[0], id: 3, handle: 'other.bsky', did: 'did:plc:other' };
    let finishUnlike!: () => void;
    let finishStale!: (value: LoadedPage) => void;
    const unlike = vi.fn(() => new Promise<void>(resolve => { finishUnlike = resolve; }));
    const otherUnlike = vi.fn();
    const client = (id: number, deleteLike: typeof unlike | typeof otherUnlike) => ({ accountId: id, platform: 'bluesky', client: {}, oauthAgent: { deleteLike } }) as unknown as ClientEntry;
    vi.mocked(initAllClients).mockResolvedValue({ accounts: [...accounts, otherAccount], clients: new Map([[1, client(1, unlike)], [3, client(3, otherUnlike)]]) });
    const likedRow = (sourceAccountId: number, uri = 'shared') => row(uri, { sourceAccountId, likeCount: 5, raw: { post: { uri, cid: 'cid', viewer: { like: `at://like/${sourceAccountId}/${uri}` } } } });
    let mirrorReads = 0;
    vi.mocked(loadDeckPage).mockImplementation(async (column, _accounts, _clients, cursors) => {
      if (column.id === 'mirror' && ++mirrorReads === 2) return new Promise(resolve => { finishStale = resolve; });
      if (column.id === 'likes' && cursors?.['1'] === 'older') return page({ posts: [likedRow(1, 'older-row')], cursors: { '1': 'oldest' }, hasMore: true });
      if (column.id === 'likes' && cursors?.['1'] === 'oldest') return page({ posts: [likedRow(1, 'oldest-row')] });
      return page({ posts: [likedRow(column.id === 'other' ? 3 : 1)], cursors: { '1': 'older' }, hasMore: true });
    });
    const target = await render([
      { id: 'likes', title: 'Likes A', type: 'likes', accountIds: [1] },
      { id: 'mirror', title: 'Likes A mirror', type: 'likes', accountIds: [1] },
      { id: 'other', title: 'Likes B', type: 'likes', accountIds: [3] },
      { id: 'home', title: 'Home A', type: 'timeline', accountIds: [1] },
    ]);
    const region = (title: string) => target.querySelector<HTMLElement>(`[role="region"][aria-label="${title}"]`)!;
    const olderButton = () => [...region('Likes A').querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === i18n.t.deck.loadOlder)!;
    flushSync(() => olderButton().click()); await settle();
    await refresh(region('Likes A mirror'));
    flushSync(() => region('Likes A').querySelector<HTMLButtonElement>('[data-post-uri="shared"] [data-test-like]')!.click());
    expect(region('Likes A').querySelector('[data-post-uri="shared"]')).not.toBeNull();
    finishUnlike(); await settle();
    expect(unlike).toHaveBeenCalledWith('at://like/1/shared');
    expect(otherUnlike).not.toHaveBeenCalled();
    expect(region('Likes A').querySelector('[data-post-uri="shared"]')).toBeNull();
    expect(region('Likes A mirror').querySelector('[data-post-uri="shared"]')).toBeNull();
    expect(region('Likes B').querySelector('[data-post-uri="shared"]')?.getAttribute('data-liked')).toBe('true');
    const homeRow = region('Home A').querySelector('[data-post-uri="shared"]')!;
    expect(homeRow.getAttribute('data-liked')).toBe('false');
    expect(homeRow.getAttribute('data-like-count')).toBe('4');
    expect(region('Likes A').querySelector('[data-post-uri="older-row"]')).not.toBeNull();
    finishStale(page({ posts: [likedRow(1)] })); await settle();
    expect(region('Likes A mirror').querySelector('[data-post-uri="shared"]')).toBeNull();
    flushSync(() => olderButton().click()); await settle();
    expect(loadDeckPage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'likes' }), expect.anything(), expect.anything(), { '1': 'oldest' });
    expect(region('Likes A').querySelector('[data-post-uri="older-row"]')).not.toBeNull();
    expect(region('Likes A').querySelector('[data-post-uri="oldest-row"]')).not.toBeNull();
  });

  it('leaves a liked row and its count intact when the unlike fails', async () => {
    const unlike = vi.fn().mockRejectedValue(new Error('Disconnected'));
    const client = { accountId: 1, platform: 'bluesky', client: {}, oauthAgent: { deleteLike: unlike } } as unknown as ClientEntry;
    vi.mocked(initAllClients).mockResolvedValue({ accounts, clients: new Map([[1, client]]) });
    vi.mocked(loadDeckPage).mockResolvedValue(page({ posts: [row('liked', { sourceAccountId: 1, likeCount: 5, raw: { post: { uri: 'liked', cid: 'cid', viewer: { like: 'at://like/1' } } } })] }));
    const target = await render({ type: 'likes', accountIds: [1] });
    flushSync(() => target.querySelector<HTMLButtonElement>('[data-test-like]')!.click()); await settle();
    expect(unlike).toHaveBeenCalledOnce();
    const article = target.querySelector('[data-post-uri="liked"]')!;
    expect(article.getAttribute('data-liked')).toBe('true');
    expect(article.getAttribute('data-like-count')).toBe('5');
    expect(article.querySelector('[role="alert"]')?.textContent).toContain('Disconnected');
  });
});
