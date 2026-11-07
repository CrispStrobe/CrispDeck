import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const account = { platform: 'mastodon', handle: '@test@example.com', credentials: '{"access_token":"account-secret"}' };

describe('browser credential durability', () => {
  it.each(['crispdeck-key', 'crispdeck-salt-v2'])('refuses an account when %s cannot be persisted', async failedKey => {
    const setItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failedKey) throw new DOMException('Storage full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    const db = await import('./browser-db');
    await expect(db.addAccount(account)).rejects.toThrow('Could not save the credential encryption');
    expect(await db.listAccounts()).toEqual([]);
    storage.mockRestore();
    // A failed attempt must not cache an ephemeral key and poison a later retry.
    const saved = await db.addAccount(account);
    vi.resetModules();
    const reloaded = await import('./browser-db');
    expect(await reloaded.getDecryptedCredentials(saved.id)).toBe(account.credentials);
  });

  it('decrypts saved credentials after a module reload with persisted key material', async () => {
    const db = await import('./browser-db');
    const saved = await db.addAccount(account);
    expect(localStorage.getItem('crispdeck-key')).toBeTruthy();
    expect(localStorage.getItem('crispdeck-salt-v2')).toBeTruthy();
    vi.resetModules();
    const reloaded = await import('./browser-db');
    expect(await reloaded.getDecryptedCredentials(saved.id)).toBe(account.credentials);
  });
});
