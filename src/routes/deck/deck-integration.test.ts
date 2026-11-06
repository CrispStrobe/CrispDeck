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
  vi.mocked(initAllClients).mockResolvedValue({ accounts, clients: new Map() });
  vi.mocked(loadDeckPage).mockReset().mockResolvedValue(page());
  vi.mocked(loadPublishingEntries).mockReset().mockResolvedValue([]);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  if (instance) await unmount(instance); instance = undefined;
  document.body.innerHTML = ''; vi.restoreAllMocks();
});

async function settle() { for (let index = 0; index < 6; index++) await tick(); }
async function render(column: Partial<DeckColumnConfig> = {}) {
  localStorage.setItem('crispdeck-deck-columns', JSON.stringify([{ id: 'column', title: 'Test column', type: 'timeline', ...column }]));
  const target = document.createElement('div'); document.body.appendChild(target);
  instance = mount(DeckPage, { target }); flushSync(); await settle();
  return target;
}
async function refresh(target: ParentNode) {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t.common.refreshColumn}"]`)!;
  flushSync(() => button.click()); await settle();
}

describe('deck integration boundaries', () => {
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
});
