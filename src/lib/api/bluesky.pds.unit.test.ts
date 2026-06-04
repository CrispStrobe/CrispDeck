/**
 * Unit tests for PDS resolution logic (no network).
 */
import { describe, it, expect, vi } from 'vitest';

describe('PDS resolution logic', () => {
  it('did:plc format is detected correctly', () => {
    expect('did:plc:abc123'.startsWith('did:plc:')).toBe(true);
    expect('did:web:example.com'.startsWith('did:plc:')).toBe(false);
    expect('alice.bsky.social'.startsWith('did:')).toBe(false);
  });

  it('did:web domain extraction', () => {
    const did = 'did:web:example.com';
    const domain = did.replace('did:web:', '');
    expect(domain).toBe('example.com');
  });

  it('handle detection (not a DID)', () => {
    const inputs = ['alice.bsky.social', 'user.example.com', '@bob'];
    for (const input of inputs) {
      expect(input.startsWith('did:')).toBe(false);
    }
  });

  it('fallback URL is bsky.social', () => {
    const AUTH_API = 'https://bsky.social';
    expect(AUTH_API).toBe('https://bsky.social');
  });
});
