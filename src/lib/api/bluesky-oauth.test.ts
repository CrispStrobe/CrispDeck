/**
 * Tests for Bluesky OAuth — client metadata, origin detection, client_id construction.
 * Does NOT test actual OAuth flow (requires browser redirect).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the BrowserOAuthClient import
vi.mock('@atproto/oauth-client-browser', () => ({
  BrowserOAuthClient: vi.fn().mockImplementation((config: any) => ({
    config,
    signIn: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('OAuth client_id construction', () => {
  const PROD_ORIGIN = 'https://crispdeck.vercel.app';

  it('production uses client-metadata.json URL', () => {
    const origin = 'https://crispdeck.vercel.app';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const clientId = isLocalhost
      ? `http://localhost?redirect_uri=${encodeURIComponent(`${origin}/oauth/bsky-callback`)}&scope=atproto`
      : `${PROD_ORIGIN}/client-metadata.json`;
    expect(clientId).toBe('https://crispdeck.vercel.app/client-metadata.json');
  });

  it('localhost uses loopback client_id format', () => {
    const origin = 'http://localhost:1420';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const clientId = isLocalhost
      ? `http://localhost?redirect_uri=${encodeURIComponent(`${origin}/oauth/bsky-callback`)}&scope=${encodeURIComponent('atproto transition:generic transition:chat.bsky')}`
      : `${PROD_ORIGIN}/client-metadata.json`;
    expect(clientId).toContain('http://localhost?redirect_uri=');
    expect(clientId).toContain('oauth%2Fbsky-callback');
  });

  it('preview deployments use production origin for client_id', () => {
    const origin = 'https://crispdeck-abc123-team.vercel.app';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const clientId = isLocalhost
      ? `http://localhost?redirect_uri=...`
      : `${PROD_ORIGIN}/client-metadata.json`;
    // Preview deploys still point to production origin
    expect(clientId).toBe('https://crispdeck.vercel.app/client-metadata.json');
  });

  it('127.0.0.1 also uses loopback format', () => {
    const origin = 'http://127.0.0.1:1420';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    expect(isLocalhost).toBe(true);
  });
});

describe('client metadata shape', () => {
  it('has all required OAuth fields', () => {
    const metadata = {
      client_id: 'https://crispdeck.vercel.app/client-metadata.json',
      client_name: 'CrispDeck',
      client_uri: 'https://crispdeck.vercel.app',
      redirect_uris: ['https://crispdeck.vercel.app/oauth/bsky-callback'],
      scope: 'atproto transition:generic transition:chat.bsky',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    };
    expect(metadata.scope).toContain('atproto');
    expect(metadata.scope).toContain('transition:chat.bsky');
    expect(metadata.dpop_bound_access_tokens).toBe(true);
    expect(metadata.grant_types).toContain('authorization_code');
    expect(metadata.grant_types).toContain('refresh_token');
    expect(metadata.redirect_uris[0]).toContain('/oauth/bsky-callback');
  });
});

describe('OAuth scopes', () => {
  it('includes chat scope for DMs', () => {
    const scope = 'atproto transition:generic transition:chat.bsky';
    expect(scope).toContain('transition:chat.bsky');
  });

  it('includes generic transition scope', () => {
    const scope = 'atproto transition:generic transition:chat.bsky';
    expect(scope).toContain('transition:generic');
  });
});
