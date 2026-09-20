import { describe, it, expect, beforeAll } from 'vitest';
import { parseAtUri, BLOCK_COLLECTION, unblockActor } from '../bluesky-moderation';

/**
 * Hits the real Bluesky network over the network.
 *
 * Gated behind CRISPDECK_LIVE so a slow or unreachable third party cannot turn
 * a pull request red. These are worth having — they are what catches an API
 * changing shape under us — but a required check should report on the code in
 * the change, not on someone else's uptime. The Live APIs workflow runs them
 * nightly and on demand.
 *
 *   CRISPDECK_LIVE=1 npm test -- src/lib/api/bluesky-moderation.live.test.ts
 */
const LIVE = !!process.env.CRISPDECK_LIVE;


/**
 * Live oracle for the block record this app writes.
 *
 * Block records are public in AT Proto — they live in the author's repo and
 * anyone can list them. That makes it possible to check the record we
 * construct against records real clients actually wrote, rather than against
 * a fixture we wrote ourselves and could have got wrong in the same way twice.
 *
 * This is the check that catches lexicon drift: if Bluesky adds a required
 * field to app.bsky.graph.block, real records grow it and this test says so.
 *
 * Read-only and unauthenticated. No account is blocked or unblocked here.
 */

const PUBLIC_API = 'https://public.api.bsky.app';
/** Long-lived accounts likely to have at least one block record. */
const CANDIDATES = ['bsky.app', 'atproto.com', 'safety.bsky.app'];

async function resolvePds(handle: string): Promise<{ did: string; pds: string }> {
  const r = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
  if (!r.ok) throw new Error(`resolveHandle ${handle}: ${r.status}`);
  const { did } = await r.json();
  const docR = await fetch(`https://plc.directory/${did}`);
  if (!docR.ok) throw new Error(`plc.directory ${did}: ${docR.status}`);
  const doc = await docR.json();
  const pds = doc.service.find((s: any) => s.id === '#atproto_pds')?.serviceEndpoint;
  if (!pds) throw new Error(`no PDS for ${did}`);
  return { did, pds };
}

async function listRecords(pds: string, did: string, collection: string, limit = 5) {
  const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${collection}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`listRecords ${collection}: ${r.status}`);
  return (await r.json()).records ?? [];
}

describe.skipIf(!LIVE)('app.bsky.graph.block, against real records', () => {
  let records: any[] = [];
  let source = '';

  beforeAll(async () => {
    for (const handle of CANDIDATES) {
      try {
        const { did, pds } = await resolvePds(handle);
        const found = await listRecords(pds, did, BLOCK_COLLECTION);
        if (found.length) { records = found; source = handle; return; }
      } catch {
        // Try the next candidate; one account moving PDS is not a failure.
      }
    }
  }, 30_000);

  it('found real block records to check against', () => {
    // Explicit rather than skipped: a run that silently checked nothing is
    // indistinguishable from a run that passed.
    expect(records.length, `no block records found on any of ${CANDIDATES.join(', ')}`).toBeGreaterThan(0);
    expect(source).toBeTruthy();
  });

  it('real records carry exactly the fields blockActor writes', () => {
    // blockActor writes { subject, createdAt } and the SDK stamps $type.
    for (const rec of records) {
      expect(Object.keys(rec.value).sort()).toEqual(['$type', 'createdAt', 'subject']);
      expect(rec.value.$type).toBe(BLOCK_COLLECTION);
    }
  });

  it('subject is a DID, not a handle', () => {
    // A handle would look plausible and break silently when it is changed.
    for (const rec of records) expect(rec.value.subject).toMatch(/^did:/);
  });

  it('createdAt is the ISO timestamp format blockActor produces', () => {
    for (const rec of records) {
      expect(Date.parse(rec.value.createdAt)).not.toBeNaN();
    }
  });

  it('parseAtUri splits a real block URI', () => {
    const { repo, collection, rkey } = parseAtUri(records[0].uri);
    expect(collection).toBe(BLOCK_COLLECTION);
    expect(repo).toMatch(/^did:/);
    expect(rkey).toBeTruthy();
    // The record lives in the blocker's repo, not the blocked account's.
    expect(repo).not.toBe(records[0].value.subject);
  });

  it('refuses to delete a real follow record as if it were a block', async () => {
    const { did, pds } = await resolvePds('bsky.app');
    const follows = await listRecords(pds, did, 'app.bsky.graph.follow', 1);
    expect(follows.length).toBeGreaterThan(0);

    const agent: any = { did, app: { bsky: { graph: { block: { delete: () => { throw new Error('must not be called'); } } } } } };
    await expect(unblockActor(agent, follows[0].uri)).rejects.toThrow('not a block record');
  }, 30_000);
});
