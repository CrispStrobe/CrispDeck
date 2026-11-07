// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../api/threads/resolve-repost';

const fetchMock = vi.fn();
const request = (url: string) => new Request(`https://crispdeck.vercel.app/api/threads/resolve-repost?${new URLSearchParams({ url })}`);

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

describe('Threads repost resolver network boundary', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/private',
    'https://attacker.example/@user/post/abc',
    'https://threads.com.attacker.example/@user/post/abc',
    'https://threads.com@attacker.example/@user/post/abc',
    'https://attacker@threads.com/@user/post/abc',
    'http://threads.com/@user/post/abc',
    'https://threads.com:8443/@user/post/abc',
    'https://threads.com/redirect?url=http://localhost',
    'file:///etc/passwd',
  ])('rejects %s before making a network request', async (url) => {
    expect((await GET(request(url))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'])('resolves a permalink on %s', async (host) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 301, headers: { location: 'https://www.threads.com/@original/post/XYZ_123?x=1' } }));
    const response = await GET(request(`https://${host}/@reposter/post/abc`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resolved: true, original_url: 'https://www.threads.com/@original/post/XYZ_123?x=1',
      original_author: 'original', original_shortcode: 'XYZ_123',
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://${host}/@reposter/post/abc`, expect.objectContaining({ method: 'HEAD', redirect: 'manual', signal: expect.any(AbortSignal) }));
  });

  it('resolves relative redirect locations', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: '/@original/post/xyz' } }));
    expect(await (await GET(request('https://threads.com/@reposter/post/abc'))).json()).toMatchObject({ resolved: true, original_author: 'original' });
  });

  it.each(['http://169.254.169.254/latest/meta-data/', 'https://evil.example/threads.com/@original/post/xyz', 'https://threads.com.evil.example/@original/post/xyz'])('does not follow or return an untrusted redirect: %s', async (location) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 301, headers: { location } }));
    expect(await (await GET(request('https://threads.com/@reposter/post/abc'))).json()).toEqual({ resolved: false, original_url: 'https://threads.com/@reposter/post/abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
