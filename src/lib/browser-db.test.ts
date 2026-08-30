/**
 * Tests for browser-db — data model validation and business logic.
 * Does NOT test IndexedDB operations directly (requires fake-indexeddb).
 * Tests the shapes, defaults, and edge cases of the DB schema.
 */
import { describe, it, expect } from 'vitest';
import type { Account, Identity, Draft } from './types';

/**
 * A row as the DB hands it back: every column present, the unset ones `null`.
 * `Account` declares them `string | null` rather than optional, so a fixture
 * that simply omits them is not the shape any caller actually receives.
 */
function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    platform: 'bluesky',
    handle: 'alice.bsky.social',
    display_name: null,
    avatar_url: null,
    did: null,
    mastodon_id: null,
    threads_user_id: null,
    instance_url: null,
    is_primary: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Account data model', () => {
  it('has all required fields', () => {
    const account = makeAccount({
      display_name: 'Alice',
      avatar_url: 'https://cdn.bsky.social/img/avatar.jpg',
      is_primary: true,
    });
    expect(account.platform).toBe('bluesky');
    expect(account.handle).toBeTruthy();
    expect(account.id).toBe(1);
  });

  it('supports all 3 platforms', () => {
    const platforms = ['bluesky', 'mastodon', 'threads'] as const;
    for (const p of platforms) {
      const acct = makeAccount({ platform: p, handle: `user.${p}` });
      expect(acct.platform).toBe(p);
    }
  });

  it('unset columns come back as null', () => {
    const account = makeAccount({ platform: 'mastodon', handle: '@user@masto.social' });
    expect(account.display_name).toBeNull();
    expect(account.avatar_url).toBeNull();
    expect(account.did).toBeNull();
    expect(account.instance_url).toBeNull();
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
    // Drafts address their targets by account id — there is no `platforms`
    // column; which platform a target posts to comes from its Account row.
    const draft: Draft = {
      id: 1,
      text: 'Hello world!',
      target_accounts: [1, 2],
      media_paths: [],
      visibility: 'public',
      content_warning: null,
      scheduled_at: '2026-06-10T12:00:00Z',
      is_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(draft.target_accounts).toContain(1);
    expect(draft.target_accounts).toContain(2);
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
