/**
 * Tests for starter pack creator — validation, flow, and AT Protocol record structure.
 */
import { describe, it, expect, vi } from 'vitest';
import { publishStarterPack, deleteStarterPack, type StarterPackDraft } from './starter-pack-creator';

function mockAgent() {
  return {
    session: { did: 'did:plc:creator' },
    api: {
      com: {
        atproto: {
          repo: {
            createRecord: vi.fn().mockResolvedValue({ data: { uri: 'at://did:plc:creator/record/abc' } }),
            deleteRecord: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
    },
  } as any;
}

describe('publishStarterPack', () => {
  it('validates name is required', async () => {
    const agent = mockAgent();
    const draft: StarterPackDraft = { name: '', description: '', members: [{ did: 'did:plc:1', handle: 'a' }] };
    await expect(publishStarterPack(agent, draft)).rejects.toThrow('name is required');
  });

  it('validates at least one member', async () => {
    const agent = mockAgent();
    const draft: StarterPackDraft = { name: 'Test Pack', description: '', members: [] };
    await expect(publishStarterPack(agent, draft)).rejects.toThrow('At least one member');
  });

  it('validates max 150 members', async () => {
    const agent = mockAgent();
    const members = Array.from({ length: 151 }, (_, i) => ({ did: `did:plc:${i}`, handle: `user${i}` }));
    const draft: StarterPackDraft = { name: 'Big Pack', description: '', members };
    await expect(publishStarterPack(agent, draft)).rejects.toThrow('Maximum 150');
  });

  it('creates list, adds members, then creates starterpack record', async () => {
    const agent = mockAgent();
    const draft: StarterPackDraft = {
      name: 'Cool Pack',
      description: 'A pack',
      members: [
        { did: 'did:plc:alice', handle: 'alice.bsky.social' },
        { did: 'did:plc:bob', handle: 'bob.bsky.social' },
      ],
    };

    const uri = await publishStarterPack(agent, draft);
    expect(uri).toContain('at://');

    const calls = agent.api.com.atproto.repo.createRecord.mock.calls;
    // 1st call: create list
    expect(calls[0][0].collection).toBe('app.bsky.graph.list');
    expect(calls[0][0].record.name).toBe('Cool Pack');
    // 2nd + 3rd: add members
    expect(calls[1][0].collection).toBe('app.bsky.graph.listitem');
    expect(calls[1][0].record.subject).toBe('did:plc:alice');
    expect(calls[2][0].collection).toBe('app.bsky.graph.listitem');
    expect(calls[2][0].record.subject).toBe('did:plc:bob');
    // 4th: create starterpack
    expect(calls[3][0].collection).toBe('app.bsky.graph.starterpack');
    expect(calls[3][0].record.name).toBe('Cool Pack');
  });

  it('creates records with timestamps', async () => {
    const agent = mockAgent();
    const draft: StarterPackDraft = {
      name: 'Timestamped',
      description: '',
      members: [{ did: 'did:plc:1', handle: 'user1' }],
    };
    await publishStarterPack(agent, draft);

    for (const call of agent.api.com.atproto.repo.createRecord.mock.calls) {
      expect(call[0].record.createdAt).toBeTruthy();
      expect(new Date(call[0].record.createdAt).getTime()).not.toBeNaN();
    }
  });
});

describe('deleteStarterPack', () => {
  it('extracts rkey from URI and deletes', async () => {
    const agent = mockAgent();
    await deleteStarterPack(agent, 'at://did:plc:creator/app.bsky.graph.starterpack/rkey456');
    expect(agent.api.com.atproto.repo.deleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:creator',
      collection: 'app.bsky.graph.starterpack',
      rkey: 'rkey456',
    });
  });
});

describe('StarterPackDraft type', () => {
  it('supports optional member fields', () => {
    const draft: StarterPackDraft = {
      name: 'Pack',
      description: 'Desc',
      members: [
        { did: 'did:plc:1', handle: 'user1', displayName: 'User One', avatar: 'https://img.example.com/1.jpg' },
        { did: 'did:plc:2', handle: 'user2' },
      ],
    };
    expect(draft.members[0].displayName).toBe('User One');
    expect(draft.members[1].displayName).toBeUndefined();
  });
});
