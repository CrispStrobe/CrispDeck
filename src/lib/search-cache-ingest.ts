/** Optional local-search ingestion. Only small text projections reach the index. */
import type { UnifiedPost } from '$lib/types';
import type { SearchCacheInput } from '$lib/search-cache';
import { cacheSearchItems, getSearchCacheGeneration, getSearchCacheSettings } from '$lib/search-cache';
import { swallow } from '$lib/debug-log';
import { readJson, writeJson } from '$lib/safe-storage';

/** Per-action bounds protect slow servers and mobile webviews. */
export const WALLABAG_SYNC_PAGE_LIMIT = 10000;
export const WALLABAG_SYNC_PAGE_SIZE = 50;
export interface SearchCacheSyncProgress { processed: number; indexed: number; pages: number }
export interface SearchCacheSyncResult extends SearchCacheSyncProgress { stoppedEarly: boolean; stoppedByDate?: boolean }
export interface SearchCacheSyncOptions {
  signal?: AbortSignal;
  pauseOnAbort?: boolean;
  onProgress?: (progress: SearchCacheSyncProgress) => void;
  incremental?: boolean;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function webUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

/** Account provenance is required; legacy unscoped posts are left alone. */
export function postSearchInput(post: UnifiedPost): SearchCacheInput | null {
  if (!post || !['bluesky', 'mastodon', 'threads'].includes(post.platform) ||
      !Number.isSafeInteger(post.sourceAccountId) || Number(post.sourceAccountId) <= 0 ||
      typeof post.uri !== 'string' || !post.uri || typeof post.text !== 'string') return null;
  const raw = record(post.raw);
  const target = record(post.platform === 'mastodon' ? raw.reblog ?? raw : post.platform === 'threads' ? raw.reposted_post ?? raw : raw.post);
  // Never index direct messages even when a notification contains one.
  if (post.platform === 'mastodon' && target.visibility === 'direct') return null;
  const card = record(target.card);
  const embed = record(post.embeds);
  const external = record(embed.external ?? record(embed.media).external);
  const title = post.platform === 'bluesky' ? external.title : card.title;
  const originalDate = post.platform === 'mastodon' ? target.createdAt ?? target.created_at
    : post.platform === 'bluesky' ? record(target.record).createdAt : target.timestamp;
  const createdAt = typeof originalDate === 'string' ? originalDate : post.createdAt;
  let url = webUrl(target.url ?? target.permalink) || webUrl(post.uri);
  if (post.platform === 'bluesky') {
    const match = /^at:\/\/([^/?#]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(post.uri);
    if (match) url = `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
  }
  if (!url) return null;
  const html = post.platform === 'mastodon' && typeof target.content === 'string';
  return {
    source: post.platform, scope: `account:${post.sourceAccountId}`, id: post.uri, url,
    title: typeof title === 'string' ? title : undefined,
    text: html ? target.content : post.text, html,
    author: [post.author?.displayName, post.author?.handle].filter(Boolean).join(' '), createdAt,
  };
}

const queued = new Map<string, SearchCacheInput>();
let scheduled = false;
let queueGeneration = -1;

/** Batch synchronous feed/render callbacks; optional storage never blocks a view. */
export function queuePostsForSearchCache(posts: UnifiedPost[], generation = getSearchCacheGeneration()): void {
  const settings = getSearchCacheSettings();
  if (!settings.enabled || !settings.posts.enabled) return;
  if (generation !== getSearchCacheGeneration()) return;
  if (generation !== queueGeneration) { queued.clear(); queueGeneration = generation; }
  for (const post of posts) {
    const item = postSearchInput(post);
    if (item) queued.set(`${item.scope}:${item.source}:${item.id}`, item);
    if (queued.size >= 1000) break;
  }
  if (!queued.size || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const items = [...queued.values()];
    const capturedGeneration = queueGeneration;
    queued.clear();
    void (async () => {
      for (let offset = 0; offset < items.length; offset += 500) {
        await cacheSearchItems(items.slice(offset, offset + 500), { generation: capturedGeneration });
      }
    })().catch(error => swallow('search-cache.ingest', error));
  });
}

function checkActive(generation: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Indexing cancelled.', 'AbortError');
  if (generation !== getSearchCacheGeneration() || !getSearchCacheSettings().enabled) {
    throw new DOMException('Index settings changed. Start indexing again.', 'AbortError');
  }
}

/**
 * Seed from existing, account-scoped bookmarks and view/offline feed caches.
 * The legacy archive has no source account identity and is deliberately not
 * imported: guessing an account could expose private Mastodon content.
 */
export async function indexExistingSearchCache(options: SearchCacheSyncOptions = {}): Promise<SearchCacheSyncResult> {
  const settings = getSearchCacheSettings();
  const progress: SearchCacheSyncResult = { processed: 0, indexed: 0, pages: 0, stoppedEarly: false };
  if (!settings.enabled || !settings.posts.enabled) return progress;
  const generation = getSearchCacheGeneration();
  checkActive(generation, options.signal);
  const { listAccounts } = await import('$lib/db');
  const accounts = new Set((await listAccounts()).map(account => account.id));
  checkActive(generation, options.signal);
  const cutoff = settings.maxAgeDays ? Date.now() - settings.maxAgeDays * 86_400_000 : -Infinity;
  let candidates = new Map<string, SearchCacheInput>();
  const consider = (posts: UnifiedPost[]) => {
    checkActive(generation, options.signal);
    for (const post of posts) {
      if (!accounts.has(post?.sourceAccountId!)) continue;
      const item = postSearchInput(post);
      if (!item) continue;
      const createdAt = Date.parse(item.createdAt);
      if (!Number.isFinite(createdAt) || createdAt < cutoff) continue;
      candidates.set(`${item.scope}:${item.source}:${item.id}`, item);
    }
    if (candidates.size > settings.maxItems) {
      progress.stoppedEarly = true;
      candidates = new Map([...candidates.entries()]
        .sort((a, b) => Date.parse(b[1].createdAt) - Date.parse(a[1].createdAt))
        .slice(0, settings.maxItems));
    }
    progress.pages++;
    options.onProgress?.({ ...progress });
  };
  const { listBookmarks } = await import('$lib/bookmarks');
  consider(await listBookmarks());
  checkActive(generation, options.signal);
  const feedKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('crispdeck-vc-')) feedKeys.push(key);
  }
  for (const key of feedKeys) {
    checkActive(generation, options.signal);
    const data: unknown = record(readJson<unknown>(key, null)).data;
    const posts = Array.isArray(data) ? data : record(data).posts;
    if (Array.isArray(posts)) consider(posts);
  }
  checkActive(generation, options.signal);
  const { loadCachedFeed } = await import('$lib/offline-cache');
  // Current account feeds have localStorage mirrors. These older singleton
  // keys cover installations upgraded from the original offline cache.
  for (const key of ['feed', 'trending', 'notifications']) {
    checkActive(generation, options.signal);
    const feed = await loadCachedFeed(key);
    if (feed) consider(feed.posts);
  }
  const entries = [...candidates.values()];
  for (let offset = 0; offset < entries.length; offset += 500) {
    checkActive(generation, options.signal);
    const batch = entries.slice(offset, offset + 500);
    progress.indexed += await cacheSearchItems(batch, { generation, strict: true });
    progress.processed += batch.length;
    options.onProgress?.({ ...progress });
  }
  checkActive(generation, options.signal);
  return progress;
}

/** Explicit, cancellable Wallabag import; never runs from a search request. */
let wallabagSyncRunning = false;
export async function syncWallabagSearchCache(options: SearchCacheSyncOptions = {}): Promise<SearchCacheSyncResult> {
  if (wallabagSyncRunning) throw new Error('A Wallabag index update is already running.');
  wallabagSyncRunning = true;
  try {
    const run = () => syncWallabagSearchCacheImpl(options);
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('crispdeck-wallabag-index-sync', { ifAvailable: true }, lock => {
        if (!lock) throw new Error('A Wallabag index update is already running.');
        return run();
      });
    }
    return await run();
  } finally { wallabagSyncRunning = false; }
}
async function syncWallabagSearchCacheImpl(options: SearchCacheSyncOptions): Promise<SearchCacheSyncResult> {
  const settings = getSearchCacheSettings();
  const progress: SearchCacheSyncResult = { processed: 0, indexed: 0, pages: 0, stoppedEarly: false };
  if (!settings.enabled || !settings.wallabag.enabled) return progress;
  const generation = getSearchCacheGeneration();
  checkActive(generation, options.signal);
  const server = localStorage.getItem('crispdeck-wallabag-url') ?? '';
  if (!server.trim()) throw new Error('Connect Wallabag in Settings first.');
  const { listWallabagIndexEntries, wallabagSearchScope } = await import('$lib/wallabag');
  const scope = await wallabagSearchScope(server);
  checkActive(generation, options.signal);
  let startedAt = Date.now();
  let startPage = 1;
  const checkpointKey = `crispdeck-wallabag-index-checkpoint:${scope}`;
  const signature = JSON.stringify([settings.wallabag, settings.maxAgeDays, settings.maxItems]);
  let since: number | undefined;
  if (options.incremental) {
    try {
      const checkpoint = JSON.parse(localStorage.getItem(checkpointKey) ?? 'null');
      if (checkpoint?.signature !== signature || checkpoint?.generation !== generation || checkpoint?.paused) return progress;
      if (checkpoint.phase === 'full' && Number.isSafeInteger(checkpoint.nextPage) && checkpoint.nextPage >= 1 && Number.isFinite(checkpoint.startedAt)) {
        startPage = checkpoint.nextPage; startedAt = checkpoint.startedAt;
      } else if (Number.isSafeInteger(checkpoint?.since) && checkpoint.since >= 0) since = checkpoint.since;
      else return progress;
    } catch { return progress; }
  }
  if (!options.incremental) {
    writeJson(checkpointKey, { signature, generation, phase: 'full', startedAt, nextPage: 1 });
  }
  const cutoff = settings.maxAgeDays ? Date.now() - settings.maxAgeDays * 86_400_000 : -Infinity;
  const seen = new Set<number>();
  const pageLimit = Math.min(WALLABAG_SYNC_PAGE_LIMIT, Math.ceil(settings.maxItems / WALLABAG_SYNC_PAGE_SIZE));
  try {
  for (let page = startPage; page <= pageLimit; page++) {
    checkActive(generation, options.signal);
    const result = await listWallabagIndexEntries(server, {
      page, perPage: WALLABAG_SYNC_PAGE_SIZE, expectedScope: scope, signal: options.signal, ...(since !== undefined ? { since } : {}),
    });
    checkActive(generation, options.signal);
    const inputs: SearchCacheInput[] = [];
    for (const entry of result.entries) {
      if (seen.has(entry.id)) continue;
      if (seen.size >= settings.maxItems) { progress.stoppedEarly = true; break; }
      seen.add(entry.id);
      inputs.push({ source: 'wallabag', scope, id: String(entry.id), url: entry.url,
        title: entry.title, text: entry.content, html: true, createdAt: entry.createdAt });
    }
    progress.processed += inputs.length;
    progress.indexed += await cacheSearchItems(inputs, { generation, strict: true });
    progress.pages++;
    options.onProgress?.({ ...progress });
    checkActive(generation, options.signal);
    const allOlder = since === undefined && result.entries.length > 0 && result.entries.every(entry => Date.parse(entry.createdAt) < cutoff);
    if (allOlder && settings.maxAgeDays) progress.stoppedByDate = true;
    if (!result.hasMore || allOlder || result.entries.length === 0 || inputs.length === 0 || progress.stoppedEarly) break;
    if (page === pageLimit || seen.size >= settings.maxItems) { progress.stoppedEarly = true; break; }
    if (since === undefined) {
      writeJson(checkpointKey, { signature, generation, phase: 'full', startedAt, nextPage: page + 1 });
    }
  }
  } catch (error) {
    if (options.signal?.aborted && options.pauseOnAbort) {
      try {
        const checkpoint = JSON.parse(localStorage.getItem(checkpointKey) ?? 'null');
        if (checkpoint?.signature === signature && checkpoint?.generation === generation && checkpoint?.phase === 'full') {
          checkpoint.paused = true; writeJson(checkpointKey, checkpoint);
        }
      } catch { /* Cancellation remains effective in this session. */ }
    }
    throw error;
  }
  if (!progress.stoppedEarly) {
    // Overlap runs to cover edits made while pages were being read.
    writeJson(checkpointKey, { signature, generation, since: Math.max(0, Math.floor((startedAt - 120_000) / 1000)) });
  }
  return progress;
}
