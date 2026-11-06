import type { Account, Platform } from './types';
import type { DeckColumnConfig } from './deck-layouts';

/** Empty explicit selections stay empty after an account is removed/imported. */
export function columnAccounts(column: DeckColumnConfig, accounts: Account[]): Account[] {
  return accounts.filter(account => {
    if (column.accountIds !== undefined && !column.accountIds.includes(account.id)) return false;
    if (column.platform && column.platform !== 'all' && column.platform !== account.platform) return false;
    return columnSupportsPlatform(column, account.platform);
  });
}

export function columnSupportsPlatform(column: Pick<DeckColumnConfig, 'type' | 'query'>, platform: Platform): boolean {
  if (['rss', 'drafts', 'scheduled', 'bookmarks'].includes(column.type)) return false;
  if (column.type === 'local' || column.type === 'federated') return platform === 'mastodon';
  if (column.type === 'feed') return platform === 'bluesky';
  if (column.type === 'list') return column.query?.startsWith('at://') ? platform === 'bluesky' : platform === 'mastodon';
  if (column.type === 'threads-search') return platform === 'threads';
  if (platform === 'threads') return ['my-posts', 'search', 'keyword-monitor', 'hashtag', 'user'].includes(column.type);
  return true;
}
