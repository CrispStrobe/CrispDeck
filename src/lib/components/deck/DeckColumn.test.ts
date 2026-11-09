import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick, type ComponentProps } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import DeckColumn from './DeckColumn.svelte';
import { i18n } from '$lib/i18n.svelte';
import { measureItems, restoreAnchor } from '$lib/feed-scroll';
import { getReadPosition } from '$lib/read-position';
import { groupNotifications } from '$lib/notification-grouping';
import { playColumnSound } from '$lib/column-notify';
import type { UnifiedPost } from '$lib/types';

vi.mock('$lib/components/Post.svelte', async () => ({ default: (await import('./test-fixtures/PostStub.svelte')).default }));
vi.mock('$lib/feed-scroll', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/feed-scroll')>(),
  measureItems: vi.fn(), restoreAnchor: vi.fn(),
}));
vi.mock('$lib/read-position', () => ({ getReadPosition: vi.fn(), saveReadPosition: vi.fn(), flushReadPositions: vi.fn() }));
vi.mock('$lib/column-notify', () => ({ playColumnSound: vi.fn() }));

type Props = ComponentProps<typeof DeckColumn>;
let instance: ReturnType<typeof createClassComponent<Props, {}, {}, {}>> | undefined;
const post = (uri: string, patch: Partial<UnifiedPost> = {}): UnifiedPost => ({
  uri, text: `Post ${uri}`, author: { handle: 'writer.test' }, platform: 'bluesky',
  createdAt: '2026-11-06T10:00:00Z', isRepost: false, ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getReadPosition).mockReturnValue(null);
  vi.mocked(measureItems).mockImplementation(container => [...container.querySelectorAll<HTMLElement>('[data-feed-key]')].map((element, index) => ({ key: element.dataset.feedKey!, top: index * 100, height: 100 })));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  instance?.$destroy(); instance = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function render(props: Partial<Props> = {}) {
  const target = document.createElement('div'); document.body.appendChild(target);
  instance = createClassComponent({ component: DeckColumn, target, props: { id: 'test-column', title: 'Test column', type: 'timeline', posts: [], ...props } });
  flushSync(); await settle();
  return target;
}

async function settle() { await tick(); await tick(); }
async function update(props: Partial<Props>) { flushSync(() => instance!.$set(props)); await settle(); }
function button(target: ParentNode, text: string) {
  const result = [...target.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

describe('deck column rendering and continuous reading', () => {
  it('renders a named retry action for account errors and disables it during refresh', async () => {
    const onrefresh = vi.fn();
    const target = await render({ errors: ['The source account is disconnected.'], onrefresh });
    const status = target.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('The source account is disconnected.');
    const retry = button(status, 'Retry');
    expect(retry.textContent?.trim()).toBe(i18n.t.feed.retry);
    flushSync(() => retry.click());
    expect(onrefresh).toHaveBeenCalledOnce();
    await update({ loading: true });
    expect(button(status, 'Retry').disabled).toBe(true);
  });

  it('renders canonical parent matches without rejecting a trimmed display-name match', async () => {
    const target = await render({ posts: [post('one', { text: 'Hello', author: { handle: 'writer.test', displayName: 'Alice' } })], filters: { searchTerm: ' Alice ' } });
    expect(target.querySelectorAll('[data-post-uri]')).toHaveLength(1);
    expect(target.textContent).toContain('Alice');
  });

  it.each(['activity', 'followers'] as const)('never falls through to synthetic posts when all %s groups are filtered out', async type => {
    const target = await render({ type, posts: [post('synthetic', { text: 'Excluded activity' })], notificationGroups: [] });
    expect(target.querySelectorAll('[data-post-uri]')).toHaveLength(0);
    expect(target.textContent).not.toContain('Excluded activity');
    expect(target.textContent).toContain(i18n.t.feed.noPostsFound);
  });

  it('keeps notification pagination available after more than fifty activity events', async () => {
    const onloadmore = vi.fn();
    const groups = groupNotifications([{ id: 'event', platform: 'bluesky', type: 'like', createdAt: '2026-11-06', author: { handle: 'friend.test' }, text: 'A notification' }]);
    const target = await render({ type: 'activity', posts: Array.from({ length: 80 }, (_, index) => post(String(index))), notificationGroups: groups, hasOlder: true, onloadmore });
    flushSync(() => button(target, i18n.t.deck.loadOlder).click());
    expect(onloadmore).toHaveBeenCalledOnce();
  });

  it('makes every loaded conversation reachable and preserves its account-specific destination', async () => {
    const target = await render({ type: 'messages', posts: Array.from({ length: 51 }, (_, index) => post(`chat:${index}`, { sourceAccountId: 7, raw: { id: `conversation-${index}` } })) });
    expect(target.querySelectorAll('[data-post-uri]')).toHaveLength(50);
    flushSync(() => button(target, i18n.t.deck.showMore.replace('{count}', '1')).click());
    expect(target.querySelectorAll('[data-post-uri]')).toHaveLength(51);
    expect(target.querySelector('[data-post-uri="chat:50"]')?.getAttribute('href')).toBe('/messages?account=7&conversation=conversation-50&platform=bluesky');
  });

  it('opens a Mastodon notification through its canonical URL without choosing another account’s local status ID', async () => {
    const canonical = 'https://remote.example/users/alice/statuses/123';
    const groups = groupNotifications([{ id: 'masto-2-event', platform: 'mastodon', type: 'mention', createdAt: '2026-11-06', author: { handle: 'alice@remote.example' }, text: 'Notification text', postUri: canonical }]);
    const target = await render({ type: 'notifications', notificationGroups: groups });
    const link = [...target.querySelectorAll('a')].find(element => element.textContent === 'Notification text');
    expect(link?.getAttribute('href')).toBe(canonical);
    await update({ notificationGroups: [{ ...groups[0], postUri: 'javascript:alert(1)' }] });
    expect([...target.querySelectorAll('a')].some(element => element.textContent === 'Notification text')).toBe(false);
  });

  it('links both grouped actors and the liked post in the notification column', async () => {
    const uri = 'at://did:plc:reader/app.bsky.feed.post/parent';
    const groups = groupNotifications([
      { id: '1', platform: 'bluesky', type: 'like', createdAt: '2026-11-06', author: { handle: 'alice.test', displayName: '•' }, postUri: uri, sourceAccountId: 7, text: 'The liked post' },
      { id: '2', platform: 'bluesky', type: 'like', createdAt: '2026-11-06', author: { handle: 'bob.test' }, postUri: uri, sourceAccountId: 7 },
    ]);
    const target = await render({ type: 'notifications', notificationGroups: groups });
    expect([...target.querySelectorAll('a')].find(a => a.textContent === 'alice.test')?.getAttribute('href')).toContain('handle=alice.test');
    const postLink = [...target.querySelectorAll('a')].find(a => a.textContent === 'The liked post');
    expect(postLink?.getAttribute('href')).toContain('account=7');
    const toggle = target.querySelector<HTMLButtonElement>('[data-feed-key="notification:1"] [aria-expanded="false"]');
    expect(toggle).not.toBeNull();
    flushSync(() => toggle!.click());
    expect([...target.querySelectorAll('a')].some(a => a.textContent === 'bob.test' && a.getAttribute('href')?.includes('handle=bob.test'))).toBe(true);
  });

  it('does not jump to the head when older posts append to an unlocked column', async () => {
    const rows = [post('a'), post('b')];
    const target = await render({ posts: rows, scrollLock: false });
    const content = target.querySelector<HTMLElement>('.overflow-y-auto')!;
    content.scrollTop = 150;
    await update({ posts: [...rows, post('c')] });
    expect(content.scrollTo).not.toHaveBeenCalled();
    await update({ posts: [post('new'), ...rows, post('c')] });
    expect(content.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('clears a prior refresh anchor once the reader moves back to the top', async () => {
    const rows = [post('a'), post('b')];
    const target = await render({ posts: rows });
    const content = target.querySelector<HTMLElement>('.overflow-y-auto')!;
    content.scrollTop = 120;
    await update({ posts: [post('new'), ...rows] });
    expect(restoreAnchor).toHaveBeenCalledWith(content, { key: 'b', offset: 20 });
    vi.mocked(restoreAnchor).mockClear(); content.scrollTop = 0;
    await update({ posts: [post('newer'), post('new'), ...rows] });
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it('waits for asynchronously loaded rows before restoring a saved reading position', async () => {
    vi.mocked(getReadPosition).mockReturnValue({ lastSeenUri: 'saved', lastSeenAt: '2026-11-06', scrollY: 35 });
    const target = await render({ posts: [], loading: true });
    expect(restoreAnchor).not.toHaveBeenCalled();
    await update({ posts: [post('a'), post('saved')], loading: false });
    expect(restoreAnchor).toHaveBeenCalledWith(target.querySelector('.overflow-y-auto'), { key: 'saved', offset: 35 });
  });

  it('reveals an already loaded saved anchor beyond the initial render page', async () => {
    vi.mocked(getReadPosition).mockReturnValue({ lastSeenUri: 'row-60', lastSeenAt: '2026-11-06', scrollY: 15 });
    const target = await render({ posts: Array.from({ length: 70 }, (_, index) => post(`row-${index}`)) });
    expect(target.querySelector('[data-feed-key="row-60"]')).not.toBeNull();
    expect(restoreAnchor).toHaveBeenCalledWith(target.querySelector('.overflow-y-auto'), { key: 'row-60', offset: 15 });
  });

  it('requests desktop permission from the mode-change gesture and activates sound when selected', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    const onnotifychange = vi.fn();
    const target = await render({ notify: 'sound', onnotifychange });
    flushSync(() => target.querySelector<HTMLButtonElement>('button[title="Notifications: sound"]')!.click());
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(onnotifychange).toHaveBeenCalledWith('desktop');
    await update({ notify: 'off' });
    flushSync(() => target.querySelector<HTMLButtonElement>('button[title="Notifications: off"]')!.click());
    expect(playColumnSound).toHaveBeenCalledOnce();
  });
});
