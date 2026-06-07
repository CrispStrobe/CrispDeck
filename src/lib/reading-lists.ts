/**
 * Reading lists — themed post collections beyond flat bookmarks.
 * Users can create named lists and add posts to them.
 * Stored in localStorage.
 */

const STORAGE_KEY = 'crispdeck-reading-lists';

export interface ReadingListPost {
  uri: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatar?: string;
  platform: string;
  addedAt: string;
}

export interface ReadingList {
  id: string;
  name: string;
  description: string;
  posts: ReadingListPost[];
  created_at: string;
  updated_at: string;
}

let counter = 0;

export function createReadingList(name: string, description = ''): ReadingList {
  return {
    id: `rl-${Date.now()}-${counter++}`,
    name,
    description,
    posts: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function listReadingLists(): ReadingList[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function saveAll(lists: ReadingList[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

export function saveReadingList(list: ReadingList): void {
  const lists = listReadingLists();
  const idx = lists.findIndex(l => l.id === list.id);
  list.updated_at = new Date().toISOString();
  if (idx >= 0) lists[idx] = list;
  else lists.push(list);
  saveAll(lists);
}

export function deleteReadingList(id: string): void {
  saveAll(listReadingLists().filter(l => l.id !== id));
}

export function getReadingList(id: string): ReadingList | null {
  return listReadingLists().find(l => l.id === id) ?? null;
}

export function addPostToList(listId: string, post: {
  uri: string; text: string; platform: string;
  author: { handle: string; displayName?: string; avatar?: string };
}): void {
  const lists = listReadingLists();
  const list = lists.find(l => l.id === listId);
  if (!list) return;
  if (list.posts.some(p => p.uri === post.uri)) return; // no dupes
  list.posts.push({
    uri: post.uri,
    text: post.text.substring(0, 300),
    authorHandle: post.author.handle,
    authorName: post.author.displayName ?? post.author.handle,
    authorAvatar: post.author.avatar,
    platform: post.platform,
    addedAt: new Date().toISOString(),
  });
  list.updated_at = new Date().toISOString();
  saveAll(lists);
}

export function removePostFromList(listId: string, postUri: string): void {
  const lists = listReadingLists();
  const list = lists.find(l => l.id === listId);
  if (!list) return;
  list.posts = list.posts.filter(p => p.uri !== postUri);
  list.updated_at = new Date().toISOString();
  saveAll(lists);
}

export function getListsForPost(postUri: string): ReadingList[] {
  return listReadingLists().filter(l => l.posts.some(p => p.uri === postUri));
}
