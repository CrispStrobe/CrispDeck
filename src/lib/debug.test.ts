import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./debug');
}

const store: Record<string, string> = {};
beforeEach(() => {
  // Vitest runs as a dev build, where logging is on by default. These tests are
  // about the opt-in path, so DEV is stubbed off except where stated.
  vi.stubEnv('DEV', false);
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('swallow', () => {
  it('logs nothing when debug is off', async () => {
    const { swallow } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    swallow('feed.load', new Error('boom'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs with context when the flag is set', async () => {
    store['crispdeck-debug'] = 'true';
    const { swallow } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('boom');
    swallow('feed.load', err);
    expect(warn).toHaveBeenCalledWith('[crispdeck] feed.load:', err);
    warn.mockRestore();
  });

  it('never throws when localStorage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
    });
    const { swallow } = await load();
    expect(() => swallow('x', new Error('y'))).not.toThrow();
  });

  it('never throws when console.warn throws', async () => {
    store['crispdeck-debug'] = 'true';
    const { swallow } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('no console'); });
    expect(() => swallow('x', new Error('y'))).not.toThrow();
    warn.mockRestore();
  });

  it('caches the flag, and resetDebugFlag re-reads it', async () => {
    const { swallow, resetDebugFlag } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    swallow('a', 1);
    expect(warn).not.toHaveBeenCalled();

    store['crispdeck-debug'] = 'true';
    swallow('b', 2);
    expect(warn).not.toHaveBeenCalled(); // still cached

    resetDebugFlag();
    swallow('c', 3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('is on automatically in a dev build', async () => {
    vi.stubEnv('DEV', true);
    const { swallow } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    swallow('ctx', new Error('x'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('accepts any thrown value, not just Errors', async () => {
    store['crispdeck-debug'] = 'true';
    const { swallow } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    swallow('ctx', 'a string');
    swallow('ctx', undefined);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
