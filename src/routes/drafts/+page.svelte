<script lang="ts">
  import { onMount } from 'svelte';
  import { listDrafts, deleteDraft as dbDeleteDraft, saveDraft as dbSaveDraft } from '$lib/db';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { FileText, Trash2, Clock, Send, Loader2, Edit3, Calendar, Eye } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { crosspostThread, type PostResult } from '$lib/compose/adapter';
  import { splitForPlatform } from '$lib/compose/thread';
  import type { Draft, Account, Platform } from '$lib/types';

  let drafts: Draft[] = $state([]);
  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let posting: number | null = $state(null);
  let results: PostResult[] = $state([]);
  let error = $state('');

  let clientEntries: Map<number, ClientEntry> = new Map();

  // Schedule form
  let schedulingDraftId: number | null = $state(null);
  let scheduleDate = $state('');
  let scheduleTime = $state('');

  onMount(() => {
    let stopScheduler: (() => void) | undefined;
    (async () => {
      try {
        const [draftList, result] = await Promise.all([listDrafts(), initAllClients()]);
        drafts = draftList;
        accounts = result.accounts;
        clientEntries = result.clients;
        stopScheduler = checkScheduledDrafts();
      } catch (e) {
        error = String(e);
      } finally {
        loading = false;
      }
    })();
    return () => stopScheduler?.();
  });

  function checkScheduledDrafts() {
    // Check every 30 seconds for drafts that are past their scheduled time
    const interval = setInterval(async () => {
      const now = new Date();
      for (const draft of drafts) {
        if (draft.scheduled_at && !draft.is_sent && new Date(draft.scheduled_at) <= now) {
          await postDraft(draft);
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }

  /** One account's share of a draft, after the text has been split for its platform. */
  type DraftTarget = { platform: Platform; client: ClientEntry['client']; parts: string[] };

  async function postDraft(draft: Draft) {
    posting = draft.id;
    error = '';
    results = [];

    const targetIds = Array.isArray(draft.target_accounts)
      ? draft.target_accounts
      : JSON.parse(draft.target_accounts as unknown as string);

    const targets = targetIds
      .map((id: number) => {
        const acct = accounts.find(a => a.id === id);
        const entry = clientEntries.get(id);
        if (!acct || !entry) return null;
        const plan = splitForPlatform(draft.text.trim(), acct.platform as Platform);
        return { platform: acct.platform as Platform, client: entry.client, parts: plan.parts.map(p => p.text) };
      })
      // `typeof t` inside t's own annotation is circular — TS gives up and
      // silently types the parameter `any`. Name the shape instead.
      .filter((t: DraftTarget | null): t is DraftTarget => t !== null);

    if (targets.length === 0) {
      error = 'No valid accounts for this draft';
      posting = null;
      return;
    }

    try {
      results = await crosspostThread(targets, {
        visibility: (draft.visibility as any) ?? 'public',
        contentWarning: draft.content_warning ?? undefined,
      });

      if (results.every(r => r.success)) {
        await dbDeleteDraft(draft.id);
        drafts = await listDrafts();
      }
    } catch (e) {
      error = String(e);
    } finally {
      posting = null;
    }
  }

  async function handleDelete(id: number) {
    try {
      await dbDeleteDraft(id);
      drafts = drafts.filter(d => d.id !== id);
    } catch (e) {
      error = String(e);
    }
  }

  async function scheduleDraft(draftId: number) {
    if (!scheduleDate || !scheduleTime) return;
    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();

    // Update the draft — delete and re-save with scheduled_at
    const draft = drafts.find(d => d.id === draftId);
    if (!draft) return;

    try {
      await dbDeleteDraft(draftId);
      await dbSaveDraft({
        text: draft.text,
        target_accounts: Array.isArray(draft.target_accounts) ? draft.target_accounts : JSON.parse(draft.target_accounts as unknown as string),
        visibility: draft.visibility,
        content_warning: draft.content_warning,
        scheduled_at: scheduledAt,
      });
      drafts = await listDrafts();
      schedulingDraftId = null;
      scheduleDate = '';
      scheduleTime = '';
    } catch (e) {
      error = String(e);
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  function getAccountNames(targetAccounts: number[] | string): string {
    const ids = Array.isArray(targetAccounts)
      ? targetAccounts
      : JSON.parse(targetAccounts as unknown as string);
    return ids.map((id: number) => accounts.find(a => a.id === id)?.handle ?? `#${id}`).join(', ');
  }

  const scheduledDrafts = $derived(drafts.filter(d => d.scheduled_at));
  const unscheduledDrafts = $derived(drafts.filter(d => !d.scheduled_at));

  let previewDraftId: number | null = $state(null);
  let showCalendar = $state(false);

  // Calendar helpers
  function getWeekDays(): Date[] {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay()); // Start from Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }

  function isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }

  function getDraftsForDay(day: Date): Draft[] {
    return scheduledDrafts.filter(d => d.scheduled_at && isSameDay(new Date(d.scheduled_at), day));
  }

  function isToday(day: Date): boolean {
    return isSameDay(day, new Date());
  }

  const weekDays = $derived(getWeekDays());
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getDraftPlatforms(draft: Draft): Platform[] {
    const ids = Array.isArray(draft.target_accounts)
      ? draft.target_accounts
      : JSON.parse(draft.target_accounts as unknown as string);
    return [...new Set(ids.map((id: number) => accounts.find(a => a.id === id)?.platform).filter(Boolean))] as Platform[];
  }
</script>

<svelte:head><title>CrispDeck — Drafts</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Compose tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/compose" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Compose</a>
    <a href="/drafts" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Drafts</a>
  </div>

  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <FileText size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.drafts.title}</h1>
      {#if drafts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({drafts.length})</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if scheduledDrafts.length > 0}
        <button
          onclick={() => showCalendar = !showCalendar}
          class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors {showCalendar ? 'bg-yellow-600 text-white' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)]'}"
        >
          <Calendar size={14} /> {i18n.t.drafts.calendarView}
        </button>
      {/if}
      <a href="/compose" class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-md">
        <Edit3 size={14} /> {i18n.t.drafts.newPost}
      </a>
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if results.length > 0}
    <div class="mb-4 space-y-1">
      {#each results as result}
        <div class="p-2 rounded text-xs {result.success ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}">
          {result.success ? 'Posted' : 'Failed'}: {result.platform} {result.uri ?? result.error ?? ''}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Calendar view -->
  {#if showCalendar && scheduledDrafts.length > 0}
    <div class="mb-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
      <div class="grid grid-cols-7 border-b border-[var(--color-border)]">
        {#each dayNames as name}
          <div class="px-2 py-1.5 text-center text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">{name}</div>
        {/each}
      </div>
      <div class="grid grid-cols-7 min-h-[120px]">
        {#each weekDays as day, i}
          {@const dayDrafts = getDraftsForDay(day)}
          <div class="border-r border-[var(--color-border)] p-1.5 {i === 6 ? 'border-r-0' : ''} {isToday(day) ? 'bg-[var(--color-primary)]/5' : ''}">
            <div class="text-[10px] font-medium mb-1 {isToday(day) ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}">
              {day.getDate()}
            </div>
            {#each dayDrafts as draft}
              <div
                class="px-1 py-0.5 mb-0.5 text-[9px] rounded bg-yellow-600/20 text-yellow-300 truncate cursor-default"
                title="{draft.text.substring(0, 80)} — {new Date(draft.scheduled_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"
              >
                {new Date(draft.scheduled_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {draft.text.substring(0, 20)}...
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if drafts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <FileText size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.drafts.noDrafts}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Saved drafts from the <a href="/compose" class="text-[var(--color-primary)] underline">Compose</a> page appear here.</p>
    </div>
  {:else}
    <!-- Scheduled drafts -->
    {#if scheduledDrafts.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
        <Clock size={14} /> Scheduled ({scheduledDrafts.length})
      </h2>
      <div class="space-y-3 mb-8">
        {#each scheduledDrafts as draft}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-yellow-700/30">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words line-clamp-3">{draft.text}</p>
                <div class="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span class="flex items-center gap-1 text-yellow-400">
                    <Calendar size={10} /> {formatDate(draft.scheduled_at!)}
                  </span>
                  <span>To: {getAccountNames(draft.target_accounts)}</span>
                </div>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button
                  onclick={() => previewDraftId = previewDraftId === draft.id ? null : draft.id}
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors {previewDraftId === draft.id ? 'text-[var(--color-primary)]' : ''}"
                  title="Preview"
                >
                  <Eye size={14} />
                </button>
                <button
                  onclick={() => postDraft(draft)}
                  disabled={posting === draft.id}
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-success)] transition-colors"
                  title="Post now"
                >
                  {#if posting === draft.id}<Loader2 size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
                </button>
                <button onclick={() => handleDelete(draft.id)} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <!-- Post preview -->
            {#if previewDraftId === draft.id}
              <div class="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                {#each getDraftPlatforms(draft) as plat}
                  {@const plan = splitForPlatform(draft.text.trim(), plat)}
                  <div class="p-2 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
                    <div class="flex items-center gap-1.5 mb-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: var(--color-{plat})"></span>
                      <span class="text-[10px] font-medium text-[var(--color-text-muted)] capitalize">{plat}</span>
                      {#if plan.parts.length > 1}
                        <span class="text-[10px] px-1 py-0.5 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded">{plan.parts.length}-post thread</span>
                      {/if}
                      {#if draft.content_warning}
                        <span class="text-[10px] px-1 py-0.5 bg-yellow-600/20 text-yellow-400 rounded">CW: {draft.content_warning}</span>
                      {/if}
                    </div>
                    {#each plan.parts as part, i}
                      <div class="text-xs text-[var(--color-text)] whitespace-pre-wrap break-words {i > 0 ? 'mt-2 pt-2 border-t border-[var(--color-border)]/50' : ''}">
                        {part.text}
                        <span class="text-[9px] text-[var(--color-text-muted)] ml-1">{part.charCount}/{part.charLimit}</span>
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Unscheduled drafts -->
    {#if unscheduledDrafts.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
        <FileText size={14} /> Drafts ({unscheduledDrafts.length})
      </h2>
      <div class="space-y-3">
        {#each unscheduledDrafts as draft}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words line-clamp-3">{draft.text}</p>
                <div class="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>Saved {formatDate(draft.created_at)}</span>
                  <span>To: {getAccountNames(draft.target_accounts)}</span>
                </div>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <a
                  href="/compose?draft={draft.id}"
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
                  title="Edit"
                >
                  <Edit3 size={14} />
                </a>
                <button
                  onclick={() => previewDraftId = previewDraftId === draft.id ? null : draft.id}
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors {previewDraftId === draft.id ? 'text-[var(--color-primary)]' : ''}"
                  title="Preview"
                >
                  <Eye size={14} />
                </button>
                <button
                  onclick={() => postDraft(draft)}
                  disabled={posting === draft.id}
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-success)] transition-colors"
                  title="Post now"
                >
                  {#if posting === draft.id}<Loader2 size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
                </button>
                <button
                  onclick={() => { schedulingDraftId = schedulingDraftId === draft.id ? null : draft.id; }}
                  class="p-1.5 text-[var(--color-text-muted)] hover:text-yellow-400 transition-colors"
                  title="Schedule"
                >
                  <Clock size={14} />
                </button>
                <button onclick={() => handleDelete(draft.id)} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <!-- Schedule form -->
            {#if schedulingDraftId === draft.id}
              <div class="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center gap-2">
                <input
                  type="date"
                  bind:value={scheduleDate}
                  class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <input
                  type="time"
                  bind:value={scheduleTime}
                  class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                />
                <button
                  onclick={() => scheduleDraft(draft.id)}
                  disabled={!scheduleDate || !scheduleTime}
                  class="px-3 py-1 text-xs bg-yellow-600 text-white rounded disabled:opacity-50"
                >
                  Schedule
                </button>
                <button
                  onclick={() => schedulingDraftId = null}
                  class="px-2 py-1 text-xs text-[var(--color-text-muted)]"
                >
                  Cancel
                </button>
              </div>
            {/if}
            <!-- Post preview -->
            {#if previewDraftId === draft.id}
              <div class="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                {#each getDraftPlatforms(draft) as plat}
                  {@const plan = splitForPlatform(draft.text.trim(), plat)}
                  <div class="p-2 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
                    <div class="flex items-center gap-1.5 mb-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: var(--color-{plat})"></span>
                      <span class="text-[10px] font-medium text-[var(--color-text-muted)] capitalize">{plat}</span>
                      {#if plan.parts.length > 1}
                        <span class="text-[10px] px-1 py-0.5 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded">{plan.parts.length}-post thread</span>
                      {/if}
                      {#if draft.content_warning}
                        <span class="text-[10px] px-1 py-0.5 bg-yellow-600/20 text-yellow-400 rounded">CW: {draft.content_warning}</span>
                      {/if}
                    </div>
                    {#each plan.parts as part, i}
                      <div class="text-xs text-[var(--color-text)] whitespace-pre-wrap break-words {i > 0 ? 'mt-2 pt-2 border-t border-[var(--color-border)]/50' : ''}">
                        {part.text}
                        <span class="text-[9px] text-[var(--color-text-muted)] ml-1">{part.charCount}/{part.charLimit}</span>
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
