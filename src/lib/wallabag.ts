import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCredentialBackend } from '$lib/db';
import { removeKey, writeString } from '$lib/safe-storage';
import { normalizeWallabagServer, WallabagError, WALLABAG_CONNECTION_CHANGED } from '$lib/wallabag-common';
export { normalizeWallabagServer, WALLABAG_CONNECTION_CHANGED } from '$lib/wallabag-common';

/** Wallabag's bookmarklet uses the browser's own sign-in session. */
export function wallabagBookmarklet(instance: string, link: string): string | null {
  try {
    const base = new URL(instance.trim());
    const target = new URL(link);
    if (!['http:', 'https:'].includes(base.protocol) || !['http:', 'https:'].includes(target.protocol) || base.username || base.password || target.username || target.password) return null;
    base.hash = ''; base.search = '';
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/bookmarklet`;
    base.searchParams.set('url', target.href);
    return base.href;
  } catch { return null; }
}

interface Session {
  server: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** New connections get a distinct identity, including on the same server. */
  connectionId?: string;
}
export interface WallabagCredentials { server: string; clientId: string; clientSecret: string; username: string; password: string }
export interface WallabagEntry {
  id: number;
  title: string;
  url: string;
  /** Empty for list metadata; fetch the entry before displaying its article. */
  content: string;
  is_archived: boolean;
  is_starred: boolean;
  created_at: string;
  reading_time?: number;
  domain_name?: string;
  preview_picture?: string;
  tags: Array<{ id?: number; label: string; slug?: string }>;
}
export interface WallabagEntriesPage { items: WallabagEntry[]; page: number; pages: number; total: number }
export type WallabagEntryFilter = 'unread' | 'archived' | 'starred' | 'all';
export interface WallabagEntriesOptions { filter?: WallabagEntryFilter; page?: number; perPage?: number }

type Store = { kind: 'browser' } | { kind: 'native'; args: { backend: string; keychain: string } };
interface SavedSession { store: Store; session: Session; generation: number }
interface Token { access_token: string; refresh_token: string; expires_in: number }

const browserKey = 'crispdeck-wallabag-session';
const maxSessionBytes = 64 * 1024;
const maxArticleBytes = 5 * 1024 * 1024;
const requestTimeoutMs = 30_000;
let generation = 0;
let sessionQueue: Promise<unknown> = Promise.resolve();
let nativeTransport: Promise<typeof import('@tauri-apps/plugin-http')> | undefined;
const requests = new Set<AbortController>();

const connectionChanged = () => new WallabagError('The Wallabag connection changed. Try again.');

function notifyConnectionChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALLABAG_CONNECTION_CHANGED));
}

/** Only an explicit new connection may replace or rebind saved credentials. */
function changeConnection(): number {
  generation++;
  for (const request of requests) request.abort();
  notifyConnectionChanged();
  return generation;
}

/** Serialize token rotation and persistence, also across tabs when supported. */
function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  const run = () => typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request(browserKey, action)
    : action();
  const pending = sessionQueue.then(run, run);
  sessionQueue = pending.catch(() => undefined);
  return pending;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
}

function bearerToken(value: unknown): value is string {
  return nonemptyString(value) && /^[A-Za-z0-9._~+\/-]+=*$/.test(value);
}

function parseSession(raw: string): Session {
  try {
    if (raw.length > maxSessionBytes) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const session = value as Record<string, unknown>;
    if (!nonemptyString(session.server) || normalizeWallabagServer(session.server) !== session.server ||
        !nonemptyString(session.clientId) || !nonemptyString(session.clientSecret) ||
        !bearerToken(session.accessToken) || !nonemptyString(session.refreshToken) ||
        !Number.isSafeInteger(session.expiresAt) || (session.expiresAt as number) <= 0 ||
        (session.connectionId !== undefined && !nonemptyString(session.connectionId))) throw new Error();
    return {
      server: session.server, clientId: session.clientId, clientSecret: session.clientSecret,
      accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt as number,
      ...(typeof session.connectionId === 'string' ? { connectionId: session.connectionId } : {}),
    };
  } catch {
    // JSON/decryption errors can include part of the secret. Never surface it.
    throw new WallabagError('Saved Wallabag credentials are invalid. Reconnect in Settings.');
  }
}

async function selectedStore(): Promise<Store> {
  if (!isTauri()) return { kind: 'browser' };
  const info = await getCredentialBackend();
  return { kind: 'native', args: { backend: info.backend, keychain: info.macosKeychain ?? 'login' } };
}

async function readSession(store: Store): Promise<Session | null> {
  if (store.kind === 'native') {
    const raw = await invoke<string | null>('wallabag_session_get', store.args);
    return raw ? parseSession(raw) : null;
  }
  try {
    // Read storage every time: another tab may have disconnected or reconnected.
    const encrypted = localStorage.getItem(browserKey);
    if (!encrypted) return null;
    if (encrypted.length > maxSessionBytes * 2) throw new Error();
    const { decrypt } = await import('$lib/browser-db');
    return parseSession(await decrypt(encrypted));
  } catch {
    throw new WallabagError('Could not read saved Wallabag credentials. Check browser storage or reconnect in Settings.');
  }
}

async function writeSession(store: Store, session: Session): Promise<void> {
  const value = JSON.stringify(session);
  if (store.kind === 'native') {
    // Native commands reject a changed backend/keychain. Never silently move
    // credentials to the new selection while a network request is in flight.
    await invoke('wallabag_session_set', { ...store.args, value });
    return;
  }
  const { encrypt } = await import('$lib/browser-db');
  const encrypted = await encrypt(value);
  if (!writeString(browserKey, encrypted)) throw new WallabagError('Could not save Wallabag credentials');
}

export async function disconnectWallabag(): Promise<void> {
  changeConnection();
  await withSessionLock(async () => {
    const store = await selectedStore();
    if (store.kind === 'native') {
      await invoke('wallabag_session_delete', store.args);
    } else {
      try {
        removeKey(browserKey);
        if (localStorage.getItem(browserKey) !== null) throw new Error();
      } catch {
        throw new WallabagError('Could not remove Wallabag credentials. Check browser storage and try again.');
      }
    }
  });
}

/** Keep the deadline active until the response body is consumed or discarded. */
async function request<T>(url: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
  requests.add(controller);
  let response: Response | undefined;
  try {
    const options: RequestInit = { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal };
    if (isTauri()) {
      const { fetch: nativeFetch } = await (nativeTransport ??= import('@tauri-apps/plugin-http').catch(error => {
        nativeTransport = undefined;
        throw error;
      }));
      // Fetch's redirect mode is not forwarded by the native HTTP plugin.
      response = await nativeFetch(url, { ...options, maxRedirections: 0 });
    } else {
      response = await fetch(url, options);
    }
    if (controller.signal.aborted) throw new Error();
    const result = await consume(response, controller.signal);
    if (controller.signal.aborted) throw new Error();
    return result;
  } catch (error) {
    if (timedOut) throw new WallabagError('The Wallabag request timed out. Try again.');
    if (controller.signal.aborted) throw connectionChanged();
    if (error instanceof WallabagError) throw error;
    throw new WallabagError(isTauri()
      ? 'Could not reach Wallabag. Check the server URL and connection.'
      : 'Could not reach Wallabag. Check the server URL, connection, and browser CORS settings.');
  } finally {
    clearTimeout(timeout);
    requests.delete(controller);
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}

async function boundedJson(response: Response, maxBytes: number, message: string, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('Content-Length')) > maxBytes) throw new WallabagError(message);
  const reader = response.body?.getReader();
  if (!reader) throw new WallabagError(message);
  // Cancel a body that stalls after its headers arrive, including transports
  // whose fetch AbortSignal stops only the initial network request.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new WallabagError(message);
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // JSON parser errors can quote remote content, including credentials.
    throw new WallabagError(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function token(server: string, fields: Record<string, string>): Promise<Token> {
  return request(`${server}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }, async (response, signal) => {
    if (!response.ok) throw new WallabagError(`Wallabag authentication failed (${response.status})`, [400, 401, 403].includes(response.status));
    const value = await boundedJson(response, maxSessionBytes, 'Wallabag returned an invalid token', signal);
    if (!record(value)) throw new WallabagError('Wallabag returned an invalid token');
    const expiresIn = typeof value?.expires_in === 'number' || (typeof value?.expires_in === 'string' && /^\d+$/.test(value.expires_in)) ? Number(value.expires_in) : NaN;
    if (!bearerToken(value?.access_token) || !nonemptyString(value?.refresh_token) ||
        !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || !Number.isSafeInteger(Date.now() + expiresIn * 1000) ||
        (value.token_type !== undefined && (typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer'))) {
      throw new WallabagError('Wallabag returned an invalid token');
    }
    return { access_token: value.access_token, refresh_token: value.refresh_token, expires_in: expiresIn };
  });
}

export async function connectWallabag(credentials: WallabagCredentials): Promise<string> {
  const server = normalizeWallabagServer(credentials.server);
  const clientId = credentials.clientId.trim();
  const clientSecret = credentials.clientSecret.trim();
  const username = credentials.username.trim();
  if (![clientId, clientSecret, username, credentials.password].every(nonemptyString)) throw new WallabagError('Complete all Wallabag fields');
  const started = changeConnection();
  return withSessionLock(async () => {
    if (started !== generation) throw connectionChanged();
    const store = await selectedStore();
    if (started !== generation) throw connectionChanged();
    const result = await token(server, { grant_type: 'password', client_id: clientId, client_secret: clientSecret, username, password: credentials.password });
    if (started !== generation) throw connectionChanged();
    await writeSession(store, { server, clientId, clientSecret, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000, connectionId: crypto.randomUUID() });
    if (started !== generation) throw connectionChanged();
    return server;
  });
}

export async function wallabagConnected(server: string): Promise<boolean> {
  let normalized: string;
  try { normalized = normalizeWallabagServer(server); } catch { return false; }
  return withSessionLock(async () => (await readSession(await selectedStore()))?.server === normalized);
}

function assertConnection(saved: SavedSession, current: Session | null): asserts current is Session {
  const expected = saved.session;
  if (saved.generation !== generation || !current || current.server !== expected.server || current.clientId !== expected.clientId ||
      current.clientSecret !== expected.clientSecret || current.connectionId !== expected.connectionId) throw connectionChanged();
}

async function usableSession(saved: SavedSession, afterUnauthorized = false): Promise<SavedSession> {
  return withSessionLock(async () => {
    let current = await readSession(saved.store);
    assertConnection(saved, current);
    // A concurrent save may already have rotated the rejected token. Reuse its
    // replacement instead of submitting an invalidated refresh token twice.
    if (afterUnauthorized ? current.accessToken === saved.session.accessToken : current.expiresAt <= Date.now() + 30_000) {
      const result = await token(current.server, { grant_type: 'refresh_token', client_id: current.clientId, client_secret: current.clientSecret, refresh_token: current.refreshToken });
      const latest = await readSession(saved.store);
      assertConnection(saved, latest);
      if (latest.accessToken !== current.accessToken || latest.refreshToken !== current.refreshToken) return { ...saved, session: latest };
      current = { ...current, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000 };
      await writeSession(saved.store, current);
      assertConnection(saved, current);
    }
    return { ...saved, session: current };
  });
}

async function savedSession(server: string): Promise<SavedSession> {
  const normalized = normalizeWallabagServer(server);
  const started = generation;
  return withSessionLock(async () => {
    if (started !== generation) throw connectionChanged();
    const store = await selectedStore();
    const session = await readSession(store);
    if (started !== generation) throw connectionChanged();
    if (!session || session.server !== normalized) throw new WallabagError('Connect Wallabag in Settings first');
    return { store, session, generation: started };
  });
}

/** A response from an old account must never become the current article list. */
async function assertSavedSessionCurrent(saved: SavedSession): Promise<void> {
  await withSessionLock(async () => {
    assertConnection(saved, saved.session);
    const currentStore = await selectedStore();
    if (currentStore.kind !== saved.store.kind || (currentStore.kind === 'native' && saved.store.kind === 'native' &&
        (currentStore.args.backend !== saved.store.args.backend || currentStore.args.keychain !== saved.store.args.keychain))) throw connectionChanged();
    assertConnection(saved, await readSession(saved.store));
  });
}

async function authenticatedRequest<T>(server: string, path: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<T> | T, message: string): Promise<T> {
  let saved: SavedSession | undefined;
  try {
    saved = await savedSession(server);
    saved = await usableSession(saved);
    const send = async (value: SavedSession): Promise<{ status: number; data?: T }> => {
      await assertSavedSessionCurrent(value);
      return request(`${value.session.server}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${value.session.accessToken}` },
      }, async (response, signal) => ({ status: response.status, ...(response.ok ? { data: await consume(response, signal) } : {}) }));
    };
    let result = await send(saved);
    if (result.status === 401) {
      saved = await usableSession(saved, true);
      result = await send(saved);
    }
    // Includes changes made by another browser tab or to the native backend.
    await assertSavedSessionCurrent(saved);
    if (result.status < 200 || result.status >= 300) throw new WallabagError(`${message} (${result.status})`, result.status === 401 || result.status === 403);
    return result.data as T;
  } catch (error) {
    if (saved && error instanceof WallabagError && error.authenticationFailed) {
      try {
        await assertSavedSessionCurrent(saved);
        notifyConnectionChanged();
      } catch {
        // A late failure from a replaced account cannot invalidate its successor.
      }
    }
    if (error instanceof WallabagError) throw error;
    throw new WallabagError('Could not access saved Wallabag credentials. Reconnect in Settings.');
  }
}

export async function saveToWallabag(server: string, link: string): Promise<void> {
  let target: URL;
  try {
    target = new URL(link);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
  } catch { throw new WallabagError('Invalid article URL'); }
  await authenticatedRequest(server, '/api/entries.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target.href }),
  }, () => undefined, 'Wallabag could not save the link');
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function entryFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new WallabagError('Wallabag returned an invalid article');
}

function parseEntry(value: unknown): WallabagEntry {
  if (!record(value) || !positiveInteger(value.id) ||
      (value.title != null && typeof value.title !== 'string') ||
      (value.url != null && typeof value.url !== 'string') ||
      (value.content != null && typeof value.content !== 'string')) throw new WallabagError('Wallabag returned an invalid article');
  const tags: WallabagEntry['tags'] = [];
  if (Array.isArray(value.tags)) {
    for (const tag of value.tags) {
      if (typeof tag === 'string') tags.push({ label: tag });
      else if (record(tag) && typeof tag.label === 'string') tags.push({
        label: tag.label,
        ...(positiveInteger(tag.id) ? { id: tag.id } : {}),
        ...(typeof tag.slug === 'string' ? { slug: tag.slug } : {}),
      });
    }
  }
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    url: typeof value.url === 'string' ? value.url : '',
    content: typeof value.content === 'string' ? value.content : '',
    is_archived: entryFlag(value.is_archived),
    is_starred: entryFlag(value.is_starred),
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    ...(typeof value.reading_time === 'number' && Number.isSafeInteger(value.reading_time) && value.reading_time >= 0 ? { reading_time: value.reading_time } : {}),
    ...(typeof value.domain_name === 'string' ? { domain_name: value.domain_name } : {}),
    ...(typeof value.preview_picture === 'string' ? { preview_picture: value.preview_picture } : {}),
    tags,
  };
}

function parseEntriesPage(value: unknown): WallabagEntriesPage {
  if (!record(value) || !record(value._embedded) || !Array.isArray(value._embedded.items) || value._embedded.items.length > 100 ||
      !positiveInteger(value.page) || typeof value.pages !== 'number' || !Number.isSafeInteger(value.pages) || value.pages < 0 ||
      typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0 ||
      (value._embedded.items.length > 0 && (value.page > value.pages || value.total < value._embedded.items.length))) {
    throw new WallabagError('Wallabag returned an invalid article list');
  }
  return { items: value._embedded.items.map(parseEntry), page: value.page, pages: Math.max(1, value.pages), total: value.total };
}

/** Fetch metadata only; individual article content is loaded when opened. */
export async function listWallabagEntries(server: string, options: WallabagEntriesOptions = {}): Promise<WallabagEntriesPage> {
  const { filter = 'unread', page = 1, perPage = 30 } = options;
  if (!positiveInteger(page) || !positiveInteger(perPage) || perPage > 100 || !['unread', 'archived', 'starred', 'all'].includes(filter)) {
    throw new WallabagError('Invalid Wallabag article list options');
  }
  const query = new URLSearchParams({ page: String(page), perPage: String(perPage), sort: 'created', order: 'desc', detail: 'metadata' });
  if (filter === 'unread') query.set('archive', '0');
  if (filter === 'archived') query.set('archive', '1');
  if (filter === 'starred') query.set('starred', '1');
  return authenticatedRequest(server, `/api/entries.json?${query}`, { method: 'GET' }, async (response, signal) =>
    parseEntriesPage(await boundedJson(response, maxArticleBytes, 'Wallabag returned an invalid article list', signal)), 'Wallabag could not load articles');
}

/** A saved token alone is insufficient: the server must accept a reader request. */
export async function validateWallabagConnection(server: string): Promise<boolean> {
  try {
    await listWallabagEntries(server, { filter: 'all', perPage: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function getWallabagEntry(server: string, id: number): Promise<WallabagEntry> {
  if (!positiveInteger(id)) throw new WallabagError('Invalid Wallabag article ID');
  return authenticatedRequest(server, `/api/entries/${id}.json`, { method: 'GET' }, async (response, signal) => {
    const entry = parseEntry(await boundedJson(response, maxArticleBytes, 'Wallabag returned an invalid article', signal));
    if (entry.id !== id) throw new WallabagError('Wallabag returned an invalid article');
    return entry;
  }, 'Wallabag could not load the article');
}

export async function updateWallabagEntry(server: string, id: number, changes: { archive?: boolean; starred?: boolean }): Promise<WallabagEntry> {
  if (!positiveInteger(id)) throw new WallabagError('Invalid Wallabag article ID');
  if (!record(changes) || (changes.archive === undefined && changes.starred === undefined) ||
      (changes.archive !== undefined && typeof changes.archive !== 'boolean') ||
      (changes.starred !== undefined && typeof changes.starred !== 'boolean')) throw new WallabagError('Invalid Wallabag article update');
  // Wallabag expects 0/1; strings such as "false" cast to true on its PHP API.
  const body = {
    ...(changes.archive !== undefined ? { archive: Number(changes.archive) } : {}),
    ...(changes.starred !== undefined ? { starred: Number(changes.starred) } : {}),
  };
  return authenticatedRequest(server, `/api/entries/${id}.json`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, async (response, signal) => {
    const entry = parseEntry(await boundedJson(response, maxArticleBytes, 'Wallabag returned an invalid article', signal));
    if (entry.id !== id) throw new WallabagError('Wallabag returned an invalid article');
    return entry;
  }, 'Wallabag could not update the article');
}
