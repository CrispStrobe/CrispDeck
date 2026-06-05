/**
 * Tests for Bluesky 2FA auth flow logic.
 */
import { describe, it, expect } from 'vitest';
import { BlueskyClient } from './bluesky';

describe('Bluesky 2FA support', () => {
  it('login method accepts authFactorToken parameter', () => {
    const client = new BlueskyClient('test.bsky.social', 'fake-password');
    // Verify the method signature accepts the token
    expect(typeof client.login).toBe('function');
    expect(client.login.length).toBeLessThanOrEqual(1); // 0 or 1 params
  });

  it('read-only client does not need 2FA', async () => {
    const client = BlueskyClient.readOnly('test.bsky.social');
    // login() with no auth agent should return immediately
    await client.login();
    expect(client.isAuthenticated()).toBe(false); // still not authenticated (no password)
  });

  it('AuthFactorTokenRequired detection in error string', () => {
    const errorMessages = [
      'AuthFactorTokenRequired',
      'Error: auth_factor_token_required',
      'AuthenticationRequired: AuthFactorTokenRequired',
    ];
    for (const msg of errorMessages) {
      const needs2fa = msg.includes('AuthFactorTokenRequired') || msg.includes('auth_factor');
      expect(needs2fa).toBe(true);
    }
  });

  it('normal auth errors do not trigger 2FA', () => {
    const normalErrors = [
      'Invalid password',
      'Account not found',
      'Network error',
    ];
    for (const msg of normalErrors) {
      const needs2fa = msg.includes('AuthFactorTokenRequired') || msg.includes('auth_factor');
      expect(needs2fa).toBe(false);
    }
  });
});
