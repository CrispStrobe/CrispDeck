import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { SearchCacheSettings } from '$lib/search-cache';

const boundaries = vi.hoisted(() => ({ settings: vi.fn(), stats: vi.fn(), update: vi.fn(), clear: vi.fn(), rebuild: vi.fn(), existing: vi.fn(), wallabag: vi.fn() }));
vi.mock('$lib/search-cache', () => ({
  getSearchCacheSettings: boundaries.settings,
  getSearchCacheStats: boundaries.stats,
  updateSearchCacheSettings: boundaries.update,
  clearSearchCache: boundaries.clear,
  rebuildSearchCache: boundaries.rebuild,
}));
vi.mock('$lib/search-cache-ingest', () => ({
  indexExistingSearchCache: boundaries.existing,
  syncWallabagSearchCache: boundaries.wallabag,
}));

import LocalSearchSettings from './LocalSearchSettings.svelte';

let instance: ReturnType<typeof mount> | undefined;
let settings: SearchCacheSettings;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  settings = {
    enabled: false,
    posts: { enabled: true, mode: 'paragraph', maxChars: 1000 },
    wallabag: { enabled: true, mode: 'paragraph', maxChars: 2000 },
    maxAgeDays: 90, maxItems: 10000,
  };
  boundaries.settings.mockImplementation(() => structuredClone(settings));
  boundaries.stats.mockResolvedValue({ count: 0, bytes: 0, available: true, bySource: {} });
  boundaries.update.mockImplementation(async (next: SearchCacheSettings) => {
    settings = JSON.parse(JSON.stringify(next));
    return structuredClone(settings);
  });
  boundaries.clear.mockResolvedValue(undefined);
  boundaries.rebuild.mockResolvedValue(undefined);
  boundaries.existing.mockResolvedValue({ processed: 20, indexed: 12, pages: 1, stoppedEarly: false });
  boundaries.wallabag.mockResolvedValue({ processed: 50, indexed: 50, pages: 1, stoppedEarly: false });
});

afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined; document.body.innerHTML = '';
});

async function render() {
  const target = document.createElement('div'); document.body.append(target);
  instance = mount(LocalSearchSettings, { target }); flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('0 cached items'); });
  return target;
}

function field(target: HTMLElement, selector: string, value: string) {
  const input = target.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  flushSync();
}

function click(target: HTMLElement, name: string) {
  const button = [...target.querySelectorAll('button')].find(item => item.textContent?.trim() === name);
  if (!button) throw new Error(`Button missing: ${name}`);
  button.click(); flushSync();
}

describe('local cache settings UI', () => {
  it('requires opt-in and saves independent excerpt policies, age and capacity limits', async () => {
    const target = await render();
    const enabled = target.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(enabled.checked).toBe(false);
    expect(target.querySelector('#search-cache-posts-mode')?.matches(':disabled')).toBe(true);
    enabled.click(); flushSync();
    field(target, '#search-cache-posts-mode', 'title');
    field(target, '#search-cache-wallabag-mode', 'characters');
    field(target, '#search-cache-wallabag-chars', '7500');
    field(target, '#search-cache-age', '30');
    field(target, '#search-cache-count', '1200');
    expect(boundaries.update).not.toHaveBeenCalled();
    click(target, 'Save cache settings');
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Cache settings saved.'); });
    expect(boundaries.update).toHaveBeenCalledWith({
      enabled: true,
      posts: { enabled: true, mode: 'title', maxChars: 1000 },
      wallabag: { enabled: true, mode: 'characters', maxChars: 7500 },
      maxAgeDays: 30, maxItems: 1200,
    });
  });

  it('preserves unsaved input when saving fails and allows a retry', async () => {
    boundaries.update.mockRejectedValueOnce(new Error('Storage quota exceeded'));
    const target = await render();
    target.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); flushSync();
    field(target, '#search-cache-age', '7');
    click(target, 'Save cache settings');
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('Storage quota exceeded'); });
    expect(target.querySelector<HTMLInputElement>('#search-cache-age')?.value).toBe('7');
    expect(target.textContent).not.toContain('Cache settings saved.');
    click(target, 'Save cache settings');
    await vi.waitFor(() => expect(boundaries.update).toHaveBeenCalledTimes(2));
    expect(settings.maxAgeDays).toBe(7);
  });

  it('keeps clearing and rebuilding explicit and reports completion only after persistence', async () => {
    settings.enabled = true;
    let finish!: () => void;
    boundaries.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const target = await render();
    click(target, 'Clear search cache');
    expect(boundaries.clear).toHaveBeenCalledTimes(1);
    expect(target.textContent).not.toContain('Search cache cleared.');
    finish();
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Search cache cleared.'); });
    click(target, 'Rebuild search index');
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Search index rebuilt from the retained excerpts.'); });
    expect(boundaries.rebuild).toHaveBeenCalledTimes(1);
  });

  it('reports a bounded import honestly and never fetches Wallabag implicitly', async () => {
    settings.enabled = true;
    boundaries.existing.mockResolvedValue({ processed: 200, indexed: 120, pages: 4, stoppedEarly: true });
    const target = await render();
    expect(boundaries.existing).not.toHaveBeenCalled();
    expect(boundaries.wallabag).not.toHaveBeenCalled();
    click(target, 'Index existing cache');
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Indexed 120 items.'); });
    expect(target.textContent).toContain('Reached the import limit.');
    expect(boundaries.wallabag).not.toHaveBeenCalled();
  });

  it('shows sync progress and stops a pending request without reporting success', async () => {
    settings.enabled = true;
    let signal: AbortSignal | undefined;
    boundaries.wallabag.mockImplementation(({ signal: current, onProgress }) => {
      signal = current;
      onProgress({ processed: 50, indexed: 42, pages: 1 });
      return new Promise((_, reject) => current.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
    });
    const target = await render();
    click(target, 'Sync Wallabag');
    expect(target.textContent).toContain('Processed 50 items · indexed 42');
    expect(signal?.aborted).toBe(false);
    click(target, 'Stop');
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('Indexing stopped.'); });
    expect(target.textContent).not.toContain('Indexed 42 items.');
    expect(target.querySelector('[role=alert]')).toBeNull();
  });

  it('cancels an active import when the settings view is left', async () => {
    settings.enabled = true;
    let signal: AbortSignal | undefined;
    boundaries.wallabag.mockImplementation(({ signal: current }) => {
      signal = current;
      return new Promise((_, reject) => current.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
    });
    const target = await render();
    click(target, 'Sync Wallabag');
    await unmount(instance!); instance = undefined;
    expect(signal?.aborted).toBe(true);
  });
});
