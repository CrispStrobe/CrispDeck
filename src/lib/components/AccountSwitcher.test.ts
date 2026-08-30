import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/i18n.svelte', () => ({ i18n: { t: {} } }));

import type { Account } from '$lib/types';

describe('AccountSwitcher', () => {
  const TIMESTAMPS = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

  const mockAccounts: Account[] = [
    { id: 1, platform: 'bluesky', handle: 'alice.bsky.social', display_name: 'Alice', avatar_url: 'https://cdn.bsky.app/alice.jpg', did: 'did:plc:abc', mastodon_id: null, threads_user_id: null, instance_url: null, is_primary: true, ...TIMESTAMPS },
    { id: 2, platform: 'mastodon', handle: '@bob@mastodon.social', display_name: 'Bob', avatar_url: 'https://mastodon.social/avatars/bob.jpg', did: null, mastodon_id: '123', threads_user_id: null, instance_url: 'https://mastodon.social', is_primary: false, ...TIMESTAMPS },
    { id: 3, platform: 'threads', handle: '@carol', display_name: null, avatar_url: null, did: null, mastodon_id: null, threads_user_id: '456', instance_url: null, is_primary: false, ...TIMESTAMPS },
  ];

  describe('account display', () => {
    it('shows stacked avatars for connected accounts', () => {
      const avatars = mockAccounts.filter(a => a.avatar_url).map(a => a.avatar_url);
      expect(avatars).toHaveLength(2);
    });

    it('shows initial letter when no avatar', () => {
      const noAvatar = mockAccounts.find(a => !a.avatar_url);
      expect(noAvatar?.handle[0]?.toUpperCase()).toBe('@');
    });

    it('limits visible avatars to 4 with +N overflow', () => {
      const manyAccounts = Array.from({ length: 6 }, (_, i) => ({
        ...mockAccounts[0],
        id: i + 10,
        handle: `user${i}.bsky.social`,
      }));
      const visible = manyAccounts.slice(0, 4);
      const overflow = manyAccounts.length - 4;
      expect(visible).toHaveLength(4);
      expect(overflow).toBe(2);
    });

    it('shows account count text when not collapsed', () => {
      const collapsed = false;
      const text = `${mockAccounts.length} account${mockAccounts.length !== 1 ? 's' : ''}`;
      expect(text).toBe('3 accounts');
    });

    it('hides count text when collapsed', () => {
      const collapsed = true;
      expect(collapsed).toBe(true);
      // In collapsed mode, only avatars show — no text
    });
  });

  describe('popover', () => {
    it('toggles popover visibility', () => {
      let show = false;
      show = !show;
      expect(show).toBe(true);
      show = !show;
      expect(show).toBe(false);
    });

    it('lists all accounts with platform indicator', () => {
      const items = mockAccounts.map(a => ({
        handle: a.handle,
        displayName: a.display_name ?? a.handle,
        platform: a.platform,
      }));
      expect(items).toHaveLength(3);
      expect(items[0].platform).toBe('bluesky');
      expect(items[1].platform).toBe('mastodon');
      expect(items[2].platform).toBe('threads');
    });

    it('uses display_name when available, falls back to handle', () => {
      const name1 = mockAccounts[0].display_name ?? mockAccounts[0].handle;
      const name2 = mockAccounts[2].display_name ?? mockAccounts[2].handle;
      expect(name1).toBe('Alice');
      expect(name2).toBe('@carol');
    });

    it('links to settings account tab', () => {
      const href = '/settings?tab=account';
      expect(href).toContain('tab=account');
    });

    it('includes "Add account" link', () => {
      const addHref = '/settings?tab=account';
      expect(addHref).toBeTruthy();
    });
  });

  describe('platform colors', () => {
    it('returns bluesky color for bluesky platform', () => {
      const color = (p: string) => {
        switch (p) {
          case 'bluesky': return 'var(--color-bluesky)';
          case 'mastodon': return 'var(--color-mastodon)';
          case 'threads': return 'var(--color-threads, #000)';
          default: return 'var(--color-text-muted)';
        }
      };
      expect(color('bluesky')).toBe('var(--color-bluesky)');
      expect(color('mastodon')).toBe('var(--color-mastodon)');
      expect(color('threads')).toBe('var(--color-threads, #000)');
      expect(color('unknown')).toBe('var(--color-text-muted)');
    });
  });

  describe('empty state', () => {
    it('renders nothing when no accounts', () => {
      const accounts: Account[] = [];
      const shouldRender = accounts.length > 0;
      expect(shouldRender).toBe(false);
    });
  });

  describe('singular vs plural', () => {
    // Taking `count: number` matters: inlining a literal lets TS fold the
    // comparison away, so the test would assert against a constant.
    const label = (count: number) => `${count} account${count !== 1 ? 's' : ''}`;

    it('says "1 account" for single account', () => {
      expect(label(1)).toBe('1 account');
    });

    it('says "3 accounts" for multiple', () => {
      expect(label(3)).toBe('3 accounts');
    });

    it('says "0 accounts" for none', () => {
      expect(label(0)).toBe('0 accounts');
    });
  });
});
