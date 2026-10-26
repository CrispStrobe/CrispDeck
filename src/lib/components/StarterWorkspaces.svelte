<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { readJson } from '$lib/safe-storage';
  import { STARTER_WORKSPACES, workspaceColumns, applyWorkspace, type WorkspaceId } from '$lib/starter-workspaces';
  import type { DeckColumnConfig } from '$lib/deck-layouts';
  let { connected = false, onapply }: { connected?: boolean; onapply?: (columns: DeckColumnConfig[]) => void } = $props();
  let selected: WorkspaceId = $state('dailyReading');
  let preview = $state(false);
  let error = $state('');
  const columns = $derived(workspaceColumns(selected, {
    feed: i18n.t.nav.feed, notifications: i18n.t.nav.notifications, search: i18n.t.nav.search,
    trending: i18n.t.nav.trending, messages: i18n.t.nav.messages, mentions: i18n.t.deck.mentions,
    myPosts: i18n.t.feed.myPosts,
  }));
  async function useWorkspace() {
    error = '';
    const existing = readJson<DeckColumnConfig[]>('crispdeck-deck-columns', [], Array.isArray);
    if (existing.length && !confirm(i18n.t.workflow.replaceWorkspace)) return;
    try {
      applyWorkspace(selected, columns);
      if (onapply) { onapply(columns); preview = false; }
      else if (connected) await goto(`${base}/deck`);
      else preview = true;
    } catch (e) { error = String(e); }
  }
</script>

<section class="space-y-3" aria-label={i18n.t.workflow.starterWorkspaces}>
  <h2 class="text-lg font-semibold">{i18n.t.workflow.starterWorkspaces}</h2>
  <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.workflow.starterHint}</p>
  <div class="grid gap-3 sm:grid-cols-3">
    {#each STARTER_WORKSPACES as id}
      <button class="p-4 text-left rounded-xl border transition-colors {selected === id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}" aria-pressed={selected === id} onclick={() => { selected = id; preview = true; }}>
        <span class="block text-sm font-semibold">{i18n.t.workflow[id]}</span>
        <span class="flex gap-1 mt-3" aria-hidden="true">{#each [1, 2, 3] as n}<span class="h-12 flex-1 rounded bg-[var(--color-border)] border-t-2 border-[var(--color-primary)] opacity-70"></span>{/each}</span>
      </button>
    {/each}
  </div>
  {#if preview}
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
      <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold">{i18n.t.workflow[selected]}</h3><span class="text-xs px-2 py-1 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary-text)]">{i18n.t.workflow.sampleData}</span></div>
      <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.sampleHint}</p>
      <div class="grid gap-3 sm:grid-cols-3">
        {#each columns as column, index}
          <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
            <p class="px-3 py-2 border-t-2 text-xs font-semibold" style:border-top-color={column.color}>{column.title}</p>
            {#each [1, 2] as n}
              <div class="p-3 border-t border-[var(--color-border)] space-y-2">
                <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-[var(--color-primary)]/20"></span><span class="text-xs font-medium">@{['alex', 'sam', 'robin'][index]}.example</span></div>
                <p class="text-xs text-[var(--color-text-muted)]">{n === 1 ? i18n.t.workflow.samplePost : i18n.t.workflow.sampleReply}</p>
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <button class="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm" onclick={useWorkspace}>{i18n.t.workflow.useWorkspace}</button>
      {#if !connected}<a class="text-sm underline ml-3" href={base || '/'}>{i18n.t.workflow.connectAccounts}</a>{/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="text-sm text-red-400">{error}</p>{/if}
</section>
