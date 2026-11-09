import type { Filters } from './types';
import { readJson, writeJson } from './safe-storage';

const key = 'crispdeck-feed-filter-defaults';
export const factoryFeedFilters: Filters = { searchTerm: '', sortBy: 'newest', hasMedia: false, hideReplies: false, hideReposts: false, minLikes: 0 };
export function loadFeedFilterDefaults(): Filters {
  const value = readJson<Partial<Filters>>(key, {}, value => !!value && typeof value === 'object' && !Array.isArray(value));
  return {
    searchTerm: typeof value.searchTerm === 'string' ? value.searchTerm : '',
    sortBy: (['newest', 'oldest', 'likes', 'reposts', 'engagement'] as const).find(sort => sort === value.sortBy) ?? 'newest',
    hasMedia: value.hasMedia === true, hideReplies: value.hideReplies === true, hideReposts: value.hideReposts === true,
    minLikes: typeof value.minLikes === 'number' && Number.isFinite(value.minLikes) && value.minLikes >= 0 ? value.minLikes : 0,
  };
}
export function saveFeedFilterDefaults(filters: Filters): boolean { return writeJson(key, filters); }
export function resetFeedFilterDefaults(): boolean { return writeJson(key, factoryFeedFilters); }
