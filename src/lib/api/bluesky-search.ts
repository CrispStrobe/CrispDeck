import type { ClientEntry } from '$lib/api/client-factory';
import { BlueskyClient } from '$lib/api/bluesky';
import { normalizePost } from '$lib/api/unified';
import type { UnifiedPost } from '$lib/types';

export interface SearchActor { did: string; handle: string; displayName?: string; avatar?: string; platform?: 'bluesky' | 'mastodon'; sourceAccountId?: number }
/** Search independently so a failed post index does not hide matching people. */
export async function searchBlueskyAccount(entry: ClientEntry, query: string) {
  const client = entry.client as BlueskyClient;
  const plain = !/(?:^|\s)[\w-]+:/.test(query);
  const [postResult, actorResult] = await Promise.allSettled([
    entry.oauthAgent
      ? entry.oauthAgent.api.app.bsky.feed.searchPosts({ q: query, limit: 50 }).then(r => r.data.posts)
      : client.searchPosts(query).then(r => r.posts),
    plain ? client.searchActors(query.replace(/^@/, '')) : Promise.resolve([]),
  ]);
  const terms = query.trim().replace(/^@/, '').toLocaleLowerCase().normalize('NFKC').split(/\s+/);
  const returnedActors: SearchActor[] = actorResult.status === 'fulfilled' ? actorResult.value : [];
  // The provider may return loosely related accounts for a full name. Keep
  // only results containing every word, including matches in the handle.
  const actors = terms.length > 1 ? returnedActors.filter(actor => {
    const text = `${actor.displayName ?? ''} ${actor.handle}`.toLocaleLowerCase().normalize('NFKC');
    return terms.every(term => text.includes(term));
  }) : returnedActors;
  const posts: UnifiedPost[] = postResult.status === 'fulfilled'
    ? postResult.value.map(post => normalizePost({ post, reason: undefined } as any, 'bluesky')) : [];
  // A person's posts need not mention their own name. Include recent posts
  // when the query exactly matches a handle or a name component.
  const term = query.replace(/^@/, '').toLocaleLowerCase();
  const matching = actors.filter(a => {
    const handle = a.handle.toLocaleLowerCase();
    const displayName = a.displayName?.toLocaleLowerCase().trim().replace(/\s+/g, ' ') ?? '';
    const name = term.trim().replace(/\s+/g, ' ');
    return handle === name || handle.split('.')[0] === name || displayName === name ||
      displayName.startsWith(name + ' ') || (!name.includes(' ') && displayName.split(' ').includes(name));
  }).slice(0, 2);
  const feeds = await Promise.allSettled(matching.map(a => client.getAuthorFeed(a.did, undefined, 'posts_no_replies')));
  for (const feed of feeds) if (feed.status === 'fulfilled') posts.push(...feed.value.feed.map(item => normalizePost(item, 'bluesky')));
  return { posts, actors, postFailed: postResult.status === 'rejected', actorFailed: actorResult.status === 'rejected' };
}
