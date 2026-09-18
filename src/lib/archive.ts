/**
 * Local post archive — stores posts in IndexedDB for offline search,
 * filtering, and export. Indexes your own posts, likes, reposts, replies.
 */

import type { UnifiedPost, Platform } from './types';

const DB_NAME = 'crispdeck-archive';
const DB_VERSION = 2;
const STORE_NAME = 'posts';

export type ArchiveType = 'post' | 'like' | 'repost' | 'reply';

export interface ArchivedPost {
  uri: string;
  platform: Platform;
  type: ArchiveType;
  text: string;
  authorHandle: string;
  authorName: string;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  hasMedia: boolean;
  raw: unknown;
  indexedAt: string;
}

/**
 * Cached connection.
 *
 * Every archive call used to open its own IDBDatabase and never close it, so a
 * session accumulated one connection per search — and an open connection blocks
 * any later version upgrade. One shared connection avoids both.
 */
let dbPromise: Promise<IDBDatabase> | null = null;

function openArchiveDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openArchiveDBUncached().catch((e) => {
      dbPromise = null; // let the next call retry
      throw e;
    });
  }
  return dbPromise;
}

/** Drop the cached connection (used when the database is deleted or reset). */
export function closeArchiveDB(): void {
  const pending = dbPromise;
  dbPromise = null;
  pending?.then((db) => db.close()).catch(() => {});
}

function openArchiveDBUncached(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const txn = req.transaction!;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? txn.objectStore(STORE_NAME)
        : (() => {
            const s = db.createObjectStore(STORE_NAME, { keyPath: 'uri' });
            s.createIndex('platform', 'platform', { unique: false });
            s.createIndex('type', 'type', { unique: false });
            s.createIndex('authorHandle', 'authorHandle', { unique: false });
            s.createIndex('createdAt', 'createdAt', { unique: false });
            return s;
          })();

      // v2: compound indexes so a search can walk newest-first within a type or
      // platform and stop at the limit, instead of reading the whole store.
      // IndexedDB backfills these for existing records automatically.
      if ((event.oldVersion ?? 0) < 2) {
        if (!store.indexNames.contains('type_createdAt')) {
          store.createIndex('type_createdAt', ['type', 'createdAt'], { unique: false });
        }
        if (!store.indexNames.contains('platform_createdAt')) {
          store.createIndex('platform_createdAt', ['platform', 'createdAt'], { unique: false });
        }
      }
    };
  });
}

/** Convert a UnifiedPost to an ArchivedPost */
export function toArchiveRecord(post: UnifiedPost, type: ArchiveType): ArchivedPost {
  return {
    uri: post.uri,
    platform: post.platform,
    type,
    text: post.text,
    authorHandle: post.author.handle,
    authorName: post.author.displayName ?? post.author.handle,
    createdAt: post.createdAt,
    likeCount: post.likeCount ?? 0,
    repostCount: post.repostCount ?? 0,
    replyCount: post.replyCount ?? 0,
    hasMedia: !!(post.embeds && (Array.isArray(post.embeds) ? (post.embeds as unknown[]).length > 0 : true)),
    raw: post.raw,
    indexedAt: new Date().toISOString(),
  };
}

/**
 * Maximum records kept. The archive grows with every sync and was only ever
 * emptied wholesale by the user, so a heavy account could push IndexedDB into
 * the hundreds of megabytes — and browsers evict IndexedDB under storage
 * pressure a whole database at a time, so the failure mode is losing the lot
 * rather than merely being slow. Oldest records are dropped past the cap.
 */
export const DEFAULT_ARCHIVE_CAP = 20_000;

export function getArchiveCap(): number {
  try {
    const raw = localStorage.getItem('crispdeck-archive-cap');
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // storage blocked; fall through to the default
  }
  return DEFAULT_ARCHIVE_CAP;
}

function countRecords(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Drop the oldest records until at most `cap` remain.
 *
 * Walks the createdAt index forwards (oldest first) and deletes through the
 * cursor, so only the records actually being removed are read.
 * Returns how many were deleted.
 */
export async function pruneArchive(cap = getArchiveCap()): Promise<number> {
  const db = await openArchiveDB();
  const total = await countRecords(db);
  const excess = total - cap;
  if (excess <= 0) return 0;

  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const index = txn.objectStore(STORE_NAME).index('createdAt');
    let removed = 0;
    const req = index.openCursor(null, 'next');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || removed >= excess) return;
      cursor.delete();
      removed++;
      cursor.continue();
    };
    txn.oncomplete = () => resolve(removed);
    txn.onerror = () => reject(txn.error);
  });
}

/** How much room the archive is taking, for the archive page to show. */
export async function getArchiveUsage(): Promise<{
  records: number;
  cap: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}> {
  const db = await openArchiveDB();
  const records = await countRecords(db);
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    // Origin-wide, not archive-specific — the browser exposes nothing finer.
    const estimate = await navigator.storage?.estimate?.();
    usageBytes = estimate?.usage ?? null;
    quotaBytes = estimate?.quota ?? null;
  } catch {
    // Storage API unavailable or blocked.
  }
  return { records, cap: getArchiveCap(), usageBytes, quotaBytes };
}

/** Add posts to the archive (upsert — won't duplicate) */
export async function archivePosts(posts: UnifiedPost[], type: ArchiveType): Promise<number> {
  const db = await openArchiveDB();
  let added = 0;
  const txn = db.transaction(STORE_NAME, 'readwrite');
  const store = txn.objectStore(STORE_NAME);

  for (const post of posts) {
    const record = toArchiveRecord(post, type);
    store.put(record);
    added++;
  }

  await new Promise<void>((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });

  // Keep the store bounded rather than letting it grow until the browser
  // evicts the whole database.
  await pruneArchive();
  return added;
}

/** Count rows matching one index key, without materialising them. */
function countByIndex(db: IDBDatabase, indexName: string, key: IDBValidKey): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index(indexName).count(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** First or last value of an index, via a single-step cursor. */
function edgeByIndex(
  db: IDBDatabase,
  indexName: string,
  direction: 'next' | 'prev'
): Promise<ArchivedPost | null> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
      .index(indexName).openCursor(null, direction);
    req.onsuccess = () => resolve((req.result?.value as ArchivedPost) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get archive stats.
 *
 * Counted through the indexes rather than by reading every record — this is
 * called on the archive page, and materialising the whole store (each record
 * carrying the full raw API payload) to produce a handful of numbers got
 * steadily more expensive as the archive grew.
 */
export async function getArchiveStats(): Promise<{
  total: number;
  byType: Record<ArchiveType, number>;
  byPlatform: Record<Platform, number>;
  dateRange: { oldest: string; newest: string } | null;
}> {
  const db = await openArchiveDB();

  const types: ArchiveType[] = ['post', 'like', 'repost', 'reply'];
  const platforms: Platform[] = ['bluesky', 'mastodon', 'threads'];

  const [total, typeCounts, platformCounts, oldestRow, newestRow] = await Promise.all([
    countRecords(db),
    Promise.all(types.map((t) => countByIndex(db, 'type', t))),
    Promise.all(platforms.map((p) => countByIndex(db, 'platform', p))),
    edgeByIndex(db, 'createdAt', 'next'),
    edgeByIndex(db, 'createdAt', 'prev'),
  ]);

  const byType = {} as Record<ArchiveType, number>;
  types.forEach((t, i) => { byType[t] = typeCounts[i]; });
  const byPlatform = {} as Record<Platform, number>;
  platforms.forEach((p, i) => { byPlatform[p] = platformCounts[i]; });

  return {
    total,
    byType,
    byPlatform,
    dateRange: oldestRow && newestRow
      ? { oldest: oldestRow.createdAt, newest: newestRow.createdAt }
      : null,
  };
}

/**
 * Order used by searchArchive: newest first, ties broken by uri ascending.
 *
 * The tie-break is explicit because results no longer always arrive in object
 * store key order. A full getAll() returns records by primary key (uri), and a
 * stable sort left equal timestamps in that order; cursor reads don't, so the
 * comparator has to say so rather than rely on the read path.
 */
function byNewest(a: ArchivedPost, b: ArchivedPost): number {
  const t = b.createdAt.localeCompare(a.createdAt);
  return t !== 0 ? t : a.uri.localeCompare(b.uri);
}

/** Read every record in the store. */
function getAllRecords(db: IDBDatabase): Promise<ArchivedPost[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Walk a compound [field, createdAt] index newest-first, keeping records that
 * pass `accept`, and stop once `limit` are collected.
 *
 * Collection continues past the limit while the timestamp is unchanged, so a
 * run of identical timestamps at the boundary is resolved by the comparator
 * rather than by where the cursor happened to stop.
 */
function collectFromIndex(
  db: IDBDatabase,
  indexName: string,
  value: string,
  limit: number,
  accept: (p: ArchivedPost) => boolean
): Promise<ArchivedPost[]> {
  return new Promise((resolve, reject) => {
    const index = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index(indexName);
    // Whole range for this key. In IndexedDB key ordering a shorter array sorts
    // before any longer array sharing its prefix, and arrays sort above every
    // string — so [value] is below [value, <any string>] and [value, []] is
    // above all of them, whatever createdAt happens to contain.
    const range = IDBKeyRange.bound([value], [value, []]);
    const out: ArchivedPost[] = [];
    const req = index.openCursor(range, 'prev');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(out); return; }
      const record = cursor.value as ArchivedPost;
      if (accept(record)) {
        if (out.length >= limit && record.createdAt !== out[out.length - 1].createdAt) {
          resolve(out); return;
        }
        out.push(record);
      }
      cursor.continue();
    };
  });
}

/**
 * Search the archive.
 *
 * This used to read the entire store with getAll() and filter in JS, with the
 * limit applied last — so the feed's three calls on mount each deserialised
 * every archived post to use 500 of them, and got slower the longer the archive
 * grew. The store's indexes were never used.
 *
 * Now the most selective equality filter picks an index. With a limit, a
 * compound [field, createdAt] index is walked newest-first and stops early;
 * without one, the index narrows the read before filtering. A search with no
 * equality filter still has to scan, which is unavoidable for a substring query.
 */
export async function searchArchive(params: {
  query?: string;
  platform?: Platform;
  type?: ArchiveType;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
  hasMedia?: boolean;
  limit?: number;
}): Promise<ArchivedPost[]> {
  const db = await openArchiveDB();

  // Every filter except the one chosen as the index key.
  const makeAccept = (skip: 'type' | 'platform' | 'author' | null) => (p: ArchivedPost) => {
    if (skip !== 'platform' && params.platform && p.platform !== params.platform) return false;
    if (skip !== 'type' && params.type && p.type !== params.type) return false;
    if (skip !== 'author' && params.author) {
      const a = params.author.toLowerCase();
      if (!p.authorHandle.toLowerCase().includes(a) && !p.authorName.toLowerCase().includes(a)) return false;
    }
    if (params.dateFrom && p.createdAt < params.dateFrom) return false;
    if (params.dateTo && p.createdAt > params.dateTo) return false;
    if (params.hasMedia && !p.hasMedia) return false;
    if (params.query) {
      const q = params.query.toLowerCase();
      if (!p.text.toLowerCase().includes(q) && !p.authorHandle.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  // Fast path: an equality filter plus a limit can stop early.
  if (params.limit && params.limit > 0) {
    if (params.type) {
      const rows = await collectFromIndex(db, 'type_createdAt', params.type, params.limit, makeAccept('type'));
      return rows.sort(byNewest).slice(0, params.limit);
    }
    if (params.platform) {
      const rows = await collectFromIndex(db, 'platform_createdAt', params.platform, params.limit, makeAccept('platform'));
      return rows.sort(byNewest).slice(0, params.limit);
    }
  }

  // Otherwise narrow the read with a plain index where we can.
  let rows: ArchivedPost[];
  let skip: 'type' | 'platform' | null = null;
  if (params.type) {
    rows = await getAllByIndex(db, 'type', params.type);
    skip = 'type';
  } else if (params.platform) {
    rows = await getAllByIndex(db, 'platform', params.platform);
    skip = 'platform';
  } else {
    rows = await getAllRecords(db);
  }

  const results = rows.filter(makeAccept(skip)).sort(byNewest);
  return params.limit ? results.slice(0, params.limit) : results;
}

function getAllByIndex(db: IDBDatabase, indexName: string, key: IDBValidKey): Promise<ArchivedPost[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Clear the entire archive */
export async function clearArchive(): Promise<void> {
  const db = await openArchiveDB();
  const txn = db.transaction(STORE_NAME, 'readwrite');
  txn.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}
