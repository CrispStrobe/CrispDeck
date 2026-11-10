import type { Account } from './types';
import type { DeckColumnConfig } from './deck-layouts';

/** Keep cached columns tied to both their configuration and account identities. */
export function deckCacheKey(col: DeckColumnConfig, sourceAccounts: Account[]): string {
  const identities = sourceAccounts.map(a => [a.id, a.platform, a.did, a.mastodon_id, a.threads_user_id, a.instance_url, a.handle]);
  const source = [col.id, col.type, col.platform, col.query, col.accountIds];
  return `deck:v2:${JSON.stringify([source, identities])}`;
}
