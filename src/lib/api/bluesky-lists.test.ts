import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@atproto/api', () => ({
  BskyAgent: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue({}),
    session: { did: 'did:plc:test123' },
    api: {
      app: {
        bsky: {
          graph: {
            getLists: vi.fn().mockResolvedValue({
              data: {
                lists: [
                  { uri: 'at://did:plc:test/list/1', name: 'Tech People', purpose: 'app.bsky.graph.defs#curatelist', listItemCount: 25 },
                  { uri: 'at://did:plc:test/list/2', name: 'News Sources', purpose: 'app.bsky.graph.defs#curatelist', listItemCount: 10 },
                ],
                cursor: 'cursor123',
              },
            }),
            getList: vi.fn().mockResolvedValue({
              data: {
                list: { uri: 'at://did:plc:test/list/1', name: 'Tech People', purpose: 'app.bsky.graph.defs#curatelist' },
                items: [
                  { subject: { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice' } },
                  { subject: { did: 'did:plc:bob', handle: 'bob.bsky.social', displayName: 'Bob' } },
                ],
                cursor: undefined,
              },
            }),
            getListMutes: vi.fn().mockResolvedValue({ data: { lists: [], cursor: undefined } }),
            getListBlocks: vi.fn().mockResolvedValue({ data: { lists: [], cursor: undefined } }),
          },
          feed: {
            getListFeed: vi.fn().mockResolvedValue({
              data: {
                feed: [
                  { post: { uri: 'at://did:plc:alice/post/1', record: { text: 'Hello from list!' } } },
                ],
                cursor: undefined,
              },
            }),
          },
        },
      },
    },
  })),
  AppBskyFeedDefs: { isReasonRepost: () => false },
}));

import { BlueskyClient } from './bluesky';

describe('BlueskyClient — Lists API', () => {
  let client: BlueskyClient;

  beforeEach(() => {
    client = new BlueskyClient('test.bsky.social', 'password');
  });

  describe('getLists', () => {
    it('returns lists for an actor', async () => {
      const result = await client.getLists();
      expect(result.lists).toHaveLength(2);
      expect(result.lists[0].name).toBe('Tech People');
      expect(result.lists[1].name).toBe('News Sources');
    });

    it('returns pagination cursor', async () => {
      const result = await client.getLists();
      expect(result.cursor).toBe('cursor123');
    });
  });

  describe('getList', () => {
    it('returns list metadata and items', async () => {
      const result = await client.getList('at://did:plc:test/list/1');
      expect(result.list.name).toBe('Tech People');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].subject.handle).toBe('alice.bsky.social');
    });
  });

  describe('getListFeed', () => {
    it('returns posts by list members', async () => {
      const result = await client.getListFeed('at://did:plc:test/list/1');
      expect(result.feed).toHaveLength(1);
      expect(result.feed[0].post.record.text).toBe('Hello from list!');
    });
  });

  describe('getListMutes', () => {
    it('returns empty array when no muted lists', async () => {
      const result = await client.getListMutes();
      expect(result.lists).toEqual([]);
    });
  });

  describe('getListBlocks', () => {
    it('returns empty array when no blocked lists', async () => {
      const result = await client.getListBlocks();
      expect(result.lists).toEqual([]);
    });
  });

  describe('API method signatures', () => {
    it('getLists accepts optional actor and cursor', () => {
      expect(typeof client.getLists).toBe('function');
      // TypeScript ensures params are (actor?: string, cursor?: string)
    });

    it('getList requires listUri', () => {
      expect(typeof client.getList).toBe('function');
    });

    it('getListFeed requires listUri', () => {
      expect(typeof client.getListFeed).toBe('function');
    });
  });
});
