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
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Cache feed data for offline use. Call after every successful feed load. */
export async function cacheFeed(key: string, posts: UnifiedPost[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Only cache the first 100 posts to keep IndexedDB size reasonable
    const entry: CachedFeed = {
      key,
      posts: posts.slice(0, 100),
      cachedAt: new Date().toISOString(),
    };
    store.put(entry);
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
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
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
