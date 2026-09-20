import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOk, fetchJson, HttpError, safeUrl } from './http';

/**
 * The bug this exists for: `await fetch(...)` resolves for a 401, so a
 * try/catch around it reports success for a request the server refused.
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

function respond(status: number, body = '', ok?: boolean) {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchOk', () => {
  it('returns the response for a 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, 'ok')));
    await expect(fetchOk('https://example.test/x')).resolves.toMatchObject({ status: 200 });
  });

  it('throws on a 401 instead of resolving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(401, '')));
    await expect(fetchOk('https://example.test/x')).rejects.toBeInstanceOf(HttpError);
  });

  it.each([400, 403, 404, 422, 429, 500, 502, 503])('throws on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(status)));
    await expect(fetchOk('https://example.test/x')).rejects.toThrow(String(status));
  });

  it('carries the status for a caller that wants to branch on it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(429, '')));
    const err = await failure(() => fetchOk('https://example.test/x'));
    expect(err.status).toBe(429);
  });

  it('includes what the caller was doing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(403)));
    await expect(fetchOk('https://example.test/x', {}, 'block account')).rejects.toThrow('block account');
  });

  it('surfaces the server error message from a JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(422, '{"error":"Validation failed: already blocked"}')));
    await expect(fetchOk('https://example.test/x')).rejects.toThrow('already blocked');
  });

  it('falls back to raw text when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(502, '<html>bad gateway</html>')));
    await expect(fetchOk('https://example.test/x')).rejects.toThrow('bad gateway');
  });

  it('does not crash when the body cannot be read', async () => {
    const bad = { ok: false, status: 500, text: async () => { throw new Error('stream closed'); } } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bad));
    await expect(fetchOk('https://example.test/x')).rejects.toThrow('500');
  });

  it('truncates a huge body rather than putting it all in the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(500, 'x'.repeat(10_000))));
    const err = await failure(() => fetchOk('https://example.test/x'));
    expect(err.body.length).toBeLessThanOrEqual(200);
  });

  it('still rejects on a network error, as fetch always did', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchOk('https://example.test/x')).rejects.toThrow('Failed to fetch');
  });
});

describe('fetchJson', () => {
  it('parses the body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, '{"id":"7"}')));
    await expect(fetchJson('https://example.test/x')).resolves.toEqual({ id: '7' });
  });

  it('throws before parsing when the status is bad', async () => {
    // Parsing an error page as JSON would report a SyntaxError instead of 500.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(500, 'not json')));
    await expect(fetchJson('https://example.test/x')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('safeUrl', () => {
  it('drops the query string, which is where tokens travel', () => {
    // These messages reach the in-app log viewer, which users paste into
    // bug reports.
    expect(safeUrl('https://mastodon.social/oauth/token?access_token=secret123'))
      .toBe('https://mastodon.social/oauth/token');
    expect(safeUrl('https://x.test/cb?code=abc&state=def')).toBe('https://x.test/cb');
  });

  it('keeps origin and path so the message still says where it failed', () => {
    expect(safeUrl('https://mastodon.social/api/v1/accounts/1/block'))
      .toBe('https://mastodon.social/api/v1/accounts/1/block');
  });

  it('handles a relative URL', () => {
    expect(safeUrl('/api/push/subscribe?k=v')).toBe('/api/push/subscribe');
  });

  it('never throws on something that is not a URL', () => {
    expect(() => safeUrl('::::')).not.toThrow();
  });

  it('a token in the query never reaches the error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(401, '')));
    const err = await failure(() => fetchOk('https://x.test/api?access_token=hunter2', {}, 'probe'));
    expect(err.message).not.toContain('hunter2');
    expect(err.url).not.toContain('hunter2');
  });
});
