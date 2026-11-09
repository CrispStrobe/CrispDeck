import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const api = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('$lib/wallabag', () => ({
  WALLABAG_CONNECTION_CHANGED: 'crispdeck:wallabag-connection-changed',
  normalizeWallabagServer: (value: string) => new URL(value).href.replace(/\/+$/, ''),
  validateWallabagConnection: api.validate,
}));

let availability: typeof import('./wallabag-availability');
let stop: (() => void) | undefined;
const server = 'https://read.example.org';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  api.validate.mockReset().mockResolvedValue(false);
  availability = await import('./wallabag-availability');
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe('Wallabag reader availability', () => {
  it('starts hidden and does not probe when no server is saved', async () => {
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
    expect(await availability.refreshWallabagAvailability()).toBe(false);
    expect(api.validate).not.toHaveBeenCalled();
  });

  it('a saved server alone cannot expose the reader', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    expect(await availability.refreshWallabagAvailability()).toBe(false);
    expect(api.validate).toHaveBeenCalledWith(server);
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it('appears only after the saved session passes an authenticated probe', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    const probe = deferred<boolean>();
    api.validate.mockReturnValue(probe.promise);
    const pending = availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability).status).toBe('checking');
    probe.resolve(true);
    expect(await pending).toBe(true);
    expect(get(availability.wallabagAvailability)).toMatchObject({ status: 'ready', server });
    expect(localStorage.length).toBe(1); // Never persist a "working" flag.
  });

  it('deduplicates concurrent checks for the same saved connection', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    const probe = deferred<boolean>();
    api.validate.mockReturnValue(probe.promise);
    const one = availability.refreshWallabagAvailability();
    const two = availability.refreshWallabagAvailability();
    await vi.waitFor(() => expect(api.validate).toHaveBeenCalledTimes(1));
    probe.resolve(true);
    expect(await Promise.all([one, two])).toEqual([true, true]);
  });

  it('a delayed successful check cannot undo a disconnect', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    const probe = deferred<boolean>();
    api.validate.mockReturnValue(probe.promise);
    const pending = availability.refreshWallabagAvailability();
    availability.hideWallabagReader();
    probe.resolve(true);
    expect(await pending).toBe(false);
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it('does not re-expose the old server after the URL changes', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    const probe = deferred<boolean>();
    api.validate.mockReturnValueOnce(probe.promise).mockResolvedValueOnce(false);
    const pending = availability.refreshWallabagAvailability();
    localStorage.setItem('crispdeck-wallabag-url', 'https://other.example.org');
    await availability.refreshWallabagAvailability();
    probe.resolve(true);
    expect(await pending).toBe(false);
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it('hides the reader when revalidation fails without keeping an error or secrets', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    api.validate.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('private-test-token'));
    await availability.refreshWallabagAvailability();
    expect(await availability.refreshWallabagAvailability()).toBe(false);
    expect(get(availability.wallabagAvailability)).toMatchObject({ status: 'hidden', server: '' });
    expect(JSON.stringify(get(availability.wallabagAvailability))).not.toContain('private-test-token');
  });

  it('keeps a validated article mounted during successful background checks', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    api.validate.mockResolvedValueOnce(true);
    await availability.refreshWallabagAvailability();
    const before = get(availability.wallabagAvailability);
    const probe = deferred<boolean>();
    api.validate.mockReturnValueOnce(probe.promise);
    const pending = availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability)).toEqual(before);
    probe.resolve(true);
    await pending;
    expect(get(availability.wallabagAvailability)).toEqual(before);
  });
});

describe('live credential changes', () => {
  async function ready() {
    localStorage.setItem('crispdeck-wallabag-url', server);
    api.validate.mockResolvedValue(true);
    stop = availability.startWallabagAvailability();
    await availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability).status).toBe('ready');
  }

  it('immediately invalidates on connect, disconnect, or rejected authorization', async () => {
    await ready();
    const calls = api.validate.mock.calls.length;
    window.dispatchEvent(new Event('crispdeck:wallabag-connection-changed'));
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
    expect(api.validate).toHaveBeenCalledTimes(calls); // Do not form an auth retry loop.
  });

  it('checks the newly selected native credential store before showing it', async () => {
    await ready();
    const before = get(availability.wallabagAvailability).revision;
    const probe = deferred<boolean>();
    api.validate.mockReturnValueOnce(probe.promise);
    window.dispatchEvent(new Event('crispdeck:credential-storage-changed'));
    expect(get(availability.wallabagAvailability).status).toBe('checking');
    expect(get(availability.wallabagAvailability).revision).toBeGreaterThan(before);
    probe.resolve(false);
    await availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it.each(['crispdeck-wallabag-session', 'crispdeck-wallabag-url', 'crispdeck-key', 'crispdeck-salt-v2', null])('invalidates changes from another tab: %s', async key => {
    await ready();
    api.validate.mockResolvedValue(false);
    window.dispatchEvent(new StorageEvent('storage', { key }));
    expect(get(availability.wallabagAvailability).status).toBe('checking');
    await availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it('ignores unrelated settings and revalidates on reconnect', async () => {
    await ready();
    const calls = api.validate.mock.calls.length;
    window.dispatchEvent(new StorageEvent('storage', { key: 'crispdeck-theme' }));
    expect(api.validate).toHaveBeenCalledTimes(calls);
    window.dispatchEvent(new Event('offline'));
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
    window.dispatchEvent(new Event('online'));
    await availability.refreshWallabagAvailability();
    expect(get(availability.wallabagAvailability).status).toBe('ready');
  });

  it('immediately rechecks a server imported in the same tab', async () => {
    await ready();
    api.validate.mockResolvedValue(false);
    localStorage.setItem('crispdeck-wallabag-url', 'https://imported.example.org');
    window.dispatchEvent(new Event('crispdeck:wallabag-server-changed'));
    expect(get(availability.wallabagAvailability).status).toBe('checking');
    await availability.refreshWallabagAvailability();
    expect(api.validate).toHaveBeenLastCalledWith('https://imported.example.org');
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });

  it('cleans up listeners, its interval and pending results on unmount', async () => {
    vi.useFakeTimers();
    await ready();
    stop!();
    const calls = api.validate.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.validate).toHaveBeenCalledTimes(calls);
    expect(get(availability.wallabagAvailability).status).toBe('hidden');
  });
});
