// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../api/threads/token';

const fetchMock = vi.fn();
const exchange = { action: 'exchange', code: 'authorization-code', redirect_uri: 'https://crispdeck.vercel.app/oauth/threads-callback' };
const request = (body: unknown) => new Request('https://crispdeck.vercel.app/api/threads/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  vi.stubEnv('THREADS_CLIENT_ID', 'app-id');
  vi.stubEnv('THREADS_CLIENT_SECRET', 'secret-must-not-appear-in-errors');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Threads token API', () => {
  it('refreshes through Meta’s refresh endpoint with bounded non-redirecting requests', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'refreshed', expires_in: 5_184_000 }));
    const response = await POST(request({ action: 'refresh', access_token: 'existing' }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).origin + new URL(url).pathname).toBe('https://graph.threads.net/refresh_access_token');
    expect(new URL(url).searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(new URL(url).searchParams.get('access_token')).toBe('existing');
    expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
    expect(await response.json()).toMatchObject({ access_token: 'refreshed', expires_in: 5_184_000 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves numeric user IDs beyond JavaScript integer precision', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"access_token":"short","user_id":9007199254740999}'))
      .mockResolvedValueOnce(json({ access_token: 'long', expires_in: 5_184_000 }));
    const response = await POST(request(exchange));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: 'long', user_id: '9007199254740999', long_lived: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps a valid short-lived token if its upgrade fails on the network', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(json({ access_token: 'short', user_id: '123' }))
      .mockRejectedValueOnce(new Error('Failed https://graph.threads.net/access_token?client_secret=secret-must-not-appear-in-errors'));
    const response = await POST(request(exchange));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: 'short', user_id: '123', long_lived: false, expires_in: 3600 });
    expect(log).not.toHaveBeenCalled();
  });

  it.each([null, {}, { access_token: '' }, { access_token: 'long' }, { access_token: 'long', expires_in: -1 }])('keeps the original token after malformed upgrade response %j', async (upgraded) => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'short', user_id: '123' })).mockResolvedValueOnce(json(upgraded));
    expect(await (await POST(request(exchange))).json()).toMatchObject({ access_token: 'short', long_lived: false });
  });

  it.each([null, {}, { access_token: '' }, { access_token: 'bad', expires_in: -1 }])('does not send invalid refresh data to credential storage %j', async (refreshed) => {
    fetchMock.mockResolvedValue(json(refreshed));
    expect((await POST(request({ action: 'refresh', access_token: 'existing' }))).status).toBe(502);
  });

  it.each([null, [], { action: 'refresh', access_token: {} }, { ...exchange, code: 1 }, { ...exchange, redirect_uri: {} }, { action: {} }])('rejects malformed input before using Meta %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the request body and handles invalid JSON', async () => {
    expect((await POST(request({ ...exchange, code: 'x'.repeat(20_000) }))).status).toBe(413);
    expect((await POST(new Request('https://crispdeck.vercel.app/api/threads/token', { method: 'POST', body: '{invalid' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redacts exception details from both logs and responses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('Failed https://graph.threads.net/refresh_access_token?access_token=TOP-SECRET'));
    const response = await POST(request({ action: 'refresh', access_token: 'TOP-SECRET' }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('TOP-SECRET');
    expect(JSON.stringify(log.mock.calls)).not.toContain('TOP-SECRET');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
