import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTauri } from './platform';

describe('isTauri', () => {
  const originalWindow = global.window;

  afterEach(() => {
    // Restore
    if (originalWindow === undefined) {
      // @ts-ignore
      delete global.window;
    }
  });

  it('returns false when no window', () => {
    // @ts-ignore
    global.window = undefined;
    // Need to re-import since the module uses typeof window
    // In practice, isTauri checks at call time
    expect(isTauri()).toBe(false);
  });

  it('returns false when window exists but no __TAURI_INTERNALS__', () => {
    // @ts-ignore
    global.window = {};
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ exists', () => {
    // @ts-ignore
    global.window = { __TAURI_INTERNALS__: {} };
    expect(isTauri()).toBe(true);
  });
});
