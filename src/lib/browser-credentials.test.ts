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
    const prototype = Object.getPrototypeOf(localStorage) as Storage;
    const setItem = prototype.setItem;
    const storage = vi.spyOn(prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
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

  it('derives one key for concurrent credential writes', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    const db = await import('./browser-db');
    const encrypted = await Promise.all(Array.from({ length: 5 }, (_, index) => db.encrypt(`secret-${index}`)));
    expect(derive).toHaveBeenCalledTimes(1);
    expect(await Promise.all(encrypted.map(value => db.decrypt(value)))).toEqual(['secret-0', 'secret-1', 'secret-2', 'secret-3', 'secret-4']);
  });

  it('does not save with a stale memory key after browser key material is cleared', async () => {
    const db = await import('./browser-db');
    await db.encrypt('old-session');
    localStorage.removeItem('crispdeck-key');
    localStorage.removeItem('crispdeck-salt-v2');
    const encrypted = await db.encrypt('new-session');
    vi.resetModules();
    expect(await (await import('./browser-db')).decrypt(encrypted)).toBe('new-session');
  });

  it('rejects credential encryption if the persisted seed is cleared while derivation is pending', async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const deriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce(async (...args) => {
      started();
      await blocked;
      return deriveKey(...args);
    });
    const db = await import('./browser-db');
    const encrypting = db.encrypt('must-not-be-saved-with-the-discarded-key');
    const rejected = expect(encrypting).rejects.toThrow();
    await entered;
    localStorage.removeItem('crispdeck-key');
    release();
    await rejected;

    const retried = await db.encrypt('new-credential');
    vi.resetModules();
    expect(await (await import('./browser-db')).decrypt(retried)).toBe('new-credential');
  });

  it('rejects credential encryption if the persisted salt changes while encryption is pending', async () => {
    const db = await import('./browser-db');
    await db.encrypt('prime-the-cached-key');
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      started();
      await blocked;
      return encrypt(...args);
    });
    const encrypting = db.encrypt('must-not-be-saved-with-the-replaced-salt');
    const rejected = expect(encrypting).rejects.toThrow();
    await entered;
    localStorage.setItem('crispdeck-salt-v2', btoa('s'.repeat(32)));
    release();
    await rejected;

    const retried = await db.encrypt('new-credential');
    vi.resetModules();
    expect(await (await import('./browser-db')).decrypt(retried)).toBe('new-credential');
  });

  it('handles a large credential document without overflowing the argument stack', async () => {
    const db = await import('./browser-db');
    const document = JSON.stringify({ token: 'a'.repeat(256_000), name: 'Zoë 日本語' });
    expect(await db.decrypt(await db.encrypt(document))).toBe(document);
  });
});
