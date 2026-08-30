/**
 * List management — create/edit/delete Mastodon lists and manage members.
 * Bluesky lists use AT Protocol directly via the agent.
 */

import type { Agent } from '@atproto/api';

// ── Mastodon Lists ───────────────────────────────────────────────────────────

export interface MastodonList {
  id: string;
  title: string;
  replies_policy?: string;
}

export async function getMastodonLists(instanceUrl: string, token: string): Promise<MastodonList[]> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch lists: ${resp.statusText}`);
  return resp.json();
}

export async function createMastodonList(instanceUrl: string, token: string, title: string): Promise<MastodonList> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw new Error(`Failed to create list: ${resp.statusText}`);
  return resp.json();
}

export async function deleteMastodonList(instanceUrl: string, token: string, listId: string): Promise<void> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists/${listId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to delete list: ${resp.statusText}`);
}

export async function renameMastodonList(instanceUrl: string, token: string, listId: string, title: string): Promise<MastodonList> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists/${listId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw new Error(`Failed to rename list: ${resp.statusText}`);
  return resp.json();
}

export async function addToMastodonList(instanceUrl: string, token: string, listId: string, accountIds: string[]): Promise<void> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists/${listId}/accounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_ids: accountIds }),
  });
  if (!resp.ok) throw new Error(`Failed to add to list: ${resp.statusText}`);
}

export async function removeFromMastodonList(instanceUrl: string, token: string, listId: string, accountIds: string[]): Promise<void> {
  const resp = await fetch(`${instanceUrl}/api/v1/lists/${listId}/accounts`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_ids: accountIds }),
  });
  if (!resp.ok) throw new Error(`Failed to remove from list: ${resp.statusText}`);
}

// ── Bluesky Lists ────────────────────────────────────────────────────────────

export async function createBlueskyList(agent: Agent, name: string, description = ''): Promise<string> {
  const resp = await agent.api.com.atproto.repo.createRecord({
    repo: agent.assertDid,
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

export async function deleteBlueskyList(agent: Agent, listUri: string): Promise<void> {
  const rkey = listUri.split('/').pop()!;
  await agent.api.com.atproto.repo.deleteRecord({
    repo: agent.assertDid,
    collection: 'app.bsky.graph.list',
    rkey,
  });
}

export async function addToBlueskyList(agent: Agent, listUri: string, subjectDid: string): Promise<void> {
  await agent.api.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: 'app.bsky.graph.listitem',
    record: {
      $type: 'app.bsky.graph.listitem',
      subject: subjectDid,
      list: listUri,
      createdAt: new Date().toISOString(),
    },
  });
}
