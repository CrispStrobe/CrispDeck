import type { Account, UnifiedPost } from './types';
import type { SearchActor } from './api/bluesky-search';

export interface SearchReturnState {
  query: string;
  posts: UnifiedPost[];
  actors: SearchActor[];
  accountIdentity: string;
  scrollTop: number;
}
let saved: SearchReturnState | undefined;
export function searchAccountIdentity(accounts: Account[]): string {
  return JSON.stringify(accounts.map(a => [a.id, a.platform, a.handle, a.did, a.instance_url, a.mastodon_id, a.threads_user_id]).sort((a, b) => Number(a[0]) - Number(b[0])));
}
export function saveSearchReturn(state: SearchReturnState): void { saved = state; }
export function getSearchReturn(): SearchReturnState | undefined { return saved; }
export function clearSearchReturn(): void { saved = undefined; }

export function canRestoreSearch(state: SearchReturnState | undefined, scope: string, query: string): boolean {
  return !!state && scope === 'networks' && (!query || query === state.query);
}
