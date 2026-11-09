import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';
const mocks = vi.hoisted(() => ({ initAllClients: vi.fn(), navigate: undefined as ((navigation: { to: { url: URL } }) => void) | undefined }));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: mocks.initAllClients, getBskyAgent: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: (callback: typeof mocks.navigate) => { mocks.navigate = callback; } }));
vi.mock('$lib/bookmarks', () => ({ isBookmarked: async () => false, addBookmark: vi.fn(), removeBookmark: vi.fn() }));
import ThreadPage from '../routes/thread/+page.svelte';
import { goto } from '$app/navigation';

const uri = 'at://did:plc:author/app.bsky.feed.post/main';
const accounts = [
  { id: 1, platform: 'bluesky', did: 'did:plc:personal', handle: 'personal.bsky.social' },
  { id: 2, platform: 'bluesky', did: 'did:plc:work', handle: 'work.bsky.social' },
] as Account[];
function response(text: string) {
  return { data: { thread: { post: { uri, cid: 'cid', author: { handle: 'author.bsky.social' }, record: { text, createdAt: '2026-01-01T00:00:00Z' } } } } };
}
function fixture(account: Account) {
  const getPostThread = vi.fn(async () => response(`Thread for ${account.handle}`));
  const like = vi.fn(async () => ({ uri: 'at://did:plc:personal/app.bsky.feed.like/1' }));
  const deleteLike = vi.fn(async () => {});
  return { getPostThread, like, deleteLike, entry: { accountId: account.id, platform: 'bluesky', handle: account.handle, client: {}, oauthAgent: { did: account.did, getPostThread, like, deleteLike } } as unknown as ClientEntry };
}
let personal: ReturnType<typeof fixture>;
let work: ReturnType<typeof fixture>;
let app: ReturnType<typeof createClassComponent> | undefined;
beforeEach(() => {
  vi.mocked(goto).mockClear();
  mocks.initAllClients.mockReset(); mocks.navigate = undefined;
  personal = fixture(accounts[0]); work = fixture(accounts[1]);
  mocks.initAllClients.mockResolvedValue({ accounts, clients: new Map([[1, personal.entry], [2, work.entry]]) });
});
afterEach(() => { app?.$destroy(); app = undefined; document.body.innerHTML = ''; });
function navigate(accountId: number) {
  mocks.navigate?.({ to: { url: new URL(`https://crispdeck.example/thread?platform=bluesky&account=${accountId}&uri=${encodeURIComponent(uri)}`) } });
  flushSync();
}
function render(accountId = 1) {
  const target = document.createElement('div'); document.body.append(target);
  app = createClassComponent({ component: ThreadPage, target }); flushSync(); navigate(accountId); return target;
}

describe('scoped thread page navigation', () => {
  it('preserves the selected account when replying or quoting from a thread', async () => {
    const target = render(2);
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for work.bsky.social'); });
    target.querySelector<HTMLButtonElement>('button[aria-label^="Reply ("]')!.click();
    let params = new URL(String(vi.mocked(goto).mock.calls[0][0]), 'https://crispdeck.example').searchParams;
    expect(params.get('account')).toBe('2'); expect(params.get('replyCid')).toBe('cid');
    const more = target.querySelector<HTMLButtonElement>('button[aria-label="More post actions"]')!;
    more.click(); flushSync();
    const quote = target.querySelector<HTMLButtonElement>('button[aria-label="Quote post"]')!;
    expect(quote.closest<HTMLElement>('[role="group"]')!.hidden).toBe(false);
    quote.click(); flushSync();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    params = new URL(String(vi.mocked(goto).mock.calls[1][0]), 'https://crispdeck.example').searchParams;
    expect(params.get('account')).toBe('2'); expect(params.get('quoteCid')).toBe('cid');
  });
  it('likes and unlikes a reply with the account that loaded the thread', async () => {
    const loaded = response('Root');
    const childUri = 'at://did:plc:other/app.bsky.feed.post/child';
    (loaded.data.thread as any).replies = [{ post: { uri: childUri, cid: 'child-cid', author: { handle: 'other.bsky.social' }, record: { text: 'A reply', createdAt: '2026-01-01T00:00:00Z', reply: { parent: { uri, cid: 'cid' }, root: { uri, cid: 'cid' } } } } }];
    personal.getPostThread.mockResolvedValueOnce(loaded);
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('A reply'); });
    const row = [...target.querySelectorAll<HTMLElement>('[data-thread-depth]')].find(el => el.textContent?.includes('A reply'))!;
    const button = row.querySelector<HTMLButtonElement>('button[aria-label^="Like ("]')!;
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(personal.like).toHaveBeenCalledWith(childUri, 'child-cid'));
    await vi.waitFor(() => { flushSync(); expect(button.disabled).toBe(false); });
    button.click();
    await vi.waitFor(() => expect(personal.deleteLike).toHaveBeenCalledWith('at://did:plc:personal/app.bsky.feed.like/1'));
    expect(work.like).not.toHaveBeenCalled();
  });
  it('reloads a reused route when only the selected account changes', async () => {
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for personal.bsky.social'); });
    navigate(2);
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for work.bsky.social'); });
    expect(target.textContent).not.toContain('Thread for personal.bsky.social');
    expect(personal.getPostThread).toHaveBeenCalledOnce(); expect(work.getPostThread).toHaveBeenCalledOnce();
  });

  it('ignores a slow response from the previous account after navigating to another', async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    personal.getPostThread.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const target = render();
    await vi.waitFor(() => expect(personal.getPostThread).toHaveBeenCalledOnce());
    navigate(2);
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for work.bsky.social'); });
    release(response('Late response from personal account'));
    await Promise.resolve(); await Promise.resolve(); flushSync();
    expect(target.textContent).not.toContain('Late response');
    expect(target.textContent).toContain('Thread for work.bsky.social');
  });

  it('clears the previous thread and shows an unavailable-account error instead of falling back', async () => {
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for personal.bsky.social'); });
    navigate(99);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('selected account is not available'); });
    expect(target.textContent).not.toContain('Thread for personal.bsky.social');
    expect(personal.getPostThread).toHaveBeenCalledOnce(); expect(work.getPostThread).not.toHaveBeenCalled();
  });

  it('renders replies beneath their parent and keeps author continuations in article mode', async () => {
    const loaded = response('Root article');
    const thread: any = loaded.data.thread;
    const child = (id: string, text: string, author: string, parent: string) => ({ post: {
      uri: `at://${author}/app.bsky.feed.post/${id}`, cid: id, author: { did: author, handle: author === 'did:plc:author' ? 'author.bsky.social' : 'visitor.bsky.social' },
      record: { text, createdAt: '2026-01-01T00:00:00Z', reply: { parent: { uri: parent, cid: 'parent' }, root: { uri, cid: 'root' } } },
    } });
    const first: any = child('part-2', 'Second article section', 'did:plc:author', uri);
    const visitor: any = child('visitor', 'A visitor question', 'did:plc:visitor', uri);
    visitor.replies = [child('answer', 'Answer outside the article', 'did:plc:author', visitor.post.uri)];
    first.replies = [child('part-3', 'Third article section', 'did:plc:author', first.post.uri)];
    thread.replies = [visitor, first];
    personal.getPostThread.mockResolvedValueOnce(loaded);
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Third article section'); });
    const rows = [...target.querySelectorAll<HTMLElement>('[data-thread-depth]')];
    expect(rows.map(row => [row.textContent?.trim(), row.dataset.threadDepth])).toEqual([
      [expect.stringContaining('Root article'), '0'],
      [expect.stringContaining('Second article section'), '1'],
      [expect.stringContaining('Third article section'), '2'],
      [expect.stringContaining('A visitor question'), '1'],
      [expect.stringContaining('Answer outside the article'), '2'],
    ]);
    const articleToggle = [...target.querySelectorAll('button')].find(button => button.textContent?.includes('Read as article'));
    expect(articleToggle).toBeDefined();
    articleToggle!.click(); flushSync();
    const article = target.querySelector('article');
    expect(article?.textContent).toContain('Root article'); expect(article?.textContent).toContain('Third article section');
    expect(article?.textContent).not.toContain('Answer outside the article');
  });

  it('starts an article after an intervening author and retains same-DID parts after a handle change', async () => {
    const loaded = response('Selected author response');
    const thread: any = loaded.data.thread;
    const earlierUri = 'at://did:plc:author/app.bsky.feed.post/earlier';
    const questionUri = 'at://did:plc:visitor/app.bsky.feed.post/question';
    const record = (text: string, parent?: string) => ({ text, createdAt: '2026-01-01T00:00:00Z',
      ...(parent ? { reply: { parent: { uri: parent, cid: 'parent' }, root: { uri: earlierUri, cid: 'earlier' } } } : {}),
    });
    thread.post.record = record('Selected author response', questionUri);
    thread.parent = {
      post: { uri: questionUri, cid: 'question', author: { handle: 'visitor.bsky.social' }, record: record('An intervening question', earlierUri) },
      parent: { post: { uri: earlierUri, cid: 'earlier', author: { handle: 'author.bsky.social' }, record: record('An earlier separate contribution') } },
    };
    thread.replies = [{ post: {
      uri: 'at://did:plc:author/app.bsky.feed.post/continuation', cid: 'continuation',
      author: { handle: 'renamed-author.bsky.social' }, record: record('Same author continuation', uri),
    } }];
    personal.getPostThread.mockResolvedValueOnce(loaded);
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Same author continuation'); });
    const toggle = [...target.querySelectorAll('button')].find(button => button.textContent?.includes('Read as article'));
    expect(toggle).toBeDefined(); toggle!.click(); flushSync();
    const article = target.querySelector('article')!;
    expect(article.textContent).toContain('Selected author response');
    expect(article.textContent).toContain('Same author continuation');
    expect(article.textContent).not.toContain('An intervening question');
    expect(article.textContent).not.toContain('An earlier separate contribution');
  });

  it('refreshes a scoped thread after reconnection and removes it when that account disappears', async () => {
    const target = render();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Thread for personal.bsky.social'); });
    const restored = fixture(accounts[0]);
    restored.getPostThread.mockResolvedValue(response('Refreshed account session'));
    mocks.initAllClients.mockResolvedValue({ accounts, clients: new Map([[1, restored.entry], [2, work.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: false } }));
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Refreshed account session'); });
    expect(personal.getPostThread).toHaveBeenCalledOnce();
    mocks.initAllClients.mockResolvedValue({ accounts: [accounts[1]], clients: new Map([[2, work.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('selected account is not available'); });
    expect(target.textContent).not.toContain('Refreshed account session');
    expect(work.getPostThread).not.toHaveBeenCalled();
  });
});
