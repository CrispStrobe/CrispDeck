import { beforeEach, describe, expect, it } from 'vitest';
import { factoryFeedFilters, loadFeedFilterDefaults, resetFeedFilterDefaults, saveFeedFilterDefaults } from './feed-filter-defaults';

describe('feed filter defaults', () => {
  beforeEach(() => localStorage.clear());
  it('persists a chosen default and resets it for a future session', () => {
    const filters = { ...factoryFeedFilters, sortBy: 'likes' as const, hasMedia: true, searchTerm: 'cat', minLikes: 3 };
    expect(saveFeedFilterDefaults(filters)).toBe(true);
    expect(loadFeedFilterDefaults()).toEqual(filters);
    expect(resetFeedFilterDefaults()).toBe(true);
    expect(loadFeedFilterDefaults()).toEqual(factoryFeedFilters);
  });
  it('ignores invalid stored values', () => {
    localStorage.setItem('crispdeck-feed-filter-defaults', JSON.stringify({ sortBy: 'invalid', minLikes: -5, hasMedia: 'yes' }));
    expect(loadFeedFilterDefaults()).toEqual(factoryFeedFilters);
  });
});
