import { describe, it, expect, vi } from 'vitest';
import {
  blockActor, unblockActor, findBlockUri, muteActor, unmuteActor,
  parseAtUri, BLOCK_COLLECTION,
} from './bluesky-moderation';

/**
 * The bug these tests exist for: "Block" called muteActor and reported
 * "User blocked.", and "Unblock" called muteActor as well — muting the person
 * the user was trying to unmute — while leaving the block record in place.
 *
 * So the assertions are mostly about *which* call is made, not just that a
 * call happened. A test that only checked "something was awaited" would have
 * passed against the broken code.
 */

function mockAgent(over: Record<string, any> = {}) {
  const create = vi.fn().mockResolvedValue({ uri: 'at://did:plc:me/app.bsky.graph.block/3k1', cid: 'c1' });
  const del = vi.fn().mockResolvedValue(undefined);
  const muteActorFn = vi.fn().mockResolvedValue({ success: true });
  const unmuteActorFn = vi.fn().mockResolvedValue({ success: true });
  const getBlocks = vi.fn().mockResolvedValue({ data: { blocks: [], cursor: undefined } });
  const agent: any = {
    did: 'did:plc:me',
    app: { bsky: { graph: { block: { create, delete: del } } } },
    api: { app: { bsky: { graph: { muteActor: muteActorFn, unmuteActor: unmuteActorFn, getBlocks } } } },
    ...over,
  };
  return { agent, create, del, muteActorFn, unmuteActorFn, getBlocks };
}

describe('blockActor', () => {
  it('creates a block record — it does not mute', async () => {
    const { agent, create, muteActorFn } = mockAgent();
    await blockActor(agent, 'did:plc:them');

    expect(muteActorFn).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('writes the record into the blocking account\'s own repo', async () => {
    // Not the subject's repo: you cannot write to someone else's.
    const { agent, create } = mockAgent();
    await blockActor(agent, 'did:plc:them');

    const [location, record] = create.mock.calls[0];
    expect(location).toEqual({ repo: 'did:plc:me' });
    expect(record.subject).toBe('did:plc:them');
  });

  it('stamps createdAt as an ISO timestamp', async () => {
    const { agent, create } = mockAgent();
    await blockActor(agent, 'did:plc:them');
    const record = create.mock.calls[0][1];
    expect(Date.parse(record.createdAt)).not.toBeNaN();
    expect(record.createdAt).toBe(new Date(record.createdAt).toISOString());
  });

  it('returns the record URI, which is what unblocking needs later', async () => {
    const { agent } = mockAgent();
    await expect(blockActor(agent, 'did:plc:them')).resolves.toBe('at://did:plc:me/app.bsky.graph.block/3k1');
  });

  it('reads the DID from a session-shaped agent too', async () => {
    const { agent, create } = mockAgent({ did: undefined, session: { did: 'did:plc:sess' } });
    await blockActor(agent, 'did:plc:them');
    expect(create.mock.calls[0][0]).toEqual({ repo: 'did:plc:sess' });
  });

  it('refuses when there is no signed-in DID rather than writing somewhere odd', async () => {
    const { agent } = mockAgent({ did: undefined });
    await expect(blockActor(agent, 'did:plc:them')).rejects.toThrow('not signed in');
  });

  it('refuses an empty DID', async () => {
    const { agent } = mockAgent();
    await expect(blockActor(agent, '')).rejects.toThrow('needs a DID');
  });

  it('propagates a server failure instead of reporting success', async () => {
    const { agent } = mockAgent();
    agent.app.bsky.graph.block.create = vi.fn().mockRejectedValue(new Error('upstream 502'));
    await expect(blockActor(agent, 'did:plc:them')).rejects.toThrow('upstream 502');
  });
});

describe('unblockActor', () => {
  it('deletes the block record — it does not mute', async () => {
    const { agent, del, muteActorFn } = mockAgent();
    await unblockActor(agent, 'at://did:plc:me/app.bsky.graph.block/3k1');

    expect(muteActorFn).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ repo: 'did:plc:me', rkey: '3k1' });
  });

  it('refuses a URI that is not a block record', async () => {
    // A follow URI reaching this would otherwise delete the follow: the repo
    // and rkey parse fine, and only the collection says what it really is.
    const { agent, del } = mockAgent();
    await expect(
      unblockActor(agent, 'at://did:plc:me/app.bsky.graph.follow/3k1'),
    ).rejects.toThrow('not a block record');
    expect(del).not.toHaveBeenCalled();
  });

  it('refuses something that is not an AT URI at all', async () => {
    const { agent } = mockAgent();
    await expect(unblockActor(agent, 'did:plc:them')).rejects.toThrow('not an AT URI');
  });
});

describe('findBlockUri', () => {
  it('returns the block URI for an account that is blocked', async () => {
    const { agent } = mockAgent();
    agent.api.app.bsky.graph.getBlocks = vi.fn().mockResolvedValue({
      data: { blocks: [{ did: 'did:plc:them', viewer: { blocking: 'at://did:plc:me/app.bsky.graph.block/3k9' } }] },
    });
    await expect(findBlockUri(agent, 'did:plc:them')).resolves.toBe('at://did:plc:me/app.bsky.graph.block/3k9');
  });

  it('pages until it finds the account', async () => {
    const { agent } = mockAgent();
    const getBlocks = vi.fn()
      .mockResolvedValueOnce({ data: { blocks: [{ did: 'did:plc:other', viewer: {} }], cursor: 'p2' } })
      .mockResolvedValueOnce({ data: { blocks: [{ did: 'did:plc:them', viewer: { blocking: 'at://did:plc:me/app.bsky.graph.block/3kb' } }] } });
    agent.api.app.bsky.graph.getBlocks = getBlocks;

    await expect(findBlockUri(agent, 'did:plc:them')).resolves.toContain('3kb');
    expect(getBlocks).toHaveBeenCalledTimes(2);
    expect(getBlocks.mock.calls[1][0].cursor).toBe('p2');
  });

  it('returns null for an account that is not blocked', async () => {
    const { agent } = mockAgent();
    await expect(findBlockUri(agent, 'did:plc:them')).resolves.toBeNull();
  });

  it('stops rather than following a cursor forever', async () => {
    // A service that always returns a cursor would otherwise spin.
    const { agent } = mockAgent();
    const getBlocks = vi.fn().mockResolvedValue({ data: { blocks: [], cursor: 'always' } });
    agent.api.app.bsky.graph.getBlocks = getBlocks;

    await expect(findBlockUri(agent, 'did:plc:them')).resolves.toBeNull();
    expect(getBlocks.mock.calls.length).toBeLessThanOrEqual(20);
  });
});

describe('mute and unmute stay their own thing', () => {
  it('muteActor mutes and creates no record', async () => {
    const { agent, muteActorFn, create } = mockAgent();
    await muteActor(agent, 'did:plc:them');
    expect(muteActorFn).toHaveBeenCalledWith({ actor: 'did:plc:them' });
    expect(create).not.toHaveBeenCalled();
  });

  it('unmuteActor unmutes — not mutes', async () => {
    const { agent, unmuteActorFn, muteActorFn } = mockAgent();
    await unmuteActor(agent, 'did:plc:them');
    expect(unmuteActorFn).toHaveBeenCalledWith({ actor: 'did:plc:them' });
    expect(muteActorFn).not.toHaveBeenCalled();
  });
});

describe('parseAtUri', () => {
  it('splits repo, collection and rkey', () => {
    expect(parseAtUri('at://did:plc:abc/app.bsky.graph.block/3kxyz')).toEqual({
      repo: 'did:plc:abc',
      collection: BLOCK_COLLECTION,
      rkey: '3kxyz',
    });
  });

  it('rejects a truncated URI rather than returning empty parts', () => {
    expect(() => parseAtUri('at://did:plc:abc/app.bsky.graph.block')).toThrow('not an AT URI');
    expect(() => parseAtUri('')).toThrow('not an AT URI');
  });
});
