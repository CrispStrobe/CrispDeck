import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('$lib/platform', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mock.fetch }));
import { exchangeCodeForToken, exchangeForLongLivedToken, refreshLongLivedToken, ThreadsClient } from './threads';

beforeEach(() => {
  mock.fetch.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Webview request blocked by CORS')));
});
afterEach(() => vi.unstubAllGlobals());

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('Threads native transport', () => {
  it('loads the account feed through native HTTP rather than WKWebView fetch', async () => {
    mock.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: '1' }] }) });
    const posts = await new ThreadsClient('test-token', '123').getOwnPosts(10);
    expect(posts.map(post => post.id)).toEqual(['1']);
    const url = new URL(mock.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1.0/123/threads');
    expect(url.searchParams.get('access_token')).toBe('test-token');
  });

  it('uses native HTTP for the whole create, poll, publish flow', async () => {
    mock.fetch.mockResolvedValueOnce(response({ id: 'container' }))
      .mockResolvedValueOnce(response({ id: 'container', status: 'FINISHED' }))
      .mockResolvedValueOnce(response({ id: 'published' }));
    const result = await new ThreadsClient('test-token', '123').publishText('Hello');
    expect(result.id).toBe('published');
    expect(mock.fetch).toHaveBeenCalledTimes(3);
    const [url, init] = mock.fetch.mock.calls[0];
    expect(url).toBe('https://graph.threads.net/v1.0/123/threads');
    expect(init.method).toBe('POST');
    expect(init.body.get('text')).toBe('Hello');
    expect(init.body.get('access_token')).toBe('test-token');
    expect(mock.fetch.mock.calls[2][1].body.get('creation_id')).toBe('container');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses native HTTP for likes and unlikes', async () => {
    mock.fetch.mockImplementation(async () => response({ success: true }));
    const client = new ThreadsClient('test-token', '123');
    await client.like('post');
    await client.unlike('post');
    expect(mock.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'DELETE']);
    expect(mock.fetch.mock.calls[1][1].body.get('media_id')).toBe('post');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exchanges and refreshes custom-app tokens through native HTTP', async () => {
    mock.fetch.mockResolvedValueOnce(new Response('{"access_token":"short","user_id":9007199254740999}'))
      .mockResolvedValueOnce(response({ access_token: 'long' }))
      .mockResolvedValueOnce(response({ access_token: 'refreshed' }));
    expect(await exchangeCodeForToken('app', 'secret', 'https://app.example/callback', 'code'))
      .toMatchObject({ access_token: 'short', user_id: '9007199254740999' });
    expect((await exchangeForLongLivedToken('secret', 'short')).access_token).toBe('long');
    expect((await refreshLongLivedToken('long')).access_token).toBe('refreshed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
