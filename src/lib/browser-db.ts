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

const DB_NAME = 'crispdeck';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
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
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const txn = db.transaction(storeName, mode);
    const store = txn.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
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

function put<T>(storeName: string, value: T): Promise<IDBValidKey> {
  return tx(storeName, 'readwrite', store => store.put(value));
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

async function getCryptoKey(): Promise<CryptoKey> {
  // Derive a stable key from a fixed passphrase stored in localStorage.
  // Less secure than Tauri's machine-bound Argon2 key, but functional for web.
  let seed = localStorage.getItem(CRYPTO_KEY_NAME);
  if (!seed) {
    seed = crypto.randomUUID();
    localStorage.setItem(CRYPTO_KEY_NAME, seed);
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(seed), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('crispdeck-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // Pack iv + ciphertext as base64
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...packed));
}

async function decrypt(encoded: string): Promise<string> {
  const key = await getCryptoKey();
  const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
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
  return { id, ...record } as unknown as Account;
}

export async function updateAccount(params: {
  id: number;
  display_name?: string;
  avatar_url?: string;
  is_primary?: boolean;
}): Promise<void> {
  const db = await openDB();
  const existing = await new Promise<any>((resolve, reject) => {
    const req = db.transaction('accounts', 'readonly').objectStore('accounts').get(params.id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!existing) throw new Error('Account not found');
  if (params.display_name !== undefined) existing.display_name = params.display_name;
  if (params.avatar_url !== undefined) existing.avatar_url = params.avatar_url;
  if (params.is_primary !== undefined) existing.is_primary = params.is_primary;
  existing.updated_at = now();
  await put('accounts', existing);
}

export async function deleteAccount(id: number): Promise<void> {
  await del('accounts', id);
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

export async function listIdentities(_filter?: { confirmed_only?: boolean; tag?: string } | null): Promise<Identity[]> {
  let identities = await getAll<any>('identities');
  const allLinks = await getAll<IdentityLink>('identity_links');
  const allTags = await getAll<{ identity_id: number; tag: string }>('identity_tags');

  return identities.map(i => ({
    ...i,
    auto_detected: i.auto_detected ?? false,
    confirmed: i.confirmed ?? false,
    links: allLinks.filter(l => l.identity_id === i.id),
    tags: allTags.filter(t => t.identity_id === i.id).map(t => t.tag),
  }));
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
  const db = await openDB();
  const existing = await new Promise<any>((resolve, reject) => {
    const req = db.transaction('identities', 'readonly').objectStore('identities').get(params.id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!existing) throw new Error('Identity not found');
  if (params.display_name !== undefined) existing.display_name = params.display_name;
  if (params.notes !== undefined) existing.notes = params.notes;
  existing.updated_at = now();
  await put('identities', existing);
}

export async function deleteIdentity(id: number): Promise<void> {
  await del('identities', id);
  // Cascade delete links and tags
  const links = await getAllByIndex<IdentityLink>('identity_links', 'identity_id', id);
  for (const link of links) await del('identity_links', link.id);
  const tags = await getAllByIndex<any>('identity_tags', 'identity_id', id);
  for (const tag of tags) await del('identity_tags', tag.id);
}

export async function linkToIdentity(params: {
  identity_id: number;
  platform: string;
  handle: string;
  did?: string;
  mastodon_id?: string;
  instance_url?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  account_id?: number;
}): Promise<void> {
  await add('identity_links', {
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
  });
}

export async function unlinkFromIdentity(linkId: number): Promise<void> {
  await del('identity_links', linkId);
}

export async function confirmIdentity(id: number): Promise<void> {
  const db = await openDB();
  const existing = await new Promise<any>((resolve, reject) => {
    const req = db.transaction('identities', 'readonly').objectStore('identities').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) {
    existing.confirmed = true;
    existing.updated_at = now();
    await put('identities', existing);
  }
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
  const existing = await getAllByIndex<any>('identity_tags', 'identity_id', identityId);
  if (existing.some(t => t.tag === tag)) return;
  await add('identity_tags', { identity_id: identityId, tag });
}

export async function removeTag(identityId: number, tag: string): Promise<void> {
  const all = await getAllByIndex<any>('identity_tags', 'identity_id', identityId);
  const match = all.find(t => t.tag === tag);
  if (match) await del('identity_tags', match.id);
}

// ── Identity detection (JS implementation) ────────────────────────────────

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1M = new Array(len1).fill(false);
  const s2M = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    for (let j = Math.max(0, i - matchWindow); j < Math.min(i + matchWindow + 1, len2); j++) {
      if (s2M[j] || s1[i] !== s2[j]) continue;
      s1M[i] = true; s2M[j] = true; matches++; break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1M[i]) continue;
    while (!s2M[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

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
  // Clear old cache
  const old = await getAllByIndex<any>('follows_cache', 'owner_account_id', ownerAccountId);
  for (const o of old) await del('follows_cache', o.id);
  // Insert new
  for (const f of follows) {
    await add('follows_cache', { ...f, owner_account_id: ownerAccountId, fetched_at: now() });
  }
}

export async function getCachedFollows(ownerAccountId: number): Promise<FollowEntry[]> {
  return getAllByIndex<FollowEntry>('follows_cache', 'owner_account_id', ownerAccountId);
}

// ── Crosspost history ─────────────────────────────────────────────────────

export async function logCrosspost(params: {
  draft_id?: number;
  bluesky_uri?: string;
  bluesky_cid?: string;
  mastodon_uri?: string;
  mastodon_id?: string;
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
  text: string;
  target_accounts: number[];
  media_paths?: string[];
  visibility?: string;
  content_warning?: string;
}): Promise<number> {
  return await add('drafts', {
    ...params,
    is_sent: false,
    created_at: now(),
    updated_at: now(),
  }) as number;
}

export async function listDrafts(): Promise<Draft[]> {
  const all = await getAll<Draft>('drafts');
  return all.filter(d => !d.is_sent).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function deleteDraft(id: number): Promise<void> {
  await del('drafts', id);
}

// ── Mastodon OAuth (browser popup flow) ───────────────────────────────────

export async function startMastodonOAuth(instanceUrl: string): Promise<{
  auth_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}> {
  const instance = instanceUrl.replace(/\/$/, '');
  const redirectUri = `${window.location.origin}/oauth/callback`;

  const resp = await fetch(`${instance}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'CrispDeck',
      redirect_uris: redirectUri,
      scopes: 'read write:statuses write:media write:favourites write:bookmarks',
      website: 'https://github.com/CrispStrobe/CrispDeck',
    }),
  });

  const app = await resp.json();
  const authUrl = `${instance}/oauth/authorize?client_id=${app.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('read write:statuses write:media write:favourites write:bookmarks')}`;

  return {
    auth_url: authUrl,
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: redirectUri,
  };
}

export async function completeMastodonOAuth(params: {
  instance_url: string;
  code: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}): Promise<{ access_token: string }> {
  const instance = params.instance_url.replace(/\/$/, '');
  const resp = await fetch(`${instance}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: params.client_id,
      client_secret: params.client_secret,
      redirect_uri: params.redirect_uri,
      grant_type: 'authorization_code',
      code: params.code,
      scope: 'read write:statuses write:media write:favourites write:bookmarks',
    }),
  });
  const data = await resp.json();
  return { access_token: data.access_token };
}
