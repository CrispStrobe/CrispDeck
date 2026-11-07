import { base } from '$app/paths';
import { writeString } from './safe-storage';
import { ensureMastodonApp, mastodonAuthorizeUrl, exchangeMastodonCode } from './mastodon-app';
/**
 * Browser-side database using IndexedDB.
 * Mirrors the Rust/SQLite backend so the app works fully on Vercel.
 * Credentials are stored with Web Crypto AES-GCM encryption.
 */

import type {
  Account,
  Identity,
  IdentityLink,
  IdentityCandidate,
  CrosspostEntry,
  Draft,
  FollowEntry,
} from './types';
import { jaroWinkler } from '$lib/utils/string';

const DB_NAME = 'crispdeck';
const DB_VERSION = 1;

let _dbInstance: IDBDatabase | null = null;
let _dbOpening: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  if (_dbOpening) return _dbOpening;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      _dbInstance = db;
      const release = () => { if (_dbInstance === db) _dbInstance = null; };
      db.onclose = release;
      // Another tab (or the cache purge) must be able to upgrade/delete it.
      db.onversionchange = () => { db.close(); release(); };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('accounts')) {
        const store = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
        store.createIndex('platform_handle', ['platform', 'handle'], { unique: true });
      }
      if (!db.objectStoreNames.contains('identities')) {
        db.createObjectStore('identities', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('identity_links')) {
        const store = db.createObjectStore('identity_links', { keyPath: 'id', autoIncrement: true });
        store.createIndex('identity_id', 'identity_id', { unique: false });
        store.createIndex('platform_handle', ['platform', 'handle'], { unique: false });
      }
      if (!db.objectStoreNames.contains('identity_tags')) {
        const store = db.createObjectStore('identity_tags', { keyPath: 'id', autoIncrement: true });
        store.createIndex('identity_id', 'identity_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('crosspost_history')) {
        db.createObjectStore('crosspost_history', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('follows_cache')) {
        const store = db.createObjectStore('follows_cache', { keyPath: 'id', autoIncrement: true });
        store.createIndex('owner_account_id', 'owner_account_id', { unique: false });
      }
    };
  });
  _dbOpening = opening;
  const settled = () => { if (_dbOpening === opening) _dbOpening = null; };
  void opening.then(settled, settled);
  return opening;
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const txn = db.transaction(storeName, mode);
    const store = txn.objectStore(storeName);
    const req = fn(store);
    let result: T;
    req.onsuccess = () => { result = req.result; };
    txn.oncomplete = () => resolve(result);
    txn.onabort = txn.onerror = () => reject(txn.error ?? req.error);
  }));
}

/** Keep reads and their dependent writes in one IndexedDB transaction. */
function atomic<T>(stores: string[], run: (txn: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const txn = db.transaction(stores, 'readwrite');
    let result: T;
    let failure: unknown;
    const fail = (error: unknown) => { failure = error; txn.abort(); };
    txn.oncomplete = () => resolve(result);
    txn.onabort = txn.onerror = () => reject(failure ?? txn.error ?? new Error('Database transaction failed'));
    try { run(txn, value => { result = value; }, fail); }
    catch (error) { fail(error); }
  }));
}

function updateRecord(storeName: string, id: number, message: string, update: (record: any) => void): Promise<void> {
  return atomic<void>([storeName], (txn, _result, fail) => {
    const store = txn.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { fail(new Error(message)); return; }
      try {
        update(request.result);
        store.put(request.result);
      } catch (error) { fail(error); }
    };
  });
}

function deleteIndexedRows(store: IDBObjectStore, index: string, key: IDBValidKey, done?: () => void): void {
  const request = store.index(index).openKeyCursor(key);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) { done?.(); return; }
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

function getAll<T>(storeName: string): Promise<T[]> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const txn = db.transaction(storeName, 'readonly');
    const req = txn.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function getAllByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const txn = db.transaction(storeName, 'readonly');
    const req = txn.objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function add<T>(storeName: string, value: T): Promise<IDBValidKey> {
  return tx(storeName, 'readwrite', store => store.add(value));
}

function del(storeName: string, key: IDBValidKey): Promise<undefined> {
  return tx(storeName, 'readwrite', store => store.delete(key));
}

function now(): string {
  return new Date().toISOString();
}

// ── Web Crypto helpers for credential encryption ─────────────────────────

const CRYPTO_KEY_NAME = 'crispdeck-key';
const CRYPTO_SALT_NAME = 'crispdeck-salt-v2';
const CRYPTO_MIGRATED = 'crispdeck-crypto-v2';

function getSeed(): string {
  let seed = localStorage.getItem(CRYPTO_KEY_NAME);
  if (!seed) {
    seed = crypto.randomUUID();
    if (!writeString(CRYPTO_KEY_NAME, seed)) {
      throw new Error('Could not save the credential encryption key. Allow browser storage and try connecting again.');
    }
  }
  return seed;
}

async function deriveKey(salt: Uint8Array, iterations: number, seed = getSeed()): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(seed), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

let _cachedCryptoKey: { seed: string; salt: string; key: Promise<CryptoKey> } | null = null;
function requireCurrentKey(material: { seed: string; salt: string }): void {
  if (localStorage.getItem(CRYPTO_KEY_NAME) !== material.seed || localStorage.getItem(CRYPTO_SALT_NAME) !== material.salt) {
    throw new Error('Credential encryption storage changed during the operation. Please try again.');
  }
}

async function getCryptoKey(): Promise<{ seed: string; salt: string; key: CryptoKey }> {
  // New key: per-device random salt + 600k iterations (OWASP 2024).
  let saltB64 = localStorage.getItem(CRYPTO_SALT_NAME);
  if (!saltB64) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(32));
    saltB64 = btoa(String.fromCharCode(...saltBytes));
    if (!writeString(CRYPTO_SALT_NAME, saltB64)) {
      throw new Error('Could not save the credential encryption salt. Free browser storage and try connecting again.');
    }
  }
  const seed = getSeed();
  // Starting several account clients at once must share this expensive KDF.
  // Compare persisted material on each use so clearing/changing storage never
  // causes new credentials to be saved with an old, memory-only key.
  let pending = _cachedCryptoKey;
  if (!pending || pending.seed !== seed || pending.salt !== saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    pending = { seed, salt: saltB64, key: deriveKey(salt, 600000, seed) };
    _cachedCryptoKey = pending;
  }
  try {
    const key = await pending.key;
    requireCurrentKey(pending);
    return { seed: pending.seed, salt: pending.salt, key };
  }
  catch (error) {
    if (_cachedCryptoKey === pending) _cachedCryptoKey = null;
    throw error;
  }
}

/** Legacy key for migrating existing data (static salt, 100k iterations) */
async function getLegacyCryptoKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return deriveKey(enc.encode('crispdeck-salt'), 100000);
}

export async function encrypt(plaintext: string): Promise<string> {
  const material = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, material.key, enc.encode(plaintext));
  // Pack iv + ciphertext as base64
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(ct), iv.length);
  const chunks: string[] = [];
  for (let start = 0; start < packed.length; start += 0x8000) {
    chunks.push(String.fromCharCode(...packed.subarray(start, start + 0x8000)));
  }
  const encoded = btoa(chunks.join(''));
  requireCurrentKey(material);
  return encoded;
}

export async function decrypt(encoded: string): Promise<string> {
  const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);

  // Try new key first
  try {
    const material = await getCryptoKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, material.key, ct);
    requireCurrentKey(material);
    return new TextDecoder().decode(pt);
  } catch {
    // Fall back to legacy key (static salt, 100k iterations)
    const legacyKey = await getLegacyCryptoKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, ct);
    return new TextDecoder().decode(pt);
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<Account[]> {
  const all = await getAll<Account & { credentials_enc?: string }>('accounts');
  return all.map(({ credentials_enc, ...rest }) => rest).sort((a, b) => a.platform.localeCompare(b.platform));
}

export async function addAccount(params: {
  platform: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  did?: string;
  mastodon_id?: string;
  instance_url?: string;
  credentials: string;
  is_primary?: boolean;
}): Promise<Account> {
  const encrypted = await encrypt(params.credentials);
  const record = {
    platform: params.platform,
    handle: params.handle,
    display_name: params.display_name ?? null,
    avatar_url: params.avatar_url ?? null,
    did: params.did ?? null,
    mastodon_id: params.mastodon_id ?? null,
    instance_url: params.instance_url ?? null,
    credentials_enc: encrypted,
    is_primary: params.is_primary ?? false,
    created_at: now(),
    updated_at: now(),
  };
  const id = await add('accounts', record) as number;
  const { credentials_enc: _secret, ...publicRecord } = record;
  return { id, ...publicRecord } as unknown as Account;
}

export async function updateAccount(params: {
  id: number;
  display_name?: string;
  avatar_url?: string;
  is_primary?: boolean;
}): Promise<void> {
  await updateRecord('accounts', params.id, 'Account not found', existing => {
    if (params.display_name !== undefined) existing.display_name = params.display_name;
    if (params.avatar_url !== undefined) existing.avatar_url = params.avatar_url;
    if (params.is_primary !== undefined) existing.is_primary = params.is_primary;
    existing.updated_at = now();
  });
}

export async function deleteAccount(id: number): Promise<void> {
  await atomic<void>(['accounts', 'follows_cache', 'identity_links'], txn => {
    txn.objectStore('accounts').delete(id);
    deleteIndexedRows(txn.objectStore('follows_cache'), 'owner_account_id', id);
    const request = txn.objectStore('identity_links').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.account_id === id) cursor.update({ ...cursor.value, account_id: null });
      cursor.continue();
    };
  });
}

export async function getDecryptedCredentials(accountId: number): Promise<string> {
  const db = await openDB();
  const acct = await new Promise<any>((resolve, reject) => {
    const req = db.transaction('accounts', 'readonly').objectStore('accounts').get(accountId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!acct?.credentials_enc) throw new Error('No credentials found');
  return decrypt(acct.credentials_enc);
}

// ── Identities ────────────────────────────────────────────────────────────

export async function listIdentities(filter?: { confirmed_only?: boolean; tag?: string } | null): Promise<Identity[]> {
  const [identities, allLinks, allTags] = await Promise.all([
    getAll<any>('identities'), getAll<IdentityLink>('identity_links'),
    getAll<{ identity_id: number; tag: string }>('identity_tags'),
  ]);
  const links = new Map<number, IdentityLink[]>();
  const tags = new Map<number, string[]>();
  for (const link of allLinks) {
    const group = links.get(link.identity_id);
    if (group) group.push(link); else links.set(link.identity_id, [link]);
  }
  for (const tag of allTags) {
    const group = tags.get(tag.identity_id);
    if (group) group.push(tag.tag); else tags.set(tag.identity_id, [tag.tag]);
  }
  return identities.map(i => ({
    ...i,
    auto_detected: i.auto_detected ?? false,
    confirmed: i.confirmed ?? false,
    links: links.get(i.id) ?? [],
    tags: tags.get(i.id) ?? [],
  })).filter(identity => (!filter?.confirmed_only || identity.confirmed) &&
    (filter?.tag === undefined || identity.tags.includes(filter.tag)));
}

export async function createIdentity(params: { display_name?: string; notes?: string }): Promise<Identity> {
  const record = {
    display_name: params.display_name ?? null,
    notes: params.notes ?? null,
    auto_detected: false,
    confirmed: false,
    confidence: null,
    created_at: now(),
    updated_at: now(),
  };
  const id = await add('identities', record) as number;
  return { id, ...record, tags: [], links: [] } as Identity;
}

export async function updateIdentity(params: { id: number; display_name?: string; notes?: string }): Promise<void> {
  await updateRecord('identities', params.id, 'Identity not found', existing => {
    if (params.display_name !== undefined) existing.display_name = params.display_name;
    if (params.notes !== undefined) existing.notes = params.notes;
    existing.updated_at = now();
  });
}

export async function deleteIdentity(id: number): Promise<void> {
  await atomic<void>(['identities', 'identity_links', 'identity_tags'], txn => {
    txn.objectStore('identities').delete(id);
    deleteIndexedRows(txn.objectStore('identity_links'), 'identity_id', id);
    deleteIndexedRows(txn.objectStore('identity_tags'), 'identity_id', id);
  });
}

export async function linkToIdentity(params: {
  identity_id: number;
  platform: string;
  handle: string;
  // Nullable columns: a row read back from the DB carries `null`, not
  // `undefined`, and callers relink straight from such a row.
  did?: string | null;
  mastodon_id?: string | null;
  instance_url?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  account_id?: number | null;
}): Promise<void> {
  const record = {
    identity_id: params.identity_id,
    account_id: params.account_id ?? null,
    platform: params.platform,
    handle: params.handle,
    did: params.did ?? null,
    mastodon_id: params.mastodon_id ?? null,
    instance_url: params.instance_url ?? null,
    display_name: params.display_name ?? null,
    avatar_url: params.avatar_url ?? null,
    bio: params.bio ?? null,
    created_at: now(),
  };
  await atomic<void>(['identities', 'accounts', 'identity_links'], (txn, _result, fail) => {
    const insert = () => {
      const links = txn.objectStore('identity_links');
      const existing = links.index('platform_handle').getAll([params.platform, params.handle]);
      existing.onsuccess = () => {
        if (!existing.result.some(link => link.identity_id === params.identity_id)) links.add(record);
      };
    };
    const parent = txn.objectStore('identities').get(params.identity_id);
    parent.onsuccess = () => {
      if (!parent.result) { fail(new Error('Identity not found')); return; }
      if (params.account_id == null) { insert(); return; }
      const account = txn.objectStore('accounts').get(params.account_id);
      account.onsuccess = () => {
        if (!account.result) { fail(new Error('Account not found')); return; }
        insert();
      };
    };
  });
}

export async function unlinkFromIdentity(linkId: number): Promise<void> {
  await del('identity_links', linkId);
}

export async function confirmIdentity(id: number): Promise<void> {
  await updateRecord('identities', id, 'Identity not found', existing => {
    existing.confirmed = true;
    existing.updated_at = now();
  });
}

export async function resolveHandle(handle: string, targetPlatform: string): Promise<string | null> {
  const allLinks = await getAll<IdentityLink>('identity_links');
  const sourceLink = allLinks.find(l => l.handle === handle || l.handle === `@${handle}`);
  if (!sourceLink) return null;
  const targetLink = allLinks.find(l => l.identity_id === sourceLink.identity_id && l.platform === targetPlatform);
  return targetLink?.handle ?? null;
}

// ── Tags ──────────────────────────────────────────────────────────────────

export async function addTag(identityId: number, tag: string): Promise<void> {
  await atomic<void>(['identities', 'identity_tags'], (txn, _result, fail) => {
    const parent = txn.objectStore('identities').get(identityId);
    parent.onsuccess = () => {
      if (!parent.result) { fail(new Error('Identity not found')); return; }
      const store = txn.objectStore('identity_tags');
      const existing = store.index('identity_id').getAll(identityId);
      existing.onsuccess = () => {
        if (!existing.result.some(value => value.tag === tag)) store.add({ identity_id: identityId, tag });
      };
    };
  });
}

export async function removeTag(identityId: number, tag: string): Promise<void> {
  await atomic<void>(['identity_tags'], txn => {
    const request = txn.objectStore('identity_tags').index('identity_id').openCursor(identityId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.tag === tag) cursor.delete();
      cursor.continue();
    };
  });
}

// ── Identity detection (JS implementation) ────────────────────────────────

function extractUsername(handle: string): string {
  const h = handle.replace(/^@/, '');
  const at = h.indexOf('@');
  if (at > 0) return h.substring(0, at).toLowerCase();
  const dot = h.indexOf('.');
  if (dot > 0) return h.substring(0, dot).toLowerCase();
  return h.toLowerCase();
}

export async function detectIdentities(
  bskyFollows: FollowEntry[],
  mastoFollows: FollowEntry[],
): Promise<IdentityCandidate[]> {
  const candidates: IdentityCandidate[] = [];
  const threshold = 0.85;

  for (const bsky of bskyFollows) {
    for (const masto of mastoFollows) {
      let score = 0;
      const reasons: string[] = [];

      if (bsky.display_name && masto.display_name) {
        const sim = jaroWinkler(bsky.display_name.toLowerCase(), masto.display_name.toLowerCase());
        score += 0.5 * sim;
        if (sim > 0.9) reasons.push(`display name match (${Math.round(sim * 100)}%)`);
      }

      const bu = extractUsername(bsky.handle), mu = extractUsername(masto.handle);
      if (bu && mu) {
        const sim = jaroWinkler(bu, mu);
        score += 0.3 * sim;
        if (sim > 0.9) reasons.push(`username match (${Math.round(sim * 100)}%)`);
      }

      let bioBonus = 0;
      if (bsky.bio && masto.handle && bsky.bio.toLowerCase().includes(masto.handle.toLowerCase().replace(/@/g, ''))) {
        bioBonus = 1; reasons.push('Bluesky bio mentions Mastodon handle');
      }
      if (masto.bio && bsky.handle && masto.bio.toLowerCase().includes(bsky.handle.toLowerCase())) {
        bioBonus = 1; reasons.push('Mastodon bio mentions Bluesky handle');
      }
      score += 0.2 * bioBonus;

      if (score >= threshold) {
        candidates.push({
          bluesky_handle: bsky.handle,
          bluesky_display_name: bsky.display_name,
          bluesky_avatar: bsky.avatar_url,
          bluesky_bio: bsky.bio,
          bluesky_did: bsky.did,
          mastodon_handle: masto.handle,
          mastodon_display_name: masto.display_name,
          mastodon_avatar: masto.avatar_url,
          mastodon_bio: masto.bio,
          mastodon_id: masto.mastodon_id,
          mastodon_instance: masto.instance_url,
          confidence: score,
          match_reasons: reasons,
        });
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const seenB = new Set<string>(), seenM = new Set<string>();
  return candidates.filter(c => {
    const bNew = seenB.has(c.bluesky_handle) ? false : (seenB.add(c.bluesky_handle), true);
    const mNew = seenM.has(c.mastodon_handle) ? false : (seenM.add(c.mastodon_handle), true);
    return bNew && mNew;
  });
}

// ── Follows cache ─────────────────────────────────────────────────────────

export async function cacheFollows(ownerAccountId: number, follows: FollowEntry[]): Promise<void> {
  await atomic<void>(['accounts', 'follows_cache'], (txn, _result, fail) => {
    const owner = txn.objectStore('accounts').get(ownerAccountId);
    owner.onsuccess = () => {
      if (!owner.result) { fail(new Error('Account not found')); return; }
      const store = txn.objectStore('follows_cache');
      deleteIndexedRows(store, 'owner_account_id', ownerAccountId, () => {
        const ts = now();
        for (const follow of follows) store.add({ ...follow, owner_account_id: ownerAccountId, fetched_at: ts });
      });
    };
  });
}

export async function getCachedFollows(ownerAccountId: number): Promise<FollowEntry[]> {
  return getAllByIndex<FollowEntry>('follows_cache', 'owner_account_id', ownerAccountId);
}

// ── Crosspost history ─────────────────────────────────────────────────────

export async function logCrosspost(params: {
  draft_id?: number;
  bluesky_uri?: string | null;
  bluesky_cid?: string | null;
  mastodon_uri?: string | null;
  mastodon_id?: string | null;
  threads_uri?: string | null;
  threads_id?: string | null;
  text_preview?: string;
  media_count?: number;
  status: string;
}): Promise<number> {
  return await add('crosspost_history', { ...params, posted_at: now() }) as number;
}

export async function listCrossposts(limit: number = 50, offset: number = 0): Promise<CrosspostEntry[]> {
  const all = await getAll<CrosspostEntry>('crosspost_history');
  return all.sort((a, b) => b.posted_at.localeCompare(a.posted_at)).slice(offset, offset + limit);
}

// ── Drafts ────────────────────────────────────────────────────────────────

export async function saveDraft(params: {
  id?: number;
  text: string;
  target_accounts: number[];
  media_paths?: string[];
  visibility?: string;
  // `null` is the stored "no content warning" / "not scheduled" value, and
  // rescheduling an existing draft passes it straight back in.
  content_warning?: string | null;
  scheduled_at?: string | null;
}): Promise<number> {
  const { id, ...fields } = params;
  const record = (previous?: Draft) => ({
    ...fields, ...(id === undefined ? {} : { id }), scheduled_at: params.scheduled_at ?? null,
    is_sent: false, created_at: previous?.created_at ?? now(), updated_at: now(),
  });
  if (id === undefined) return await add('drafts', record()) as number;
  await updateRecord('drafts', id, 'Draft no longer exists', previous => Object.assign(previous, record(previous)));
  return id;
}

export async function listDrafts(): Promise<Draft[]> {
  const all = await getAll<Draft>('drafts');
  return all.filter(d => !d.is_sent).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function deleteDraft(id: number): Promise<void> {
  await del('drafts', id);
}

// ── Mastodon OAuth (browser popup flow) ───────────────────────────────────

export async function startMastodonOAuth(
  instanceUrl: string,
  // The app passes its own fixed loopback address (see oauth-window.ts).
  redirectUri = `${window.location.origin}${base}/oauth/callback`,
): Promise<{
  auth_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  state: string;
}> {
  const instance = instanceUrl.replace(/\/$/, '');
  // Without a state the callback page takes whatever code lands on it, so
  // anyone who can get the browser to open /oauth/callback?code=... attaches
  // this client to an account they control. The instance echoes this back and
  // the callback page refuses anything else.
  const state = randomState();
  // The instance stores the redirect URI at registration, so getting it wrong
  // bakes a dead callback into the registered app rather than failing loudly.

  const app = await ensureMastodonApp(instance, redirectUri);
  const authUrl = mastodonAuthorizeUrl(instance, app, state);

  return {
    auth_url: authUrl,
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: redirectUri,
    state,
  };
}

/** 32 random bytes as hex. */
export function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const completeMastodonOAuth = exchangeMastodonCode;
