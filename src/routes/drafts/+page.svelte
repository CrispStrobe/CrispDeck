<script lang="ts">
  import { onMount } from 'svelte';
  import { listDrafts, deleteDraft as dbDeleteDraft, listAccounts, getDecryptedCredentials, saveDraft as dbSaveDraft } from '$lib/db';
  import { FileText, Trash2, Clock, Send, Loader2, Edit3, Calendar } from '@lucide/svelte';
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

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  // Schedule form
  let schedulingDraftId: number | null = $state(null);
  let scheduleDate = $state('');
  let scheduleTime = $state('');

  onMount(async () => {
    try {
      [drafts, accounts] = await Promise.all([listDrafts(), listAccounts()]);
      await initClients();
      checkScheduledDrafts();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);
        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          clients.set(acct.id, client);
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch (e) {
        console.error(`Failed to init client for ${acct.handle}:`, e);
      }
    }
  }

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
        const client = clients.get(id);
        if (!acct || !client) return null;
        const plan = splitForPlatform(draft.text.trim(), acct.platform as Platform);
        return { platform: acct.platform as 'bluesky' | 'mastodon', client, parts: plan.parts.map(p => p.text) };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

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
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <FileText size={24} />
      <h1 class="text-2xl font-bold">Drafts</h1>
      {#if drafts.length > 0}
        <span class="text-sm text-[var(--color-text-muted)] ml-2">({drafts.length})</span>
      {/if}
    </div>
    <a href="/compose" class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-md">
      <Edit3 size={14} /> New Post
    </a>
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

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if drafts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <FileText size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Drafts</h3>
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
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
