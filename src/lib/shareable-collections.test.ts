import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createReadingList, saveReadingList, listReadingLists, getReadingList,
  exportCollection, exportCollectionAsText, exportCollectionAsUrl,
  importCollection, importCollectionFromUrl,
  type ReadingList, type ShareableCollection,
} from './reading-lists';

describe('shareable collections', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  function createTestList(): ReadingList {
    const list = createReadingList('AI Articles', 'Curated AI posts');
    list.posts = [
      { uri: 'at://did:plc:abc/post/1', text: 'AI is transforming everything', authorHandle: 'alice.bsky.social', authorName: 'Alice', platform: 'bluesky', addedAt: '2026-01-01T00:00:00Z' },
      { uri: 'https://mastodon.social/@bob/123', text: 'Machine learning guide', authorHandle: '@bob@mastodon.social', authorName: 'Bob', platform: 'mastodon', addedAt: '2026-01-02T00:00:00Z' },
    ];
    saveReadingList(list);
    return list;
  }

  describe('exportCollection', () => {
    it('exports a reading list as a ShareableCollection', () => {
      const list = createTestList();
      const collection = exportCollection(list.id);
      expect(collection).not.toBeNull();
      expect(collection!.name).toBe('AI Articles');
      expect(collection!.description).toBe('Curated AI posts');
      expect(collection!.posts).toHaveLength(2);
      expect(collection!.version).toBe(1);
      expect(collection!.exportedAt).toBeTruthy();
    });

    it('returns null for nonexistent list', () => {
      expect(exportCollection('nonexistent')).toBeNull();
    });

    it('includes all post data', () => {
      const list = createTestList();
      const collection = exportCollection(list.id)!;
      const post = collection.posts[0];
      expect(post.uri).toBe('at://did:plc:abc/post/1');
      expect(post.text).toBe('AI is transforming everything');
      expect(post.authorHandle).toBe('alice.bsky.social');
      expect(post.platform).toBe('bluesky');
    });
  });

  describe('exportCollectionAsText', () => {
    it('exports as formatted JSON string', () => {
      const list = createTestList();
      const text = exportCollectionAsText(list.id);
      expect(text).not.toBeNull();
      const parsed = JSON.parse(text!);
      expect(parsed.name).toBe('AI Articles');
      expect(parsed.posts).toHaveLength(2);
    });

    it('returns null for nonexistent list', () => {
      expect(exportCollectionAsText('nope')).toBeNull();
    });
  });

  describe('exportCollectionAsUrl', () => {
    it('exports as a data URL', () => {
      const list = createTestList();
      const url = exportCollectionAsUrl(list.id);
      expect(url).not.toBeNull();
      expect(url!.startsWith('data:application/json;base64,')).toBe(true);
    });

    it('returns null for nonexistent list', () => {
      expect(exportCollectionAsUrl('nope')).toBeNull();
    });
  });

  describe('importCollection', () => {
    it('imports from JSON text and creates a new reading list', () => {
      const json = JSON.stringify({
        name: 'Imported List',
        description: 'From a friend',
        posts: [
          { uri: 'at://did:plc:xyz/post/5', text: 'Great post', authorHandle: 'carol.bsky.social', authorName: 'Carol', platform: 'bluesky', addedAt: '2026-03-01' },
        ],
        exportedAt: '2026-03-01',
        version: 1,
      });
      const list = importCollection(json);
      expect(list).not.toBeNull();
      expect(list!.name).toBe('Imported List');
      expect(list!.posts).toHaveLength(1);
      // Verify it was saved
      const saved = listReadingLists();
      expect(saved.some(l => l.name === 'Imported List')).toBe(true);
    });

    it('returns null for invalid JSON', () => {
      expect(importCollection('not json')).toBeNull();
    });

    it('returns null for missing name', () => {
      expect(importCollection(JSON.stringify({ posts: [] }))).toBeNull();
    });

    it('returns null for missing posts array', () => {
      expect(importCollection(JSON.stringify({ name: 'Test' }))).toBeNull();
    });

    it('filters out posts with missing required fields', () => {
      const json = JSON.stringify({
        name: 'Test',
        posts: [
          { uri: 'at://valid', text: 'Valid', platform: 'bluesky', authorHandle: 'a', authorName: 'A', addedAt: '' },
          { uri: '', text: 'Missing URI', platform: 'bluesky', authorHandle: 'b', authorName: 'B', addedAt: '' },
          { uri: 'at://also-valid', text: 'Also valid', platform: 'mastodon', authorHandle: 'c', authorName: 'C', addedAt: '' },
        ],
        exportedAt: '',
        version: 1,
      });
      const list = importCollection(json)!;
      expect(list.posts).toHaveLength(2);
    });
  });

  describe('importCollectionFromUrl', () => {
    it('round-trips export → import via data URL', () => {
      const original = createTestList();
      const url = exportCollectionAsUrl(original.id)!;

      // Clear store to prove import creates new list
      for (const key of Object.keys(store)) delete store[key];

      const imported = importCollectionFromUrl(url);
      expect(imported).not.toBeNull();
      expect(imported!.name).toBe('AI Articles');
      expect(imported!.posts).toHaveLength(2);
    });

    it('returns null for invalid data URL', () => {
      expect(importCollectionFromUrl('not-a-data-url')).toBeNull();
    });

    it('returns null for corrupted base64', () => {
      expect(importCollectionFromUrl('data:application/json;base64,!!invalid!!')).toBeNull();
    });
  });

  describe('round-trip: export text → import text', () => {
    it('preserves all data through text round-trip', () => {
      const original = createTestList();
      const text = exportCollectionAsText(original.id)!;

      for (const key of Object.keys(store)) delete store[key];

      const imported = importCollection(text)!;
      expect(imported.name).toBe(original.name);
      expect(imported.description).toBe(original.description);
      expect(imported.posts).toHaveLength(original.posts.length);
      expect(imported.posts[0].uri).toBe(original.posts[0].uri);
      expect(imported.posts[1].text).toBe(original.posts[1].text);
    });
  });
});
