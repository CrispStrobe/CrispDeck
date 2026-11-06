// @vitest-environment node
import { expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: { did: string; value?: string; backend: string }) => {
    if (args.backend !== 'local') throw new Error('Unexpected keychain access');
    if (command === 'oauth_session_set') { storage.set(args.did, args.value!); return; }
    if (command === 'oauth_session_get') return storage.get(args.did) ?? null;
    if (command === 'oauth_session_delete') { storage.delete(args.did); return; }
    throw new Error(`Unexpected native command ${command}`);
  },
}));

import { createMacOAuthClient } from './macos-oauth';
import metadata from '../../../static/client-metadata-native.json';

it('completes authorization and restores the local session after a client restart', async () => {
  const did = 'did:plc:b5ly66nko7iijwy2lktt3ctq';
  const issuer = 'https://oauth.example';
  const tokenSet = { sub: did, iss: issuer, access_token: 'access', refresh_token: 'refresh', token_type: 'DPoP', expires_at: Date.now() + 3_600_000, scope: 'atproto' };
  const server = { issuer, clientMetadata: metadata, authMethod: { method: 'none' }, serverMetadata: {}, exchangeCode: vi.fn(async () => tokenSet), revoke: vi.fn(async () => {}) };
  const configure = (client: any) => {
    client.oauthResolver.resolve = vi.fn(async () => ({
      identityInfo: null,
      metadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint_auth_methods_supported: ['none'], dpop_signing_alg_values_supported: ['ES256'] },
    }));
    client.serverFactory.fromIssuer = vi.fn(async (_issuer, _method, dpopKey) => ({ ...server, dpopKey }));
    client.revoke = vi.fn(async () => {});
  };
  const client = await createMacOAuthClient(metadata as never, 'local');
  configure(client);
  const url = await client.authorize('https://bsky.social');
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  const result = await client.callback(new URLSearchParams({ state: state!, code: 'test-code', iss: issuer }));
  expect(result.session.did).toBe(did);
  expect(storage.has(did)).toBe(true);

  const restarted = await createMacOAuthClient(metadata as never, 'local');
  configure(restarted);
  const restored = await restarted.restore(did);
  expect(restored.did).toBe(did);
});
