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

function openArchiveDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
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

/** Get archive stats */
export async function getArchiveStats(): Promise<{
  total: number;
  byType: Record<ArchiveType, number>;
  byPlatform: Record<Platform, number>;
  dateRange: { oldest: string; newest: string } | null;
}> {
  const db = await openArchiveDB();
  const all = await new Promise<ArchivedPost[]>((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const byType: Record<string, number> = { post: 0, like: 0, repost: 0, reply: 0 };
  const byPlatform: Record<string, number> = { bluesky: 0, mastodon: 0 };
  let oldest = '', newest = '';

  for (const p of all) {
    byType[p.type] = (byType[p.type] ?? 0) + 1;
    byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
    if (!oldest || p.createdAt < oldest) oldest = p.createdAt;
    if (!newest || p.createdAt > newest) newest = p.createdAt;
  }

  return {
    total: all.length,
    byType: byType as Record<ArchiveType, number>,
    byPlatform: byPlatform as Record<Platform, number>,
    dateRange: all.length > 0 ? { oldest, newest } : null,
  };
}

/** Search the archive */
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
  const all = await new Promise<ArchivedPost[]>((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let results = all;

  if (params.platform) results = results.filter(p => p.platform === params.platform);
  if (params.type) results = results.filter(p => p.type === params.type);
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
