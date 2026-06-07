/**
 * Bluesky starter pack creator — build and publish starter packs
 * from the user's identity database or manual selection.
 *
 * A starter pack is an `app.bsky.graph.starterpack` record containing:
 * - name, description
 * - list of user DIDs (as an `app.bsky.graph.list` record reference)
 *
 * Flow: create a list → add members → create starterpack record referencing the list.
 */

import type { Agent } from '@atproto/api';

export interface StarterPackDraft {
  name: string;
  description: string;
  members: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
}

/**
 * Create a list record on Bluesky for the starter pack members.
 */
async function createList(agent: Agent, name: string, description: string): Promise<string> {
  const resp = await agent.api.com.atproto.repo.createRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.graph.list',
    record: {
      $type: 'app.bsky.graph.list',
      purpose: 'app.bsky.graph.defs#curatelist',
      name,
      description,
      createdAt: new Date().toISOString(),
    },
  });
  return resp.data.uri;
}

/**
 * Add a member to a list.
 */
async function addListMember(agent: Agent, listUri: string, memberDid: string): Promise<void> {
  await agent.api.com.atproto.repo.createRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.graph.listitem',
    record: {
      $type: 'app.bsky.graph.listitem',
      subject: memberDid,
      list: listUri,
      createdAt: new Date().toISOString(),
    },
  });
}

/**
 * Create a starter pack record referencing the list.
 */
async function createStarterPackRecord(
  agent: Agent,
  name: string,
  description: string,
  listUri: string,
): Promise<string> {
  const resp = await agent.api.com.atproto.repo.createRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.graph.starterpack',
    record: {
      $type: 'app.bsky.graph.starterpack',
      name,
      description,
      list: listUri,
      createdAt: new Date().toISOString(),
    },
  });
  return resp.data.uri;
}

/**
 * Full flow: create list → add members → create starter pack.
 * Returns the starter pack URI.
 */
export async function publishStarterPack(agent: Agent, draft: StarterPackDraft): Promise<string> {
  if (!draft.name.trim()) throw new Error('Starter pack name is required');
  if (draft.members.length === 0) throw new Error('At least one member is required');
  if (draft.members.length > 150) throw new Error('Maximum 150 members per starter pack');

  // Create the backing list
  const listUri = await createList(agent, draft.name, draft.description);

  // Add all members (sequential to avoid rate limits)
  for (const member of draft.members) {
    await addListMember(agent, listUri, member.did);
  }

  // Create the starter pack record
  return createStarterPackRecord(agent, draft.name, draft.description, listUri);
}

/**
 * Delete a starter pack (and its backing list).
 */
export async function deleteStarterPack(agent: Agent, starterPackUri: string): Promise<void> {
  const rkey = starterPackUri.split('/').pop()!;
  await agent.api.com.atproto.repo.deleteRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.graph.starterpack',
    rkey,
  });
}
