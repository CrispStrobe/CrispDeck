/**
 * Official Bluesky bookmarks (app.bsky.bookmark.*, shipped with Bluesky 1.108).
 *
 * The installed @atproto/api predates these lexicons, so we call the XRPC
 * endpoints directly via Agent.call() — the PDS proxies app.bsky.* to the
 * appview with the session's auth. Works with OAuth and app-password agents.
 */

import type { Agent } from '@atproto/api';

export interface BlueskyBookmarkView {
  subject: { uri: string; cid: string };
  createdAt?: string;
  /** postView, blockedPost, or notFoundPost — check $type before use */
  item?: { $type?: string; [k: string]: unknown };
}

/** Create a private server-side bookmark for a post */
export async function createBlueskyBookmark(agent: Agent, uri: string, cid: string): Promise<void> {
  await agent.call('app.bsky.bookmark.createBookmark', undefined, { uri, cid }, { encoding: 'application/json' });
}

/** Delete a server-side bookmark */
export async function deleteBlueskyBookmark(agent: Agent, uri: string): Promise<void> {
  await agent.call('app.bsky.bookmark.deleteBookmark', undefined, { uri }, { encoding: 'application/json' });
}

/** Fetch one page of the authenticated user's server-side bookmarks */
export async function getBlueskyBookmarks(
  agent: Agent,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ bookmarks: BlueskyBookmarkView[]; cursor?: string }> {
  const res = await agent.call('app.bsky.bookmark.getBookmarks', {
    limit: opts.limit ?? 100,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  });
  const data = res.data as { bookmarks?: BlueskyBookmarkView[]; cursor?: string };
  return { bookmarks: data.bookmarks ?? [], cursor: data.cursor };
}

/** Fetch all server-side bookmarks (paginated, capped to avoid runaway loops) */
export async function getAllBlueskyBookmarks(agent: Agent, maxPages = 10): Promise<BlueskyBookmarkView[]> {
  const all: BlueskyBookmarkView[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await getBlueskyBookmarks(agent, { limit: 100, cursor });
    all.push(...page.bookmarks);
    if (!page.cursor || page.bookmarks.length === 0) break;
    cursor = page.cursor;
  }
  return all;
}
