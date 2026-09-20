import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readJson, readString, writeJson, writeString, removeKey } from './safe-storage';
import { getLogs, clearLogs } from './debug-log';

/**
 * The failure this exists for: +layout.svelte parsed a stored value at
 * component initialisation, outside any try/catch. One corrupt value threw
 * while the shell was initialising, so every page failed to render — on every
 * visit, with no way out but clearing site data.
 */

beforeEach(() => {
  localStorage.clear();
  clearLogs();
});
afterEach(() => vi.restoreAllMocks());

describe('readJson', () => {
  it('returns the stored value', () => {
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(readJson('k', null)).toEqual({ a: 1 });
  });

  it('returns the fallback when the key is missing', () => {
    expect(readJson('absent', ['default'])).toEqual(['default']);
  });

  it('returns the fallback instead of throwing on corrupt JSON', () => {
    localStorage.setItem('k', '{not json');
    expect(() => readJson('k', [])).not.toThrow();
    expect(readJson('k', ['fallback'])).toEqual(['fallback']);
  });

  it('records the corruption rather than hiding it', () => {
    // A preference that silently resets needs to be explicable afterwards.
    localStorage.setItem('k', 'nonsense');
    readJson('k', []);
    expect(getLogs()[0].source).toContain('safe-storage.parse:k');
  });

  it('rejects a value of the wrong shape', () => {
    // A string where an array is expected parses fine and breaks further away.
    localStorage.setItem('k', JSON.stringify('a string'));
    expect(readJson('k', [] as unknown[], Array.isArray)).toEqual([]);
  });

  it('accepts a value that passes the shape check', () => {
    localStorage.setItem('k', JSON.stringify([1, 2]));
    expect(readJson('k', [] as unknown[], Array.isArray)).toEqual([1, 2]);
  });

  it('survives storage that throws on access', () => {
    // Safari in private mode, and browsers with site data blocked.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readJson('k', 'fallback')).toBe('fallback');
  });

  it('treats a stored null as a value, not as missing', () => {
    localStorage.setItem('k', 'null');
    expect(readJson('k', 'fallback')).toBeNull();
  });
});

describe('readString', () => {
  it('reads a plain string', () => {
    localStorage.setItem('k', 'hello');
    expect(readString('k')).toBe('hello');
  });

  it('falls back when missing or unavailable', () => {
    expect(readString('absent', 'd')).toBe('d');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('nope'); });
    expect(readString('k', 'd')).toBe('d');
  });
});

describe('writeJson', () => {
  it('stores the value and reports success', () => {
    expect(writeJson('k', { a: 1 })).toBe(true);
    expect(JSON.parse(localStorage.getItem('k')!)).toEqual({ a: 1 });
  });

  it('reports failure when the quota is exceeded rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    });
    expect(writeJson('k', { a: 1 })).toBe(false);
    expect(getLogs()[0].source).toContain('safe-storage.write:k');
  });

  it('reports failure when storage is disabled outright', () => {
    // Safari private mode throws on every setItem.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(writeString('k', 'v')).toBe(false);
  });
});

describe('removeKey', () => {
  it('removes a key', () => {
    localStorage.setItem('k', 'v');
    removeKey('k');
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('nope'); });
    expect(() => removeKey('k')).not.toThrow();
  });
});

describe('the round trip', () => {
  it('reads back what it wrote', () => {
    const value = { columns: ['a', 'b'], nested: { n: 1 } };
    expect(writeJson('k', value)).toBe(true);
    expect(readJson('k', null)).toEqual(value);
  });
});
