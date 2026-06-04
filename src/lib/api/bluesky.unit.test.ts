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

    it('getAgent returns agent (before login, for construction)', () => {
      const client = new BlueskyClient('alice.bsky.social', 'fake-password');
      // getAgent should return the auth agent even before login
      const agent = client.getAgent();
      expect(agent).toBeTruthy();
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
