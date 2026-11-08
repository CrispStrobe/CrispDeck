import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ enabled: true, sync: vi.fn(), availability: undefined as unknown }));
vi.mock('./search-cache-state', () => ({ isSearchCacheEnabled: () => mocks.enabled }));
vi.mock('./search-cache-ingest', () => ({ syncWallabagSearchCache: mocks.sync }));
vi.mock('./wallabag-availability', () => ({ wallabagAvailability: mocks.availability }));

beforeEach(() => {
  vi.useFakeTimers(); mocks.enabled = true; mocks.sync.mockReset().mockResolvedValue({});
  mocks.availability = writable({ status: 'ready', server: 'https://wallabag.example', revision: 1 });
});
afterEach(() => { vi.useRealTimers(); });

describe('automatic Wallabag index updates', () => {
  it('runs incremental sync after startup and stops cleanly', async () => {
    const { startWallabagIndexUpdates } = await import('./wallabag-index-auto');
    const stop = startWallabagIndexUpdates();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ incremental: true, signal: expect.any(AbortSignal) }));
    stop(); mocks.sync.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('does no work when the feature is disabled', async () => {
    mocks.enabled = false;
    const { startWallabagIndexUpdates } = await import('./wallabag-index-auto');
    const stop = startWallabagIndexUpdates();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sync).not.toHaveBeenCalled(); stop();
  });
});
