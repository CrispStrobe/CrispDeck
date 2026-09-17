import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { corsFor, preflight } from '../../api/_lib/cors';

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
