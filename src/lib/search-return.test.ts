import { afterEach, describe, expect, it } from 'vitest';
import { clearSearchReturn, getSearchReturn, saveSearchReturn, searchAccountIdentity, canRestoreSearch } from './search-return';
import type { Account } from './types';

afterEach(clearSearchReturn);
describe('search return state', () => {
  it('keeps the search only in memory and can discard it', () => {
    const value = { query: 'Michael Blume', posts: [], actors: [], accountIdentity: 'accounts', scrollTop: 80 };
    saveSearchReturn(value);
    expect(getSearchReturn()).toEqual(value);
    clearSearchReturn();
    expect(getSearchReturn()).toBeUndefined();
  });
  it('restores only compatible network searches', () => {
    const state = { query: 'Michael Blume', posts: [], actors: [], accountIdentity: '', scrollTop: 0 };
    expect(canRestoreSearch(undefined, 'networks', 'other')).toBe(false);
    expect(canRestoreSearch(state, 'local', 'Michael Blume')).toBe(false);
    expect(canRestoreSearch(state, 'networks', 'other')).toBe(false);
    expect(canRestoreSearch(state, 'networks', '')).toBe(true);
    expect(canRestoreSearch(state, 'networks', 'Michael Blume')).toBe(true);
  });
  it('detects account or identity changes independent of account order', () => {
    const a = { id: 1, platform: 'bluesky', handle: 'alice.test', did: 'did:plc:alice' } as Account;
    const b = { id: 2, platform: 'mastodon', handle: 'bob@example.test', instance_url: 'https://example.test' } as Account;
    expect(searchAccountIdentity([a, b])).toBe(searchAccountIdentity([b, a]));
    expect(searchAccountIdentity([a, b])).not.toBe(searchAccountIdentity([a]));
    expect(searchAccountIdentity([a, b])).not.toBe(searchAccountIdentity([{ ...a, did: 'did:plc:other' }, b]));
  });
});
