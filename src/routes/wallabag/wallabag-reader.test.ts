import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { Writable } from 'svelte/store';
import type { WallabagAvailability } from '$lib/wallabag-availability';
import type { WallabagEntry, WallabagEntriesPage } from '$lib/wallabag';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), update: vi.fn(), refresh: vi.fn(), openExternal: vi.fn(),
  localEnabled: false, localResults: vi.fn(), scope: vi.fn(),
  sanitizerReady: undefined as Promise<void> | undefined,
}));
vi.mock('$lib/wallabag', () => ({ listWallabagEntries: mocks.list, getWallabagEntry: mocks.get, updateWallabagEntry: mocks.update, wallabagSearchScope: mocks.scope }));
vi.mock('$lib/search-cache', () => ({ getSearchCacheSettings: () => ({ enabled: mocks.localEnabled, wallabag: { enabled: true } }), searchCache: mocks.localResults }));
vi.mock('$lib/wallabag-availability', async () => {
  const { writable } = await import('svelte/store');
  return { wallabagAvailability: writable({ status: 'hidden', server: '', revision: 0 }), refreshWallabagAvailability: mocks.refresh };
});
vi.mock('$lib/external-link', () => ({ openExternalLink: mocks.openExternal }));
vi.mock('$lib/wallabag-content', async importOriginal => {
  const original = await importOriginal<typeof import('$lib/wallabag-content')>();
  return {
    ...original,
    loadWallabagSanitizer: async () => { await mocks.sanitizerReady; await original.loadWallabagSanitizer(); },
  };
});

import Reader from './+page.svelte';
import { wallabagAvailability } from '$lib/wallabag-availability';

const availability = wallabagAvailability as Writable<WallabagAvailability>;
const server = 'https://wallabag.example';
const ready: WallabagAvailability = { status: 'ready', server, revision: 1 };
const entry = (id: number, overrides: Partial<WallabagEntry> = {}): WallabagEntry => ({
  id, title: `Article ${id}`, url: `https://news.example/${id}`, content: `<p>Body ${id}</p>`,
  is_archived: false, is_starred: false, created_at: '2026-01-01T00:00:00Z', tags: [], ...overrides,
});
const page = (items: WallabagEntry[], current = 1, pages = 1, total = items.length): WallabagEntriesPage => ({ items, page: current, pages, total });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let instance: ReturnType<typeof createClassComponent> | undefined;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.sanitizerReady = undefined; mocks.localEnabled = false;
  mocks.scope.mockResolvedValue('wallabag:scope'); mocks.localResults.mockResolvedValue([]);
  availability.set(ready);
  mocks.refresh.mockResolvedValue(false);
  mocks.list.mockResolvedValue(page([entry(1), entry(2)]));
  mocks.get.mockImplementation(async (_server: string, id: number) => entry(id));
});
afterEach(() => {
  instance?.$destroy(); instance = undefined;
  flushSync(); document.body.innerHTML = '';
});

function render() {
  const target = document.createElement('div'); document.body.append(target);
  instance = createClassComponent({ component: Reader, target }); flushSync();
  return target;
}
function button(target: HTMLElement, label: string) {
  const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(item =>
    (item.getAttribute('aria-label') ?? item.textContent?.trim().replace(/\s+/g, ' ')) === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function select(target: HTMLElement, id: number) {
  const found = target.querySelector<HTMLButtonElement>(`[data-wallabag-entry="${id}"]`);
  if (!found) throw new Error(`Missing article: ${id}`);
  found.click(); flushSync();
}
async function expectArticle(target: HTMLElement, title: string) {
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('article h2')?.textContent).toBe(title); });
}
async function expectEntries(target: HTMLElement, ids: number[]) {
  await vi.waitFor(() => {
    flushSync();
    expect([...target.querySelectorAll('[data-wallabag-entry]')].map(item => Number(item.getAttribute('data-wallabag-entry')))).toEqual(ids);
  });
}

describe('Wallabag reader controls', () => {
  it('shows scoped local hits immediately, then replaces them with complete server results', async () => {
    const target = render(); await expectEntries(target, [1, 2]);
    mocks.localEnabled = true;
    mocks.localResults.mockResolvedValue([{ id: JSON.stringify(['wallabag', 'wallabag:scope', '9']), title: 'Local result', url: 'https://example.org/9', createdAt: '2026-01-01T00:00:00Z' }]);
    const network = deferred<WallabagEntriesPage>(); mocks.list.mockReturnValueOnce(network.promise);
    const input = target.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = 'theology'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expectEntries(target, [9]);
    expect(mocks.localResults).toHaveBeenCalledWith('theology', { source: 'wallabag', scope: 'wallabag:scope', limit: 100 });
    expect(target.textContent).toContain('Local excerpt results');
    network.resolve(page([entry(10)])); await expectEntries(target, [10]);
  });

  it('places the back, reading, favorite and original controls together before the article title', async () => {
    const target = render(); await expectEntries(target, [1, 2]);
    select(target, 1); await expectArticle(target, 'Article 1');
    const toolbar = target.querySelector('.article-actions')!;
    for (const label of ['Back to articles', 'Mark as read', 'Star article', 'Open original']) {
      expect(toolbar.querySelector(`[aria-label="${label}"]`)?.getAttribute('title')).toBe(label);
      expect(target.querySelector(`article .article-actions [aria-label="${label}"]`)).not.toBeNull();
    }
    expect(toolbar.textContent?.trim()).toBe('');
    expect(toolbar.compareDocumentPosition(target.querySelector('article h2')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows previews by default and respects the saved thumbnail setting', async () => {
    mocks.list.mockResolvedValue(page([entry(1, { preview_picture: 'https://news.example/picture.jpg' })]));
    const target = render(); await expectEntries(target, [1]);
    expect(target.querySelector<HTMLImageElement>('.entry-thumbnail')?.src).toBe('https://news.example/picture.jpg');
    instance?.$destroy(); instance = undefined; target.remove();
    localStorage.setItem('crispdeck-wallabag-thumbnails', 'false');
    const hidden = render(); await expectEntries(hidden, [1]);
    expect(hidden.querySelector('.entry-thumbnail')).toBeNull();
  });
  it('submits a search across all articles', async () => {
    const target = render(); await expectEntries(target, [1, 2]);
    const input = target.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = 'theology'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); flushSync();
    await vi.waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(server, { filter: 'all', page: 1, perPage: 20, search: 'theology' }));
  });
});

describe('Wallabag reader connection boundaries', () => {
  it('does not request articles before validation and clears a revoked account immediately', async () => {
    availability.set({ status: 'checking', server, revision: 1 });
    const target = render();
    expect(target.textContent).toContain('Checking your saved Wallabag connection');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();

    availability.set(ready);
    await expectEntries(target, [1, 2]);
    const pending = deferred<WallabagEntry>(); mocks.get.mockReturnValueOnce(pending.promise);
    select(target, 1);
    availability.set({ status: 'hidden', server: '', revision: 2 }); flushSync();
    expect(target.textContent).toContain('Wallabag is not connected');
    expect(target.querySelector('[data-wallabag-entry]')).toBeNull();
    pending.resolve(entry(1, { title: 'Old private article' }));
    await Promise.resolve(); flushSync();
    expect(target.textContent).not.toContain('Old private article');
    expect(target.querySelector('article')).toBeNull();
  });

  it('does not reload or close an article after a successful background credential check', async () => {
    const target = render(); await expectEntries(target, [1, 2]);
    select(target, 1); await expectArticle(target, 'Article 1');
    availability.set({ ...ready }); flushSync();
    await Promise.resolve(); flushSync();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(target.querySelector('article h2')?.textContent).toBe('Article 1');
    expect(document.activeElement).toBe(target.querySelector('article h2'));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('ignores a mutation from an earlier account on the same server', async () => {
    const target = render(); await expectEntries(target, [1, 2]);
    select(target, 1); await expectArticle(target, 'Article 1');
    const pending = deferred<WallabagEntry>(); mocks.update.mockReturnValueOnce(pending.promise);
    button(target, 'Mark as read').click(); flushSync();
    mocks.list.mockResolvedValueOnce(page([entry(9)]));
    availability.set({ status: 'ready', server, revision: 2 });
    await expectEntries(target, [9]);
    pending.resolve(entry(1, { title: 'Previous account article', is_archived: true }));
    await Promise.resolve(); flushSync();
    expect(target.querySelector('article')).toBeNull();
    expect(target.textContent).not.toContain('Previous account article');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});

describe('Wallabag reader requests and reading actions', () => {
  it('waits for the lazy sanitizer before rendering any article content', async () => {
    const sanitizer = deferred<void>();
    mocks.sanitizerReady = sanitizer.promise;
    const target = render(); await expectEntries(target, [1, 2]);
    select(target, 1);
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith(server, 1));
    await Promise.resolve(); flushSync();
    expect(target.querySelector('article')).toBeNull();
    expect(target.textContent).not.toContain('Body 1');
    sanitizer.resolve();
    await expectArticle(target, 'Article 1');
    expect(target.querySelector('article p')?.textContent).toBe('Body 1');
  });

  it('keeps the latest filter when responses finish out of order', async () => {
    const unread = deferred<WallabagEntriesPage>(); const starred = deferred<WallabagEntriesPage>();
    mocks.list.mockReturnValueOnce(unread.promise).mockReturnValueOnce(starred.promise);
    const target = render();
    button(target, 'Starred').click(); flushSync();
    expect(mocks.list).toHaveBeenLastCalledWith(server, { filter: 'starred', page: 1, perPage: 20 });
    starred.resolve(page([entry(2, { is_starred: true })]));
    await expectEntries(target, [2]);
    unread.resolve(page([entry(1)]));
    await Promise.resolve(); flushSync();
    await expectEntries(target, [2]);
    expect(button(target, 'Starred').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the most recently opened article and renders sanitized content', async () => {
    const first = deferred<WallabagEntry>(); const second = deferred<WallabagEntry>();
    mocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const target = render(); await expectEntries(target, [1, 2]);
    select(target, 1); select(target, 2);
    second.resolve(entry(2, { content: '<h3>Article section</h3><img src="https://cdn.example/photo.jpg" onerror="alert(1)"><a href="javascript:alert(1)">Bad link</a>' }));
    await expectArticle(target, 'Article 2');
    expect(target.querySelector('article h3')?.textContent).toBe('Article section');
    expect(target.querySelector('article img')?.hasAttribute('onerror')).toBe(false);
    expect(target.querySelector('article a[href^="javascript:"]')).toBeNull();
    first.resolve(entry(1));
    await Promise.resolve(); flushSync();
    expect(target.querySelector('article h2')?.textContent).toBe('Article 2');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('moves back before requesting a page emptied by an explicit archive action', async () => {
    mocks.list.mockResolvedValueOnce(page([entry(1)], 1, 2, 21));
    const target = render(); await expectEntries(target, [1]);
    mocks.list.mockResolvedValueOnce(page([entry(21)], 2, 2, 21));
    button(target, 'Next page').click(); flushSync();
    await expectEntries(target, [21]);
    select(target, 21); await expectArticle(target, 'Article 21');
    mocks.update.mockResolvedValueOnce(entry(21, { is_archived: true }));
    // An implementation that requests page 2 again meets Wallabag's actual
    // out-of-range rejection here, instead of a friendly empty-page fixture.
    mocks.list.mockImplementation(async (_server: string, options: { page: number }) => {
      if (options.page !== 1) throw new Error('Pagerfanta out of range');
      return page([entry(1)], 1, 1, 20);
    });
    button(target, 'Mark as read').click(); flushSync();
    await expectEntries(target, [1]);
    expect(mocks.update).toHaveBeenCalledWith(server, 21, { archive: true });
    expect(mocks.list).toHaveBeenLastCalledWith(server, { filter: 'unread', page: 1, perPage: 20 });
    await expectArticle(target, 'Article 21');
    expect(button(target, 'Mark as unread')).toBeDefined();
    expect(target.textContent).not.toContain('Could not load your Wallabag articles');
  });
});
