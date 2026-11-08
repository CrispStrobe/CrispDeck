import { IDBDatabase, IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchCacheInput, SearchCacheSettings } from './search-cache';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;
const settingsKey = 'crispdeck-search-cache-settings';
let clock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function input(id: string, extra: Partial<SearchCacheInput> = {}): SearchCacheInput {
  return {
    id, source: 'mastodon', scope: 'account:1', url: `https://social.example/posts/${id}`,
    title: 'Example heading', text: 'A useful first paragraph.\n\nA separate hidden paragraph.',
    author: 'alice@example.org', createdAt: new Date(NOW - DAY).toISOString(), ...extra,
  };
}
async function enabled(patch: Partial<SearchCacheSettings> = {}) {
  const cache = await import('./search-cache');
  await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: true, ...patch });
  return cache;
}
async function storedItems(): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('crispdeck-search-cache');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('items', 'readonly');
      const req = tx.objectStore('items').getAll();
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

describe('opt-in and normalized settings', () => {
  it('does not open storage or collect anything until enabled', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const cache = await import('./search-cache');
    expect(cache.getSearchCacheSettings()).toMatchObject({ enabled: false, maxAgeDays: 90, maxItems: 10_000, posts: { mode: 'paragraph', maxChars: 1000 }, wallabag: { maxChars: 2000 } });
    expect(await cache.cacheSearchItems([input('1')])).toBe(0);
    expect(await cache.searchCache('useful')).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('fails closed on malformed preferences and bounds imported values', async () => {
    const cache = await import('./search-cache');
    localStorage.setItem(settingsKey, '{broken');
    expect(cache.getSearchCacheSettings().enabled).toBe(false);
    localStorage.setItem(settingsKey, JSON.stringify({ enabled: 'true', maxAgeDays: -12, maxItems: 1e10, posts: { mode: 'unknown', maxChars: 0 } }));
    expect(cache.getSearchCacheSettings()).toMatchObject({ enabled: false, maxAgeDays: 0, maxItems: 500_000, posts: { mode: 'paragraph', maxChars: 100 } });
    localStorage.setItem(settingsKey, JSON.stringify({ enabled: true, maxItems: '1000' }));
    expect(cache.getSearchCacheSettings().maxItems).toBe(10_000);
  });

  it('reports a failed preferences write without pretending opt-in succeeded', async () => {
    const cache = await import('./search-cache');
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new DOMException('No storage', 'SecurityError'); });
    await expect(cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: true })).rejects.toThrow('storage');
    expect(cache.getSearchCacheSettings().enabled).toBe(false);
  });
});

describe('bounded text-only records', () => {
  it('keeps the title and first real HTML paragraph, decodes entities, and excludes active content', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1', { source: 'wallabag', scope: 'wallabag:one', title: 'Coffee &amp; tea', html: true,
      text: '<h1>Heading before body</h1><p> </p><p>Café &amp; croissants<br>on Monday.</p><p>SECRETTAIL</p><script>INJECTED</script><style>HIDDENCSS</style>' })]);
    const [hit] = await cache.searchCache('cafe');
    expect(hit.title).toBe('Coffee & tea');
    expect(hit.excerpt).toBe('Café & croissants\non Monday.');
    expect(await cache.searchCache('secrettail')).toEqual([]);
    expect(await cache.searchCache('injected')).toEqual([]);
    const [record] = await storedItems();
    expect(record).not.toHaveProperty('raw');
    expect(record).not.toHaveProperty('text');
    expect(JSON.stringify(record)).not.toMatch(/SECRETTAIL|HIDDENCSS|INJECTED|<p>/);
  });

  it('keeps ranked results bounded and shows context for matches deep in full text', async () => {
    const cache = await enabled({ wallabag: { enabled: true, mode: 'full', maxChars: 100 } });
    const text = `${'leading '.repeat(800)}deepneedle ${'trailing '.repeat(800)}`;
    await cache.cacheSearchItems(Array.from({ length: 20 }, (_, n) => input(String(n), { source: 'wallabag', scope: 'wallabag:one', title: n === 0 ? 'deepneedle in title' : `Item ${n}`, text })));
    const results = await cache.searchCache('deepneedle', { source: 'wallabag', limit: 3 });
    expect(results).toHaveLength(3);
    expect(results[0].title).toBe('deepneedle in title');
    expect(results[0].excerpt.length).toBeLessThanOrEqual(4000);
    expect(results[0].excerpt).toContain('deepneedle');
  });

  it('indexes the complete retained Wallabag text when explicitly selected', async () => {
    const cache = await enabled({ wallabag: { enabled: true, mode: 'full', maxChars: 100 } });
    await cache.cacheSearchItems([input('article', { source: 'wallabag', scope: 'wallabag:one', text: '<p>Introduction</p><p>uniquesecondparagraph</p>', html: true })]);
    expect(await cache.searchCache('uniquesecondparagraph', { source: 'wallabag', scope: 'wallabag:one' })).toHaveLength(1);
    expect(await cache.searchCache('uniquesecondparagraph', { source: 'wallabag', scope: 'wallabag:other' })).toHaveLength(0);
  });

  it('uses independent limits for social posts and Wallabag', async () => {
    const cache = await enabled({ posts: { enabled: true, mode: 'characters', maxChars: 100 }, wallabag: { enabled: true, mode: 'characters', maxChars: 200 } });
    const body = 'a'.repeat(110) + ' distinctive ' + 'b'.repeat(120);
    await cache.cacheSearchItems([input('post', { text: body }), input('article', { source: 'wallabag', scope: 'wallabag:one', text: body })]);
    const hits = await cache.searchCache('distinctive');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('wallabag');
    const rows = await storedItems();
    expect(rows.map(row => String(row.excerpt).length).sort()).toEqual([100, 200]);
  });

  it('makes title-only useful for untitled posts without retaining the body', async () => {
    const cache = await enabled({ posts: { enabled: true, mode: 'title', maxChars: 1000 } });
    await cache.cacheSearchItems([input('1', { title: undefined, text: 'An interesting headline\nSecond line\n\nLater paragraph' })]);
    const [hit] = await cache.searchCache('headline');
    expect(hit.title).toBe('An interesting headline');
    expect(hit.excerpt).toBe('');
    expect(await cache.searchCache('later')).toEqual([]);
  });

  it('does not retain unsafe URLs or invalid dates', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1', { url: 'javascript:alert(1)' }), input('2', { createdAt: 'bad' }), input('3', { url: 'https://user:secret@example.com/' })]);
    const hits = await cache.searchCache('useful');
    expect(hits).toHaveLength(2);
    expect(hits.every(hit => hit.url === '')).toBe(true);
    expect(JSON.stringify(await storedItems())).not.toContain('secret');
  });

  it('does not truncate a Unicode surrogate pair at the excerpt limit', async () => {
    const cache = await enabled({ posts: { enabled: true, mode: 'characters', maxChars: 100 } });
    await cache.cacheSearchItems([input('1', { text: 'x'.repeat(99) + '😀 after' })]);
    expect((await cache.searchCache('example'))[0].excerpt).toBe('x'.repeat(99));
  });
});

describe('indexed search and durability', () => {
  it('ANDs words, folds case/accents, completes the last word, and filters sources', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([
      input('1', { title: 'Café running club', source: 'bluesky' }),
      input('2', { title: 'Café reading club', source: 'threads' }),
      input('3', { title: 'Running outside', source: 'rss' }),
    ]);
    expect((await cache.searchCache('CAFE runn')).map(hit => hit.source)).toEqual(['bluesky']);
    expect((await cache.searchCache('cafe', { source: 'threads' })).map(hit => hit.source)).toEqual(['threads']);
    expect(await cache.searchCache('cafe absent')).toEqual([]);
    expect(await cache.searchCache('   !   ')).toEqual([]);
    expect(await cache.searchCache('r')).toEqual([]);
  });

  it('searches unspaced CJK and non-Latin text without a native tokenizer', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1', { title: '東京都の図書館', text: 'مرحبا بالعالم' })]);
    expect(await cache.searchCache('東京')).toHaveLength(1);
    expect(await cache.searchCache('図書館')).toHaveLength(1);
    expect(await cache.searchCache('مرحبا')).toHaveLength(1);
  });

  it('replaces old term postings on an edit and deduplicates repeated sightings', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1', { text: 'obsolete term' }), input('1', { text: 'replacement term' })]);
    expect(await cache.searchCache('obsolete')).toEqual([]);
    expect(await cache.searchCache('replacement')).toHaveLength(1);
    expect((await cache.getSearchCacheStats()).count).toBe(1);
  });

  it('persists across module reloads and supports the same URI in separate account scopes', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1'), input('1', { scope: 'account:2' })]);
    vi.resetModules();
    const reopened = await import('./search-cache');
    expect(await reopened.searchCache('useful')).toHaveLength(2);
    expect((await reopened.getSearchCacheStats()).bytes).toBeGreaterThan(0);
  });

  it('uses the token index rather than scanning all cached bodies for each query', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1'), input('2', { text: 'different content' })]);
    const scan = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
    const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const keys = vi.spyOn(IDBIndex.prototype, 'getAllKeys');
    expect(await cache.searchCache('useful')).toHaveLength(1);
    expect(keys).toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
  });

  it('waits for the write transaction to commit', async () => {
    const cache = await enabled();
    const original = IDBDatabase.prototype.transaction;
    let committed = false;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = original.apply(this, args);
      if (tx.mode === 'readwrite') tx.addEventListener('complete', () => { committed = true; });
      return tx;
    });
    await cache.cacheSearchItems([input('1')]);
    expect(committed).toBe(true);
  });

  it('processes every item in a large batch instead of silently dropping items after 500', async () => {
    const cache = await enabled();
    expect(await cache.cacheSearchItems(Array.from({ length: 605 }, (_, i) => input(String(i))))).toBe(605);
    expect((await cache.getSearchCacheStats()).count).toBe(605);
  });

  it('enforces all query words and refuses overlong queries without reporting a storage failure', async () => {
    const cache = await enabled();
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`);
    await cache.cacheSearchItems([input('1', { text: words.slice(0, 18).join(' ') })]);
    expect(await cache.searchCache(words.join(' '))).toEqual([]);
    await expect(cache.searchCache('x'.repeat(257))).rejects.toThrow('256');
    expect((await cache.getSearchCacheStats()).error).toBeUndefined();
  });
});

describe('retention, clearing, and account lifecycle', () => {
  it('uses source creation date and expires old records even without another feed load', async () => {
    const cache = await enabled({ maxAgeDays: 7 });
    await cache.cacheSearchItems([input('recent'), input('ancient', { createdAt: new Date(NOW - 100 * DAY).toISOString() })]);
    expect((await cache.getSearchCacheStats()).count).toBe(1);
    clock.mockReturnValue(NOW + 8 * DAY);
    expect(await cache.searchCache('useful')).toEqual([]);
    expect((await cache.getSearchCacheStats()).count).toBe(0);
  });

  it('evicts oldest entries at the item limit and supports all dates', async () => {
    const cache = await enabled({ maxItems: 100, maxAgeDays: 0 });
    await cache.cacheSearchItems(Array.from({ length: 105 }, (_, i) => input(String(i), { createdAt: new Date(NOW - (i + 1) * DAY).toISOString(), title: `Heading number${i}` })));
    expect((await cache.getSearchCacheStats()).count).toBe(100);
    expect(await cache.searchCache('number104')).toEqual([]);
    expect(await cache.searchCache('number99')).toHaveLength(1);
  });

  it('immediately retrims and removes postings when settings narrow', async () => {
    const cache = await enabled({ posts: { enabled: true, mode: 'characters', maxChars: 1000 } });
    await cache.cacheSearchItems([input('1', { text: 'Intro.\n\nExtra paragraphs contain specialtail.' })]);
    expect(await cache.searchCache('specialtail')).toHaveLength(1);
    await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), posts: { enabled: true, mode: 'paragraph', maxChars: 1000 } });
    expect(await cache.searchCache('specialtail')).toEqual([]);
    await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), posts: { enabled: true, mode: 'characters', maxChars: 1000 } });
    await cache.rebuildSearchCache();
    expect(await cache.searchCache('specialtail')).toEqual([]);
  });

  it('clears disabled sources and clears everything when switched off', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1'), input('2', { source: 'wallabag', scope: 'wallabag:one' })]);
    await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), wallabag: { ...cache.getSearchCacheSettings().wallabag, enabled: false } });
    expect((await cache.getSearchCacheStats()).bySource.wallabag).toBe(0);
    expect((await cache.getSearchCacheStats()).count).toBe(1);
    await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: false });
    expect(await storedItems()).toEqual([]);
  });

  it('invalidates queued writes and fetches started before a clear', async () => {
    const cache = await enabled();
    const generation = cache.getSearchCacheGeneration();
    const pending = cache.cacheSearchItems([input('queued')]);
    await cache.clearSearchCache();
    await pending;
    expect(await cache.cacheSearchItems([input('stale')], { generation })).toBe(0);
    expect((await cache.getSearchCacheStats()).count).toBe(0);
    expect(await cache.cacheSearchItems([input('fresh')])).toBe(1);
  });

  it('revokes disconnected scopes durably without deleting another account’s copy', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('same'), input('same', { scope: 'account:2' })]);
    await cache.removeSearchCacheScope('account:1');
    vi.resetModules();
    const next = await import('./search-cache');
    expect(await next.cacheSearchItems([input('late')])).toBe(0);
    const hits = await next.searchCache('useful');
    expect(hits).toHaveLength(1);
    expect(hits[0].scope).toBe('account:2');
  });

  it('reapplies settings imported directly into localStorage', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1')]);
    localStorage.setItem(settingsKey, JSON.stringify({ ...cache.getSearchCacheSettings(), posts: { enabled: false, mode: 'paragraph', maxChars: 1000 } }));
    expect(await cache.searchCache('useful')).toEqual([]);
    expect((await cache.getSearchCacheStats()).count).toBe(0);
  });
});

describe('storage failures and recovery', () => {
  it('fails gracefully without IndexedDB and does not emit an endless error-status loop', async () => {
    const cache = await enabled();
    // Close via external deletion before removing the API; otherwise the open
    // database remains usable even when its global factory disappears.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('crispdeck-search-cache');
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
    vi.stubGlobal('indexedDB', undefined);
    const events = vi.fn();
    window.addEventListener('search-cache-changed', events);
    try {
      expect(await cache.cacheSearchItems([input('1')])).toBe(0);
      expect(await cache.getSearchCacheStats()).toMatchObject({ available: false, count: 0 });
      await cache.getSearchCacheStats();
      expect(events).toHaveBeenCalledTimes(1);
      await expect(cache.searchCache('useful')).rejects.toThrow('storage');
    } finally { window.removeEventListener('search-cache-changed', events); }
  });

  it('rolls back a failed batch, exposes quota errors, and recovers on the next write', async () => {
    const cache = await enabled();
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'items') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    });
    expect(await cache.cacheSearchItems([input('1')])).toBe(0);
    put.mockRestore();
    expect((await cache.getSearchCacheStats()).error).toContain('full');
    expect(await storedItems()).toEqual([]);
    expect(await cache.cacheSearchItems([input('1')])).toBe(1);
    expect((await cache.getSearchCacheStats()).error).toBeUndefined();
  });

  it('releases the database for a full purge and recreates it successfully', async () => {
    const cache = await enabled();
    await cache.cacheSearchItems([input('1')]);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('crispdeck-search-cache');
      req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Cache blocked deletion'));
    });
    expect((await cache.getSearchCacheStats()).count).toBe(0);
    expect(await cache.cacheSearchItems([input('2')])).toBe(1);
  });
});
