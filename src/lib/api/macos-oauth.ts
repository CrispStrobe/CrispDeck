/** Bluesky OAuth without persisting WebCrypto CryptoKey objects in WebKit. */
import type { OAuthClient, OAuthClientMetadataInput, RuntimeImplementation, Session, SessionStore, StateStore } from '@atproto/oauth-client-browser';
import { invoke } from '@tauri-apps/api/core';
import { JoseKey } from '@atproto/jwk-jose';
import { loadOAuthSdk } from './atproto-sdk';
import { readString, removeKey } from '$lib/safe-storage';

export async function createMacOAuthClient(metadata: OAuthClientMetadataInput, backend: 'local' | 'keychain', keychain = 'login'): Promise<OAuthClient> {
  const { OAuthClient } = await loadOAuthSdk();
  // Authorization is completed in the same running app. Never put a CryptoKey
  // into IndexedDB: WKWebView wraps it using its own default keychain.
  const states = new Map<string, { expires: number; value: Parameters<StateStore['set']>[1] }>();
  const stateStore: StateStore = {
    async get(key) {
      const entry = states.get(key);
      if (!entry || entry.expires < Date.now()) { states.delete(key); return undefined; }
      return entry.value;
    },
    async set(key, value) {
      for (const [k, entry] of states) if (entry.expires < Date.now()) states.delete(k);
      states.set(key, { expires: Date.now() + 10 * 60_000, value });
    },
    async del(key) { states.delete(key); },
  };
  // The native store persists tokens and the DPoP JWK according to the user's
  // selected backend. WebKit never serializes CryptoKey objects into IndexedDB.
  const sessions = new Map<string, Session>();
  const pendingSessions = new Map<string, Promise<Session | undefined>>();
  const sessionStore: SessionStore = {
    async get(did) {
      const cached = sessions.get(did);
      if (cached) return cached;
      const pending = pendingSessions.get(did);
      if (pending) return pending;
      const read = (async () => {
        const data = await invoke<string | null>('oauth_session_get', { did, backend, keychain });
        if (!data) return undefined;
        const { dpopKey, ...session } = JSON.parse(data);
        const restored = { ...session, dpopKey: await JoseKey.fromJWK(dpopKey) } as Session;
        sessions.set(did, restored);
        return restored;
      })();
      pendingSessions.set(did, read);
      try { return await read; } finally { pendingSessions.delete(did); }
    },
    async set(did, session) {
      const dpopKey = session.dpopKey.privateJwk;
      if (!dpopKey) throw new Error('Cannot persist the Bluesky signing key');
      await invoke('oauth_session_set', { did, backend, keychain, value: JSON.stringify({ ...session, dpopKey }) });
      sessions.set(did, session);
    },
    async del(did) {
      await invoke('oauth_session_delete', { did, backend, keychain });
      sessions.delete(did);
    },
  };
  const runtimeImplementation: RuntimeImplementation = {
    createKey: (algs) => JoseKey.generate(algs),
    getRandomValues: (length) => crypto.getRandomValues(new Uint8Array(length)),
    async digest(data, { name }) {
      return new Uint8Array(await crypto.subtle.digest(`SHA-${name.slice(3)}`, data));
    },
    requestLock: typeof navigator !== 'undefined' && navigator.locks?.request
      ? (name, fn) => navigator.locks.request(name, { mode: 'exclusive' }, async () => fn())
      : undefined,
  };
  return new OAuthClient({
    clientMetadata: metadata,
    responseMode: 'query',
    handleResolver: 'https://bsky.social',
    runtimeImplementation,
    sessionStore,
    stateStore,
    onDelete(sub) {
      const pointer = '@@atproto/oauth-client-browser(sub)';
      if (readString(pointer) === sub) removeKey(pointer);
    },
  });
}
