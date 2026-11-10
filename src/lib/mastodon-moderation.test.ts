import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMastodonModeration } from './mastodon-moderation';

afterEach(() => vi.unstubAllGlobals());
describe('Mastodon moderation lists', () => {
  it('loads every page with the connected account token', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ id: '1', acct: 'first' }]), { headers: { Link: '<https://example.test/api/v1/blocks?max_id=1>; rel="next"' } })).mockResolvedValueOnce(new Response(JSON.stringify([{ id: '2', acct: 'second' }])));
    vi.stubGlobal('fetch', fetch);
    expect((await listMastodonModeration('https://example.test', 'token', 'blocks')).map(a => a.id)).toEqual(['1', '2']);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
  });
  it('never forwards credentials to a different instance', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[]', { headers: { Link: '<https://evil.test/api/v1/mutes>; rel="next"' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(listMastodonModeration('https://example.test', 'token', 'mutes')).rejects.toThrow('Invalid moderation pagination');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports server failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(listMastodonModeration('https://example.test', 'token', 'blocks')).rejects.toThrow();
  });
});
