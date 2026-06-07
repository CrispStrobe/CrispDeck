import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listReadingLists, createReadingList, saveReadingList,
  deleteReadingList, getReadingList, addPostToList,
  removePostFromList, getListsForPost,
} from './reading-lists';

describe('reading lists', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('starts empty', () => {
    expect(listReadingLists()).toEqual([]);
  });

  it('creates and saves a list', () => {
    const list = createReadingList('AI Articles', 'Machine learning posts');
    saveReadingList(list);
    const lists = listReadingLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe('AI Articles');
    expect(lists[0].description).toBe('Machine learning posts');
  });

  it('creates unique IDs', () => {
    const a = createReadingList('A');
    const b = createReadingList('B');
    expect(a.id).not.toBe(b.id);
  });

  it('updates an existing list', () => {
    const list = createReadingList('Test');
    saveReadingList(list);
    list.name = 'Updated';
    saveReadingList(list);
    expect(listReadingLists()).toHaveLength(1);
    expect(listReadingLists()[0].name).toBe('Updated');
  });

  it('deletes a list', () => {
    const list = createReadingList('Delete Me');
    saveReadingList(list);
    deleteReadingList(list.id);
    expect(listReadingLists()).toHaveLength(0);
  });

  it('gets a list by ID', () => {
    const list = createReadingList('Find Me');
    saveReadingList(list);
    expect(getReadingList(list.id)?.name).toBe('Find Me');
    expect(getReadingList('nonexistent')).toBeNull();
  });

  it('adds a post to a list', () => {
    const list = createReadingList('Test');
    saveReadingList(list);
    addPostToList(list.id, {
      uri: 'at://post-1', text: 'Hello world', platform: 'bluesky',
      author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    });
    const updated = getReadingList(list.id);
    expect(updated?.posts).toHaveLength(1);
    expect(updated?.posts[0].authorHandle).toBe('alice.bsky.social');
  });

  it('prevents duplicate posts in a list', () => {
    const list = createReadingList('Test');
    saveReadingList(list);
    const post = { uri: 'at://post-1', text: 'Hello', platform: 'bluesky', author: { handle: 'alice' } };
    addPostToList(list.id, post);
    addPostToList(list.id, post);
    expect(getReadingList(list.id)?.posts).toHaveLength(1);
  });

  it('removes a post from a list', () => {
    const list = createReadingList('Test');
    saveReadingList(list);
    addPostToList(list.id, { uri: 'at://post-1', text: 'A', platform: 'bluesky', author: { handle: 'a' } });
    addPostToList(list.id, { uri: 'at://post-2', text: 'B', platform: 'mastodon', author: { handle: 'b' } });
    removePostFromList(list.id, 'at://post-1');
    expect(getReadingList(list.id)?.posts).toHaveLength(1);
    expect(getReadingList(list.id)?.posts[0].uri).toBe('at://post-2');
  });

  it('finds which lists contain a post', () => {
    const l1 = createReadingList('List 1');
    const l2 = createReadingList('List 2');
    saveReadingList(l1);
    saveReadingList(l2);
    addPostToList(l1.id, { uri: 'at://post-1', text: 'A', platform: 'bluesky', author: { handle: 'a' } });
    addPostToList(l2.id, { uri: 'at://post-1', text: 'A', platform: 'bluesky', author: { handle: 'a' } });
    const containing = getListsForPost('at://post-1');
    expect(containing).toHaveLength(2);
  });
});
