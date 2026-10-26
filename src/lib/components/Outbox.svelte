<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { listJobs, deliverJob, type PublishJob } from '$lib/publishing/outbox';
  import { listDrafts } from '$lib/db';
  import { SCHEDULER_CHANGE } from '$lib/publishing/events';
  import DeliveryStatus from './DeliveryStatus.svelte';
  let jobs: PublishJob[] = $state([]);
  let busy: string | null = $state(null);
  let error = $state('');
  let expanded: Record<string, boolean> = $state({});
  let visibleCount = $state(20);
  async function refresh() {
    try { const active = new Set((await listDrafts()).map(d => d.id)); jobs = (await listJobs()).filter(j => j.draftId === undefined || !active.has(j.draftId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    catch (e) { error = String(e); }
  }
  async function retry(job: PublishJob, allow: boolean) {
    busy = job.id;
    error = '';
    try { await deliverJob(job.id, undefined, allow); await refresh(); }
    catch (e) { error = String(e); }
    finally { busy = null; }
  }
  onMount(() => {
    void refresh();
    window.addEventListener('crispdeck-outbox-change', refresh);
    window.addEventListener(SCHEDULER_CHANGE, refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('crispdeck-outbox-change', refresh); window.removeEventListener(SCHEDULER_CHANGE, refresh); window.removeEventListener('focus', refresh); };
  });
</script>

<div class="space-y-3 mt-6">
  <h2 class="text-lg font-semibold">{i18n.t.workflow.outbox}</h2>
  {#if error}<p role="alert" class="text-red-400">{error}</p>{/if}
  {#if jobs.length === 0}<p class="text-sm text-[var(--color-text-muted)]">{i18n.t.workflow.noJobs}</p>{/if}
  {#each jobs.slice(0, visibleCount) as job (job.id)}
    <details class="rounded-xl border border-[var(--color-border)]" open={job.status !== 'posted'} ontoggle={e => expanded = { ...expanded, [job.id]: e.currentTarget.open }}>
      <summary class="p-3 cursor-pointer text-sm">{i18n.t.workflow[job.status]} · {job.snapshot.text.slice(0, 90)}</summary>
      {#if job.status !== 'posted' || expanded[job.id]}<DeliveryStatus {job} busy={busy === job.id} onretry={allow => retry(job, allow)} />{/if}
    </details>
  {/each}
  {#if jobs.length > visibleCount}<button class="text-sm underline" onclick={() => visibleCount += 20}>{i18n.t.workflow.loadMore}</button>{/if}
</div>
