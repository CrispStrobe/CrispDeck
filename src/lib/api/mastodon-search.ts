import { isMastodonHandle } from '$lib/search-account';
import type { SearchActor } from './bluesky-search';

/** Search the connected instance's account index, including resolved remote accounts. */
export async function searchMastodonAccounts(query: string, instance: string, token: string): Promise<SearchActor[]> {
  if (!instance || !token || /(?:^|\s)[\w-]+:/.test(query)) return [];
  const origin = new URL(instance).origin;
  const params = new URLSearchParams({ q: query.trim(), type: 'accounts', resolve: 'true', limit: '40' });
  const response = await fetch(`${origin}/api/v2/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Mastodon account search failed (${response.status})`);
  const data = await response.json();
  const terms = query.trim().replace(/^@/, '').toLocaleLowerCase().normalize('NFKC').split(/\s+/);
  return (Array.isArray(data.accounts) ? data.accounts : []).flatMap((account: any) => {
    if (typeof account.acct !== 'string' || !account.acct) return [];
    const handle = account.acct.replace(/^@/, '').includes('@') ? account.acct.replace(/^@/, '') : `${account.acct.replace(/^@/, '')}@${new URL(origin).host}`;
    const text = `${account.display_name ?? ''} ${handle}`.toLocaleLowerCase().normalize('NFKC');
    const match = isMastodonHandle(query) ? handle.toLocaleLowerCase() === terms[0] : terms.every(term => text.includes(term));
    if (!match) return [];
    return [{ did: `mastodon:${handle.toLocaleLowerCase()}`, handle, displayName: account.display_name, avatar: account.avatar, platform: 'mastodon' as const }];
  });
}
