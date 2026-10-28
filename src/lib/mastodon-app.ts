/**
 * The CrispDeck app registration on a Mastodon instance, shared by the web
 * build and the desktop/mobile app.
 *
 * Every sign-in used to POST /api/v1/apps afresh, so each reconnect left one
 * more "CrispDeck" under the user's authorized apps on their instance. The
 * registration is now kept per instance and return address and reused, and
 * only replaced when the instance no longer recognises it or it was made for
 * an older set of permissions.
 */
import { fetchOk, HttpError } from '$lib/http';
import { readJson, writeJson } from '$lib/safe-storage';

/**
 * Everything CrispDeck writes on Mastodon. Every write the client makes needs
 * its scope here — before this list grew, following, blocking, muting, lists,
 * filters, poll votes and dismissing announcements all failed with 403.
 * Changing it re-registers the app on next sign-in; accounts connected with
 * a narrower token keep working for what that token covers.
 */
export const MASTODON_SCOPES = [
  'read',
  'write:statuses',
  'write:media',
  'write:favourites',
  'write:bookmarks',
  'write:follows',
  'write:blocks',
  'write:mutes',
  'write:lists',
  'write:filters',
  'write:accounts',
  'write:notifications',
].join(' ');

export interface MastodonApp {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
}

const APPS_KEY = 'crispdeck-mastodon-apps';

function cacheKey(instance: string, redirectUri: string): string {
  return `${instance}|${redirectUri}`;
}

/**
 * Whether the instance still knows this client. An app token from the
 * client_credentials grant is the documented way to check; a 401 means the
 * app was deleted (or the instance reset). Anything else — a network error,
 * a 5xx — is not proof it is gone, so the saved app is kept.
 */
async function appStillValid(instance: string, app: MastodonApp): Promise<boolean> {
  try {
    await fetchOk(`${instance}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: app.client_id,
        client_secret: app.client_secret,
        redirect_uri: app.redirect_uri,
        grant_type: 'client_credentials',
      }),
    }, 'check app registration');
    return true;
  } catch (e) {
    return !(e instanceof HttpError && (e.status === 400 || e.status === 401));
  }
}

/** The saved registration for this instance and return address, or a new one. */
export async function ensureMastodonApp(instance: string, redirectUri: string): Promise<MastodonApp> {
  const all = readJson<Record<string, MastodonApp>>(APPS_KEY, {});
  const key = cacheKey(instance, redirectUri);
  const saved = all[key];
  if (saved && saved.scopes === MASTODON_SCOPES && (await appStillValid(instance, saved))) {
    return saved;
  }

  const resp = await fetchOk(`${instance}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'CrispDeck',
      redirect_uris: redirectUri,
      scopes: MASTODON_SCOPES,
      website: 'https://github.com/CrispStrobe/CrispDeck',
    }),
  }, 'register app with instance');
  const reg = await resp.json();
  if (!reg.client_id) throw new Error('Instance registered no client_id');

  const app: MastodonApp = {
    client_id: reg.client_id,
    client_secret: reg.client_secret,
    redirect_uri: redirectUri,
    scopes: MASTODON_SCOPES,
  };
  // Not being able to save it only costs a duplicate registration next time.
  writeJson(APPS_KEY, { ...all, [key]: app });
  return app;
}

export function mastodonAuthorizeUrl(instance: string, app: MastodonApp, state: string): string {
  const params = new URLSearchParams({
    client_id: app.client_id,
    redirect_uri: app.redirect_uri,
    response_type: 'code',
    scope: app.scopes,
    state,
  });
  return `${instance}/oauth/authorize?${params}`;
}

export async function exchangeMastodonCode(params: {
  instance_url: string;
  code: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}): Promise<{ access_token: string }> {
  const instance = params.instance_url.replace(/\/$/, '');
  const resp = await fetchOk(`${instance}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: params.client_id,
      client_secret: params.client_secret,
      redirect_uri: params.redirect_uri,
      grant_type: 'authorization_code',
      code: params.code,
      scope: MASTODON_SCOPES,
    }),
  }, 'exchange authorization code');
  const data = await resp.json();
  // Without this the account is saved with access_token: undefined and every
  // later call fails somewhere far away from the cause.
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Instance returned no access token');
  }
  return { access_token: data.access_token };
}

/**
 * Revoke an account's token when it is removed from CrispDeck, so it does not
 * stay valid on the instance. Best effort: removing the account must not
 * depend on the instance being reachable.
 */
export async function revokeMastodonToken(
  instanceUrl: string,
  creds: { access_token?: string; client_id?: string; client_secret?: string },
): Promise<void> {
  if (!creds.access_token || !creds.client_id) return;
  await fetchOk(`${instanceUrl.replace(/\/$/, '')}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      token: creds.access_token,
    }),
  }, 'revoke token');
}
