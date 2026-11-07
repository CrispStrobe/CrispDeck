import { writable } from 'svelte/store';
import { readString } from '$lib/safe-storage';
import { normalizeWallabagServer, validateWallabagConnection, WALLABAG_CONNECTION_CHANGED } from '$lib/wallabag';

export interface WallabagAvailability {
  status: 'hidden' | 'checking' | 'ready';
  server: string;
  /** Changes when an old connection must no longer be displayed. */
  revision: number;
}

let current: WallabagAvailability = { status: 'hidden', server: '', revision: 0 };
const state = writable(current);
// Availability is deliberately never persisted: a saved URL or a previous
// successful connection does not establish that today's credentials work.
export const wallabagAvailability = { subscribe: state.subscribe };

let pending: { server: string; revision: number; promise: Promise<boolean> } | undefined;
let watchers = 0;
let stopWatching: (() => void) | undefined;

function publish(value: WallabagAvailability): void {
  current = value;
  state.set(value);
}

function configuredServer(): string {
  try { return normalizeWallabagServer(readString('crispdeck-wallabag-url')); }
  catch { return ''; }
}

/** Also invalidates in-flight probes and article views, even on the same server. */
export function hideWallabagReader(): void {
  pending = undefined;
  publish({ status: 'hidden', server: '', revision: current.revision + 1 });
}

/** Require both persisted credentials and a successful authenticated reader request. */
export function refreshWallabagAvailability(): Promise<boolean> {
  const server = configuredServer();
  if (!server) {
    hideWallabagReader();
    return Promise.resolve(false);
  }
  if (pending?.server === server && pending.revision === current.revision) return pending.promise;
  if (current.server && current.server !== server) hideWallabagReader();
  const revision = current.revision;
  // A background recheck need not unmount a working article. Any failure or
  // credential change below immediately hides it and drops its data.
  if (current.status !== 'ready') publish({ status: 'checking', server, revision });
  const promise = (async () => {
    let working = false;
    try { working = await validateWallabagConnection(server); }
    catch { /* Credential errors are never copied to logs or persisted state. */ }
    if (revision !== current.revision || configuredServer() !== server) return false;
    if (working) publish({ status: 'ready', server, revision });
    else hideWallabagReader();
    return working;
  })().finally(() => {
    if (pending?.promise === promise) pending = undefined;
  });
  pending = { server, revision, promise };
  return promise;
}

/** One set of listeners for the app shell, with a synchronous mount cleanup. */
export function startWallabagAvailability(): () => void {
  if (typeof window === 'undefined') return () => {};
  watchers++;
  if (watchers === 1) {
    const refresh = () => { void refreshWallabagAvailability(); };
    const changed = () => { hideWallabagReader(); refresh(); };
    const visible = () => { if (!document.hidden) refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === null || [
        'crispdeck-wallabag-url', 'crispdeck-wallabag-session',
        'crispdeck-key', 'crispdeck-salt-v2', 'crispdeck-crypto-v2',
      ].includes(event.key)) changed();
    };
    window.addEventListener(WALLABAG_CONNECTION_CHANGED, hideWallabagReader);
    window.addEventListener('crispdeck:credential-storage-changed', changed);
    window.addEventListener('crispdeck:wallabag-server-changed', changed);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', visible);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', hideWallabagReader);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(visible, 60_000);
    refresh();
    stopWatching = () => {
      clearInterval(interval);
      window.removeEventListener(WALLABAG_CONNECTION_CHANGED, hideWallabagReader);
      window.removeEventListener('crispdeck:credential-storage-changed', changed);
      window.removeEventListener('crispdeck:wallabag-server-changed', changed);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', hideWallabagReader);
      document.removeEventListener('visibilitychange', visible);
      hideWallabagReader();
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--watchers === 0) { stopWatching?.(); stopWatching = undefined; }
  };
}
