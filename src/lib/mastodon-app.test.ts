/**
 * The Mastodon app registration: reused per instance instead of piling up a
 * new "CrispDeck" under the user's authorized apps on every sign-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureMastodonApp,
  mastodonAuthorizeUrl,
  revokeMastodonToken,
  MASTODON_SCOPES,
} from './mastodon-app';

const INSTANCE = 'https://mastodon.example';
const REDIRECT = 'app.vercel.crispdeck://oauth/mastodon';

type Reply = { status: number; body: unknown };

/** fetch stand-in answering by path, recording every call. */
function fakeFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: { path: string; body: any }[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const route = routes[path];
    const reply = Array.isArray(route) ? route.shift() : route;
    if (!reply) throw new Error(`unexpected request to ${path}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const registered = { status: 200, body: { client_id: 'cid', client_secret: 'csec' } };

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('ensureMastodonApp', () => {
  it('registers once, then reuses the saved app while the instance still knows it', async () => {
    const calls = fakeFetch({
      '/api/v1/apps': registered,
      '/oauth/token': { status: 200, body: { access_token: 'app-token' } },
    });

    const first = await ensureMastodonApp(INSTANCE, REDIRECT);
    const second = await ensureMastodonApp(INSTANCE, REDIRECT);

    expect(second).toEqual(first);
    expect(calls.filter((c) => c.path === '/api/v1/apps')).toHaveLength(1);
    // The check uses the client_credentials grant, not a user token.
    expect(calls.find((c) => c.path === '/oauth/token')?.body.grant_type).toBe('client_credentials');
  });

  it('registers again when the instance no longer recognises the saved app', async () => {
    const calls = fakeFetch({
      '/api/v1/apps': [registered, { status: 200, body: { client_id: 'cid2', client_secret: 'csec2' } }],
      '/oauth/token': { status: 401, body: { error: 'invalid_client' } },
    });

    await ensureMastodonApp(INSTANCE, REDIRECT);
    const again = await ensureMastodonApp(INSTANCE, REDIRECT);

    expect(again.client_id).toBe('cid2');
    expect(calls.filter((c) => c.path === '/api/v1/apps')).toHaveLength(2);
  });

  it('keeps the saved app when the check fails for some other reason', async () => {
    // A 503 is not proof the app is gone; re-registering on every hiccup is
    // exactly the pile-up this exists to stop.
    const calls = fakeFetch({
      '/api/v1/apps': registered,
      '/oauth/token': { status: 503, body: {} },
    });

    await ensureMastodonApp(INSTANCE, REDIRECT);
    await ensureMastodonApp(INSTANCE, REDIRECT);

    expect(calls.filter((c) => c.path === '/api/v1/apps')).toHaveLength(1);
  });

  it('registers again when the saved app was made for other permissions', async () => {
    localStorage.setItem('crispdeck-mastodon-apps', JSON.stringify({
      [`${INSTANCE}|${REDIRECT}`]: { client_id: 'old', client_secret: 's', redirect_uri: REDIRECT, scopes: 'read' },
    }));
    const calls = fakeFetch({ '/api/v1/apps': registered });

    const app = await ensureMastodonApp(INSTANCE, REDIRECT);

    expect(app.client_id).toBe('cid');
    expect(calls[0].body.scopes).toBe(MASTODON_SCOPES);
  });

  it('keeps separate registrations per return address', async () => {
    const calls = fakeFetch({
      '/api/v1/apps': [registered, { status: 200, body: { client_id: 'web', client_secret: 'w' } }],
    });

    await ensureMastodonApp(INSTANCE, REDIRECT);
    const web = await ensureMastodonApp(INSTANCE, 'https://crispdeck.vercel.app/oauth/callback');

    expect(web.client_id).toBe('web');
    expect(calls).toHaveLength(2);
  });
});

describe('MASTODON_SCOPES', () => {
  it('covers every kind of write the client makes', () => {
    for (const scope of ['write:follows', 'write:blocks', 'write:mutes', 'write:lists', 'write:filters']) {
      expect(MASTODON_SCOPES.split(' ')).toContain(scope);
    }
  });
});

describe('mastodonAuthorizeUrl', () => {
  it('carries the app, its permissions and the state', () => {
    const url = new URL(mastodonAuthorizeUrl(INSTANCE, {
      client_id: 'cid', client_secret: 'x', redirect_uri: REDIRECT, scopes: MASTODON_SCOPES,
    }, 'st'));
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('scope')).toBe(MASTODON_SCOPES);
    expect(url.searchParams.get('state')).toBe('st');
  });
});

describe('revokeMastodonToken', () => {
  it('revokes the token with the app that issued it', async () => {
    const calls = fakeFetch({ '/oauth/revoke': { status: 200, body: {} } });
    await revokeMastodonToken(`${INSTANCE}/`, { access_token: 't', client_id: 'c', client_secret: 's' });
    expect(calls).toEqual([{ path: '/oauth/revoke', body: { client_id: 'c', client_secret: 's', token: 't' } }]);
  });

  it('does nothing without a token', async () => {
    const calls = fakeFetch({});
    await revokeMastodonToken(INSTANCE, {});
    expect(calls).toHaveLength(0);
  });
});
