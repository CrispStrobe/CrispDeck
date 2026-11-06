// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), config: null as any }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./atproto-sdk', () => ({
  loadOAuthSdk: async () => ({ OAuthClient: class { constructor(config: unknown) { mocks.config = config; } } }),
}));

import { createMacOAuthClient } from './macos-oauth';
import { JoseKey } from '@atproto/jwk-jose';

describe('macOS Bluesky OAuth storage', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.config = null; });

  it('restores a local-only session after recreating the client', async () => {
    let saved = '';
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      expect(args.backend).toBe('local');
      if (command === 'oauth_session_set') saved = args.value;
      if (command === 'oauth_session_get') return saved;
      if (command === 'oauth_session_delete') saved = '';
    });
    await createMacOAuthClient({} as never, 'local');
    const dpopKey = await mocks.config.runtimeImplementation.createKey(['ES256']);
    const session = { tokenSet: { sub: 'did:plc:test' }, authMethod: { method: 'none' }, dpopKey };
    await mocks.config.stateStore.set('state', { verifier: 'verifier' });
    await mocks.config.sessionStore.set('did:plc:test', session);
    expect(await mocks.config.stateStore.get('state')).toEqual({ verifier: 'verifier' });
    expect(await mocks.config.sessionStore.get('did:plc:test')).toBe(session);
    await createMacOAuthClient({} as never, 'local');
    const restored = await mocks.config.sessionStore.get('did:plc:test');
    expect(restored.dpopKey.privateJwk).toEqual(dpopKey.privateJwk);
    expect(restored.tokenSet.sub).toBe('did:plc:test');
    await mocks.config.sessionStore.del('did:plc:test');
    expect(saved).toBe('');
  });

  it('persists a signing key and session through the native keychain commands', async () => {
    let saved = '';
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === 'oauth_session_set') saved = args.value;
      if (command === 'oauth_session_get') return saved;
      if (command === 'oauth_session_delete') saved = '';
    });
    await createMacOAuthClient({} as never, 'keychain');
    const dpopKey = await mocks.config.runtimeImplementation.createKey(['ES256']);
    await mocks.config.sessionStore.set('did:plc:test', { dpopKey, tokenSet: { sub: 'did:plc:test' }, authMethod: { method: 'none' } });
    expect(JSON.parse(saved).dpopKey.d).toBeTruthy();
    await createMacOAuthClient({} as never, 'keychain'); // simulate a restart
    const restored = await mocks.config.sessionStore.get('did:plc:test');
    expect(await mocks.config.sessionStore.get('did:plc:test')).toBe(restored);
    expect(restored.dpopKey.privateJwk).toEqual(dpopKey.privateJwk);
    expect(restored.tokenSet.sub).toBe('did:plc:test');
    const jwt = await restored.dpopKey.createJwt({ alg: 'ES256' }, { sub: 'did:plc:test' });
    const { d, key_ops, ...publicJwk } = dpopKey.privateJwk;
    const publicKey = await JoseKey.fromJWK(publicJwk);
    const verified = await publicKey.verifyJwt(jwt);
    expect(verified.payload.sub).toBe('did:plc:test');
    await mocks.config.sessionStore.del('did:plc:test');
    expect(saved).toBe('');
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual(['oauth_session_set', 'oauth_session_get', 'oauth_session_delete']);
  });
});
