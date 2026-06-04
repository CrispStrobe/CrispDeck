/**
 * Tests for PDS resolution — the resolvePdsEndpoint function.
 * Uses live network calls against plc.directory.
 */
import { describe, it, expect } from 'vitest';
import { resolvePdsEndpoint } from './bluesky';

describe('resolvePdsEndpoint', () => {
  it('resolves bsky.app to a PDS endpoint', async () => {
    const pds = await resolvePdsEndpoint('bsky.app');
    expect(pds).toMatch(/^https:\/\//);
  }, 15000);

  it('resolves a did:plc DID', async () => {
    // bsky.app's DID (well-known)
    const pds = await resolvePdsEndpoint('did:plc:z72i7hdynmk6r22z27h6tvur');
    expect(pds).toMatch(/^https:\/\//);
  }, 15000);

  it('returns bsky.social for unknown handles', async () => {
    const pds = await resolvePdsEndpoint('this-handle-definitely-does-not-exist-123456789.bsky.social');
    expect(pds).toBe('https://bsky.social');
  }, 15000);

  it('returns bsky.social for invalid DID', async () => {
    const pds = await resolvePdsEndpoint('did:plc:invaliddddddddd');
    expect(pds).toBe('https://bsky.social');
  }, 15000);

  it('returns bsky.social for empty string', async () => {
    const pds = await resolvePdsEndpoint('');
    expect(pds).toBe('https://bsky.social');
  }, 15000);

  it('handles did:web format gracefully', async () => {
    // Most did:web won't have .well-known/did.json, so should fall back
    const pds = await resolvePdsEndpoint('did:web:example.com');
    expect(pds).toMatch(/^https:\/\//);
  }, 15000);
});
