/**
 * Local post archive — stores posts in IndexedDB for offline search,
 * filtering, and export. Indexes your own posts, likes, reposts, replies.
 */

import type { UnifiedPost, Platform } from './types';

const DB_NAME = 'crispdeck-archive';
const DB_VERSION = 1;
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

let _archiveDb: IDBDatabase | null = null;

function openArchiveDB(): Promise<IDBDatabase> {
  if (_archiveDb) return Promise.resolve(_archiveDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      _archiveDb = req.result;
      _archiveDb.onclose = () => { _archiveDb = null; };
      resolve(_archiveDb);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'uri' });
        store.createIndex('platform', 'platform', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('authorHandle', 'authorHandle', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
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

  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve(added);
    txn.onerror = () => reject(txn.error);
  });
}

/** Get archive stats using index counts (O(1) per count instead of full scan) */
export async function getArchiveStats(): Promise<{
  total: number;
  byType: Record<ArchiveType, number>;
  byPlatform: Record<Platform, number>;
  dateRange: { oldest: string; newest: string } | null;
}> {
  const db = await openArchiveDB();
  const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);

  const idbCount = (index: IDBIndex, key: IDBValidKey) => new Promise<number>((resolve, reject) => {
    const req = index.count(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const idbCursorValue = (index: IDBIndex, dir: IDBCursorDirection) => new Promise<ArchivedPost | null>((resolve, reject) => {
    const req = index.openCursor(null, dir);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });

  const typeIndex = store.index('type');
  const platformIndex = store.index('platform');
  const dateIndex = store.index('createdAt');

  const [postCount, likeCount, repostCount, replyCount, bskyCount, mastoCount, oldest, newest] = await Promise.all([
    idbCount(typeIndex, 'post'),
    idbCount(typeIndex, 'like'),
    idbCount(typeIndex, 'repost'),
    idbCount(typeIndex, 'reply'),
    idbCount(platformIndex, 'bluesky'),
    idbCount(platformIndex, 'mastodon'),
    idbCursorValue(dateIndex, 'next'),
    idbCursorValue(dateIndex, 'prev'),
  ]);

  const total = postCount + likeCount + repostCount + replyCount;
  return {
    total,
    byType: { post: postCount, like: likeCount, repost: repostCount, reply: replyCount },
    byPlatform: { bluesky: bskyCount, mastodon: mastoCount, threads: total - bskyCount - mastoCount } as Record<Platform, number>,
    dateRange: total > 0 ? { oldest: oldest!.createdAt, newest: newest!.createdAt } : null,
  };
}

/**
 * Search the archive. Uses IndexedDB indexes when a single filter is applied
 * (type, platform) to avoid loading the entire archive into memory.
 * Falls back to full scan only when text search or multi-field filter is needed.
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
  const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);

  // Fast path: use index when only filtering by type or platform (most common case)
  const hasTextFilters = !!(params.query || params.author);
  const hasDateFilters = !!(params.dateFrom || params.dateTo);
  const hasMediaFilter = !!params.hasMedia;

  let initial: ArchivedPost[];

  if (params.type && !params.platform && !hasTextFilters && !hasDateFilters && !hasMediaFilter) {
    // Index scan on 'type' — much faster than getAll() for large archives
    initial = await new Promise<ArchivedPost[]>((resolve, reject) => {
      const req = store.index('type').getAll(params.type);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } else if (params.platform && !params.type && !hasTextFilters && !hasDateFilters && !hasMediaFilter) {
    initial = await new Promise<ArchivedPost[]>((resolve, reject) => {
      const req = store.index('platform').getAll(params.platform);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } else {
    // Full scan — needed for text search or complex multi-field filters
    initial = await new Promise<ArchivedPost[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  let results = initial;

  if (params.platform && params.type) {
    // Both set but only one was used for index scan
    if (params.platform) results = results.filter(p => p.platform === params.platform);
    if (params.type) results = results.filter(p => p.type === params.type);
  }
  if (params.author) {
    const a = params.author.toLowerCase();
    results = results.filter(p => p.authorHandle.toLowerCase().includes(a) || p.authorName.toLowerCase().includes(a));
  }
  if (params.dateFrom) results = results.filter(p => p.createdAt >= params.dateFrom!);
  if (params.dateTo) results = results.filter(p => p.createdAt <= params.dateTo!);
  if (params.hasMedia) results = results.filter(p => p.hasMedia);
  if (params.query) {
    const q = params.query.toLowerCase();
    results = results.filter(p => p.text.toLowerCase().includes(q) || p.authorHandle.toLowerCase().includes(q));
  }

  // Sort newest first
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return params.limit ? results.slice(0, params.limit) : results;
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
