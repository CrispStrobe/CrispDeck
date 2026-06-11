import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchBluesky, searchMastodon, searchThreads, mergeSearchResults,
} from './universal-search';
import type { UnifiedPost, Platform } from '$lib/types';

beforeEach(() => {
  vi.restoreAllMocks();
});

function makePost(overrides: Partial<UnifiedPost>): UnifiedPost {
  return {
    uri: `at://post-${Math.random().toString(36).slice(2)}`,
    text: 'test post',
    author: { handle: 'user.bsky.social', displayName: 'User' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    likeCount: 0,
    repostCount: 0,
    ...overrides,
  };
}

describe('searchBluesky', () => {
  it('returns empty array when no agent provided', async () => {
    const results = await searchBluesky('test', null);
    expect(results).toEqual([]);
  });

  it('calls agent.app.bsky.feed.searchPosts', async () => {
    const mockAgent = {
      app: {
        bsky: {
          feed: {
            searchPosts: vi.fn().mockResolvedValue({
              data: { posts: [{ uri: 'at://did/post/1', text: 'test' }] },
            }),
          },
        },
      },
    };
    const results = await searchBluesky('test', mockAgent);
    expect(results).toHaveLength(1);
    expect(mockAgent.app.bsky.feed.searchPosts).toHaveBeenCalledWith({ q: 'test', limit: 25 });
  });

  it('returns empty array on API error', async () => {
    const mockAgent = {
      app: { bsky: { feed: { searchPosts: vi.fn().mockRejectedValue(new Error('fail')) } } },
    };
    const results = await searchBluesky('test', mockAgent);
    expect(results).toEqual([]);
  });

  it('respects custom limit', async () => {
    const mockAgent = {
      app: { bsky: { feed: { searchPosts: vi.fn().mockResolvedValue({ data: { posts: [] } }) } } },
    };
    await searchBluesky('test', mockAgent, 10);
    expect(mockAgent.app.bsky.feed.searchPosts).toHaveBeenCalledWith({ q: 'test', limit: 10 });
  });
});

describe('searchMastodon', () => {
  it('returns empty array when no instance URL', async () => {
    expect(await searchMastodon('test', '', 'token')).toEqual([]);
  });

  it('returns empty array when no access token', async () => {
    expect(await searchMastodon('test', 'https://mastodon.social', '')).toEqual([]);
  });

  it('calls correct API endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ statuses: [{ id: '1', content: 'test' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const results = await searchMastodon('test query', 'https://mastodon.social', 'token123');
    expect(results).toHaveLength(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('https://mastodon.social/api/v2/search');
    expect(url).toContain('q=test%20query');
    expect(url).toContain('type=statuses');
    expect(opts.headers.Authorization).toBe('Bearer token123');

    vi.unstubAllGlobals();
  });

  it('returns empty array on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await searchMastodon('test', 'https://m.social', 'tok')).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('searchThreads', () => {
  it('returns empty array when no access token', async () => {
    expect(await searchThreads('test', '')).toEqual([]);
  });

  it('calls Threads search API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 't1', text: 'test' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const results = await searchThreads('test', 'threads-token');
    expect(results).toHaveLength(1);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('graph.threads.net/v1.0/keyword_search');
    expect(url).toContain('q=test');

    vi.unstubAllGlobals();
  });
});

describe('mergeSearchResults', () => {
  it('merges results from multiple platforms', () => {
    const bskyPosts = [makePost({ platform: 'bluesky', uri: 'at://1' })];
    const mastoPosts = [makePost({ platform: 'mastodon', uri: 'https://m.social/1' })];

    const results = new Map<Platform, UnifiedPost[]>([
      ['bluesky', bskyPosts],
      ['mastodon', mastoPosts],
    ]);

    const merged = mergeSearchResults(results);
    expect(merged.posts).toHaveLength(2);
    expect(merged.totalByPlatform.bluesky).toBe(1);
    expect(merged.totalByPlatform.mastodon).toBe(1);
  });

  it('deduplicates by URI', () => {
    const post = makePost({ uri: 'at://dup' });
    const results = new Map<Platform, UnifiedPost[]>([
      ['bluesky', [post, post]],
    ]);

    const merged = mergeSearchResults(results);
    expect(merged.posts).toHaveLength(1);
  });

  it('sorts by engagement/recency score', () => {
    const popular = makePost({ uri: 'at://pop', likeCount: 100, repostCount: 50 });
    const recent = makePost({ uri: 'at://rec', likeCount: 1, repostCount: 0 });

    const results = new Map<Platform, UnifiedPost[]>([
      ['bluesky', [recent, popular]],
    ]);

    const merged = mergeSearchResults(results);
    expect(merged.posts[0].uri).toBe('at://pop');
  });

  it('handles empty results', () => {
    const results = new Map<Platform, UnifiedPost[]>();
    const merged = mergeSearchResults(results);
    expect(merged.posts).toHaveLength(0);
    expect(merged.totalByPlatform.bluesky).toBe(0);
  });

  it('includes searchedAt timestamp', () => {
    const results = new Map<Platform, UnifiedPost[]>();
    const merged = mergeSearchResults(results);
    expect(merged.searchedAt).toBeTruthy();
    expect(new Date(merged.searchedAt).getTime()).toBeGreaterThan(0);
  });
});
