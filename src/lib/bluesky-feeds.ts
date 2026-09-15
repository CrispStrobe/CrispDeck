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
  /**
   * The saved-feed record's own id, which is what removeSavedFeeds takes.
   * Absent for a feed found by search that the account has not saved.
   */
  savedId?: string;
  /** Saved and pinned, saved but unpinned, or not saved at all. */
  pinned?: boolean;
  saved?: boolean;
  description?: string;
  likeCount?: number;
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
  return (await listSavedFeeds(agent)).filter((f) => f.pinned !== false);
}

/**
 * Every feed the account has saved, pinned or not, in saved order.
 *
 * bsky.app distinguishes the two: pinned feeds get a tab, saved ones sit in a
 * list you have to go and open. Showing only the pinned ones, as this did at
 * first, quietly dropped feeds the person had deliberately kept.
 */
export async function listSavedFeeds(agent: Agent): Promise<FeedChoice[]> {
  const prefs: any = await agent.getPreferences();
  const saved: any[] = (prefs?.savedFeeds ?? []).filter((s: any) => s?.value);

  const out: FeedChoice[] = [];
  const feedUris: string[] = [];
  const listUris: string[] = [];

  for (const s of saved) {
    const common = { savedId: s.id, saved: true, pinned: s.pinned !== false };
    if (s.type === 'timeline') {
      out.push({ ...FOLLOWING, ...common });
    } else if (s.type === 'feed') {
      feedUris.push(s.value);
      out.push({
        key: s.value, kind: 'feed', uri: s.value,
        title: nameFromUri(s.value), ...common,
      });
    } else if (s.type === 'list') {
      listUris.push(s.value);
      // A list rkey is a TID, not a slug, so there is nothing readable to
      // derive; 'List' at least says what the entry is.
      out.push({ key: s.value, kind: 'list', uri: s.value, title: 'List', ...common });
    }
  }
  // Following is always reachable, even for an account that has unpinned it.
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
        f.description = g.description;
        f.likeCount = g.likeCount;
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

/**
 * Search the network's public feed generators.
 *
 * Unauthenticated on purpose: this is the public AppView, so the picker can
 * offer discovery before any account is connected, and a search never depends
 * on whose session happens to be live.
 */
export async function searchFeedGenerators(
  query: string,
  limit = 15,
): Promise<FeedChoice[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators' +
    `?query=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`feed search ${res.status}`);
  const data = await res.json();
  return (data.feeds ?? []).map((g: any) => ({
    key: g.uri,
    kind: 'feed' as FeedKind,
    uri: g.uri,
    title: g.displayName || nameFromUri(g.uri),
    byHandle: g.creator?.handle,
    avatar: g.avatar,
    description: g.description,
    likeCount: g.likeCount,
    saved: false,
    pinned: false,
  }));
}

/**
 * Pin a feed or list to the account's saved feeds.
 *
 * Goes through the SDK's addSavedFeeds rather than putPreferences: the
 * preferences document is a single array covering muted words, labelers, adult
 * content settings and more, so writing it wholesale from here would discard
 * everything this app does not know about. addSavedFeeds reads, merges and
 * writes back.
 */
export async function pinFeed(agent: Agent, choice: FeedChoice): Promise<void> {
  if (!choice.uri) return;
  await (agent as any).addSavedFeeds([
    { type: choice.kind === 'list' ? 'list' : 'feed', value: choice.uri, pinned: true },
  ]);
}

/** Remove a saved feed by its saved-feed record id. */
export async function unpinFeed(agent: Agent, savedId: string): Promise<void> {
  await (agent as any).removeSavedFeeds([savedId]);
}
