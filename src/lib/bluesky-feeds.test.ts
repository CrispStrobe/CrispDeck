import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listPinnedFeeds,
  listSavedFeeds,
  searchFeedGenerators,
  pinFeed,
  unpinFeed,
  FOLLOWING,
} from './bluesky-feeds';

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
    addSavedFeeds: vi.fn().mockResolvedValue([]),
    removeSavedFeeds: vi.fn().mockResolvedValue([]),

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
    expect(feeds.map((f) => f.kind)).toEqual(['timeline']);
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
    expect(feeds.map((f) => f.kind)).toEqual(['timeline']);
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

describe('listSavedFeeds', () => {
  it('keeps feeds the account saved but unpinned, flagged as such', async () => {
    // listPinnedFeeds drops these; the picker needs them, because bsky.app
    // keeps saved-but-unpinned feeds one list away rather than discarding them.
    const feeds = await listSavedFeeds(
      makeAgent({
        savedFeeds: [
          { id: 's1', type: 'timeline', value: 'following', pinned: true },
          { id: 's2', type: 'feed', value: FEED_A, pinned: true },
          { id: 's3', type: 'feed', value: FEED_B, pinned: false },
        ],
        generators: [
          { uri: FEED_A, displayName: 'Discover' },
          { uri: FEED_B, displayName: 'Quiet Posters' },
        ],
      }),
    );
    expect(feeds.map((f) => [f.title, f.pinned])).toEqual([
      ['Following', true],
      ['Discover', true],
      ['Quiet Posters', false],
    ]);
  });

  it('carries the saved-feed id, which is what unpinning needs', async () => {
    const feeds = await listSavedFeeds(
      makeAgent({
        savedFeeds: [{ id: 'abc123', type: 'feed', value: FEED_A, pinned: true }],
        generators: [{ uri: FEED_A, displayName: 'Discover' }],
      }),
    );
    expect(feeds.find((f) => f.uri === FEED_A)?.savedId).toBe('abc123');
  });

  it('still offers Following when the account has unpinned it', async () => {
    const feeds = await listSavedFeeds(
      makeAgent({ savedFeeds: [{ id: 's1', type: 'feed', value: FEED_A, pinned: false }] }),
    );
    expect(feeds[0].kind).toBe('timeline');
  });
});

describe('pinning', () => {
  it('adds through addSavedFeeds, never by writing preferences wholesale', async () => {
    // The preferences document is one array covering muted words, labelers and
    // adult-content settings. Writing it from here would discard everything
    // this app does not model.
    const agent = makeAgent({});
    await pinFeed(agent, { key: FEED_A, kind: 'feed', uri: FEED_A, title: 'Discover' });
    expect(agent.addSavedFeeds).toHaveBeenCalledWith([
      { type: 'feed', value: FEED_A, pinned: true },
    ]);
  });

  it('pins a list with the list type, not the feed type', async () => {
    const agent = makeAgent({});
    await pinFeed(agent, { key: LIST_A, kind: 'list', uri: LIST_A, title: 'Cycling' });
    expect(agent.addSavedFeeds).toHaveBeenCalledWith([
      { type: 'list', value: LIST_A, pinned: true },
    ]);
  });

  it('does nothing for a choice with no URI, such as Following', async () => {
    const agent = makeAgent({});
    await pinFeed(agent, FOLLOWING);
    expect(agent.addSavedFeeds).not.toHaveBeenCalled();
  });

  it('unpins by saved-feed id', async () => {
    const agent = makeAgent({});
    await unpinFeed(agent, 'abc123');
    expect(agent.removeSavedFeeds).toHaveBeenCalledWith(['abc123']);
  });
});

describe('searchFeedGenerators', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns nothing for a blank query without calling the network', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as any;
    expect(await searchFeedGenerators('   ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps results and marks them as not saved', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feeds: [{
          uri: FEED_A,
          displayName: 'Science',
          description: 'Posts about science',
          likeCount: 4200,
          creator: { handle: 'someone.bsky.social' },
        }],
      }),
    }) as any;

    const [hit] = await searchFeedGenerators('science');
    expect(hit).toMatchObject({
      uri: FEED_A,
      title: 'Science',
      byHandle: 'someone.bsky.social',
      likeCount: 4200,
      saved: false,
      pinned: false,
    });
  });

  it('queries the public AppView, so discovery works without a session', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ feeds: [] }) });
    globalThis.fetch = spy as any;
    await searchFeedGenerators('cats');
    expect(spy.mock.calls[0][0]).toContain('public.api.bsky.app');
    expect(spy.mock.calls[0][0]).toContain('query=cats');
  });

  it('throws on a failed search rather than returning an empty list', async () => {
    // Silence is indistinguishable from "no matches", which would leave the
    // picker looking broken with no way to tell.
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    await expect(searchFeedGenerators('cats')).rejects.toThrow('503');
  });
});
