import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser database connection lifecycle', () => {
  it('shares one connection when independent views load simultaneously', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const db = await import('./browser-db');
    await Promise.all([db.listAccounts(), db.listDrafts(), db.listIdentities(), db.listCrossposts()]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('releases connections for deletion and can open a fresh database afterward', async () => {
    const db = await import('./browser-db');
    await db.createIdentity({ display_name: 'Temporary' });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('crispdeck');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Application kept its database open during deletion'));
    });
    expect(await db.listIdentities()).toEqual([]);
  });
});
