import { describe, expect, it } from 'vitest';
import { needsAccountAttribution } from './feed-account-attribution';
import type { Account } from './types';

describe('feed account attribution', () => {
  it('shows the source only when multiple accounts share that provider', () => {
    const accounts = [{ platform: 'bluesky' }, { platform: 'mastodon' }, { platform: 'threads' }] as Account[];
    expect(needsAccountAttribution(accounts, 'bluesky')).toBe(false);
    expect(needsAccountAttribution([...accounts, { platform: 'mastodon' } as Account], 'mastodon')).toBe(true);
    expect(needsAccountAttribution([...accounts, { platform: 'mastodon' } as Account], 'bluesky')).toBe(false);
  });
});
