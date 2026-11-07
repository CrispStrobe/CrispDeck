import { describe, expect, it } from 'vitest';
import { deckCacheKey } from './deck-cache';
import type { DeckColumnConfig } from './deck-layouts';
import type { Account } from './types';

describe('deck cache isolation', () => {
  const column = { id: 'one', type: 'timeline', title: 'Timeline' } as DeckColumnConfig;
  const account = { id: 1, platform: 'bluesky', did: 'did:plc:one', handle: 'one.test' } as Account;
  it('changes its key when the account identity or column configuration changes', () => {
    const original = deckCacheKey(column, [account]);
    expect(deckCacheKey(column, [{ ...account, did: 'did:plc:two' }])).not.toBe(original);
    expect(deckCacheKey({ ...column, type: 'mentions' }, [account])).not.toBe(original);
    expect(deckCacheKey(column, [])).not.toBe(original);
  });
});
