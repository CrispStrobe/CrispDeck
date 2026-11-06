<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { CalendarClock, Clock, FileText, Loader2, RefreshCw, Trash2, X } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { swallow } from '$lib/debug-log';
  import { toast } from '$lib/toast.svelte';
  import { buildScheduledAt, minScheduleDate } from '$lib/quick-schedule';
  import { SCHEDULER_CHANGE } from '$lib/publishing/events';
  import {
    cancelPublishingDraft, deletePublishingDraft, loadPublishingEntries, schedulePublishingDraft,
    PublishingColumnError, type PublishingColumnEntry, type PublishingColumnType,
  } from '$lib/deck-publishing';

  let { type, accountIds, filterText = '', paused = false, refreshKey = 0, onerror }: {
    type: PublishingColumnType;
    accountIds?: number[];
    filterText?: string;
    paused?: boolean;
    refreshKey?: number;
    onerror?: (error: unknown) => void;
  } = $props();

  let entries = $state<PublishingColumnEntry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busy = $state<number | null>(null);
  let scheduling = $state<number | null>(null);
  let scheduleDate = $state('');
  let scheduleTime = $state('');
  let confirming = $state<{ id: number; action: 'delete' | 'cancel' } | null>(null);
  let visibleCount = $state(30);
  let now = $state(Date.now());
  let disposed = false;
  let request = 0;
  const fieldPrefix = `publishing-${crypto.randomUUID()}`;

  const filtered = $derived.by(() => {
    const query = filterText.trim().toLocaleLowerCase();
    return query ? entries.filter(entry => `${entry.draft.text} ${entry.draft.content_warning ?? ''} ${entry.accountNames.join(' ')}`.toLocaleLowerCase().includes(query)) : entries;
  });

  async function refresh(kind: PublishingColumnType = type, selected: number[] | undefined = accountIds) {
    const sequence = ++request;
    loading = true;
    try {
      const next = await loadPublishingEntries(kind, selected);
      if (disposed || sequence !== request) return;
      entries = next;
      error = '';
      now = Date.now();
    } catch (cause) {
      if (disposed || sequence !== request) return;
      swallow('PublishingColumn.load', cause);
      error = i18n.t.deck.publishingLoadFailed;
      onerror?.(cause);
    } finally { if (!disposed && sequence === request) loading = false; }
  }

  $effect(() => {
    // Account changes and an explicit header refresh still work while paused.
    const selected = accountIds === undefined ? undefined : [...accountIds];
    refreshKey;
    visibleCount = 30;
    void refresh(type, selected);
  });

  onMount(() => {
    const update = () => { if (!paused) void refresh(); };
    const timer = setInterval(() => {
      now = Date.now();
      if (!paused && !document.hidden) void refresh();
    }, 15_000);
    window.addEventListener(SCHEDULER_CHANGE, update);
    window.addEventListener('crispdeck-outbox-change', update);
    window.addEventListener('focus', update);
    return () => {
      disposed = true;
      request++;
      clearInterval(timer);
      window.removeEventListener(SCHEDULER_CHANGE, update);
      window.removeEventListener('crispdeck-outbox-change', update);
      window.removeEventListener('focus', update);
    };
  });

  function report(cause: unknown) {
    swallow('PublishingColumn.action', cause);
    const labels = {
      busy: i18n.t.deck.publishingBusy,
      missing: i18n.t.deck.draftUnavailable,
      locked: i18n.t.workflow.deliveryLocked,
      'invalid-schedule': i18n.t.compose.scheduleFuture,
    };
    error = cause instanceof PublishingColumnError ? labels[cause.code]
      : cause instanceof Error ? cause.message : i18n.t.common.somethingWentWrong;
    toast.error(error);
    onerror?.(cause);
  }

  async function action(id: number, work: () => Promise<void>) {
    if (busy !== null) return;
    busy = id;
    error = '';
    try {
      await work();
      if (disposed) return;
      confirming = null;
      scheduling = null;
      await refresh();
    } catch (cause) { if (!disposed) report(cause); }
    finally { if (!disposed) busy = null; }
  }

  function openSchedule(entry: PublishingColumnEntry) {
    const date = new Date(entry.draft.scheduled_at || Date.now() + 3_600_000);
    scheduling = entry.draft.id;
    confirming = null;
    scheduleDate = minScheduleDate(date);
    scheduleTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function schedule(id: number) {
    const at = buildScheduledAt(scheduleDate, scheduleTime);
    if (!at || Date.parse(at) <= Date.now()) { report(new PublishingColumnError('invalid-schedule')); return; }
    void action(id, () => schedulePublishingDraft(id, at));
  }

  function dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : value;
  }
</script>

<section class="space-y-3" aria-label={type === 'scheduled' ? i18n.t.drafts.scheduled : i18n.t.drafts.title}>
  <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
    <a href="{base}/compose" class="text-[var(--color-primary-text)] hover:underline">{i18n.t.drafts.newPost}</a>
    <div class="flex items-center gap-2">
      <a href="{base}/drafts" class="text-[var(--color-text-muted)] hover:underline">{i18n.t.workflow.openPublishing}</a>
      <button type="button" disabled={loading} onclick={() => refresh()} aria-label={i18n.t.deck.refreshColumn} class="p-1.5 rounded hover:bg-[var(--color-surface)]"><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></button>
    </div>
  </div>
  {#if type === 'scheduled'}
    <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.scheduleHint}</p>
    <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.workflow.timezone}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
  {/if}
  {#if error}<p role="alert" class="text-xs text-red-400">{error}</p>{/if}
  {#if loading && entries.length === 0}
    <div role="status" class="flex items-center justify-center gap-2 py-8 text-xs text-[var(--color-text-muted)]"><Loader2 size={18} class="animate-spin" />{i18n.t.common.loading}</div>
  {:else if filtered.length === 0}
    <div class="space-y-2 py-6 text-center text-xs text-[var(--color-text-muted)]">
      <FileText size={24} class="mx-auto" />
      <p>{accountIds?.length === 0 ? i18n.t.deck.noSelectedAccounts : filterText.trim() ? i18n.t.search.noResults : i18n.t.drafts.noDrafts}</p>
    </div>
  {:else}
    {#each filtered.slice(0, visibleCount) as entry (entry.draft.id)}
      {@const draft = entry.draft}
      {@const job = entry.job}
      {@const overdue = !!draft.scheduled_at && Date.parse(draft.scheduled_at) <= now && !job}
      <article class="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3" data-draft-id={draft.id}>
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
          {#if draft.scheduled_at}
            <span class="flex items-center gap-1"><Clock size={12} /><time datetime={draft.scheduled_at}>{dateLabel(draft.scheduled_at)}</time></span>
          {:else}
            <time datetime={draft.updated_at}>{i18n.t.drafts.saved.replace('{date}', dateLabel(draft.updated_at))}</time>
          {/if}
          {#if job}<span class:text-amber-500={job.status === 'partial' || job.status === 'failed'}>{i18n.t.workflow[job.status]}</span>
          {:else if overdue}<span class="text-amber-500">{i18n.t.workflow.overdue}</span>{/if}
        </div>
        {#if draft.content_warning}<p class="text-xs font-medium break-words">{i18n.t.compose.cw}: {draft.content_warning}</p>{/if}
        <p class="whitespace-pre-wrap break-words text-sm line-clamp-5">{draft.text}</p>
        <p class="break-words text-[11px] text-[var(--color-text-muted)]">{i18n.t.drafts.to} {entry.accountNames.join(', ') || i18n.t.compose.selectAccount}</p>
        <div class="flex flex-wrap gap-2">
          <a href="{base}/compose?draft={draft.id}" class="action">{job ? i18n.t.workflow.deliveryStatus : i18n.t.drafts.edit}</a>
          {#if !job}
            <button type="button" class="action" disabled={busy !== null} onclick={() => openSchedule(entry)}><CalendarClock size={13} />{i18n.t.drafts.schedule}</button>
            {#if draft.scheduled_at}<button type="button" class="action" disabled={busy !== null} onclick={() => action(draft.id, () => cancelPublishingDraft(draft.id))}>{i18n.t.deck.cancelSchedule}</button>{/if}
          {:else if job.status !== 'cancelled' && job.status !== 'posted'}
            <button type="button" class="action" disabled={busy !== null} onclick={() => { confirming = { id: draft.id, action: 'cancel' }; scheduling = null; }}>{i18n.t.workflow.cancelDelivery}</button>
          {/if}
          <button type="button" class="action" disabled={busy !== null} onclick={() => { confirming = { id: draft.id, action: 'delete' }; scheduling = null; }}><Trash2 size={13} />{i18n.t.drafts.delete}</button>
          {#if busy === draft.id}<Loader2 size={14} class="animate-spin self-center" aria-label={i18n.t.common.loading} />{/if}
        </div>
        {#if scheduling === draft.id}
          <form onsubmit={(event) => { event.preventDefault(); schedule(draft.id); }} class="space-y-2 rounded-lg border border-[var(--color-border)] p-2">
            <div class="flex flex-wrap gap-2">
              <label class="text-xs flex-1 min-w-0" for="{fieldPrefix}-{draft.id}-date">{i18n.t.compose.date}<input id="{fieldPrefix}-{draft.id}-date" type="date" min={minScheduleDate(new Date(now))} bind:value={scheduleDate} required class="field" /></label>
              <label class="text-xs flex-1 min-w-0" for="{fieldPrefix}-{draft.id}-time">{i18n.t.compose.time}<input id="{fieldPrefix}-{draft.id}-time" type="time" bind:value={scheduleTime} required class="field" /></label>
            </div>
            <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.workflow.scheduleHint}</p>
            <div class="flex flex-wrap gap-2"><button type="submit" disabled={busy !== null} class="action">{i18n.t.compose.schedulePost}</button><button type="button" class="action" onclick={() => scheduling = null}><X size={13} />{i18n.t.common.cancel}</button></div>
          </form>
        {/if}
        {#if confirming?.id === draft.id}
          <div class="space-y-2 rounded-lg border border-[var(--color-border)] p-2">
            <p class="text-xs">{confirming.action === 'delete' ? i18n.t.deck.deleteDraftConfirm : i18n.t.workflow.cancelHint}</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="action text-red-400" disabled={busy !== null} onclick={() => action(draft.id, () => confirming?.action === 'delete' ? deletePublishingDraft(draft.id) : cancelPublishingDraft(draft.id))}>{confirming.action === 'delete' ? i18n.t.drafts.delete : i18n.t.workflow.cancelDelivery}</button>
              <button type="button" class="action" disabled={busy !== null} onclick={() => confirming = null}>{i18n.t.common.cancel}</button>
            </div>
          </div>
        {/if}
      </article>
    {/each}
    {#if filtered.length > visibleCount}<button type="button" class="w-full py-2 text-xs text-[var(--color-primary-text)]" onclick={() => visibleCount += 30}>{i18n.t.workflow.loadMore}</button>{/if}
  {/if}
</section>

<style>
  .action { display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; padding: 0.35rem 0.5rem; font-size: 0.7rem; border: 1px solid var(--color-border); border-radius: 0.4rem; min-height: 2rem; }
  .action:hover:not(:disabled) { background: var(--color-surface-hover); }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }
  .field { display: block; width: 100%; min-width: 0; margin-top: 0.25rem; padding: 0.4rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 0.4rem; color: var(--color-text); }
</style>
