import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { listDrafts, deleteDraft } from '$lib/db';
import { persistDraft, draftSnapshot } from '$lib/publishing/drafts';
import { snapshot } from '$lib/publishing/snapshots';
import { all, exclusive, remove, write } from '$lib/publishing/storage';
import { getJob, type PublishJob } from '$lib/publishing/outbox';
import { initAllClients } from '$lib/api/client-factory';
import DraftsPage from './+page.svelte';

vi.mock('$lib/api/client-factory', () => ({ initAllClients: vi.fn() }));

let instance: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(initAllClients).mockResolvedValue({ accounts: [], clients: new Map() });
  for (const draft of await listDrafts()) await deleteDraft(draft.id);
  for (const store of ['jobs', 'snapshots', 'leases']) {
    for (const item of await all<{ id: string }>(store)) await remove(store, item.id);
  }
});
afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined;
  document.body.innerHTML = '';
});

async function fixture(withJob = true) {
  const id = await persistDraft(snapshot('test', 'A scheduled draft', [1], {}, {}), new Date(Date.now() + 86_400_000).toISOString());
  const draft = (await listDrafts()).find(item => item.id === id)!;
  const job: PublishJob = {
    id: `draft-${id}`, draftId: id, snapshot: await draftSnapshot(draft), status: 'queued',
    destinations: [{ accountId: 1, handle: 'writer.example', platform: 'bluesky', parts: [{ text: draft.text, status: 'pending' }] }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (withJob) await write('jobs', job);
  const target = document.createElement('div'); document.body.append(target);
  instance = mount(DraftsPage, { target }); flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('button[title="Delete"]')).not.toBeNull(); });
  return { draft, job, target };
}

describe('draft deletion from the actual Drafts page', () => {
  it('cancels the queued delivery before deleting its source draft', async () => {
    const { target, job } = await fixture();
    target.querySelector<HTMLButtonElement>('button[title="Delete"]')!.click(); flushSync();
    await vi.waitFor(async () => expect(await listDrafts()).toEqual([]));
    expect((await getJob(job.id))?.status).toBe('cancelled');
    expect(await all('snapshots')).toEqual([]);
  });

  it('keeps the draft when a scheduler already holds a due-draft snapshot', async () => {
    const { target, draft } = await fixture(false);
    await exclusive('scheduler', async () => {
      target.querySelector<HTMLButtonElement>('button[title="Delete"]')!.click(); flushSync();
      await vi.waitFor(() => { flushSync(); expect(target.textContent).toContain('being updated or sent'); });
      expect((await listDrafts()).map(item => item.id)).toContain(draft.id);
    });
  });
});
