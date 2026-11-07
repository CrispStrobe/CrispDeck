import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowEntry } from './types';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function seedAccounts() {
  const app = await import('./browser-db');
  await app.listAccounts();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('crispdeck');
    request.onsuccess = () => {
      const db = request.result;
      const txn = db.transaction('accounts', 'readwrite');
      for (const id of [1, 2]) txn.objectStore('accounts').add({ id, platform: 'bluesky', handle: `owner-${id}`, is_primary: false, credentials_enc: 'internal-secret-blob' });
      txn.oncomplete = () => { db.close(); resolve(); };
      txn.onabort = txn.onerror = () => { db.close(); reject(txn.error); };
    };
    request.onerror = () => reject(request.error);
  });
  return app;
}

async function rows(store: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('crispdeck');
    request.onsuccess = () => {
      const db = request.result;
      const txn = db.transaction(store, 'readonly');
      const query = txn.objectStore(store).getAll();
      query.onsuccess = () => { db.close(); resolve(query.result); };
      query.onerror = () => { db.close(); reject(query.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

function follow(handle: string): FollowEntry {
  return { platform: 'bluesky', handle, did: null, mastodon_id: null, instance_url: null, display_name: null, avatar_url: null, bio: null };
}

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

describe('atomic browser storage', () => {
  it('keeps independent account changes made at the same time', async () => {
    const db = await seedAccounts();
    await Promise.all([
      db.updateAccount({ id: 1, display_name: 'Updated name' }),
      db.updateAccount({ id: 1, is_primary: true }),
      db.updateAccount({ id: 1, avatar_url: 'https://example.test/avatar.png' }),
    ]);
    expect((await db.listAccounts())[0]).toMatchObject({ display_name: 'Updated name', is_primary: true, avatar_url: 'https://example.test/avatar.png' });
    expect((await db.listAccounts())[0]).not.toHaveProperty('credentials_enc');
  });

  it('keeps identity confirmation when a profile edit runs at the same time', async () => {
    const db = await import('./browser-db');
    const identity = await db.createIdentity({ display_name: 'Before' });
    await Promise.all([db.confirmIdentity(identity.id), db.updateIdentity({ id: identity.id, notes: 'Keep this note' })]);
    expect((await db.listIdentities())[0]).toMatchObject({ confirmed: true, notes: 'Keep this note' });
  });

  it('replaces concurrent follow snapshots instead of combining them', async () => {
    const db = await seedAccounts();
    await Promise.all([db.cacheFollows(1, [follow('first')]), db.cacheFollows(1, [follow('latest')])]);
    expect((await db.getCachedFollows(1)).map(item => item.handle)).toEqual(['latest']);
  });

  it('deletes an account and its follows while preserving the identity and other accounts', async () => {
    const db = await seedAccounts();
    const identity = await db.createIdentity({ display_name: 'Keep this person' });
    await db.linkToIdentity({ identity_id: identity.id, platform: 'bluesky', handle: 'owner-1', account_id: 1 });
    await db.cacheFollows(1, [follow('private-follow')]);
    await db.cacheFollows(2, [follow('other-follow')]);
    await db.deleteAccount(1);
    expect((await db.listAccounts()).map(account => account.id)).toEqual([2]);
    expect(await db.getCachedFollows(1)).toEqual([]);
    expect((await db.getCachedFollows(2))[0].handle).toBe('other-follow');
    expect((await db.listIdentities())[0].links[0].account_id).toBeNull();
    await expect(db.cacheFollows(1, [follow('late-network-response')])).rejects.toThrow('Account not found');
  });

  it('does not resurrect a draft when deletion races with an edit', async () => {
    const db = await import('./browser-db');
    const id = await db.saveDraft({ text: 'Before', target_accounts: [1] });
    await Promise.all([db.saveDraft({ id, text: 'Edited', target_accounts: [1] }), db.deleteDraft(id)]);
    expect(await db.listDrafts()).toEqual([]);
    await expect(db.saveDraft({ id, text: 'Too late', target_accounts: [1] })).rejects.toThrow('Draft no longer exists');
  });

  it('removes only a deleted identity and its links and tags', async () => {
    const db = await import('./browser-db');
    const first = await db.createIdentity({ display_name: 'Delete' });
    const second = await db.createIdentity({ display_name: 'Keep' });
    for (const identity of [first, second]) {
      await db.addTag(identity.id, 'friend');
      await db.linkToIdentity({ identity_id: identity.id, platform: 'bluesky', handle: `person-${identity.id}` });
    }
    await db.deleteIdentity(first.id);
    expect((await rows('identity_links')).map(link => link.identity_id)).toEqual([second.id]);
    expect((await rows('identity_tags')).map(tag => tag.identity_id)).toEqual([second.id]);
  });
});

describe('browser identity filters', () => {
  it('applies confirmed and tag filters together and keeps each persons own links', async () => {
    const db = await import('./browser-db');
    const first = await db.createIdentity({ display_name: 'Confirmed friend' });
    const second = await db.createIdentity({ display_name: 'Unconfirmed friend' });
    const third = await db.createIdentity({ display_name: 'Confirmed colleague' });
    await db.confirmIdentity(first.id);
    await db.confirmIdentity(third.id);
    await db.addTag(first.id, 'friend');
    await db.addTag(second.id, 'friend');
    await db.addTag(third.id, 'colleague');
    await db.linkToIdentity({ identity_id: first.id, platform: 'bluesky', handle: 'first.example' });
    await db.linkToIdentity({ identity_id: second.id, platform: 'mastodon', handle: 'second.example' });
    expect((await db.listIdentities({ confirmed_only: true })).map(identity => identity.id)).toEqual([first.id, third.id]);
    expect((await db.listIdentities({ tag: 'friend' })).map(identity => identity.id)).toEqual([first.id, second.id]);
    const both = await db.listIdentities({ confirmed_only: true, tag: 'friend' });
    expect(both).toHaveLength(1);
    expect(both[0].links.map(link => link.handle)).toEqual(['first.example']);
    expect(await db.listIdentities({ tag: 'missing' })).toEqual([]);
  });
});
