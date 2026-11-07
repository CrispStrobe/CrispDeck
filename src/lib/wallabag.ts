/** Wallabag's bookmarklet uses the browser's own sign-in session. */
export function wallabagBookmarklet(instance: string, link: string): string | null {
  try {
    const base = new URL(instance.trim());
    const target = new URL(link);
    if (!['http:', 'https:'].includes(base.protocol) || !['http:', 'https:'].includes(target.protocol) || base.username || base.password) return null;
    base.hash = ''; base.search = '';
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/bookmarklet`;
    base.searchParams.set('url', target.href);
    return base.href;
  } catch { return null; }
}

import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCredentialBackend } from '$lib/db';
import { readString, removeKey, writeString } from '$lib/safe-storage';

interface Session { server: string; clientId: string; clientSecret: string; accessToken: string; refreshToken: string; expiresAt: number }
export interface WallabagCredentials { server: string; clientId: string; clientSecret: string; username: string; password: string }
const browserKey = 'crispdeck-wallabag-session';
let cachedSession: { store: string; value: Session } | null = null;

function serverUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Wallabag server URL');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Wallabag requires HTTPS');
  return url.href.replace(/\/+$/, '');
}
async function storageArgs() {
  const info = await getCredentialBackend();
  return { backend: info.backend, keychain: info.macosKeychain ?? 'login' };
}
async function readSession(): Promise<Session | null> {
  if (isTauri()) {
    const args = await storageArgs();
    const store = JSON.stringify(args);
    if (cachedSession?.store === store) return cachedSession.value;
    const raw = await invoke<string | null>('wallabag_session_get', args);
    const value = raw ? JSON.parse(raw) as Session : null;
    cachedSession = value ? { store, value } : null;
    return value;
  }
  if (cachedSession?.store === 'browser') return cachedSession.value;
  const encrypted = readString(browserKey);
  if (!encrypted) return null;
  const { decrypt } = await import('$lib/browser-db');
  const value = JSON.parse(await decrypt(encrypted)) as Session;
  cachedSession = { store: 'browser', value };
  return value;
}
async function writeSession(session: Session): Promise<void> {
  if (isTauri()) {
    const args = await storageArgs();
    await invoke('wallabag_session_set', { ...args, value: JSON.stringify(session) });
    cachedSession = { store: JSON.stringify(args), value: session };
    return;
  }
  const { encrypt } = await import('$lib/browser-db');
  if (!writeString(browserKey, await encrypt(JSON.stringify(session)))) throw new Error('Could not save Wallabag credentials');
  cachedSession = { store: 'browser', value: session };
}
export async function disconnectWallabag(): Promise<void> {
  cachedSession = null;
  if (isTauri()) return invoke('wallabag_session_delete', await storageArgs());
  removeKey(browserKey);
  if (readString(browserKey)) throw new Error('Could not remove Wallabag credentials');
}
async function request(url: string, init: RequestInit): Promise<Response> {
  const requestFetch = isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : fetch;
  return requestFetch(url, { ...init, redirect: 'error' });
}
async function token(server: string, fields: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const response = await request(`${server}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  if (!response.ok) throw new Error(`Wallabag authentication failed (${response.status})`);
  const value = await response.json();
  if (!value.access_token || !value.refresh_token || !Number.isFinite(Number(value.expires_in))) throw new Error('Wallabag returned an invalid token');
  return value;
}
export async function connectWallabag(credentials: WallabagCredentials): Promise<void> {
  const server = serverUrl(credentials.server);
  const clientId = credentials.clientId.trim();
  const clientSecret = credentials.clientSecret.trim();
  if (!clientId || !clientSecret || !credentials.username.trim() || !credentials.password) throw new Error('Complete all Wallabag fields');
  const result = await token(server, { grant_type: 'password', client_id: clientId, client_secret: clientSecret, username: credentials.username.trim(), password: credentials.password });
  await writeSession({ server, clientId, clientSecret, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 });
}
export async function wallabagConnected(server: string): Promise<boolean> {
  const session = await readSession();
  return !!session && session.server === serverUrl(server);
}
let refreshInFlight: Promise<Session> | undefined;
async function refresh(session: Session): Promise<Session> {
  if (!refreshInFlight) refreshInFlight = (async () => {
    const result = await token(session.server, { grant_type: 'refresh_token', client_id: session.clientId, client_secret: session.clientSecret, refresh_token: session.refreshToken });
    const updated = { ...session, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 };
    await writeSession(updated);
    return updated;
  })().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}
export async function saveToWallabag(server: string, link: string): Promise<void> {
  const target = new URL(link);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid article URL');
  let session = await readSession();
  if (!session || session.server !== serverUrl(server)) throw new Error('Connect Wallabag in Settings first');
  if (session.expiresAt <= Date.now() + 30_000) session = await refresh(session);
  const save = (s: Session) => request(`${s.server}/api/entries.json`, { method: 'POST', headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target.href }) });
  let response = await save(session);
  if (response.status === 401) { session = await refresh(session); response = await save(session); }
  if (!response.ok) throw new Error(`Wallabag could not save the link (${response.status})`);
}
