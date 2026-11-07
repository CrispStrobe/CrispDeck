import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '$lib/types';

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[], credentials: {} as Record<string, unknown>,
  login: vi.fn(), profile: vi.fn(), restore: vi.fn(),
}));
vi.mock('$lib/db', () => ({
  listAccounts: async () => mocks.accounts,
  getDecryptedCredentials: async () => JSON.stringify(mocks.credentials),
}));
vi.mock('./bluesky-oauth', () => ({
  initBlueskyOAuth: async () => null,
  restoreBlueskyOAuthSession: mocks.restore,
}));
vi.mock('./atproto-sdk', () => ({
  prefetchAtprotoSdk: () => {}, prefetchOAuthSdk: () => {},
  loadAtprotoSdk: async () => ({
    BskyAgent: class {
      private service: string;
      session: { did: string } | undefined;
      api = { app: { bsky: { actor: { getProfile: mocks.profile } } } };
      constructor({ service }: { service: string }) { this.service = service; }
      async login(options: unknown) { this.session = await mocks.login(this.service, options); }
    },
  }),
}));

import { initAllClients, invalidateClientCache } from './client-factory';
import { BlueskyClient } from './bluesky';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const OTHER_DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';
const PDS = 'https://original-pds.example.com';
const OTHER_PDS = 'https://new-handle-owner.example.com';

beforeEach(() => {
  vi.clearAllMocks(); invalidateClientCache();
  mocks.accounts = [{ id: 1, platform: 'bluesky', did: DID, handle: 'reassigned.example.com' } as Account];
  mocks.credentials = { app_password: 'saved-app-password' };
  mocks.login.mockResolvedValue({ did: DID });
  mocks.restore.mockResolvedValue({ status: 'expired' });
  mocks.profile.mockResolvedValue({ data: { did: DID, handle: 'new-handle.example.com' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // The stored handle now belongs to somebody else with their own PDS.
    if (url.includes('resolveHandle')) return new Response(JSON.stringify({ did: OTHER_DID }));
    const expected = url === `https://plc.directory/${DID}`;
    return new Response(JSON.stringify({ id: expected ? DID : OTHER_DID, service: [{
      id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: expected ? PDS : OTHER_PDS,
    }] }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('saved Bluesky account identity', () => {
  it('never sends a saved app password to the new owner of an old handle', async () => {
    const { clients } = await initAllClients();
    expect(mocks.login).toHaveBeenCalledWith(PDS, { identifier: DID, password: 'saved-app-password' });
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`https://plc.directory/${DID}`);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('resolveHandle'))).toBe(false);
    expect(clients.get(1)?.handle).toBe('reassigned.example.com');
  });

  it('does not expose an authenticated client for a different returned DID', async () => {
    mocks.login.mockResolvedValue({ did: OTHER_DID });
    expect((await initAllClients()).clients.has(1)).toBe(false);
  });

  it('requires reconnection for a legacy password account with no saved identity', async () => {
    mocks.accounts[0].did = null;
    expect((await initAllClients()).clients.has(1)).toBe(false);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps degraded public reads tied to the stored OAuth identity', async () => {
    mocks.credentials = { auth_method: 'oauth', did: DID };
    const entry = (await initAllClients()).clients.get(1)!;
    await (entry.client as BlueskyClient).getProfile();
    expect(entry.degraded).toBe(true);
    expect(mocks.profile).toHaveBeenCalledWith({ actor: DID });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('does not send the saved password to a fallback server when DID discovery fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Network unavailable'));
    expect((await initAllClients()).clients.has(1)).toBe(false);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it.each([
    { id: OTHER_DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] },
    { id: DID, service: [] },
    { id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://pds.example.com' }] },
  ])('does not fall back when the DID document cannot establish a safe PDS: %j', async doc => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(doc)));
    expect((await initAllClients()).clients.has(1)).toBe(false);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('can retry DID discovery without caching the failed fallback destination', async () => {
    const client = new BlueskyClient(DID, 'saved-app-password');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(client.login()).rejects.toThrow(/verify.*PDS/);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(client.isAuthenticated()).toBe(false);
    await client.login();
    expect(mocks.login).toHaveBeenCalledWith(PDS, { identifier: DID, password: 'saved-app-password' });
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('retains the default server fallback for an initial handle-based sign-in', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Handle lookup unavailable'));
    await new BlueskyClient('new-user.example.com', 'entered-password').login();
    expect(mocks.login).toHaveBeenCalledWith('https://bsky.social', {
      identifier: 'new-user.example.com', password: 'entered-password',
    });
  });
});
