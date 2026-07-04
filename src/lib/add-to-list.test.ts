import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listReadingLists, createReadingList, saveReadingList, addPostToList, getReadingList } from './reading-lists';

describe('quick add-to-list from post menu', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  describe('list picker', () => {
    it('loads available reading lists', () => {
      const list = createReadingList('AI Articles', 'Best AI content');
      saveReadingList(list);
      const lists = listReadingLists();
      expect(lists).toHaveLength(1);
      expect(lists[0].name).toBe('AI Articles');
    });

    it('returns empty when no lists exist', () => {
      expect(listReadingLists()).toEqual([]);
    });
  });

  describe('addPostToList', () => {
    it('adds post to specified list', () => {
      const list = createReadingList('Tech');
      saveReadingList(list);
      addPostToList(list.id, {
        uri: 'at://did:plc:abc/post/1',
        text: 'Great post about Svelte',
        platform: 'bluesky',
        author: { handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://...' },
      });
      const updated = getReadingList(list.id)!;
      expect(updated.posts).toHaveLength(1);
      expect(updated.posts[0].uri).toBe('at://did:plc:abc/post/1');
      expect(updated.posts[0].authorHandle).toBe('alice.bsky.social');
    });

    it('does not duplicate posts', () => {
      const list = createReadingList('Tech');
      saveReadingList(list);
      const post = {
        uri: 'at://did:plc:abc/post/1',
        text: 'Hello',
        platform: 'bluesky',
        author: { handle: 'alice.bsky.social' },
      };
      addPostToList(list.id, post);
      addPostToList(list.id, post);
      expect(getReadingList(list.id)!.posts).toHaveLength(1);
    });

    it('does nothing for nonexistent list', () => {
      addPostToList('nonexistent', {
        uri: 'at://...',
        text: 'hello',
        platform: 'bluesky',
        author: { handle: 'test' },
      });
      // No error thrown, no crash
      expect(listReadingLists()).toEqual([]);
    });

    it('truncates post text to 300 chars', () => {
      const list = createReadingList('Long');
      saveReadingList(list);
      const longText = 'a'.repeat(500);
      addPostToList(list.id, {
        uri: 'at://long',
        text: longText,
        platform: 'bluesky',
        author: { handle: 'test' },
      });
      expect(getReadingList(list.id)!.posts[0].text).toHaveLength(300);
    });

    it('uses displayName when available, falls back to handle', () => {
      const list = createReadingList('Test');
      saveReadingList(list);
      addPostToList(list.id, {
        uri: 'at://1',
        text: 'hello',
        platform: 'bluesky',
        author: { handle: 'alice.bsky.social', displayName: 'Alice' },
      });
      addPostToList(list.id, {
        uri: 'at://2',
        text: 'world',
        platform: 'mastodon',
        author: { handle: '@bob@mastodon.social' },
      });
      const posts = getReadingList(list.id)!.posts;
      expect(posts[0].authorName).toBe('Alice');
      expect(posts[1].authorName).toBe('@bob@mastodon.social');
    });
  });

  describe('multiple lists', () => {
    it('can add same post to different lists', () => {
      const list1 = createReadingList('List A');
      const list2 = createReadingList('List B');
      saveReadingList(list1);
      saveReadingList(list2);
      const post = {
        uri: 'at://post/1',
        text: 'Great post',
        platform: 'bluesky' as const,
        author: { handle: 'test' },
      };
      addPostToList(list1.id, post);
      addPostToList(list2.id, post);
      expect(getReadingList(list1.id)!.posts).toHaveLength(1);
      expect(getReadingList(list2.id)!.posts).toHaveLength(1);
    });
  });
});
