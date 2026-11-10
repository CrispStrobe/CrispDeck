import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchMastodonAccounts } from './mastodon-search';
import { isMastodonHandle } from '$lib/search-account';

const account = { id: '55', acct: 'BlumeEvolution@sueden.social', display_name: 'Michael Blume', avatar: 'https://sueden.social/avatar.png' };
afterEach(() => vi.unstubAllGlobals());
describe('Mastodon people search', () => {
  it.each(['michael blume', '@BlumeEvolution@sueden.social', 'BlumeEvolution@sueden.social'])('finds the real account for %s', async query => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accounts: [account, { ...account, acct: 'other@elsewhere.social', display_name: 'Michael Else' }] }) });
    vi.stubGlobal('fetch', fetch);
    const actors = await searchMastodonAccounts(query, 'https://mastodon.social', 'secret');
    expect(actors).toMatchObject([{ handle: 'BlumeEvolution@sueden.social', displayName: 'Michael Blume', platform: 'mastodon' }]);
    expect(actors).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get('type')).toBe('accounts');
    expect(new URL(url).searchParams.get('q')).toBe(query);
    expect(new URL(url).searchParams.get('resolve')).toBe('true');
    expect(init.headers.Authorization).toBe('Bearer secret');
  });
  it('keeps local instance accounts fully qualified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accounts: [{ ...account, acct: 'BlumeEvolution' }] }) }));
    expect((await searchMastodonAccounts('michael blume', 'https://sueden.social', 'token'))[0].handle).toBe('BlumeEvolution@sueden.social');
  });
  it('reports a failed account index rather than silently returning zero people', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(searchMastodonAccounts('michael blume', 'https://mastodon.social', 'token')).rejects.toThrow('403');
  });
  it('detects federated handles without mistaking Bluesky handles or names', () => {
    expect(isMastodonHandle('@BlumeEvolution@sueden.social')).toBe(true);
    expect(isMastodonHandle('BlumeEvolution@digitalcourage.social')).toBe(true);
    expect(isMastodonHandle('blumeevolution.sueden.social.ap.brid.gy')).toBe(false);
    expect(isMastodonHandle('michael blume')).toBe(false);
  });
});
