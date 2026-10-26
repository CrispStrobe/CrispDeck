import { listDrafts } from '$lib/db';

import { SCHEDULER_CHANGE } from './events';
import { exclusive } from './storage';
import { swallow } from '$lib/debug-log';

/** App lifetime, independent of routes. Failed jobs require an explicit retry. */
export function startScheduler(): () => void {
  let stopped = false;
  let running = false;
  async function tick() {
    if (stopped || running || !navigator.onLine) return;
    running = true;
    try {
      await exclusive('scheduler', async () => {
        const drafts = await listDrafts();
        for (const draft of drafts) {
          if (stopped) break;
          const due = draft.scheduled_at ? Date.parse(draft.scheduled_at) : NaN;
          if (!Number.isFinite(due) || draft.is_sent || due > Date.now()) continue;
          const { getJob, isComplete } = await import('./outbox');
          const { publishDraft } = await import('./drafts');
          const job = await getJob(`draft-${draft.id}`);
          if (!job || isComplete(job)) await publishDraft(draft);
          // queued/sending means an interrupted attempt: safe protocols resume,
          // ambiguous writes remain visible for review, never retried blindly.
          else if (job.status === 'queued' || job.status === 'sending') await publishDraft(draft);
        }
      });
    } catch (error) { swallow('scheduler.tick', error); }
    finally { running = false; }
  }
  const wake = () => { void tick(); };
  const interval = setInterval(wake, 15_000);
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  window.addEventListener(SCHEDULER_CHANGE, wake);
  document.addEventListener('visibilitychange', wake);
  wake();
  return () => {
    stopped = true;
    clearInterval(interval);
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    window.removeEventListener(SCHEDULER_CHANGE, wake);
    document.removeEventListener('visibilitychange', wake);
  };
}
