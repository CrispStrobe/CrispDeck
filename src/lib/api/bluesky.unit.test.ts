/**
 * Unit tests for BlueskyClient — constructor, read-only mode, agent access.
 * No network calls (those are in the integration tests).
 */
import { describe, it, expect } from 'vitest';
import { BlueskyClient } from './bluesky';

describe('BlueskyClient', () => {
  describe('constructor', () => {
    it('creates a client with handle', () => {
      const client = new BlueskyClient('alice.bsky.social');
      expect(client.getHandle()).toBe('alice.bsky.social');
    });

    it('read-only client is not authenticated', () => {
      const client = BlueskyClient.readOnly('alice.bsky.social');
      expect(client.isAuthenticated()).toBe(false);
    });

    it('read-only client throws when getting agent', () => {
      const client = BlueskyClient.readOnly('alice.bsky.social');
      expect(() => client.getAgent()).toThrow('No app password configured');
    });
  });

  describe('readOnly factory', () => {
    it('creates a client', () => {
      const client = BlueskyClient.readOnly('test.bsky.social');
      expect(client.getHandle()).toBe('test.bsky.social');
    });

    it('is not authenticated', () => {
      const client = BlueskyClient.readOnly('test.bsky.social');
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('with app password', () => {
    it('starts as not authenticated', () => {
      const client = new BlueskyClient('alice.bsky.social', 'fake-password');
      expect(client.isAuthenticated()).toBe(false);
    });

    it('getAgent returns the auth agent once ready, still before login', async () => {
      const client = new BlueskyClient('alice.bsky.social', 'fake-password');
      await client.ready();
      expect(client.getAgent()).toBeTruthy();
    });

    it('getAgent says the agents are not loaded, not that credentials are missing', () => {
      // The constructor used to build the agent, so the only way getAgent
      // could fail was a missing app password. It can now also be called
      // before the SDK has loaded, and pointing that case at the credentials
      // message would send the reader hunting for a password that is present.
      const client = new BlueskyClient('alice.bsky.social', 'fake-password');
      expect(() => client.getAgent()).toThrow(/await ready\(\)/);
    });
  });

  describe('getHandle', () => {
    it('returns the handle', () => {
      const client = new BlueskyClient('bob.bsky.social', 'pass');
      expect(client.getHandle()).toBe('bob.bsky.social');
    });

    it('handles custom domains', () => {
      const client = new BlueskyClient('alice.example.com');
      expect(client.getHandle()).toBe('alice.example.com');
    });
  });
});
