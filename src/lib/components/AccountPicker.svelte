<script lang="ts">
  import type { Account } from '$lib/types';

  let { accounts, selected = $bindable([]) }: {
    accounts: Account[];
    selected: number[];
  } = $props();

  function toggle(id: number) {
    if (selected.includes(id)) {
      selected = selected.filter(s => s !== id);
    } else {
      selected = [...selected, id];
    }
  }

  function selectAll() {
    selected = accounts.map(a => a.id);
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <span class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Post to</span>
    {#if accounts.length > 1}
      <button onclick={selectAll} class="text-xs text-[var(--color-primary)] hover:underline">
        Select All
      </button>
    {/if}
  </div>
  {#each accounts as acct}
    <button
      onclick={() => toggle(acct.id)}
      class="w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left {selected.includes(acct.id)
        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'}"
    >
      <div
        class="w-3 h-3 rounded-full flex-shrink-0"
        style="background: {acct.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"
      ></div>
      {#if acct.avatar_url}
        <img loading="lazy" src={acct.avatar_url} alt="" class="w-6 h-6 rounded-full" />
      {:else}
        <div class="w-6 h-6 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-[10px]">
          {acct.platform === 'bluesky' ? 'BS' : 'M'}
        </div>
      {/if}
      <div class="flex-1 min-w-0">
        <span class="text-sm truncate block">{acct.handle}</span>
      </div>
      <div class="w-5 h-5 rounded border flex items-center justify-center text-xs {selected.includes(acct.id) ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}">
        {#if selected.includes(acct.id)}✓{/if}
      </div>
    </button>
  {/each}
</div>
