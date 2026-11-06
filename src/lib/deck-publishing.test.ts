import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelPublishingDraft, deletePublishingDraft, draftAccountIds, loadPublishingEntries,
  PublishingColumnError, schedulePublishingDraft, selectPublishingEntries,
} from './deck-publishing';
import { deleteDraft, listDrafts } from './db';
import { draftSnapshot, persistDraft } from './publishing/drafts';
import { getJob, type PublishJob } from './publishing/outbox';
import { all, exclusive, remove, write } from './publishing/storage';
import { snapshot } from './publishing/snapshots';
import { initAllClients } from './api/client-factory';
import type { Account, Draft } from './types';

vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn() }));

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const draft = (id: number, patch: Partial<Draft> = {}): Draft => ({
  id, text: `Draft ${id}`, target_accounts: [1], media_paths: [], visibility: 'public',
  content_warning: null, scheduled_at: null, is_sent: false,
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', ...patch,
});

async function savedDraft(scheduledAt: string | null = null) {
  const saved = snapshot('test', 'Keep my draft', [1, 2], { '2': 'Custom destination text' }, {
    visibility: 'private', altTexts: ['Useful description'], threadGate: 'mentioned', contentWarning: 'CW',
  });
  const id = await persistDraft(saved, scheduledAt);
  return (await listDrafts()).find(value => value.id === id)!;
}

async function jobFor(draft: Draft, status: PublishJob['status'] = 'queued'): Promise<PublishJob> {
  const job: PublishJob = {
    id: `draft-${draft.id}`, draftId: draft.id, snapshot: await draftSnapshot(draft), status,
    destinations: [{ accountId: 1, platform: 'bluesky', handle: 'writer.example', parts: [{ text: draft.text, status: 'pending' }] }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await write('jobs', job);
  return job;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const draft of await listDrafts()) await deleteDraft(draft.id);
  for (const store of ['jobs', 'snapshots', 'leases']) {
    for (const item of await all<{ id: string }>(store)) await remove(store, item.id);
  }
});
afterEach(() => vi.restoreAllMocks());

describe('publishing column selection', () => {
  it('separates drafts from scheduled entries and sorts by relevant time', () => {
    const drafts = [
      draft(1, { updated_at: '2026-10-03T10:00:00Z' }),
      draft(2, { scheduled_at: '2026-10-05T10:00:00Z' }),
      draft(3, { scheduled_at: '2026-10-04T10:00:00Z' }),
      draft(4, { updated_at: '2026-10-04T10:00:00Z' }),
      draft(5, { is_sent: true }),
    ];
    expect(selectPublishingEntries('drafts', drafts, [], []).map(item => item.draft.id)).toEqual([4, 1]);
    expect(selectPublishingEntries('scheduled', drafts, [], []).map(item => item.draft.id)).toEqual([3, 2]);
  });

  it('honors explicit account selections, including none, and parses native rows', () => {
    const drafts = [draft(1), draft(2, { target_accounts: '[2,3]' as unknown as number[] }), draft(3, { target_accounts: [] })];
    expect(selectPublishingEntries('drafts', drafts, [], [], [2]).map(item => item.draft.id)).toEqual([2]);
    expect(selectPublishingEntries('drafts', drafts, [], [], [])).toEqual([]);
    expect(selectPublishingEntries('drafts', drafts, [], []).map(item => item.draft.id)).toEqual([3, 2, 1]);
    expect(draftAccountIds('[1,"2",-1,null,1]')).toEqual([1]);
    expect(draftAccountIds('{bad')).toEqual([]);
  });

  it('keeps failed and cancelled deliveries visible but excludes completed jobs', () => {
    const drafts = [1, 2, 3].map(id => draft(id, { scheduled_at: '2026-10-05T10:00:00Z' }));
    const jobs = ['failed', 'cancelled', 'posted'].map((status, index) => ({ draftId: index + 1, status, destinations: [] } as unknown as PublishJob));
    const entries = selectPublishingEntries('scheduled', drafts, jobs, []);
    expect(entries.map(entry => entry.job?.status)).toEqual(['failed', 'cancelled']);
  });

  it('shows account handles, delivery identities, and disconnected IDs without a network call', () => {
    const drafts = [draft(1, { target_accounts: [1, 2, 3] })];
    const jobs = [{ draftId: 1, status: 'failed', destinations: [{ accountId: 2, handle: 'lost.example' }] } as PublishJob];
    const accounts = [{ id: 1, handle: '@connected@example.com' } as Account];
    const entries = selectPublishingEntries('drafts', drafts, jobs, accounts);
    expect(entries[0].accountNames).toEqual(['@connected@example.com', '@lost.example', '#3']);
    expect(initAllClients).not.toHaveBeenCalled();
  });

  it('loading is read-only and an empty selection never falls back to all drafts', async () => {
    await savedDraft();
    expect(await loadPublishingEntries('drafts', [])).toEqual([]);
    expect(await loadPublishingEntries('drafts')).toHaveLength(1);
    expect(await all('jobs')).toHaveLength(0);
    expect(initAllClients).not.toHaveBeenCalled();
  });
});

describe('publishing column mutations use durable services', () => {
  it('schedules and unschedules without losing destination options or text', async () => {
    const draft = await savedDraft();
    const before = await draftSnapshot(draft);
    const at = future();
    await schedulePublishingDraft(draft.id, at);
    let stored = (await listDrafts())[0];
    expect(stored.scheduled_at).toBe(at);
    expect((await draftSnapshot(stored)).overrides).toEqual(before.overrides);
    await cancelPublishingDraft(draft.id);
    stored = (await listDrafts())[0];
    expect(stored.scheduled_at).toBeNull();
    expect((await draftSnapshot(stored)).options).toEqual(before.options);
    expect(initAllClients).not.toHaveBeenCalled();
  });

  it('rejects past dates and drafts with delivery history before modifying them', async () => {
    const draft = await savedDraft(future());
    await expect(schedulePublishingDraft(draft.id, '2020-01-01')).rejects.toBeInstanceOf(PublishingColumnError);
    await jobFor(draft);
    await expect(schedulePublishingDraft(draft.id, future())).rejects.toMatchObject({ code: 'locked' });
    expect((await listDrafts())[0].scheduled_at).toBe(draft.scheduled_at);
  });

  it('stops existing delivery through cancelJob and retains its history', async () => {
    const draft = await savedDraft(future());
    const job = await jobFor(draft, 'partial');
    await cancelPublishingDraft(draft.id);
    expect((await getJob(job.id))?.status).toBe('cancelled');
    expect(await listDrafts()).toHaveLength(1);
    expect(initAllClients).not.toHaveBeenCalled();
  });

  it('stops queued delivery before deleting a draft and preserves the outbox record', async () => {
    const draft = await savedDraft(future());
    const job = await jobFor(draft);
    await deletePublishingDraft(draft.id);
    expect(await listDrafts()).toEqual([]);
    expect((await getJob(job.id))?.status).toBe('cancelled');
    expect(await all('snapshots')).toEqual([]);
    expect(initAllClients).not.toHaveBeenCalled();
  });

  it('refuses cancellation while the scheduler has a stale due-draft snapshot', async () => {
    const draft = await savedDraft(future());
    await exclusive('scheduler', async () => {
      await expect(cancelPublishingDraft(draft.id)).rejects.toMatchObject({ code: 'busy' });
      expect((await listDrafts())[0].scheduled_at).toBe(draft.scheduled_at);
    });
  });

  it('does not delete a draft while a manual delivery holds its lock', async () => {
    const draft = await savedDraft(future());
    await exclusive(`draft-${draft.id}`, async () => {
      await expect(deletePublishingDraft(draft.id)).rejects.toMatchObject({ code: 'busy' });
      expect(await listDrafts()).toHaveLength(1);
    });
  });

  it('does not delete a draft if its outbox job is currently being sent', async () => {
    const draft = await savedDraft(future());
    const job = await jobFor(draft, 'sending');
    await exclusive(`publish-${job.id}`, async () => {
      await expect(deletePublishingDraft(draft.id)).rejects.toThrow(/still running/);
      expect(await listDrafts()).toHaveLength(1);
      expect((await getJob(job.id))?.status).toBe('sending');
    });
  });

  it('refuses stale actions on a draft removed by another window', async () => {
    await expect(deletePublishingDraft(99999)).rejects.toMatchObject({ code: 'missing' });
  });
});
