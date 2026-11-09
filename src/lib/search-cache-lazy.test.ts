import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedPost } from './types';
import type { SearchCacheInput } from './search-cache';

const calls = vi.hoisted(() => ({
  engineLoaded: vi.fn(), ingestionLoaded: vi.fn(),
  queue: vi.fn(), cache: vi.fn(), remove: vi.fn(),
}));
vi.mock('./search-cache', () => {
  calls.engineLoaded();
  return { cacheSearchItems: calls.cache, removeSearchCacheScope: calls.remove };
});
vi.mock('./search-cache-ingest', () => {
  calls.ingestionLoaded();
  return { queuePostsForSearchCache: calls.queue };
});

const post: UnifiedPost = {
  uri: 'https://social.example/posts/1', text: 'A useful post',
  platform: 'mastodon', author: { handle: '@reader@social.example' },
  createdAt: '2026-11-08T12:00:00Z', isRepost: false, sourceAccountId: 1,
};
const input: SearchCacheInput = {
  source: 'rss', scope: 'rss:one', id: '1', url: 'https://example.org/1',
  text: 'A useful article', createdAt: post.createdAt,
};
function enable(posts = true) {
  localStorage.setItem('crispdeck-search-cache-settings', JSON.stringify({ enabled: true, posts: { enabled: posts } }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  calls.cache.mockResolvedValue(1);
  calls.remove.mockResolvedValue(undefined);
});

describe('optional cache loading boundary', () => {
  it('does not import the engine or ingestion when the feature is off', async () => {
    const lazy = await import('./search-cache-lazy');
    lazy.queuePostsForSearchCache([post]);
    expect(await lazy.cacheSearchItems([input])).toBe(0);
    await vi.dynamicImportSettled();
    expect(calls.engineLoaded).not.toHaveBeenCalled();
    expect(calls.ingestionLoaded).not.toHaveBeenCalled();
    expect(calls.queue).not.toHaveBeenCalled();
    expect(calls.cache).not.toHaveBeenCalled();
  });

  it('skips post ingestion when only the Wallabag source is enabled', async () => {
    enable(false);
    const lazy = await import('./search-cache-lazy');
    lazy.queuePostsForSearchCache([post]);
    await vi.dynamicImportSettled();
    expect(calls.queue).not.toHaveBeenCalled();
  });

  it('loads ingestion after opt-in and forwards the fetch generation', async () => {
    enable();
    localStorage.setItem('crispdeck-search-cache-generation', '7');
    const lazy = await import('./search-cache-lazy');
    lazy.queuePostsForSearchCache([post], lazy.getSearchCacheGeneration());
    await vi.dynamicImportSettled();
    expect(calls.queue).toHaveBeenCalledWith([post], 7);
  });

  it('does not revive a queued post if settings change during the import', async () => {
    enable();
    const lazy = await import('./search-cache-lazy');
    const state = await import('./search-cache-state');
    lazy.queuePostsForSearchCache([post]);
    state.invalidateSearchCacheGeneration();
    await vi.dynamicImportSettled();
    expect(calls.queue).not.toHaveBeenCalled();
  });

  it('does not write RSS data if the feature is disabled during the import', async () => {
    enable();
    const lazy = await import('./search-cache-lazy');
    const pending = lazy.cacheSearchItems([input]);
    localStorage.removeItem('crispdeck-search-cache-settings');
    expect(await pending).toBe(0);
    expect(calls.cache).not.toHaveBeenCalled();
  });

  it('forwards opted-in RSS writes with their original generation', async () => {
    enable();
    const lazy = await import('./search-cache-lazy');
    const generation = lazy.getSearchCacheGeneration();
    expect(await lazy.cacheSearchItems([input], { generation })).toBe(1);
    expect(calls.cache).toHaveBeenCalledWith([input], { generation });
  });

  it('still waits for durable source cleanup even while collection is off', async () => {
    const lazy = await import('./search-cache-lazy');
    calls.remove.mockRejectedValueOnce(new Error('revocation storage failed'));
    await expect(lazy.removeSearchCacheScope('rss:one')).rejects.toThrow('revocation storage failed');
    expect(calls.remove).toHaveBeenCalledWith('rss:one');
  });
});
