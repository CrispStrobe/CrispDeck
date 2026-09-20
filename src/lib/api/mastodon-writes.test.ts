import { describe, it, expect, vi, afterEach } from 'vitest';
import { MastodonClient } from './mastodon';
import { HttpError } from '../http';

/**
 * List membership used to fail in two silent ways: `if (!this.accessToken)
 * return;` reported success for a client that was never signed in, and the
 * response was dropped, so an instance answering 403 was reported the same as
 * one that added the accounts.
 */

function client() {
  return new MastodonClient('https://example.test', 'a-token');
}

afterEach(() => vi.unstubAllGlobals());

describe('addToList / removeFromList', () => {
  it('refuses when there is no token instead of returning quietly', async () => {
    const anon = new MastodonClient('https://example.test');
    await expect(anon.addToList('1', ['2'])).rejects.toThrow('Not signed in');
    await expect(anon.removeFromList('1', ['2'])).rejects.toThrow('Not signed in');
  });

  it('throws when the instance refuses the write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => '{"error":"This action is not allowed"}',
    }));
    await expect(client().addToList('1', ['2'])).rejects.toBeInstanceOf(HttpError);
  });

  it('resolves when the instance accepts it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await expect(client().addToList('1', ['2'])).resolves.toBeUndefined();
  });

  it('sends the account ids the caller asked for', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    vi.stubGlobal('fetch', f);
    await client().addToList('42', ['7', '8']);

    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/api/v1/lists/42/accounts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ account_ids: ['7', '8'] });
  });

  it('removes with DELETE, not POST', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    vi.stubGlobal('fetch', f);
    await client().removeFromList('42', ['7']);
    expect(f.mock.calls[0][1].method).toBe('DELETE');
  });
});
