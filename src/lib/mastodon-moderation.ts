import { fetchOk } from './http';

export interface MastodonModerationAccount { id: string; acct: string; display_name?: string; avatar?: string }

/** Follow only same-instance pagination links, never forwarding credentials elsewhere. */
export async function listMastodonModeration(instance: string, token: string, kind: 'blocks' | 'mutes'): Promise<MastodonModerationAccount[]> {
  const origin = new URL(instance).origin;
  let url: string | undefined = `${origin}/api/v1/${kind}?limit=80`;
  const seen = new Set<string>();
  const accounts: MastodonModerationAccount[] = [];
  while (url && !seen.has(url)) {
    seen.add(url);
    const response = await fetchOk(url, { headers: { Authorization: `Bearer ${token}` } }, `load ${kind}`);
    accounts.push(...await response.json());
    const link = response.headers.get('link')?.split(',').find(part => /rel="?next"?/i.test(part));
    const next = link?.match(/<([^>]+)>/)?.[1];
    if (!next) break;
    const parsed = new URL(next, origin);
    if (parsed.origin !== origin || parsed.pathname !== `/api/v1/${kind}`) throw new Error('Invalid moderation pagination URL');
    url = parsed.href;
  }
  return accounts;
}
