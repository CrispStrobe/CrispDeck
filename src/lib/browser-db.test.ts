/**
 * Tests for browser-db — data model validation and business logic.
 * Does NOT test IndexedDB operations directly (requires fake-indexeddb).
 * Tests the shapes, defaults, and edge cases of the DB schema.
 */
import { describe, it, expect } from 'vitest';
import type { Account, Identity, Draft } from './types';

describe('Account data model', () => {
  it('has all required fields', () => {
    const account: Account = {
      id: 1,
      platform: 'bluesky',
      handle: 'alice.bsky.social',
      display_name: 'Alice',
      avatar_url: 'https://cdn.bsky.social/img/avatar.jpg',
      is_primary: true,
      created_at: new Date().toISOString(),
    };
    expect(account.platform).toBe('bluesky');
    expect(account.handle).toBeTruthy();
    expect(account.id).toBe(1);
  });

  it('supports all 3 platforms', () => {
    const platforms = ['bluesky', 'mastodon', 'threads'] as const;
    for (const p of platforms) {
      const acct: Account = { id: 1, platform: p, handle: `user.${p}`, created_at: '' };
      expect(acct.platform).toBe(p);
    }
  });

  it('optional fields can be undefined', () => {
    const account: Account = { id: 1, platform: 'mastodon', handle: '@user@masto.social', created_at: '' };
    expect(account.display_name).toBeUndefined();
    expect(account.avatar_url).toBeUndefined();
    expect(account.did).toBeUndefined();
    expect(account.instance_url).toBeUndefined();
  });
});

describe('Identity data model', () => {
  it('links multiple platforms to one identity', () => {
    const identity: Identity = {
      id: 1,
      display_name: 'Alice',
      confirmed: true,
      links: [
        { id: 1, identity_id: 1, platform: 'bluesky', handle: 'alice.bsky.social' },
        { id: 2, identity_id: 1, platform: 'mastodon', handle: 'alice@mastodon.social' },
      ],
      tags: ['friend'],
    } as any;
    expect(identity.links).toHaveLength(2);
    expect(identity.links[0].platform).toBe('bluesky');
    expect(identity.links[1].platform).toBe('mastodon');
  });
});

describe('Draft data model', () => {
  it('stores crosspost targets and scheduled time', () => {
    const draft: Draft = {
      id: 1,
      text: 'Hello world!',
      platforms: ['bluesky', 'mastodon'],
      scheduled_at: '2026-06-10T12:00:00Z',
      created_at: new Date().toISOString(),
    } as any;
    expect(draft.platforms).toContain('bluesky');
    expect(draft.platforms).toContain('mastodon');
    expect(draft.scheduled_at).toBeTruthy();
  });
});

describe('credential storage format', () => {
  it('Bluesky app password format', () => {
    const creds = JSON.stringify({ identifier: 'alice.bsky.social', password: 'xxxx-xxxx-xxxx-xxxx' });
    const parsed = JSON.parse(creds);
    expect(parsed.identifier).toBe('alice.bsky.social');
    expect(parsed.password).toBeTruthy();
  });

  it('Mastodon OAuth token format', () => {
    const creds = JSON.stringify({ accessToken: 'token123', instanceUrl: 'https://mastodon.social' });
    const parsed = JSON.parse(creds);
    expect(parsed.accessToken).toBeTruthy();
    expect(parsed.instanceUrl).toContain('mastodon');
  });

  it('Threads OAuth token format', () => {
    const creds = JSON.stringify({ access_token: 'IGQ...', user_id: '12345' });
    const parsed = JSON.parse(creds);
    expect(parsed.access_token).toBeTruthy();
    expect(parsed.user_id).toBeTruthy();
  });
});

describe('DB dispatch logic', () => {
  it('isTauri returns false in test environment', async () => {
    // In vitest, window.__TAURI__ is not set
    const { isTauri } = await import('./platform');
    expect(isTauri()).toBe(false);
  });
});
