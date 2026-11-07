import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCredentialBackend } from '$lib/db';
import { writeString } from '$lib/safe-storage';

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
type Store = { kind: 'browser' } | { kind: 'native'; args: { backend: string; keychain: string } };
interface SavedSession { store: Store; session: Session; generation: number }
interface Token { access_token: string; refresh_token: string; expires_in: number }

const browserKey = 'crispdeck-wallabag-session';
const maxSessionBytes = 64 * 1024;
const requestTimeoutMs = 30_000;
let generation = 0;
let sessionQueue: Promise<unknown> = Promise.resolve();
let nativeTransport: Promise<typeof import('@tauri-apps/plugin-http')> | undefined;
const requests = new Set<AbortController>();

class WallabagError extends Error {}
const connectionChanged = () => new WallabagError('The Wallabag connection changed. Try saving the link again.');

/** Only an explicit new connection may replace or rebind saved credentials. */
function changeConnection(): number {
  generation++;
  for (const request of requests) request.abort();
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

export function normalizeWallabagServer(value: string): string {
  try {
    const trimmed = value.trim();
    if (trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error();
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new WallabagError('Wallabag requires HTTPS');
    return url.href.replace(/\/+$/, '');
  } catch (error) {
    if (error instanceof WallabagError) throw error;
    throw new WallabagError('Invalid Wallabag server URL');
  }
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
        localStorage.removeItem(browserKey);
        if (localStorage.getItem(browserKey) !== null) throw new Error();
      } catch {
        throw new WallabagError('Could not remove Wallabag credentials. Check browser storage and try again.');
      }
    }
  });
}

/** Keep the deadline active until the response body is consumed or discarded. */
async function request<T>(url: string, init: RequestInit, consume: (response: Response) => Promise<T> | T): Promise<T> {
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
    return await consume(response);
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

async function token(server: string, fields: Record<string, string>): Promise<Token> {
  return request(`${server}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }, async response => {
    if (!response.ok) throw new WallabagError(`Wallabag authentication failed (${response.status})`);
    const reader = response.body?.getReader();
    if (!reader) throw new WallabagError('Wallabag returned an invalid token');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxSessionBytes) throw new WallabagError('Wallabag returned an invalid token');
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let value: Record<string, unknown>;
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new WallabagError('Wallabag returned an invalid token');
    }
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

export async function saveToWallabag(server: string, link: string): Promise<void> {
  let target: URL;
  try {
    target = new URL(link);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
  } catch { throw new WallabagError('Invalid article URL'); }
  const normalized = normalizeWallabagServer(server);
  let saved = await withSessionLock(async () => {
    const store = await selectedStore();
    const session = await readSession(store);
    if (!session || session.server !== normalized) throw new WallabagError('Connect Wallabag in Settings first');
    return { store, session, generation };
  });
  saved = await usableSession(saved);
  const save = (value: SavedSession) => {
    assertConnection(value, value.session);
    return request(`${value.session.server}/api/entries.json`, { method: 'POST', headers: { Authorization: `Bearer ${value.session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target.href }) }, response => response.status);
  };
  let status = await save(saved);
  if (status === 401) { saved = await usableSession(saved, true); status = await save(saved); }
  if (status < 200 || status >= 300) throw new WallabagError(`Wallabag could not save the link (${status})`);
}
