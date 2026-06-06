/**
 * Local cross-platform bookmarks stored in IndexedDB.
 * Works independently of platform-specific bookmarks.
 */

import type { UnifiedPost, Platform } from './types';

const DB_NAME = 'crispdeck-bookmarks';
const DB_VERSION = 1;
const STORE = 'bookmarks';

interface BookmarkedPost {
  uri: string;
  platform: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatar?: string;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  bookmarkedAt: string;
  raw: unknown;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'uri' });
      }
    };
  });
}

export async function addBookmark(post: UnifiedPost): Promise<void> {
  const db = await openDB();
  const record: BookmarkedPost = {
    uri: post.uri,
    platform: post.platform,
    text: post.text,
    authorHandle: post.author.handle,
    authorName: post.author.displayName ?? post.author.handle,
    authorAvatar: post.author.avatar,
    createdAt: post.createdAt,
    likeCount: post.likeCount ?? 0,
    repostCount: post.repostCount ?? 0,
    bookmarkedAt: new Date().toISOString(),
    raw: post.raw,
  };
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readwrite');
    txn.objectStore(STORE).put(record);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}

export async function removeBookmark(uri: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE, 'readwrite');
    txn.objectStore(STORE).delete(uri);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}

export async function isBookmarked(uri: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(uri);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listBookmarks(): Promise<UnifiedPost[]> {
  const db = await openDB();
  const all = await new Promise<BookmarkedPost[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return all
    .sort((a, b) => b.bookmarkedAt.localeCompare(a.bookmarkedAt))
    .map(b => ({
      uri: b.uri,
      text: b.text,
      author: { handle: b.authorHandle, displayName: b.authorName, avatar: b.authorAvatar },
      createdAt: b.createdAt,
      platform: b.platform as Platform,
      likeCount: b.likeCount,
      repostCount: b.repostCount,
      isRepost: false,
      raw: b.raw,
    }));
}

export async function getBookmarkCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Import bookmarks from platform APIs into local IndexedDB.
 * Skips posts that are already bookmarked locally (by URI).
 * Returns the number of newly imported bookmarks.
 */
export async function importPlatformBookmarks(posts: UnifiedPost[]): Promise<number> {
  let imported = 0;
  for (const post of posts) {
    const already = await isBookmarked(post.uri);
    if (!already) {
      await addBookmark(post);
      imported++;
    }
  }
  return imported;
}
