/**
 * The app's Mastodon sign-in, end to end over HTTP against a stand-in
 * instance that applies the real instance's rules (see testing/mock-mastodon).
 *
 * The one step not exercised here is the sign-in window itself: the mock's
 * authorize endpoint answers like a user pressing "Authorize", and the test
 * takes the redirect's query the way the Rust side does (oauth-window.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockMastodon, type MockMastodon } from './testing/mock-mastodon';
import { startMastodonOAuth, completeMastodonOAuth } from './browser-db';
import { revokeMastodonToken } from './mastodon-app';
import { MASTODON_APP_REDIRECT, queryOf } from './oauth-window';

let instance: MockMastodon;

beforeEach(async () => {
  localStorage.clear();
  instance = await startMockMastodon();
});
afterEach(() => instance.close());

/** What the sign-in window sees after "Authorize": the redirect target. */
async function authorize(authUrl: string): Promise<string> {
  const resp = await fetch(authUrl, { redirect: 'manual' });
  expect(resp.status).toBe(302);
  return resp.headers.get('location')!;
}

/** Sign in once, the way db.ts and /oauth/callback do it in the app. */
async function signIn() {
  const oauth = await startMastodonOAuth(instance.url, MASTODON_APP_REDIRECT);
  const redirect = await authorize(oauth.auth_url);
  // The window only intercepts navigations that start with the redirect URI.
  expect(redirect.startsWith(oauth.redirect_uri)).toBe(true);
  const params = new URLSearchParams(queryOf(redirect));
  expect(params.get('state')).toBe(oauth.state);
  const { access_token } = await completeMastodonOAuth({
    instance_url: instance.url,
    code: params.get('code')!,
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    redirect_uri: oauth.redirect_uri,
  });
  return { oauth, access_token, code: params.get('code')! };
}

async function verify(accessToken: string): Promise<number> {
  const r = await fetch(`${instance.url}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r.status;
}

describe('Mastodon sign-in against an instance', () => {
  it('registers, authorizes, and gets a token that works', async () => {
    const { access_token } = await signIn();
    expect(await verify(access_token)).toBe(200);
  });

  it('a second sign-in reuses the registration instead of making another app', async () => {
    await signIn();
    await signIn();
    expect(instance.apps.size).toBe(1);
    expect(instance.requests.filter((r) => r === 'POST /api/v1/apps')).toHaveLength(1);
  });

  it('registers afresh when the instance has deleted the saved app', async () => {
    const first = await signIn();
    instance.deleteApp(first.oauth.client_id);
    const second = await signIn();
    expect(second.oauth.client_id).not.toBe(first.oauth.client_id);
    expect(await verify(second.access_token)).toBe(200);
  });

  it('a code cannot be exchanged twice', async () => {
    const { oauth, code } = await signIn();
    await expect(completeMastodonOAuth({
      instance_url: instance.url,
      code,
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      redirect_uri: oauth.redirect_uri,
    })).rejects.toThrow(/400/);
  });

  it('removing the account revokes its token on the instance', async () => {
    const { oauth, access_token } = await signIn();
    await revokeMastodonToken(instance.url, { access_token, client_id: oauth.client_id, client_secret: oauth.client_secret });
    expect(await verify(access_token)).toBe(401);
  });

  it('every scope CrispDeck asks for is one Mastodon knows', async () => {
    // The mock refuses unknown scopes at registration, as the instance does.
    await expect(startMastodonOAuth(instance.url, MASTODON_APP_REDIRECT)).resolves.toBeTruthy();
  });
});
