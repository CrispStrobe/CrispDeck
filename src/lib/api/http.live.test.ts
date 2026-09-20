import { describe, it, expect } from 'vitest';
import { fetchOk, fetchJson, HttpError } from '../http';

/**
 * Hits the real mastodon.social instance over the network.
 *
 * Gated behind CRISPDECK_LIVE so a slow or unreachable third party cannot turn
 * a pull request red. These are worth having — they are what catches an API
 * changing shape under us — but a required check should report on the code in
 * the change, not on someone else's uptime. The Live APIs workflow runs them
 * nightly and on demand.
 *
 *   CRISPDECK_LIVE=1 npm test -- src/lib/api/http.live.test.ts
 */
const LIVE = !!process.env.CRISPDECK_LIVE;


/**
 * The unit tests for fetchOk stub `fetch`, so they prove the logic but not the
 * premise: that real servers answer a refused write with a non-2xx body that
 * plain `fetch` resolves happily.
 *
 * These hit real endpoints to show exactly that. Read-only — the write calls
 * use a deliberately invalid token, so they are rejected before anything
 * happens.
 */

/** Await a call that must fail, and hand back the HttpError it threw. */
async function failure(run: () => Promise<unknown>): Promise<HttpError> {
  try {
    await run();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return e as HttpError;
  }
  throw new Error('expected the call to fail, but it resolved');
}

const MASTO = 'https://mastodon.social';
const BAD_TOKEN = { Authorization: 'Bearer definitely-not-a-real-token' };

describe.skipIf(!LIVE)('real servers, real statuses', () => {
  it('plain fetch resolves for a rejected write — this is the bug', async () => {
    // Posting a status with a bogus token. If `fetch` threw here, the app's
    // existing try/catch blocks would already have been enough.
    const response = await fetch(`${MASTO}/api/v1/statuses`, {
      method: 'POST',
      headers: { ...BAD_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'crispdeck test — must not post', visibility: 'direct' }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    // No exception was thrown: the surrounding catch never runs, and the code
    // after it reports success.
  }, 30_000);

  it('fetchOk turns that same response into a thrown HttpError', async () => {
    await expect(
      fetchOk(`${MASTO}/api/v1/statuses`, {
        method: 'POST',
        headers: { ...BAD_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'crispdeck test — must not post', visibility: 'direct' }),
      }, 'send message'),
    ).rejects.toBeInstanceOf(HttpError);
  }, 30_000);

  it('carries the real status and the server\'s own explanation', async () => {
    const err = await failure(() => fetchOk(`${MASTO}/api/v1/accounts/1/block`, {
      method: 'POST', headers: BAD_TOKEN,
    }, 'block account'));

    expect(err.status).toBe(401);
    expect(err.message).toContain('block account');
    // Mastodon answers {"error":"The access token is invalid"}.
    expect(err.body.length).toBeGreaterThan(0);
  }, 30_000);

  it('a 404 from a real instance throws rather than returning an empty result', async () => {
    await expect(
      fetchJson(`${MASTO}/api/v1/accounts/lookup?acct=${'x'.repeat(40)}`),
    ).rejects.toBeInstanceOf(HttpError);
  }, 30_000);

  it('still returns the body for a request that genuinely succeeds', async () => {
    const instance = await fetchJson<any>(`${MASTO}/api/v2/instance`);
    expect(instance.domain).toBe('mastodon.social');
  }, 30_000);

  it('never puts a token from the query string into the error', async () => {
    const err = await failure(() => fetchOk(
      `${MASTO}/api/v1/accounts/verify_credentials?access_token=hunter2-not-real`,
    ));

    expect(err.message).not.toContain('hunter2');
  }, 30_000);
});

describe.skipIf(!LIVE)('the Mastodon client surfaces a refused write', () => {
  it('addToList rejects rather than resolving, against a real instance', async () => {
    // End-to-end through the client: bad token -> 401 -> fetchOk -> caller.
    // Before this, the response was dropped and the caller was told the
    // accounts had been added to the list.
    const { MastodonClient } = await import('./mastodon');
    const client = new MastodonClient(MASTO, 'definitely-not-a-real-token');

    await expect(client.addToList('1', ['1'])).rejects.toBeInstanceOf(HttpError);
  }, 30_000);
});
