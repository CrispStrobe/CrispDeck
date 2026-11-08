import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchCacheInput } from './search-cache';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/platform', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock('$lib/browser-db', () => ({}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  native.invoke.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const item = (id: string, scope = 'account:1'): SearchCacheInput => ({
  id, scope, source: 'mastodon', url: `https://social.example/posts/${id}`,
  title: 'Followers-only note', text: 'Confidential project excerpt.', createdAt: new Date().toISOString(),
});
async function seed() {
  const cache = await import('./search-cache');
  await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: true });
  await cache.cacheSearchItems([item('private'), item('other', 'account:2')]);
  return cache;
}
function failNextTransaction() {
  return vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
    throw new DOMException('Storage temporarily blocked', 'SecurityError');
  });
}

describe('account removal under independent native and webview storage failures', () => {
  it('hides a removed account immediately even when IndexedDB cleanup fails', async () => {
    const cache = await seed();
    const { deleteAccount } = await import('./db');
    const failure = failNextTransaction();
    await expect(deleteAccount(1)).resolves.toBeUndefined();
    failure.mockRestore();
    expect(native.invoke).toHaveBeenCalledWith('db_delete_account', { id: 1 });
    const visible = await cache.searchCache('confidential');
    expect(visible.map(hit => hit.scope)).toEqual(['account:2']);
  });

  it('keeps failed-cleanup revocation across reopening the app and rejects late callbacks', async () => {
    await seed();
    const { deleteAccount } = await import('./db');
    const failure = failNextTransaction();
    await expect(deleteAccount(1)).resolves.toBeUndefined();
    failure.mockRestore();
    vi.resetModules();
    const reopened = await import('./search-cache');
    expect(await reopened.cacheSearchItems([item('late')])).toBe(0);
    expect((await reopened.searchCache('confidential')).map(hit => hit.scope)).toEqual(['account:2']);
  });

  it('still revokes a scope when the IndexedDB global is temporarily absent', async () => {
    const cache = await seed();
    const { deleteAccount } = await import('./db');
    const available = indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    await deleteAccount(1);
    vi.stubGlobal('indexedDB', available);
    expect((await cache.searchCache('confidential')).map(hit => hit.scope)).toEqual(['account:2']);
  });

  it('does not let a rolled-back tombstone transaction make the scope visible again', async () => {
    const cache = await seed();
    const original = IDBDatabase.prototype.transaction;
    const failure = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (this: IDBDatabase, ...args) {
      const tx = original.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    await expect(cache.removeSearchCacheScope('account:1')).resolves.toBeUndefined();
    failure.mockRestore();
    expect((await cache.searchCache('confidential')).map(hit => hit.scope)).toEqual(['account:2']);
  });

  it('does not remove native credentials when neither revocation store is writable', async () => {
    await seed();
    const { deleteAccount } = await import('./db');
    const storage = vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    const failure = failNextTransaction();
    await expect(deleteAccount(1)).rejects.toThrow('storage');
    expect(native.invoke).not.toHaveBeenCalledWith('db_delete_account', expect.anything());
    storage.mockRestore(); failure.mockRestore();
  });

});
