/**
 * Blocking and muting on Bluesky.
 *
 * These are different things and the app used to conflate them. `blockUser`
 * called muteActor and then said "User blocked."; `unblock` called muteActor
 * too — muting the person the user was trying to stop muting — left the block
 * record in place, and removed the row from the list regardless.
 *
 * The difference matters to someone who is being harassed:
 *
 * - A **mute** is one-directional and private. The other account can still see
 *   your posts, reply to them, quote them, and follow you. You just stop
 *   seeing it.
 * - A **block** is enforced by the server for both parties. They cannot reply,
 *   quote, mention or follow you, and existing follows are severed.
 *
 * Muting is not a weaker block; it is a different feature. Telling someone
 * they are protected when they are only ignoring the problem is the kind of
 * failure that matters most.
 *
 * Muting is a server-side toggle (`muteActor`/`unmuteActor`). Blocking is a
 * *record* in the user's repo — `app.bsky.graph.block` — so it is created and
 * deleted like a post, and the record's URI is what identifies it later. The
 * SDK's Agent has mute/unmute helpers but no block helper (only
 * blockModList for moderation lists), which is most likely how the
 * substitution happened in the first place.
 */

import type { Agent } from '@atproto/api';

/** The collection NSID a block record lives in. */
export const BLOCK_COLLECTION = 'app.bsky.graph.block';

/**
 * Split an AT URI into the repo that holds the record and its record key.
 *
 * at://did:plc:abc123/app.bsky.graph.block/3kxyz → { repo, rkey }
 *
 * The repo is the *blocking* account, not the blocked one: the record lives in
 * the repo of whoever created it. Deleting with the subject's DID as the repo
 * would fail, or worse, be an attempt to write to someone else's repo.
 */
export function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error(`not an AT URI: ${uri}`);
  return { repo: match[1], collection: match[2], rkey: match[3] };
}

/** The DID the agent is acting as, however the session is shaped. */
function actingDid(agent: Agent): string {
  const did = (agent as any).did ?? (agent as any).session?.did ?? (agent as any).assertDid;
  if (!did) throw new Error('not signed in: no DID on the agent');
  return did;
}

/**
 * Block an account. Returns the URI of the block record, which is what
 * unblockActor needs later.
 */
export async function blockActor(agent: Agent, subjectDid: string): Promise<string> {
  if (!subjectDid) throw new Error('blockActor needs a DID');
  const res = await (agent as any).app.bsky.graph.block.create(
    { repo: actingDid(agent) },
    { subject: subjectDid, createdAt: new Date().toISOString() },
  );
  return res.uri;
}

/**
 * Remove a block, given the block record's URI.
 *
 * Takes the URI rather than the blocked account's DID because that is what
 * both callers already hold: a profile view carries it as `viewer.blocking`,
 * and getBlocks returns it on each entry. Looking it up from a DID means
 * paging the whole block list.
 */
export async function unblockActor(agent: Agent, blockUri: string): Promise<void> {
  const { repo, collection, rkey } = parseAtUri(blockUri);
  if (collection !== BLOCK_COLLECTION) {
    // A follow URI passed here would silently delete the follow instead.
    throw new Error(`${blockUri} is not a block record (collection: ${collection})`);
  }
  await (agent as any).app.bsky.graph.block.delete({ repo, rkey });
}

/**
 * Find an existing block record URI for an account, for the case where the
 * caller has a DID but no profile view — paging the block list until it turns
 * up. Returns null when the account is not blocked.
 */
export async function findBlockUri(agent: Agent, subjectDid: string): Promise<string | null> {
  let cursor: string | undefined;
  // Bounded: a runaway cursor must not spin forever against a remote service.
  for (let page = 0; page < 20; page++) {
    const res = await (agent as any).api.app.bsky.graph.getBlocks({ limit: 100, cursor });
    for (const entry of res.data.blocks ?? []) {
      if (entry.did === subjectDid && entry.viewer?.blocking) return entry.viewer.blocking;
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return null;
}

/** Mute an account — private, one-directional, and not a block. */
export async function muteActor(agent: Agent, subjectDid: string): Promise<void> {
  if (!subjectDid) throw new Error('muteActor needs a DID');
  await (agent as any).api.app.bsky.graph.muteActor({ actor: subjectDid });
}

/** Unmute an account. */
export async function unmuteActor(agent: Agent, subjectDid: string): Promise<void> {
  if (!subjectDid) throw new Error('unmuteActor needs a DID');
  await (agent as any).api.app.bsky.graph.unmuteActor({ actor: subjectDid });
}
