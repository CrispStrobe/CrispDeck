import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { SearchCacheResult, SearchCacheSettings } from '$lib/search-cache';

const boundaries = vi.hoisted(() => ({
  settings: vi.fn(), stats: vi.fn(), search: vi.fn(), initAllClients: vi.fn(),
  generation: vi.fn(), queue: vi.fn(), mastodonSearch: vi.fn(),
}));
vi.mock('$lib/search-cache', () => ({
  getSearchCacheSettings: boundaries.settings,
  getSearchCacheStats: boundaries.stats,
  searchCache: boundaries.search,
  getSearchCacheGeneration: boundaries.generation,
}));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: boundaries.initAllClients }));
vi.mock('$lib/search-cache-lazy', () => ({ getSearchCacheGeneration: boundaries.generation, queuePostsForSearchCache: boundaries.queue }));
vi.mock('$lib/universal-search', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/universal-search')>(),
  searchMastodon: boundaries.mastodonSearch,
}));
vi.mock('$lib/components/Post.svelte', async () => ({ default: (await import('./deck/test-fixtures/EmptyStub.svelte')).default }));

import LocalSearch from './LocalSearch.svelte';
import SearchPage from '../../routes/search/+page.svelte';
import { i18n } from '$lib/i18n.svelte';
import { loadLocalSearchTranslations } from '$lib/local-search-i18n.svelte';

let instance: ReturnType<typeof mount> | undefined;
let settings: SearchCacheSettings;
const found: SearchCacheResult = {
  id: 'wallabag:1', source: 'wallabag', scope: 'reader:one', url: 'https://example.com/solar',
  title: 'Solar energy', excerpt: 'A first paragraph about solar panels.', author: 'Alice',
  createdAt: '2026-11-01T00:00:00.000Z', indexedAt: '2026-11-08T00:00:00.000Z', score: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  i18n.setLanguage('en');
  window.history.replaceState({}, '', '/search');
  settings = {
    enabled: true,
    posts: { enabled: true, mode: 'paragraph', maxChars: 1000 },
    wallabag: { enabled: true, mode: 'paragraph', maxChars: 2000 },
    maxAgeDays: 90, maxItems: 10000,
  };
  boundaries.settings.mockImplementation(() => settings);
  boundaries.stats.mockResolvedValue({ count: 1, bytes: 1000, available: true, bySource: { wallabag: 1 } });
  boundaries.search.mockResolvedValue([found]);
  boundaries.initAllClients.mockResolvedValue({ accounts: [], clients: new Map() });
  boundaries.generation.mockReturnValue(8);
});

afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined;
  document.body.innerHTML = '';
  i18n.setLanguage('en');
  vi.useRealTimers();
});

async function render(page = false) {
  const target = document.createElement('div');
  document.body.append(target);
  instance = mount(page ? SearchPage : LocalSearch, { target });
  flushSync();
  await vi.waitFor(() => { flushSync(); expect(boundaries.stats).toHaveBeenCalled(); });
  return target;
}

function input(target: HTMLElement, value: string) {
  const field = target.querySelector<HTMLInputElement>('input[type=search]')!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function submit(target: HTMLElement) {
  target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  flushSync();
}

describe('local search UI', () => {
  it('updates optional translations and ignores a language load superseded by another choice', async () => {
    const target = await render();
    i18n.setLanguage('de');
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('section')?.getAttribute('aria-label')).toBe('Auf diesem Gerät'); });
    i18n.setLanguage('fr'); flushSync();
    i18n.setLanguage('en'); flushSync();
    await loadLocalSearchTranslations('fr'); flushSync();
    expect(target.querySelector('section')?.getAttribute('aria-label')).toBe('On this device');
    expect(target.querySelector('input')?.getAttribute('placeholder')).toBe('Search cached posts and Wallabag items');
  });

  it('opens directly and searches offline without initializing network clients or needing accounts', async () => {
    window.history.replaceState({}, '', '/search?scope=local&q=solar');
    const target = await render(true);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('article')?.textContent).toContain('Solar energy'); });
    expect(boundaries.initAllClients).not.toHaveBeenCalled();
    expect(boundaries.search).toHaveBeenCalledWith('solar', { source: undefined, limit: 100 });
    expect(target.querySelector('a[href="https://example.com/solar"]')?.getAttribute('rel')).toContain('noopener');
  });

  it('keeps opt-in disabled and links to the correct settings tab', async () => {
    settings.enabled = false;
    const target = await render();
    input(target, 'solar'); submit(target);
    expect(boundaries.search).not.toHaveBeenCalled();
    expect(target.textContent).toContain('Local search is turned off.');
    expect(target.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
    expect(target.querySelector('a[href*="tab=content#local-search-cache"]')).not.toBeNull();
  });

  it('filters by source and renders remote titles and excerpts as inert text', async () => {
    boundaries.search.mockResolvedValue([{ ...found, title: '<img src=x onerror=alert(1)>', excerpt: '<script>bad()</script>', url: 'javascript:alert(1)' }]);
    const target = await render();
    const source = target.querySelector<HTMLSelectElement>('select')!;
    source.value = 'wallabag'; source.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    input(target, 'solar'); submit(target);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('article')).not.toBeNull(); });
    expect(boundaries.search).toHaveBeenCalledWith('solar', { source: 'wallabag', limit: 100 });
    const article = target.querySelector('article')!;
    expect(article.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(article.textContent).toContain('<script>bad()</script>');
    expect(article.querySelector('img,script,a')).toBeNull();
  });

  it('does not let a slower previous search replace the latest query', async () => {
    let finishOld!: (value: SearchCacheResult[]) => void;
    boundaries.search.mockImplementation((query: string) => query === 'old'
      ? new Promise<SearchCacheResult[]>(resolve => { finishOld = resolve; })
      : Promise.resolve([{ ...found, title: 'New result' }]));
    const target = await render();
    input(target, 'old'); submit(target);
    input(target, 'new'); submit(target);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('article')?.textContent).toContain('New result'); });
    finishOld([{ ...found, title: 'Old result' }]);
    await Promise.resolve(); flushSync();
    expect(target.querySelector('article')?.textContent).toContain('New result');
    expect(target.textContent).not.toContain('Old result');
  });

  it('shows a useful storage failure instead of an empty search result', async () => {
    boundaries.stats.mockResolvedValue({ count: 0, bytes: 0, available: false, bySource: {} });
    const target = await render();
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('Local storage is unavailable'); });
    input(target, 'solar'); submit(target);
    expect(boundaries.search).not.toHaveBeenCalled();
  });

  it('removes displayed results when another view disables the local cache', async () => {
    const target = await render();
    input(target, 'solar'); submit(target);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('article')).not.toBeNull(); });
    settings = { ...settings, enabled: false };
    boundaries.stats.mockResolvedValue({ count: 0, bytes: 0, available: true, bySource: {} });
    window.dispatchEvent(new Event('search-cache-changed'));
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Local search is turned off.'); });
    expect(target.querySelector('article')).toBeNull();
  });

  it('caches remote results with their exact account and the generation from before the request', async () => {
    window.history.replaceState({}, '', '/search?q=solar');
    boundaries.initAllClients.mockResolvedValue({
      accounts: [{ id: 3, platform: 'mastodon', handle: 'reader@social.example' }],
      clients: new Map([[3, { client: { getAccessToken: () => 'token', getInstanceUrl: () => 'https://social.example' } }]]),
    });
    boundaries.mastodonSearch.mockImplementation(async () => {
      boundaries.generation.mockReturnValue(9);
      return [{
        uri: 'https://social.example/users/alice/statuses/1', content: '<p>Solar energy</p>', createdAt: '2026-11-01T00:00:00.000Z',
        account: { acct: 'alice', url: 'https://social.example/@alice' },
      }];
    });
    const target = document.createElement('div'); document.body.append(target);
    instance = mount(SearchPage, { target }); flushSync();
    await vi.waitFor(() => expect(boundaries.queue).toHaveBeenCalledTimes(1));
    expect(boundaries.queue).toHaveBeenCalledWith([expect.objectContaining({
      uri: 'https://social.example/users/alice/statuses/1', sourceAccountId: 3, sourceAccount: 'reader@social.example',
    })], 8);
  });
});
