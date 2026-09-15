import { describe, it, expect, vi } from 'vitest';
import { listPinnedFeeds, FOLLOWING } from './bluesky-feeds';

const FEED_A = 'at://did:plc:aaa/app.bsky.feed.generator/whats-hot';
const FEED_B = 'at://did:plc:bbb/app.bsky.feed.generator/with-friends';
const LIST_A = 'at://did:plc:ccc/app.bsky.graph.list/3kabc';

function makeAgent(opts: {
  savedFeeds?: any[];
  generators?: any[];
  generatorsThrows?: boolean;
  list?: any;
  listThrows?: boolean;
}) {
  return {
    getPreferences: vi.fn().mockResolvedValue({ savedFeeds: opts.savedFeeds ?? [] }),
    api: {
      app: {
        bsky: {
          feed: {
            getFeedGenerators: opts.generatorsThrows
              ? vi.fn().mockRejectedValue(new Error('offline'))
              : vi.fn().mockResolvedValue({ data: { feeds: opts.generators ?? [] } }),
          },
          graph: {
            getList: opts.listThrows
              ? vi.fn().mockRejectedValue(new Error('deleted'))
              : vi.fn().mockResolvedValue({ data: { list: opts.list } }),
          },
        },
      },
    },
  } as any;
}

describe('listPinnedFeeds', () => {
  it('always offers Following, even for an account with no saved feeds', async () => {
    const feeds = await listPinnedFeeds(makeAgent({ savedFeeds: [] }));
    expect(feeds).toEqual([FOLLOWING]);
  });

  it('keeps the order the account pinned them in', async () => {
    const agent = makeAgent({
      savedFeeds: [
        { type: 'feed', value: FEED_A, pinned: true },
        { type: 'timeline', value: 'following', pinned: true },
        { type: 'list', value: LIST_A, pinned: true },
      ],
      generators: [{ uri: FEED_A, displayName: "What's Hot", creator: { handle: 'bsky.app' } }],
      list: { name: 'Cycling' },
    });
    const feeds = await listPinnedFeeds(agent);
    expect(feeds.map((f) => f.title)).toEqual(["What's Hot", 'Following', 'Cycling']);
  });

  it('resolves generator display names and creators in one batched call', async () => {
    const agent = makeAgent({
      savedFeeds: [
        { type: 'feed', value: FEED_A, pinned: true },
        { type: 'feed', value: FEED_B, pinned: true },
      ],
      generators: [
        { uri: FEED_A, displayName: 'Discover', creator: { handle: 'bsky.app' } },
        { uri: FEED_B, displayName: 'Popular With Friends', creator: { handle: 'bsky.app' } },
      ],
    });
    const feeds = await listPinnedFeeds(agent);
    expect(agent.api.app.bsky.feed.getFeedGenerators).toHaveBeenCalledTimes(1);
    expect(agent.api.app.bsky.feed.getFeedGenerators).toHaveBeenCalledWith({
      feeds: [FEED_A, FEED_B],
    });
    expect(feeds.find((f) => f.uri === FEED_B)).toMatchObject({
      title: 'Popular With Friends',
      byHandle: 'bsky.app',
      kind: 'feed',
    });
  });

  it('drops feeds the account saved but unpinned', async () => {
    const feeds = await listPinnedFeeds(
      makeAgent({
        savedFeeds: [
          { type: 'timeline', value: 'following', pinned: true },
          { type: 'feed', value: FEED_A, pinned: false },
        ],
      }),
    );
    expect(feeds).toEqual([FOLLOWING]);
  });

  it('survives a dead feed generator with a readable fallback name', async () => {
    // A pinned generator whose service is down must not blank the switcher.
    const feeds = await listPinnedFeeds(
      makeAgent({ savedFeeds: [{ type: 'feed', value: FEED_B, pinned: true }], generatorsThrows: true }),
    );
    expect(feeds.map((f) => f.title)).toEqual(['Following', 'With Friends']);
  });

  it('survives a deleted list the same way', async () => {
    const feeds = await listPinnedFeeds(
      makeAgent({ savedFeeds: [{ type: 'list', value: LIST_A, pinned: true }], listThrows: true }),
    );
    expect(feeds.map((f) => f.title)).toEqual(['Following', 'List']);
  });

  it('ignores saved entries with no value', async () => {
    const feeds = await listPinnedFeeds(
      makeAgent({ savedFeeds: [{ type: 'feed', pinned: true }, { type: 'timeline', value: 'following' }] }),
    );
    expect(feeds).toEqual([FOLLOWING]);
  });

  it('gives every choice a distinct key so the UI can track selection', async () => {
    const feeds = await listPinnedFeeds(
      makeAgent({
        savedFeeds: [
          { type: 'timeline', value: 'following', pinned: true },
          { type: 'feed', value: FEED_A, pinned: true },
          { type: 'list', value: LIST_A, pinned: true },
        ],
        generators: [{ uri: FEED_A, displayName: 'Discover' }],
        list: { name: 'Cycling' },
      }),
    );
    expect(new Set(feeds.map((f) => f.key)).size).toBe(3);
  });
});
