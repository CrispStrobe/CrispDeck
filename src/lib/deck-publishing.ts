/** Local draft and scheduled-post columns share the durable publishing store. */
import { listAccounts, listDrafts } from './db';
import type { Account, Draft } from './types';
import { cancelJob, getJob, listJobs, type PublishJob } from './publishing/outbox';
import { draftSnapshot, persistDraft, removeDraft } from './publishing/drafts';
import { exclusive } from './publishing/storage';
import { swallow } from './debug-log';

export type PublishingColumnType = 'drafts' | 'scheduled';
export interface PublishingColumnEntry {
  draft: Draft;
  accountIds: number[];
  accountNames: string[];
  job?: PublishJob;
}

export class PublishingColumnError extends Error {
  constructor(public code: 'busy' | 'missing' | 'locked' | 'invalid-schedule') {
    super(code === 'busy' ? 'The draft is being updated or sent in another window.'
      : code === 'missing' ? 'This draft is no longer available.'
        : code === 'locked' ? 'This draft already has delivery history.' : 'Choose a future date and time.');
    this.name = 'PublishingColumnError';
  }
}

/** Native database rows may contain JSON text, while browser rows use arrays. */
export function draftAccountIds(value: unknown): number[] {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch (error) { swallow('deck-publishing.accounts', error); return []; }
  }
  return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0))] : [];
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function selectPublishingEntries(
  type: PublishingColumnType, drafts: Draft[], jobs: PublishJob[], accounts: Account[], accountIds?: number[],
): PublishingColumnEntry[] {
  const byDraft = new Map(jobs.filter(job => job.draftId !== undefined).map(job => [job.draftId!, job]));
  const selected = accountIds === undefined ? null : new Set(accountIds);
  return drafts.flatMap(draft => {
    const job = byDraft.get(draft.id);
    if (draft.is_sent || job?.status === 'posted' || Boolean(draft.scheduled_at) !== (type === 'scheduled')) return [];
    const targets = draftAccountIds(draft.target_accounts);
    if (selected && !targets.some(id => selected.has(id))) return [];
    return [{
      draft,
      accountIds: targets,
      accountNames: targets.map(id => {
        const handle = accounts.find(account => account.id === id)?.handle
          ?? job?.destinations.find(destination => destination.accountId === id)?.handle;
        return handle ? `@${handle.replace(/^@/, '')}` : `#${id}`;
      }),
      job,
    }];
  }).sort((left, right) => type === 'scheduled'
    ? timestamp(left.draft.scheduled_at!) - timestamp(right.draft.scheduled_at!) || left.draft.id - right.draft.id
    : timestamp(right.draft.updated_at) - timestamp(left.draft.updated_at) || right.draft.id - left.draft.id);
}

/** Reading a queue never initializes network clients or starts delivery. */
export async function loadPublishingEntries(type: PublishingColumnType, accountIds?: number[]): Promise<PublishingColumnEntry[]> {
  if (accountIds?.length === 0) return [];
  const [drafts, jobs, accounts] = await Promise.all([listDrafts(), listJobs(), listAccounts()]);
  return selectPublishingEntries(type, drafts, jobs, accounts, accountIds);
}

/**
 * The scheduler takes its lock before reading due drafts. Sharing that lock
 * prevents a stale scheduled row from being published after it was cancelled.
 * The per-draft lock also coordinates manual publishing from the Drafts page.
 */
async function changeDraft(id: number, change: (draft: Draft) => Promise<void>): Promise<void> {
  const changed = await exclusive('scheduler', async () => {
    const result = await exclusive(`draft-${id}`, async () => {
      const draft = (await listDrafts()).find(candidate => candidate.id === id && !candidate.is_sent);
      if (!draft) throw new PublishingColumnError('missing');
      await change(draft);
      return true;
    });
    if (!result) throw new PublishingColumnError('busy');
    return true;
  });
  if (!changed) throw new PublishingColumnError('busy');
}

export async function schedulePublishingDraft(id: number, scheduledAt: string): Promise<void> {
  const due = Date.parse(scheduledAt);
  if (!Number.isFinite(due) || due <= Date.now()) throw new PublishingColumnError('invalid-schedule');
  await changeDraft(id, async draft => {
    if (await getJob(`draft-${id}`)) throw new PublishingColumnError('locked');
    await persistDraft(await draftSnapshot(draft), new Date(due).toISOString(), id);
  });
}

export async function cancelPublishingDraft(id: number): Promise<void> {
  await changeDraft(id, async draft => {
    const job = await getJob(`draft-${id}`);
    if (job) await cancelJob(job.id);
    else if (draft.scheduled_at) await persistDraft(await draftSnapshot(draft), null, id);
  });
}

/** A removed draft must not leave a queued job able to deliver later. */
export async function deletePublishingDraft(id: number): Promise<void> {
  await changeDraft(id, async draft => {
    const job = await getJob(`draft-${id}`);
    if (job) await cancelJob(job.id);
    await removeDraft(draft);
  });
}
