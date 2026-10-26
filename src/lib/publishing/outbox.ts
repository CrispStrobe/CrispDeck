import { logCrosspost } from '$lib/db';
import { swallow } from '$lib/debug-log';
import type { Account, Platform } from '$lib/types';
import type { ComposeOptions, PostResult } from '$lib/compose/adapter';
import { postToBluesky, postToMastodon, postToThreads } from '$lib/compose/adapter';
import { splitForPlatform } from '$lib/compose/thread';
import { resolveMentionsForPlatform } from '$lib/compose/mentions';
import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';
import { newRecordKey } from './record-key';
import { all, read, write, exclusive } from './storage';
import { restoreFiles, type ComposerSnapshot } from './snapshots';

export type PartStatus = 'pending' | 'sending' | 'posted' | 'failed' | 'uncertain';
export interface DeliveryPart {
  text: string;
  status: PartStatus;
  result?: PostResult;
  error?: string;
  attemptedAt?: string;
  recordKey?: string;
}
export interface Destination {
  accountId: number;
  handle: string;
  platform: Platform;
  parts: DeliveryPart[];
}
export interface PublishJob {
  id: string;
  snapshot: ComposerSnapshot;
  destinations: Destination[];
  status: 'queued' | 'sending' | 'partial' | 'failed' | 'posted' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  draftId?: number;
  historyLogged?: boolean;
}

export const getJob = (id: string) => read<PublishJob>('jobs', id);
export const listJobs = () => all<PublishJob>('jobs');
export function isComplete(job: PublishJob): boolean {
  return job.destinations.length > 0 && job.destinations.every(d => d.parts.every(p => p.status === 'posted'));
}
export function needsReview(job: PublishJob): boolean {
  return job.destinations.some(d => d.parts.some(p => p.status === 'uncertain' || p.status === 'sending' && d.platform === 'threads' || d.platform === 'mastodon' && p.status !== 'posted' && !!p.attemptedAt && Date.now() - Date.parse(p.attemptedAt) > 3_600_000));
}
async function persist(job: PublishJob) {
  job.updatedAt = new Date().toISOString();
  await write('jobs', job);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('crispdeck-outbox-change'));
}

export async function createJob(saved: ComposerSnapshot, accounts: Account[], draftId?: number): Promise<PublishJob> {
  const id = draftId === undefined ? crypto.randomUUID() : `draft-${draftId}`;
  const prepared = await exclusive(`prepare-${id}`, async () => {
    const existing = await getJob(id);
    if (existing) return existing;
    const targets = saved.accountIds.map(accountId => {
      const account = accounts.find(a => a.id === accountId);
      if (!account) throw new Error(`Account #${accountId} is no longer connected. Reconnect it before publishing.`);
      return account;
    });
    if (!targets.length) throw new Error('Select at least one account to post to.');
    // Freeze mention resolution and splitting before the first network write.
    const destinations = await Promise.all(targets.map(async account => {
      const text = saved.overrides[String(account.id)] ?? saved.text;
      if (!text.trim() && !saved.media.length) throw new Error(`Add text or media for ${account.handle}.`);
      if (account.platform === 'threads') {
        const urls = saved.options.mediaUrls ?? [];
        if (saved.media.length && !urls.length) throw new Error('Threads needs a public HTTPS media URL. Add it in the composer before publishing.');
        if (urls.some(url => { try { return new URL(url).protocol !== 'https:'; } catch { return true; } })) throw new Error('Threads media URLs must use HTTPS.');
      }
      const resolved = await resolveMentionsForPlatform(text, account.platform);
      return {
        accountId: account.id, handle: account.handle, platform: account.platform,
        parts: splitForPlatform(resolved, account.platform).parts.map(p => ({ text: p.text, status: 'pending' as const, recordKey: account.platform === 'bluesky' ? newRecordKey() : undefined })),
      };
    }));
    const job: PublishJob = {
      id, snapshot: saved, destinations, status: 'queued', draftId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await persist(job);
    return job;
  });
  if (prepared) return prepared;
  const existing = await getJob(id);
  if (!existing) throw new Error('Another window is preparing this delivery. Try again.');
  return existing;
}

/** Every successful part is committed before the next part is sent. */
export async function deliverJob(id: string, clients?: Map<number, ClientEntry>, allowUncertain = false): Promise<PublishJob> {
  const completed = await exclusive(`publish-${id}`, async guard => {
    const job = await getJob(id);
    if (!job) throw new Error('The publishing job could not be found.');
    if (isComplete(job) || job.status === 'cancelled') return job;
    const saveProgress = async () => { await guard(); await persist(job); };
    const entries = clients ?? (await initAllClients()).clients;
    job.status = 'sending';
    await saveProgress();
    for (const destination of job.destinations) {
      const handle = (value: string) => value.replace(/^@/, '').toLowerCase();
      const entry = entries.get(destination.accountId) ?? [...entries.values()].find(e => e.platform === destination.platform && handle(e.handle) === handle(destination.handle));
      for (let index = 0; index < destination.parts.length; index++) {
        const part = destination.parts[index];
        if (part.status === 'posted') continue;
        // A crash/timeout may have happened after the server accepted a post.
        // Mastodon's idempotency cache is short-lived; require review after 1h.
        const expired = destination.platform === 'mastodon' && part.attemptedAt && Date.now() - Date.parse(part.attemptedAt) > 3_600_000;
        if ((part.status === 'sending' && destination.platform === 'threads') || expired) part.status = 'uncertain';
        if (part.status === 'uncertain' && !allowUncertain) break;
        if (!entry || entry.degraded) {
          part.status = 'failed';
          part.error = `Reconnect ${destination.handle} in Settings, then retry.`;
          break;
        }
        if (destination.platform === 'threads' && job.snapshot.media.length && !job.snapshot.options.mediaUrls?.length) {
          part.status = 'failed';
          part.error = 'Threads needs a publicly accessible media URL. Add an HTTPS media URL before publishing.';
          break;
        }
        if (destination.platform === 'bluesky') part.recordKey ??= newRecordKey();
        part.status = 'sending';
        part.attemptedAt ??= new Date().toISOString();
        part.error = undefined;
        await saveProgress();
        const previous = destination.parts[index - 1]?.result;
        const first = destination.parts[0]?.result;
        const options: ComposeOptions = {
          ...job.snapshot.options,
          text: part.text,
          deliveryKey: `${job.id}-${destination.accountId}-${index}`,
          recordKey: part.recordKey,
          createdAt: job.createdAt,
          mediaFiles: index === 0 ? restoreFiles(job.snapshot) : undefined,
          mediaUrls: index === 0 ? job.snapshot.options.mediaUrls : undefined,
          quoteUri: index === 0 ? job.snapshot.options.quoteUri : undefined,
          quoteCid: index === 0 ? job.snapshot.options.quoteCid : undefined,
          quoteUrl: index === 0 ? job.snapshot.options.quoteUrl : undefined,
          poll: index === 0 ? job.snapshot.options.poll : undefined,
          threadGate: index === 0 ? job.snapshot.options.threadGate : undefined,
          replyTo: previous ? { uri: previous.uri ?? '', cid: previous.cid, id: previous.id, rootUri: job.snapshot.options.replyTo?.rootUri ?? first?.uri, rootCid: job.snapshot.options.replyTo?.rootCid ?? first?.cid } : job.snapshot.options.replyTo?.platform && job.snapshot.options.replyTo.platform !== destination.platform ? undefined : job.snapshot.options.replyTo,
        };
        let result: PostResult;
        try {
          if (index === 0 && destination.platform === 'bluesky' && options.replyTo && !options.replyTo.rootCid) {
            const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
            const response = await agent.getPostThread({ uri: options.replyTo.uri, depth: 0, parentHeight: 0 });
            const thread = response.data.thread as { post?: { uri: string; cid: string; record: unknown } };
            if (!thread.post) throw new Error('The post being replied to is unavailable.');
            const record = thread.post.record as { reply?: { root: { uri: string; cid: string } } };
            options.replyTo = { ...options.replyTo, cid: thread.post.cid, rootUri: record.reply?.root.uri ?? thread.post.uri, rootCid: record.reply?.root.cid ?? thread.post.cid, platform: 'bluesky' };
            job.snapshot.options.replyTo = options.replyTo;
            await saveProgress();
          }
          result = destination.platform === 'bluesky'
            ? await postToBluesky(entry.client as BlueskyClient, options, entry.oauthAgent)
            : destination.platform === 'mastodon'
              ? await postToMastodon(entry.client as MastodonClient, options)
              : await postToThreads(entry.client as ThreadsClient, options);
        } catch (error) {
          result = { platform: destination.platform, success: false, error: String(error), uncertain: true };
        }
        part.result = result;
        part.status = result.success ? 'posted' : result.uncertain && destination.platform === 'threads' ? 'uncertain' : 'failed';
        part.error = result.error;
        await saveProgress();
        if (!result.success) break;
      }
    }
    job.status = isComplete(job) ? 'posted' : job.destinations.some(d => d.parts.some(p => p.status === 'posted')) ? 'partial' : 'failed';
    await saveProgress();
    if (job.status === 'posted' && !job.historyLogged) {
      const result = (platform: Platform) => job.destinations.find(d => d.platform === platform)?.parts[0].result;
      try {
        await logCrosspost({
          draft_id: job.draftId, text_preview: job.snapshot.text.slice(0, 280), media_count: job.snapshot.media.length,
          bluesky_uri: result('bluesky')?.uri, bluesky_cid: result('bluesky')?.cid,
          mastodon_uri: result('mastodon')?.uri, mastodon_id: result('mastodon')?.id,
          threads_uri: result('threads')?.uri, threads_id: result('threads')?.id, status: 'success',
        });
        job.historyLogged = true;
        await saveProgress();
      } catch (error) { swallow('publishing.history', error); }
    }
    return job;
  });
  if (completed) return completed;
  const job = await getJob(id);
  if (!job) throw new Error('The publishing job could not be found.');
  return job;
}

export async function cancelJob(id: string): Promise<void> {
  const cancelled = await exclusive(`publish-${id}`, async () => {
    const job = await getJob(id);
    if (job && !isComplete(job)) { job.status = 'cancelled'; await persist(job); }
    return true;
  });
  if (!cancelled) throw new Error('This delivery is still running in another window.');
}
