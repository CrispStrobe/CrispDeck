import { saveDraft, listDrafts, deleteDraft } from '$lib/db';
import type { Draft } from '$lib/types';
import { snapshot, saveSnapshot, loadSnapshot, deleteSnapshot, type ComposerSnapshot } from './snapshots';
import { createJob, getJob, deliverJob, isComplete, type PublishJob } from './outbox';
import { initAllClients } from '$lib/api/client-factory';
import { exclusive } from './storage';

import { SCHEDULER_CHANGE } from './events';
export { SCHEDULER_CHANGE } from './events';
export function draftsChanged() {
  window.dispatchEvent(new Event(SCHEDULER_CHANGE));
}

export async function persistDraft(saved: ComposerSnapshot, scheduledAt: string | null = null, id?: number): Promise<number> {
  return (await exclusive('draft-write', async () => {
    if (id !== undefined && await getJob(`draft-${id}`)) throw new Error('This draft has delivery history. Complete its delivery before editing.');
    // Save media/options first. A failure must never silently save a text-only draft.
    const payloadId = `draft-pending-${crypto.randomUUID()}`;
    await saveSnapshot({ ...saved, id: payloadId });
    const previous = id === undefined ? undefined : (await listDrafts()).find(d => d.id === id);
    try {
      const draftId = await saveDraft({
        id, text: saved.text, target_accounts: saved.accountIds,
        media_paths: [payloadId], visibility: saved.options.visibility,
        content_warning: saved.options.contentWarning ?? null, scheduled_at: scheduledAt,
      });
      if (previous && paths(previous)[0]?.startsWith('draft')) await deleteSnapshot(paths(previous)[0]);
      draftsChanged();
      return draftId;
    } catch (error) {
      await deleteSnapshot(payloadId);
      throw error;
    }
  })) ?? Promise.reject(new Error('Another window is saving a draft. Try again.'));
}

function paths(draft: Draft): string[] {
  try { return typeof draft.media_paths === 'string' ? JSON.parse(draft.media_paths) : draft.media_paths ?? []; }
  catch { return []; }
}
export async function draftSnapshot(draft: Draft): Promise<ComposerSnapshot> {
  const key = paths(draft)[0];
  if (key?.startsWith('draft')) {
    const saved = await loadSnapshot(key);
    if (!saved) throw new Error('Draft media could not be restored. Reattach it before publishing.');
    return saved;
  }
  if (paths(draft).length) throw new Error('This draft has legacy attachments. Reattach them in Compose before publishing.');
  const ids = typeof draft.target_accounts === 'string' ? JSON.parse(draft.target_accounts) : draft.target_accounts;
  return snapshot(`draft:${draft.id}`, draft.text, ids, {}, {
    visibility: draft.visibility as 'public', contentWarning: draft.content_warning ?? undefined,
  });
}

export async function removeDraft(draft: Draft) {
  await deleteDraft(draft.id);
  const key = paths(draft)[0];
  if (key?.startsWith('draft')) await deleteSnapshot(key);
  draftsChanged();
}

export async function publishDraft(draft: Draft, allowUncertain = false): Promise<PublishJob> {
  const job = await exclusive(`draft-${draft.id}`, async () => {
    const existing = await getJob(`draft-${draft.id}`);
    // A successful delivery with a failed local cleanup must never resend.
    if (existing && isComplete(existing)) { await removeDraft(draft); return existing; }
    const { accounts, clients } = await initAllClients();
    const pending = existing ?? await createJob(await draftSnapshot(draft), accounts, draft.id);
    const delivered = await deliverJob(pending.id, clients, allowUncertain);
    if (isComplete(delivered)) await removeDraft(draft);
    return delivered;
  });
  if (job) return job;
  const current = await getJob(`draft-${draft.id}`);
  if (!current) throw new Error('This draft is being prepared in another window.');
  return current;
}
