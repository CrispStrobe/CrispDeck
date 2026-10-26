import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDrafts, deleteDraft } from '$lib/db';
import { persistDraft, draftSnapshot } from './drafts';
import { snapshot } from './snapshots';

vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn() }));

beforeEach(async () => {
  for (const draft of await listDrafts()) await deleteDraft(draft.id);
});

describe('complete draft persistence', () => {
  it('rescheduling updates the same draft and preserves destination settings', async () => {
    const saved = snapshot('test', 'Draft', [1, 2], { '2': 'Custom' }, {
      visibility: 'private', altTexts: ['Description'], threadGate: 'mentioned', disableQuotes: true,
    });
    const id = await persistDraft(saved);
    const first = (await listDrafts())[0];
    const at = '2026-12-01T12:00:00.000Z';
    expect(await persistDraft(saved, at, id)).toBe(id);
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].created_at).toBe(first.created_at);
    expect(drafts[0].scheduled_at).toBe(at);
    const restored = await draftSnapshot(drafts[0]);
    expect(restored.overrides).toEqual({ '2': 'Custom' });
    expect(restored.options.visibility).toBe('private');
    expect(restored.options.altTexts).toEqual(['Description']);
    expect(restored.options.disableQuotes).toBe(true);
  });
});
