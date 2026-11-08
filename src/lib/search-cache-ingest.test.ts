import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedPost } from './types';

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, posts: { enabled: true, mode: 'paragraph', maxChars: 1000 }, wallabag: { enabled: true, mode: 'paragraph', maxChars: 2000 }, maxAgeDays: 90, maxItems: 10000 },
  generation: 1,
  cache: vi.fn(), listAccounts: vi.fn(), bookmarks: vi.fn(), offline: vi.fn(), listWallabag: vi.fn(), scope: vi.fn(),
}));
vi.mock('$lib/search-cache', () => ({
  cacheSearchItems: mocks.cache,
  getSearchCacheSettings: () => mocks.settings,
  getSearchCacheGeneration: () => mocks.generation,
}));
vi.mock('$lib/db', () => ({ listAccounts: mocks.listAccounts }));
vi.mock('$lib/bookmarks', () => ({ listBookmarks: mocks.bookmarks }));
vi.mock('$lib/offline-cache', () => ({ loadCachedFeed: mocks.offline }));
vi.mock('$lib/wallabag', () => ({ listWallabagIndexEntries: mocks.listWallabag, wallabagSearchScope: mocks.scope }));

import { indexExistingSearchCache, postSearchInput, queuePostsForSearchCache, syncWallabagSearchCache } from './search-cache-ingest';
const date = () => new Date().toISOString();
const post = (overrides: Partial<UnifiedPost> = {}): UnifiedPost => ({
  uri: 'https://social.example/@author/100', text: 'First paragraph\n\nSecond paragraph', platform: 'mastodon',
  author: { handle: '@author@example.org', displayName: 'Alice' }, createdAt: date(), isRepost: false, sourceAccountId: 7,
  ...overrides,
});
const article = (id: number, createdAt = date()) => ({ id, title: `Article ${id}`, url: `https://example.org/${id}`, content: '<p>First.</p><p>Second.</p>', createdAt });

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.generation++;
  mocks.settings.enabled = true; mocks.settings.posts.enabled = true; mocks.settings.wallabag.enabled = true;
  mocks.settings.maxItems = 10000; mocks.settings.maxAgeDays = 90;
  mocks.cache.mockImplementation(async items => items.length);
  mocks.listAccounts.mockResolvedValue([{ id: 7 }]);
  mocks.bookmarks.mockResolvedValue([]); mocks.offline.mockResolvedValue(null);
  mocks.scope.mockResolvedValue('wallabag:connection-one');
  localStorage.setItem('crispdeck-wallabag-url', 'https://wallabag.example');
});

describe('credential-free social projections', () => {
  it('keeps raw HTML paragraphs and original publication date from a repost', () => {
    const item = postSearchInput(post({
      createdAt: date(), isRepost: true,
      raw: { token: 'must not persist', reblog: { content: '<p>First &amp; one</p><p>Second.</p>', createdAt: '2020-01-01T00:00:00Z', visibility: 'public', card: { title: 'An article' }, url: 'https://social.example/@alice/1' } },
    }));
    expect(item).toMatchObject({ source: 'mastodon', scope: 'account:7', html: true, title: 'An article', author: 'Alice @author@example.org', createdAt: '2020-01-01T00:00:00Z', text: '<p>First &amp; one</p><p>Second.</p>' });
    expect(JSON.stringify(item)).not.toContain('must not persist');
    expect(item).not.toHaveProperty('raw');
  });

  it('skips unscoped posts and direct messages', () => {
    expect(postSearchInput(post({ sourceAccountId: undefined }))).toBeNull();
    expect(postSearchInput(post({ raw: { visibility: 'direct', content: '<p>Secret</p>' } }))).toBeNull();
  });

  it('constructs public Bluesky permalinks and retains external-card titles', () => {
    const item = postSearchInput(post({ platform: 'bluesky', uri: 'at://did:plc:alice/app.bsky.feed.post/abc', embeds: { external: { title: 'Hello' } }, raw: { post: { record: { createdAt: '2026-01-01T00:00:00Z' } } } }));
    expect(item).toMatchObject({ title: 'Hello', url: 'https://bsky.app/profile/did%3Aplc%3Aalice/post/abc', createdAt: '2026-01-01T00:00:00Z' });
  });

  it('does not produce executable or credential-bearing article URLs', () => {
    expect(postSearchInput(post({ uri: 'javascript:alert(1)' }))).toBeNull();
    expect(postSearchInput(post({ uri: 'https://user:password@example.org/' }))).toBeNull();
  });

  it('queues one batch and ignores callbacks captured before settings changed', async () => {
    queuePostsForSearchCache([post(), post()]);
    await Promise.resolve();
    expect(mocks.cache).toHaveBeenCalledTimes(1);
    expect(mocks.cache.mock.calls[0][0]).toHaveLength(1);
    const prior = mocks.generation;
    mocks.generation++;
    queuePostsForSearchCache([post()], prior);
    await Promise.resolve();
    expect(mocks.cache).toHaveBeenCalledTimes(1);
  });

  it('does no optional work while disabled', async () => {
    mocks.settings.enabled = false;
    queuePostsForSearchCache([post()]);
    await indexExistingSearchCache(); await syncWallabagSearchCache();
    await Promise.resolve();
    expect(mocks.cache).not.toHaveBeenCalled(); expect(mocks.listWallabag).not.toHaveBeenCalled();
  });
});

describe('explicit backfill', () => {
  it('deduplicates bookmarks and view caches and excludes disconnected/unknown accounts', async () => {
    mocks.bookmarks.mockResolvedValue([post(), post({ sourceAccountId: 99 }), post({ sourceAccountId: undefined })]);
    localStorage.setItem('crispdeck-vc-feed', JSON.stringify({ data: [post(), post({ uri: 'https://social.example/@author/101' })] }));
    localStorage.setItem('crispdeck-vc-corrupt', '{bad');
    const result = await indexExistingSearchCache();
    expect(result.processed).toBe(2); expect(result.indexed).toBe(2);
    expect(mocks.cache.mock.calls.flatMap(call => call[0]).every(item => item.scope === 'account:7')).toBe(true);
  });

  it('batches a large existing cache so entries beyond the core write limit are retained', async () => {
    mocks.bookmarks.mockResolvedValue(Array.from({ length: 1250 }, (_, i) => post({ uri: `https://social.example/@author/${i}` })));
    const result = await indexExistingSearchCache();
    expect(result.indexed).toBe(1250);
    expect(mocks.cache.mock.calls.map(call => call[0].length)).toEqual([500, 500, 250]);
  });

  it('does not spend the import budget on expired or undated bookmarks', async () => {
    mocks.settings.maxItems = 100;
    const expired = new Date(Date.now() - 100 * 86400000).toISOString();
    mocks.bookmarks.mockResolvedValue([
      ...Array.from({ length: 150 }, (_, i) => post({ uri: `https://social.example/old/${i}`, createdAt: expired })),
      post({ uri: 'https://social.example/undated', createdAt: 'invalid' }),
    ]);
    localStorage.setItem('crispdeck-vc-feed', JSON.stringify({ data: [post({ uri: 'https://social.example/fresh' })] }));
    const result = await indexExistingSearchCache();
    expect(result).toMatchObject({ processed: 1, indexed: 1, stoppedEarly: false });
    expect(mocks.cache.mock.calls.flatMap(call => call[0]).map(item => item.id)).toEqual(['https://social.example/fresh']);
  });

  it('retains fresher feed entries even when eligible bookmarks fill the item cap', async () => {
    mocks.settings.maxItems = 100;
    mocks.bookmarks.mockResolvedValue(Array.from({ length: 120 }, (_, i) => post({
      uri: `https://social.example/bookmark/${i}`, createdAt: new Date(Date.now() - 86400000 - i * 60000).toISOString(),
    })));
    localStorage.setItem('crispdeck-vc-feed', JSON.stringify({ data: Array.from({ length: 5 }, (_, i) => post({ uri: `https://social.example/fresh/${i}` })) }));
    const result = await indexExistingSearchCache();
    const retained = mocks.cache.mock.calls.flatMap(call => call[0]).map(item => item.id);
    expect(result).toMatchObject({ processed: 100, indexed: 100, stoppedEarly: true });
    expect(retained).toEqual(expect.arrayContaining(Array.from({ length: 5 }, (_, i) => `https://social.example/fresh/${i}`)));
    expect(retained).not.toContain('https://social.example/bookmark/119');
  });

  it('passes the generation and fixed scope to Wallabag pages, stopping at the date window', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    mocks.listWallabag.mockResolvedValueOnce({ scope: 'wallabag:connection-one', entries: [article(1)], hasMore: true })
      .mockResolvedValueOnce({ scope: 'wallabag:connection-one', entries: [article(2, old)], hasMore: true });
    const progress = vi.fn();
    const result = await syncWallabagSearchCache({ onProgress: progress });
    expect(result.pages).toBe(2); expect(mocks.listWallabag).toHaveBeenCalledTimes(2);
    expect(mocks.listWallabag.mock.calls[1][1]).toMatchObject({ page: 2, perPage: 50, expectedScope: 'wallabag:connection-one' });
    expect(mocks.cache.mock.calls[0][1]).toEqual({ generation: mocks.generation, strict: true });
    expect(mocks.cache.mock.calls[0][0][0]).toMatchObject({ source: 'wallabag', scope: 'wallabag:connection-one', html: true });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('surfaces explicit import storage failures instead of claiming a zero-item success', async () => {
    mocks.bookmarks.mockResolvedValue([post()]);
    mocks.listWallabag.mockResolvedValue({ scope: 'wallabag:connection-one', entries: [article(1)], hasMore: false });
    mocks.cache.mockImplementation(async (_items, options) => {
      if (options.strict) throw new Error('Local search storage is full.');
      return 0;
    });
    await expect(indexExistingSearchCache()).rejects.toThrow('storage is full');
    await expect(syncWallabagSearchCache()).rejects.toThrow('storage is full');
  });

  it('stops a sync cleared while the network request was in flight', async () => {
    mocks.listWallabag.mockImplementation(async () => {
      mocks.generation++;
      return { scope: 'wallabag:connection-one', entries: [article(1)], hasMore: false };
    });
    await expect(syncWallabagSearchCache()).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('does not contact Wallabag for an already-cancelled action', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(syncWallabagSearchCache({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.listWallabag).not.toHaveBeenCalled();
  });

  it('bounds a requested all-dates sync by the configured item cap', async () => {
    mocks.settings.maxItems = 100; mocks.settings.maxAgeDays = 0;
    mocks.listWallabag.mockImplementation(async (_server, { page }) => ({ scope: 'wallabag:connection-one', entries: Array.from({ length: 50 }, (_, i) => article(page * 50 + i)), hasMore: true }));
    const result = await syncWallabagSearchCache();
    expect(result.processed).toBe(100); expect(result.pages).toBe(2); expect(result.stoppedEarly).toBe(true);
    expect(mocks.listWallabag).toHaveBeenCalledTimes(2);
  });
});
