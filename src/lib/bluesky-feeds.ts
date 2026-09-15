/**
 * The set of feeds a Bluesky account can read, taken from the account's own
 * server-side preferences.
 *
 * bsky.app's feed switcher is not a fixed menu — "Discover", "Popular With
 * Friends", "Mutuals" and the rest are ordinary *feed generators*, third-party
 * services that answer `getFeedSkeleton` with a list of post URIs. Which ones
 * a person sees is simply which ones they have saved and pinned, stored in
 * `app.bsky.actor.defs#savedFeedsPrefV2`. So rather than hardcoding a guessed
 * list of at:// URIs that would rot the moment Bluesky renames a feed, we read
 * the account's preferences and show exactly what that account has pinned.
 * Pin a feed in the official app and it appears here on the next load.
 *
 * Nothing here reimplements a ranking algorithm: the ranking happens on the
 * feed generator's own server, and `app.bsky.feed.getFeed` is the public,
 * documented way to ask for its output. The one locally-ranked mode we have,
 * "For You", is our own affinity re-rank of the following timeline and lives
 * in `for-you.ts`.
 */

import type { Agent } from '@atproto/api';

export type FeedKind = 'timeline' | 'feed' | 'list';

export interface FeedChoice {
  /** Stable identity for UI keying and for the view cache. */
  key: string;
  kind: FeedKind;
  /** at:// URI of the generator or list. Absent for the following timeline. */
  uri?: string;
  title: string;
  /** Feed generators only: the account that publishes it. */
  byHandle?: string;
  avatar?: string;
}

export const FOLLOWING: FeedChoice = { key: 'timeline', kind: 'timeline', title: 'Following' };

/**
 * Fallback name for a feed generator whose service did not answer. A
 * generator's rkey is usually a human-chosen slug ("with-friends"), so it
 * titlecases into something recognisable.
 */
function nameFromUri(uri: string): string {
  const tail = uri.split('/').pop() ?? uri;
  return tail.replace(/[-_]+/g, ' ').replace(/(^|\s)(\w)/g, (_, sp, c) => sp + c.toUpperCase());
}

/**
 * Pinned feeds and lists for the signed-in account, in the order the account
 * has them pinned. Always starts with Following, which the preferences record
 * as a saved feed of type 'timeline'.
 *
 * Resolution of display names is best-effort: a feed generator can be offline
 * or deleted while still pinned, and one dead feed must not blank the whole
 * switcher, so unresolved entries fall back to a name derived from the URI.
 */
export async function listPinnedFeeds(agent: Agent): Promise<FeedChoice[]> {
  const prefs: any = await agent.getPreferences();
  const saved: any[] = prefs?.savedFeeds ?? [];
  const pinned = saved.filter((s) => s?.pinned !== false && s?.value);

  const out: FeedChoice[] = [];
  const feedUris: string[] = [];
  const listUris: string[] = [];

  for (const s of pinned) {
    if (s.type === 'timeline') {
      out.push(FOLLOWING);
    } else if (s.type === 'feed') {
      feedUris.push(s.value);
      out.push({ key: s.value, kind: 'feed', uri: s.value, title: nameFromUri(s.value) });
    } else if (s.type === 'list') {
      listUris.push(s.value);
      // A list rkey is a TID, not a slug, so there is nothing readable to
      // derive; 'List' at least says what the entry is.
      out.push({ key: s.value, kind: 'list', uri: s.value, title: 'List' });
    }
  }
  if (!out.some((f) => f.kind === 'timeline')) out.unshift(FOLLOWING);

  const byKey = new Map(out.map((f) => [f.key, f]));

  // One batched call for every generator; getFeedGenerators takes up to 25.
  if (feedUris.length) {
    try {
      const res = await agent.api.app.bsky.feed.getFeedGenerators({ feeds: feedUris.slice(0, 25) });
      for (const g of res.data.feeds ?? []) {
        const f = byKey.get(g.uri);
        if (!f) continue;
        f.title = g.displayName || f.title;
        f.byHandle = g.creator?.handle;
        f.avatar = g.avatar;
      }
    } catch (e) {
      console.error('Could not resolve feed generator names:', e);
    }
  }

  // getList has no batch form, so these go out in parallel and failures are
  // individually survivable.
  await Promise.all(listUris.slice(0, 25).map(async (uri) => {
    try {
      const res = await agent.api.app.bsky.graph.getList({ list: uri, limit: 1 });
      const f = byKey.get(uri);
      if (f) {
        f.title = res.data.list?.name || f.title;
        f.avatar = res.data.list?.avatar;
      }
    } catch { /* a deleted list keeps its URI-derived name */ }
  }));

  return out;
}
