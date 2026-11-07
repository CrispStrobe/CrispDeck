/**
 * Offline feed cache.
 *
 * Caches the last-known feed state in IndexedDB so PWA users
 * can see their feed when offline. Updated on every successful
 * feed load. Shows "Offline — cached from [time]" banner.
 */

import type { UnifiedPost } from '$lib/types';

const DB_NAME = 'crispdeck-offline';
const DB_VERSION = 1;
const STORE_NAME = 'feed-cache';

interface CachedFeed {
  key: string;         // 'feed' | 'notifications' | 'trending'
  posts: UnifiedPost[];
  cachedAt: string;    // ISO timestamp
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const release = () => { if (dbPromise === opening) dbPromise = null; };
      db.onclose = release;
      db.onversionchange = () => { db.close(); release(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    // Drop the cached promise so a later call can retry. Without this one
    // transient failure to open the database disabled the offline cache for the
    // rest of the session: every subsequent call awaited the same rejection.
    if (dbPromise === opening) dbPromise = null;
    throw e;
  });
  dbPromise = opening;
  return opening;
}

/** Cache feed data for offline use. Call after every successful feed load. */
export async function cacheFeed(key: string, posts: UnifiedPost[]): Promise<void> {
  try {
    const db = await openDB();
    // Only cache the first 100 posts to keep IndexedDB size reasonable
    const entry: CachedFeed = {
      key,
      posts: posts.slice(0, 100),
      cachedAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Offline cache write aborted'));
      tx.objectStore(STORE_NAME).put(entry);
    });
  } catch {
    // IndexedDB unavailable — silently skip (this IS an acceptable silent catch)
  }
}

/** Load cached feed data. Returns null if no cache exists. */
export async function loadCachedFeed(key: string): Promise<CachedFeed | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      let entry: CachedFeed | null = null;
      req.onsuccess = () => {
        const value = req.result;
        if (value?.key === key && Array.isArray(value.posts) && typeof value.cachedAt === 'string') entry = value;
      };
      tx.oncomplete = () => resolve(entry);
      tx.onabort = tx.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Format the cached-at timestamp for display. */
export function formatCachedTime(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(isoTimestamp).toLocaleDateString();
}

/** Check if the browser is currently offline. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}
