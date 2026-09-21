import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { corsFor, preflight, isAllowedRedirect, safeError } from '../../api/_lib/cors';

/**
 * The allowlist is the only thing standing between these endpoints and any
 * page on the web, so it gets tested rather than eyeballed.
 */
const req = (origin?: string) =>
  new Request('https://crispdeck.vercel.app/api/threads/token', {
    headers: origin ? { origin } : {},
  });

describe('CORS allowlist', () => {
  const saved = process.env.ALLOWED_ORIGINS;
  beforeEach(() => { delete process.env.ALLOWED_ORIGINS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = saved;
  });

  it('allows the production origin', () => {
    expect(corsFor(req('https://crispdeck.vercel.app'))['Access-Control-Allow-Origin'])
      .toBe('https://crispdeck.vercel.app');
  });

  it('allows the GitHub Pages mirror, which is why the list exists', () => {
    expect(corsFor(req('https://crispstrobe.github.io'))['Access-Control-Allow-Origin'])
      .toBe('https://crispstrobe.github.io');
  });

  it('allows the Tauri webview origins', () => {
    for (const o of ['tauri://localhost', 'http://tauri.localhost']) {
      expect(corsFor(req(o))['Access-Control-Allow-Origin']).toBe(o);
    }
  });

  it('allows localhost on any port, for the dev server', () => {
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:4173', 'https://localhost']) {
      expect(corsFor(req(o))['Access-Control-Allow-Origin']).toBe(o);
    }
  });

  it('refuses an origin that is not on the list', () => {
    expect(corsFor(req('https://evil.example'))['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('refuses a lookalike that merely ends with an allowed host', () => {
    // A substring check would allow this. It is a different site.
    expect(corsFor(req('https://notcrispdeck.vercel.app'))['Access-Control-Allow-Origin'])
      .toBeUndefined();
    expect(corsFor(req('https://crispstrobe.github.io.evil.example'))['Access-Control-Allow-Origin'])
      .toBeUndefined();
  });

  it('refuses a localhost lookalike', () => {
    expect(corsFor(req('https://localhost.evil.example'))['Access-Control-Allow-Origin'])
      .toBeUndefined();
  });

  it('sends no allow-origin when there is no Origin header', () => {
    // curl, a server, Bluesky polling the feed generator — not a browser
    // cross-origin request, so there is nothing to permit.
    expect(corsFor(req())['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('varies on Origin, so a cache cannot serve one origin its neighbour’s reply', () => {
    expect(corsFor(req('https://crispdeck.vercel.app')).Vary).toBe('Origin');
  });

  it('can be extended by ALLOWED_ORIGINS without a deploy', () => {
    process.env.ALLOWED_ORIGINS = 'https://staging.example, https://other.example/';
    expect(corsFor(req('https://staging.example'))['Access-Control-Allow-Origin'])
      .toBe('https://staging.example');
    // A trailing slash in the env value must not stop it matching.
    expect(corsFor(req('https://other.example'))['Access-Control-Allow-Origin'])
      .toBe('https://other.example');
  });

  it('answers a preflight with 204 and the requested methods', async () => {
    const res = preflight(req('https://crispstrobe.github.io'), 'POST, OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://crispstrobe.github.io');
  });

  it('answers a preflight from a refused origin without permitting it', async () => {
    const res = preflight(req('https://evil.example'), 'POST, OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

/**
 * Where an OAuth redirect may point.
 *
 * `auth-url` built a Threads authorization URL with our client_id and
 * whatever redirect_uri the caller sent; `token` spent a code against whatever
 * redirect_uri it was given, using our client_secret. Neither checked. That
 * left the whole question to Meta's registered-URI list — a control in another
 * company's console, which nothing here can see, test, or notice changing.
 */
describe('OAuth redirect allowlist', () => {
  const saved = process.env.ALLOWED_ORIGINS;
  beforeEach(() => { delete process.env.ALLOWED_ORIGINS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = saved;
  });

  it('accepts a callback on the production origin', () => {
    expect(isAllowedRedirect('https://crispdeck.vercel.app/oauth/threads-callback')).toBe(true);
  });

  it('accepts the GitHub Pages mirror, which is a real second origin', () => {
    expect(isAllowedRedirect('https://crispstrobe.github.io/CrispDeck/oauth/threads-callback'))
      .toBe(true);
  });

  it('accepts localhost on any port, for the dev server', () => {
    expect(isAllowedRedirect('http://localhost:5173/oauth/threads-callback')).toBe(true);
    expect(isAllowedRedirect('http://127.0.0.1:4173/oauth/threads-callback')).toBe(true);
  });

  it('refuses a callback pointing somewhere else entirely', () => {
    expect(isAllowedRedirect('https://attacker.example/steal')).toBe(false);
  });

  it('refuses a lookalike host', () => {
    // The check is on the parsed origin, not a substring, so these cannot
    // sneak past by containing an allowed name.
    expect(isAllowedRedirect('https://crispdeck.vercel.app.attacker.example/x')).toBe(false);
    expect(isAllowedRedirect('https://notcrispdeck.vercel.app/x')).toBe(false);
    expect(isAllowedRedirect('https://crispstrobe.github.io.evil.test/x')).toBe(false);
  });

  it('accepts the origins the desktop webview presents', () => {
    // window.location.origin inside Tauri is one of these, and the settings
    // page builds the redirect_uri from it. An earlier version of this check
    // required https and would have broken the desktop Threads sign-in — the
    // allowlist already trusts these, so a second rule could only disagree
    // with it.
    expect(isAllowedRedirect('tauri://localhost/oauth/threads-callback')).toBe(true);
    expect(isAllowedRedirect('http://tauri.localhost/oauth/threads-callback')).toBe(true);
  });

  it('refuses the plain-http twin of an allowed https origin', () => {
    expect(isAllowedRedirect('http://crispdeck.vercel.app/oauth/threads-callback')).toBe(false);
  });

  it('refuses a scheme that is not http at all', () => {
    expect(isAllowedRedirect('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirect('data:text/html,x')).toBe(false);
  });

  it('refuses something that is not a URL', () => {
    expect(isAllowedRedirect('')).toBe(false);
    expect(isAllowedRedirect('/oauth/threads-callback')).toBe(false);
    expect(isAllowedRedirect('not a url')).toBe(false);
  });

  it('honours ALLOWED_ORIGINS, so a new deployment does not need a code change', () => {
    process.env.ALLOWED_ORIGINS = 'https://preview.example';
    expect(isAllowedRedirect('https://preview.example/oauth/threads-callback')).toBe(true);
    expect(isAllowedRedirect('https://other.example/oauth/threads-callback')).toBe(false);
  });
});

/**
 * What an exception is allowed to tell the caller.
 */
describe('safeError', () => {
  let logged: unknown[][] = [];
  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { logged.push(args); });
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not hand the exception text to the caller', () => {
    // The long-lived-token exchange puts the client secret in a query string,
    // so a URL appearing in an error is a secret appearing in a response body.
    const secretish = new Error('fetch failed: https://graph.threads.net/v1.0/access_token?client_secret=SUPERSECRET');
    const message = safeError('Threads token exchange', secretish);

    expect(message).not.toContain('SUPERSECRET');
    expect(message).not.toContain('client_secret');
    expect(message).not.toContain('graph.threads.net');
  });

  it('names what failed, so the message is still worth reading', () => {
    expect(safeError('Threads token exchange', new Error('x'))).toContain('Threads token exchange');
  });

  it('puts the detail in the log instead', () => {
    const e = new Error('the actual cause');
    safeError('Feed generation', e);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(e);
  });

  it('survives something that is not an Error', () => {
    expect(() => safeError('x', { weird: true })).not.toThrow();
    expect(() => safeError('x', undefined)).not.toThrow();
  });
});
