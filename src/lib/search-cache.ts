/**
 * Optional, device-local excerpt cache. IndexedDB maintains the inverted index
 * for us: a multiEntry index maps each normalized word to the matching records.
 * Searches read keys from that index and fetch only intersecting candidates.
 * No provider payloads, credentials, images, or remote search calls live here.
 */
import { swallow } from './debug-log';
import { readJson, writeJson, writeString } from './safe-storage';
import {
  SEARCH_CACHE_SETTINGS_KEY as SETTINGS_KEY, SEARCH_CACHE_GENERATION_KEY as GENERATION_KEY,
  getSearchCacheGeneration, invalidateSearchCacheGeneration as invalidate,
} from './search-cache-state';
export { getSearchCacheGeneration } from './search-cache-state';

export const SEARCH_CACHE_SOURCES = ['bluesky', 'mastodon', 'threads', 'rss', 'wallabag'] as const;
export type SearchCacheSource = typeof SEARCH_CACHE_SOURCES[number];
export interface SearchCachePolicy {
  enabled: boolean;
  mode: 'title' | 'paragraph' | 'characters';
  maxChars: number;
}
export interface SearchCacheSettings {
  enabled: boolean;
  posts: SearchCachePolicy;
  wallabag: SearchCachePolicy;
  /** Source creation time, not the time an old item happened to be loaded. 0 = all. */
  maxAgeDays: number;
  maxItems: number;
}
export interface SearchCacheInput {
  source: SearchCacheSource;
  scope: string;
  id: string;
  url: string;
  title?: string;
  text: string;
  html?: boolean;
  author?: string;
  createdAt: string;
}
export interface SearchCacheResult {
  id: string;
  source: SearchCacheSource;
  scope: string;
  url: string;
  title: string;
  excerpt: string;
  author: string;
  createdAt: string;
  indexedAt: string;
  score: number;
}
export interface SearchCacheStats {
  count: number;
  /** Estimated UTF-8 record + token bytes, not browser storage allocation. */
  bytes: number;
  available: boolean;
  error?: string;
  bySource: Record<SearchCacheSource, number>;
}
interface CachedItem extends Omit<SearchCacheResult, 'score'> {
  createdAtMs: number;
  tokens: string[];
  bytes: number;
}

const REVOKED_PREFIX = 'crispdeck-search-cache-revoked:';
const DB_NAME = 'crispdeck-search-cache';
const ITEMS = 'items';
const META = 'meta';
const DAY = 86_400_000;
const MAX_INPUT_CHARS = 1_000_000;
const DEFAULTS: SearchCacheSettings = {
  enabled: false,
  posts: { enabled: true, mode: 'paragraph', maxChars: 1000 },
  wallabag: { enabled: true, mode: 'paragraph', maxChars: 2000 },
  maxAgeDays: 90,
  maxItems: 10_000,
};
let dbPromise: Promise<IDBDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastError: string | undefined;
const revokedScopes = new Set<string>();

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== SETTINGS_KEY && event.key !== GENERATION_KEY && !event.key.startsWith(REVOKED_PREFIX)) return;
  getSearchCacheGeneration();
  // Only maintain a database this tab already used; disabled installs do not
  // start opening databases merely because a preference changed elsewhere.
  if (dbPromise) void serialized(() => maintenance()).catch(failure);
  changed();
});

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}
function policy(value: unknown, fallback: SearchCachePolicy): SearchCachePolicy {
  const v = value && typeof value === 'object' ? value as Partial<SearchCachePolicy> : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled,
    mode: ['title', 'paragraph', 'characters'].includes(v.mode ?? '') ? v.mode! : fallback.mode,
    maxChars: bounded(v.maxChars, fallback.maxChars, 100, 50_000),
  };
}
function normalizeSettings(value: unknown): SearchCacheSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<SearchCacheSettings> : {};
  return {
    enabled: v.enabled === true,
    posts: policy(v.posts, DEFAULTS.posts),
    wallabag: policy(v.wallabag, DEFAULTS.wallabag),
    maxAgeDays: bounded(v.maxAgeDays, DEFAULTS.maxAgeDays, 0, 36_500),
    maxItems: bounded(v.maxItems, DEFAULTS.maxItems, 100, 50_000),
  };
}

/** Re-read preferences so another tab or a settings import takes effect. */
export function getSearchCacheSettings(): SearchCacheSettings {
  return normalizeSettings(readJson<unknown>(SETTINGS_KEY, null));
}

function changed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('search-cache-changed'));
}
function revocationKey(scope: string): string { return REVOKED_PREFIX + encodeURIComponent(scope); }
function scopeRevoked(scope: string): boolean {
  if (revokedScopes.has(scope)) return true;
  try {
    if (localStorage.getItem(revocationKey(scope)) !== null) {
      revokedScopes.add(scope);
      return true;
    }
  } catch { return true; /* Fail closed when the durable gate cannot be read. */ }
  return false;
}
function revocations(): Set<string> {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(REVOKED_PREFIX)) {
        try { revokedScopes.add(decodeURIComponent(key.slice(REVOKED_PREFIX.length))); }
        catch { /* Ignore a malformed foreign storage key. */ }
      }
    }
  } catch { /* getSearchCacheSettings fails closed if preferences are blocked. */ }
  return revokedScopes;
}
function failure(error: unknown): Error {
  // Never log a provider response, a query, or cached private text.
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = name === 'QuotaExceededError'
    ? 'Local search storage is full. Clear the cache or reduce its limits.'
    : 'Local search storage is unavailable. Check site storage permissions and try again.';
  const newError = lastError !== message;
  if (newError) swallow('search-cache.storage', new Error(message));
  lastError = message;
  // A status read must not trigger an endless status-read/event retry loop.
  if (newError) changed();
  return new Error(message);
}
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const pending = queue.then(action, action);
  queue = pending.catch(() => undefined);
  return pending;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('IndexedDB open timed out'));
    }, 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      const items = db.createObjectStore(ITEMS, { keyPath: 'id' });
      items.createIndex('tokens', 'tokens', { multiEntry: true });
      items.createIndex('createdAtMs', 'createdAtMs');
      items.createIndex('source', 'source');
      items.createIndex('scope', 'scope');
      db.createObjectStore(META, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      const release = () => { if (dbPromise === opening) dbPromise = null; };
      db.onclose = release;
      db.onversionchange = () => { db.close(); release(); };
      resolve(db);
    };
    request.onerror = () => { clearTimeout(timeout); settled = true; reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); settled = true; reject(new Error('IndexedDB open blocked')); };
  }).catch(error => {
    if (dbPromise === opening) dbPromise = null;
    throw error;
  });
  dbPromise = opening;
  return opening;
}

/** Resolve only after commit. Request success can still be followed by abort. */
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, abort: (error: unknown) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ITEMS, META], mode);
    let value: T;
    let cause: unknown;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(cause ?? tx.error ?? new Error('Local search transaction aborted'));
    const abort = (error: unknown) => { cause = error; tx.abort(); };
    try { run(tx, result => { value = result; }, abort); }
    catch (error) { abort(error); }
  });
}

function clip(value: string, limit: number): string {
  // Avoid ending an excerpt with one half of an astral Unicode character.
  const cut = value.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
function whitespace(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR']);
function nodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const tag = node.nodeType === 1 ? (node as Element).tagName : '';
  if (tag === 'BR') return '\n';
  const inner = Array.from(node.childNodes, nodeText).join('');
  return BLOCK_TAGS.has(tag) ? `\n\n${inner}\n\n` : inner;
}

/** Extract inert text, preserving paragraphs and decoding HTML entities. */
export function extractSearchText(value: string, html = false): { text: string; paragraph: string } {
  let text = value.slice(0, MAX_INPUT_CHARS);
  let paragraph = '';
  if (html && typeof document !== 'undefined') {
    // Template contents are inert: images/scripts never enter the live DOM.
    const template = document.createElement('template');
    template.innerHTML = text;
    template.content.querySelectorAll('script,style,noscript,template,iframe,object,svg,math').forEach(node => node.remove());
    const paragraphs = template.content.querySelectorAll('p');
    for (const p of paragraphs) {
      paragraph = whitespace(nodeText(p));
      if (paragraph) break;
    }
    text = nodeText(template.content);
  } else if (html) {
    // SSR has no DOM and never persists data. A conservative text fallback is
    // useful to callers without a document; browsers/WebViews use the parser.
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  }
  text = whitespace(text).replace(/\n{3,}/g, '\n\n');
  return { text, paragraph: paragraph || text.split(/\n\s*\n/)[0] || '' };
}
function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Deterministic across WebViews; no Intl.Segmenter or native extension needed. */
export function tokenizeSearchText(value: string): string[] {
  const words = normalized(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = new Set<string>();
  for (const word of words) {
    // Unspaced CJK/Thai text also gets character and bigram postings. That
    // allows substring queries without depending on a locale-specific ICU.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(word)) {
      const chars = Array.from(word);
      for (let i = 0; i < chars.length; i++) {
        terms.add(chars[i]);
        if (i + 1 < chars.length) terms.add(chars[i] + chars[i + 1]);
      }
    } else terms.add(word);
  }
  return [...terms];
}
function safeLink(value: string): string {
  if (value.length > 2048 || /[\u0000-\u0020]/.test(value)) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function selectedPolicy(settings: SearchCacheSettings, source: SearchCacheSource): SearchCachePolicy {
  return source === 'wallabag' ? settings.wallabag : settings.posts;
}
function retainedExcerpt(text: string, paragraph: string, config: SearchCachePolicy): string {
  return config.mode === 'title' ? '' : clip(config.mode === 'paragraph' ? paragraph : text, config.maxChars);
}
function finishRecord(item: Omit<CachedItem, 'tokens' | 'bytes'>): CachedItem {
  const tokens = tokenizeSearchText(`${item.title}\n${item.excerpt}\n${item.author}`);
  const record = { ...item, tokens, bytes: 0 };
  record.bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  return record;
}
function recordFor(input: SearchCacheInput, settings: SearchCacheSettings): CachedItem | null {
  if (!SEARCH_CACHE_SOURCES.includes(input.source) || !input.scope || input.scope.length > 2048 || !input.id || input.id.length > 4096 || typeof input.text !== 'string') return null;
  if (scopeRevoked(input.scope)) return null;
  const config = selectedPolicy(settings, input.source);
  const createdAtMs = Date.parse(input.createdAt);
  if (!config.enabled || !Number.isFinite(createdAtMs) || (settings.maxAgeDays && createdAtMs < Date.now() - settings.maxAgeDays * DAY)) return null;
  const content = extractSearchText(input.text, input.html);
  return finishRecord({
    id: JSON.stringify([input.source, input.scope, input.id]),
    source: input.source, scope: input.scope, url: safeLink(input.url),
    title: clip(extractSearchText(input.title ?? '', input.html).text.replace(/\s+/g, ' '), 512)
      || clip(content.paragraph.split('\n')[0], 160),
    excerpt: retainedExcerpt(content.text, content.paragraph, config),
    author: clip(whitespace(input.author ?? '').replace(/\s+/g, ' '), 256),
    createdAt: new Date(createdAtMs).toISOString(), createdAtMs,
    indexedAt: new Date().toISOString(),
  });
}

/** Age/count eviction uses indexes. Re-trimming only scans on a policy change. */
function maintain(tx: IDBTransaction, settings: SearchCacheSettings, rebuild = false): void {
  const items = tx.objectStore(ITEMS);
  const meta = tx.objectStore(META);
  if (!settings.enabled) { items.clear(); return; }
  // A scope may have been revoked while IndexedDB was unavailable. The
  // independent gate hides it immediately; retry physical cleanup here.
  const revoked = [...revocations()];
  const policyMaintenance = () => maintainPolicy(tx, settings, rebuild);
  if (!revoked.length) { policyMaintenance(); return; }
  let pending = revoked.length;
  for (const scope of revoked) {
    const cursor = items.index('scope').openCursor(scope);
    cursor.onsuccess = () => {
      if (cursor.result) { cursor.result.delete(); cursor.result.continue(); return; }
      const tombstone = meta.get(`revoked:${scope}`);
      tombstone.onsuccess = () => {
        if (!tombstone.result) meta.put({ key: `revoked:${scope}`, value: true });
        if (--pending === 0) policyMaintenance();
      };
    };
  }
}
function maintainPolicy(tx: IDBTransaction, settings: SearchCacheSettings, rebuild: boolean): void {
  const items = tx.objectStore(ITEMS);
  const meta = tx.objectStore(META);
  const signature = JSON.stringify({ posts: settings.posts, wallabag: settings.wallabag });
  const savedPolicy = meta.get('policy');
  savedPolicy.onsuccess = () => {
    const trim = rebuild || savedPolicy.result?.value !== signature;
    const evict = () => {
      const expire = settings.maxAgeDays ? items.index('createdAtMs').openCursor(IDBKeyRange.upperBound(Date.now() - settings.maxAgeDays * DAY, true)) : null;
      const cap = () => {
        const count = items.count();
        count.onsuccess = () => {
          let excess = count.result - settings.maxItems;
          if (excess <= 0) return;
          const cursor = items.index('createdAtMs').openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result || excess <= 0) return;
            cursor.result.delete(); excess--;
            if (excess > 0) cursor.result.continue();
          };
        };
      };
      if (!expire) cap();
      else expire.onsuccess = () => {
        if (!expire.result) { cap(); return; }
        expire.result.delete(); expire.result.continue();
      };
    };
    if (!trim) { evict(); return; }
    const cursor = items.openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) { meta.put({ key: 'policy', value: signature }); evict(); return; }
      const item = cursor.result.value as CachedItem;
      const config = selectedPolicy(settings, item.source);
      if (!config.enabled) cursor.result.delete();
      else {
        const content = extractSearchText(item.excerpt);
        cursor.result.update(finishRecord({ ...item, excerpt: retainedExcerpt(content.text, content.paragraph, config) }));
      }
      cursor.result.continue();
    };
  };
}
async function maintenance(rebuild = false): Promise<void> {
  const db = await openDB();
  await transaction<void>(db, 'readwrite', tx => maintain(tx, getSearchCacheSettings(), rebuild));
}

/** Optional automatic collection must never make a feed fail to load. */
export async function cacheSearchItems(inputs: SearchCacheInput[], options: { generation?: number; strict?: boolean } = {}): Promise<number> {
  const started = options.generation ?? getSearchCacheGeneration();
  if (!inputs.length || !getSearchCacheSettings().enabled || started !== getSearchCacheGeneration()) return 0;
  if (inputs.length > 500) {
    let total = 0;
    for (let offset = 0; offset < inputs.length; offset += 500) {
      total += await cacheSearchItems(inputs.slice(offset, offset + 500), { ...options, generation: started });
    }
    return total;
  }
  return serialized(async () => {
    try {
      if (started !== getSearchCacheGeneration()) return 0;
      const db = await openDB();
      const settings = getSearchCacheSettings();
      if (!settings.enabled || started !== getSearchCacheGeneration()) return 0;
      // Bound one transaction and yield between batches at the ingestion layer.
      const records = inputs.map(input => recordFor(input, settings)).filter((v): v is CachedItem => !!v);
      if (!records.length) { await maintenance(); return 0; }
      const added = await transaction<number>(db, 'readwrite', (tx, result, abort) => {
        const items = tx.objectStore(ITEMS);
        const meta = tx.objectStore(META);
        const byScope = new Map<string, CachedItem[]>();
        for (const record of records) byScope.set(record.scope, [...(byScope.get(record.scope) ?? []), record]);
        let remaining = byScope.size;
        let count = 0;
        for (const [scope, scoped] of byScope) {
          const revoked = meta.get(`revoked:${scope}`);
          revoked.onsuccess = () => {
            try {
              if (!revoked.result && !scopeRevoked(scope) && started === getSearchCacheGeneration() && getSearchCacheSettings().enabled) {
                for (const record of scoped) { items.put(record); count++; }
              }
              if (--remaining === 0) { result(count); maintain(tx, getSearchCacheSettings()); }
            } catch (error) { abort(error); }
          };
        }
      });
      lastError = undefined;
      changed();
      return added;
    } catch (error) {
      const reported = failure(error);
      if (options.strict) throw reported;
      return 0;
    }
  });
}

export async function updateSearchCacheSettings(value: SearchCacheSettings): Promise<SearchCacheSettings> {
  const settings = normalizeSettings(value);
  invalidate();
  if (!writeJson(SETTINGS_KEY, settings)) throw failure(new Error('Preference write failed'));
  try {
    await serialized(() => maintenance());
    lastError = undefined;
    changed();
    return settings;
  } catch (error) { throw failure(error); }
}

export async function clearSearchCache(): Promise<void> {
  invalidate();
  try {
    await serialized(async () => {
      const db = await openDB();
      // Keep revoked scopes so late callbacks cannot resurrect disconnected data.
      await transaction<void>(db, 'readwrite', tx => { tx.objectStore(ITEMS).clear(); });
    });
    lastError = undefined;
    changed();
  } catch (error) { throw failure(error); }
}

/**
 * Revoke independently of database cleanup, including across tabs/restarts.
 * A failed deletion transaction must not resurrect a disconnected account.
 * Call before deleting account credentials: if neither durable mechanism works,
 * this rejects and the account can remain connected until storage recovers.
 */
export async function removeSearchCacheScope(scope: string): Promise<void> {
  invalidate();
  revokedScopes.add(scope);
  // The IndexedDB tombstone below is a second durable mechanism if this fails.
  const gated = writeString(revocationKey(scope), '1');
  changed();
  if (typeof indexedDB === 'undefined' && gated) return;
  try {
    await serialized(async () => {
      const db = await openDB();
      await transaction<void>(db, 'readwrite', tx => {
        tx.objectStore(META).put({ key: `revoked:${scope}`, value: true });
        const request = tx.objectStore(ITEMS).index('scope').openCursor(scope);
        request.onsuccess = () => {
          if (request.result) { request.result.delete(); request.result.continue(); }
        };
      });
    });
    changed();
  } catch (error) {
    const reported = failure(error);
    // The durable gate blocks reads/writes and maintenance retries deletion.
    if (!gated) throw reported;
  }
}

/** Rebuild from retained excerpts; deliberately cannot recover discarded text. */
export async function rebuildSearchCache(): Promise<void> {
  invalidate();
  try { await serialized(() => maintenance(true)); lastError = undefined; changed(); }
  catch (error) { throw failure(error); }
}

export async function getSearchCacheStats(): Promise<SearchCacheStats> {
  const stats: SearchCacheStats = { count: 0, bytes: 0, available: typeof indexedDB !== 'undefined', bySource: { bluesky: 0, mastodon: 0, threads: 0, rss: 0, wallabag: 0 } };
  try {
    await serialized(() => maintenance());
    const db = await openDB();
    await transaction<void>(db, 'readonly', tx => {
      const request = tx.objectStore(ITEMS).openCursor();
      request.onsuccess = () => {
        if (!request.result) return;
        const item = request.result.value as CachedItem;
        if (!scopeRevoked(item.scope)) {
          stats.count++; stats.bytes += item.bytes; stats.bySource[item.source]++;
        }
        request.result.continue();
      };
    });
    stats.error = lastError;
  } catch (error) { stats.available = false; stats.error = failure(error).message; }
  return stats;
}

/** AND words, with a prefix for the final word (2+ chars). No body scans. */
export async function searchCache(query: string, options: { source?: SearchCacheSource; limit?: number } = {}): Promise<SearchCacheResult[]> {
  const started = getSearchCacheGeneration();
  if (!getSearchCacheSettings().enabled) return [];
  if (query.length > 256) throw new Error('Local search queries must be 256 characters or fewer.');
  const terms = tokenizeSearchText(query.trim());
  if (!terms.length) return [];
  const limit = bounded(options.limit, 100, 1, 500);
  try {
    await serialized(() => maintenance());
    const db = await openDB();
    if (started !== getSearchCacheGeneration() || !getSearchCacheSettings().enabled) return [];
    const found = await transaction<SearchCacheResult[]>(db, 'readonly', (tx, result) => {
      const store = tx.objectStore(ITEMS);
      const index = store.index('tokens');
      const lists: Set<IDBValidKey>[] = [];
      let pending = terms.length;
      const collect = () => {
        lists.sort((a, b) => a.size - b.size);
        const candidates = [...lists[0]].filter(key => lists.every(list => list.has(key)));
        const matches: SearchCacheResult[] = [];
        result(matches);
        for (const key of candidates) {
          const request = store.get(key);
          request.onsuccess = () => {
            const item = request.result as CachedItem | undefined;
            if (!item || scopeRevoked(item.scope) || (options.source && item.source !== options.source)) return;
            const settings = getSearchCacheSettings();
            if (!settings.enabled || !selectedPolicy(settings, item.source).enabled || (settings.maxAgeDays && item.createdAtMs < Date.now() - settings.maxAgeDays * DAY)) return;
            const title = normalized(item.title);
            const author = normalized(item.author);
            const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 8 : 0) + (author.includes(term) ? 3 : 0) + 1, 0);
            const { tokens: _tokens, bytes: _bytes, createdAtMs: _date, ...view } = item;
            matches.push({ ...view, score });
          };
        }
      };
      terms.forEach((term, i) => {
        const key = i === terms.length - 1 && Array.from(term).length >= 2 ? IDBKeyRange.bound(term, `${term}\uffff`) : term;
        const request = index.getAllKeys(key);
        request.onsuccess = () => { lists.push(new Set(request.result)); if (--pending === 0) collect(); };
      });
    });
    if (started !== getSearchCacheGeneration() || !getSearchCacheSettings().enabled) return [];
    return found.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, limit);
  } catch (error) { throw failure(error); }
}
