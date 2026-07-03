/**
 * Post analytics history — periodic engagement snapshots stored in IndexedDB.
 * Tracks likes/reposts/replies over time for the user's own posts.
 */

const DB_NAME = 'crispdeck-engagement';
const DB_VERSION = 1;
const STORE = 'snapshots';

export interface EngagementSnapshot {
  uri: string;
  platform: string;
  likes: number;
  reposts: number;
  replies: number;
  timestamp: string;
}

let _engagementDb: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_engagementDb) return Promise.resolve(_engagementDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      _engagementDb = req.result;
      _engagementDb.onclose = () => { _engagementDb = null; };
      resolve(_engagementDb);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('uri', 'uri', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Record an engagement snapshot for a post.
 */
export async function recordSnapshot(post: {
  uri: string;
  platform: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}): Promise<void> {
  const db = await openDB();
  const snapshot: EngagementSnapshot = {
    uri: post.uri,
    platform: post.platform,
    likes: post.likeCount ?? 0,
    reposts: post.repostCount ?? 0,
    replies: post.replyCount ?? 0,
    timestamp: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readwrite');
    txn.objectStore(STORE).add(snapshot);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}

/**
 * Record snapshots for multiple posts (batch).
 */
export async function recordSnapshots(posts: Array<{
  uri: string;
  platform: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}>): Promise<number> {
  const db = await openDB();
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readwrite');
    const store = txn.objectStore(STORE);
    let count = 0;
    for (const post of posts) {
      store.add({
        uri: post.uri,
        platform: post.platform,
        likes: post.likeCount ?? 0,
        reposts: post.repostCount ?? 0,
        replies: post.replyCount ?? 0,
        timestamp: now,
      });
      count++;
    }
    txn.oncomplete = () => resolve(count);
    txn.onerror = () => reject(txn.error);
  });
}

/**
 * Get engagement history for a specific post.
 */
export async function getPostHistory(uri: string): Promise<EngagementSnapshot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readonly');
    const index = txn.objectStore(STORE).index('uri');
    const req = index.getAll(uri);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get the latest snapshot for each post URI.
 */
export async function getLatestSnapshots(limit = 100): Promise<EngagementSnapshot[]> {
  const db = await openDB();
  const all = await new Promise<EngagementSnapshot[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Group by URI, keep latest per URI
  const byUri = new Map<string, EngagementSnapshot>();
  for (const s of all) {
    const existing = byUri.get(s.uri);
    if (!existing || s.timestamp > existing.timestamp) {
      byUri.set(s.uri, s);
    }
  }

  return [...byUri.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/**
 * Clean up old snapshots (keep last N per post, default 50).
 */
export async function cleanupSnapshots(maxPerPost = 50): Promise<number> {
  const db = await openDB();
  const all = await new Promise<(EngagementSnapshot & { id: number })[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Group by URI
  const byUri = new Map<string, (EngagementSnapshot & { id: number })[]>();
  for (const s of all) {
    const list = byUri.get(s.uri) ?? [];
    list.push(s);
    byUri.set(s.uri, list);
  }

  // Find IDs to delete (keep only latest maxPerPost per URI)
  const toDelete: number[] = [];
  for (const [, snapshots] of byUri) {
    if (snapshots.length > maxPerPost) {
      snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      for (let i = maxPerPost; i < snapshots.length; i++) {
        toDelete.push(snapshots[i].id);
      }
    }
  }

  if (toDelete.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readwrite');
    const store = txn.objectStore(STORE);
    for (const id of toDelete) store.delete(id);
    txn.oncomplete = () => resolve(toDelete.length);
    txn.onerror = () => reject(txn.error);
  });
}
