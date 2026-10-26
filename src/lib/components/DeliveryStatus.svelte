<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { i18n } from '$lib/i18n.svelte';
  import { hrefOrHash } from '$lib/safe-url';
  import { cancelJob, getJob, needsReview, type PublishJob } from '$lib/publishing/outbox';
  let { job, busy = false, onretry }: { job: PublishJob; busy?: boolean; onretry?: (allowUncertain: boolean) => void } = $props();
  let checked = $state(false);
  let error = $state('');
  async function stop() {
    if (!confirm(i18n.t.workflow.cancelHint)) return;
    try { await cancelJob(job.id); job = await getJob(job.id) ?? job; }
    catch (e) { error = String(e); }
  }
  onMount(() => {
    let disposed = false;
    let sequence = 0;
    async function refresh() {
      const id = job.id; const request = ++sequence;
      const current = await getJob(id);
      if (!disposed && request === sequence && current && job.id === id) job = current;
    }
    const update = () => { void refresh().catch(e => { error = String(e); }); };
    window.addEventListener('crispdeck-outbox-change', update);
    window.addEventListener('focus', update);
    return () => { disposed = true; window.removeEventListener('crispdeck-outbox-change', update); window.removeEventListener('focus', update); };
  });
  const review = $derived(needsReview(job));
</script>

<section class="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3" aria-label={i18n.t.workflow.deliveryStatus}>
  <div class="flex justify-between gap-3 text-sm font-semibold">
    <span>{i18n.t.workflow.deliveryStatus}</span>
    <span aria-live="polite">{i18n.t.workflow[job.status]}</span>
  </div>
  {#each job.destinations as destination}
    <div class="text-sm space-y-1">
      <p class="font-medium">@{destination.handle} <span class="text-[var(--color-text-muted)]">· {destination.platform}</span></p>
      {#each destination.parts as part, index}
        <div class="pl-3 border-l-2 border-[var(--color-border)]">
          <span>{index + 1}/{destination.parts.length} · {i18n.t.workflow[part.status]}</span>
          {#if part.result?.success && part.result.uri}
            <a class="underline ml-2" href={hrefOrHash(part.result.uri.startsWith('at://') ? `https://bsky.app/profile/${part.result.uri.split('/')[2]}/post/${part.result.uri.split('/').pop()}` : part.result.uri)} target="_blank" rel="noopener noreferrer">{i18n.t.common.view}</a>
          {/if}
          {#if part.error}<p class="text-xs text-[var(--color-text-muted)] break-words">{part.error} <a href="{base}/settings?tab=account" class="underline">{i18n.t.nav.settings}</a></p>{/if}
        </div>
      {/each}
    </div>
  {/each}
  {#if job.status !== 'posted' && job.status !== 'cancelled' && onretry}
    {#if review}
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.workflow.checkPublished}</p>
      <label class="flex gap-2 items-start text-sm">
        <input type="checkbox" bind:checked disabled={busy} class="mt-1" />
        {i18n.t.workflow.confirmNotPublished}
      </label>
    {/if}
    <button class="px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm disabled:opacity-50" disabled={busy || (review && !checked)} onclick={() => onretry?.(checked)}>
      {busy ? i18n.t.workflow.sending : i18n.t.workflow.retryFailed}
    </button>
    <button class="ml-3 text-sm underline" disabled={busy} onclick={stop}>{i18n.t.workflow.cancelDelivery}</button>
  {/if}
  {#if error}<p role="alert" class="text-sm text-red-400">{error}</p>{/if}
</section>
