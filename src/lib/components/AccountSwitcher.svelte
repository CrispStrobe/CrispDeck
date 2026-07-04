<script lang="ts">
  import { ChevronUp } from '@lucide/svelte';
  import type { Account } from '$lib/types';

  let {
    accounts = [],
    collapsed = false,
  }: {
    accounts: Account[];
    collapsed?: boolean;
  } = $props();

  let showPopover = $state(false);

  function platformColor(platform: string): string {
    switch (platform) {
      case 'bluesky': return 'var(--color-bluesky)';
      case 'mastodon': return 'var(--color-mastodon)';
      case 'threads': return 'var(--color-threads, #000)';
      default: return 'var(--color-text-muted)';
    }
  }
</script>

{#if accounts.length > 0}
  <div class="relative">
    <!-- Trigger: stacked avatars -->
    <button
      onclick={() => showPopover = !showPopover}
      class="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
      title="Switch account"
    >
      <div class="flex -space-x-1.5">
        {#each accounts.slice(0, 4) as acct}
          {#if acct.avatar_url}
            <img
              src={acct.avatar_url}
              alt={acct.handle}
              class="w-5 h-5 rounded-full border border-[var(--color-bg)] flex-shrink-0"
            />
          {:else}
            <div
              class="w-5 h-5 rounded-full border border-[var(--color-bg)] flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
              style="background: {platformColor(acct.platform)}"
            >
              {acct.handle[0]?.toUpperCase() ?? '?'}
            </div>
          {/if}
        {/each}
        {#if accounts.length > 4}
          <div class="w-5 h-5 rounded-full bg-[var(--color-surface)] border border-[var(--color-bg)] flex items-center justify-center text-[7px] font-bold text-[var(--color-text-muted)]">
            +{accounts.length - 4}
          </div>
        {/if}
      </div>
      {#if !collapsed}
        <span class="text-[10px] text-[var(--color-text-muted)] truncate flex-1 text-left">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
        <ChevronUp size={10} class="text-[var(--color-text-muted)] flex-shrink-0 {showPopover ? '' : 'rotate-180'}" />
      {/if}
    </button>

    <!-- Popover: full account list -->
    {#if showPopover}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 z-40" onclick={() => showPopover = false} onkeydown={() => {}}></div>
      <div class="absolute bottom-full left-0 mb-1 w-56 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
        <div class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-medium border-b border-[var(--color-border)]">
          Connected accounts
        </div>
        {#each accounts as acct}
          <a
            href="/settings?tab=account"
            onclick={() => showPopover = false}
            class="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {#if acct.avatar_url}
              <img src={acct.avatar_url} alt={acct.handle} class="w-7 h-7 rounded-full flex-shrink-0" />
            {:else}
              <div
                class="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style="background: {platformColor(acct.platform)}"
              >
                {acct.handle[0]?.toUpperCase() ?? '?'}
              </div>
            {/if}
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium truncate">{acct.display_name ?? acct.handle}</p>
              <p class="text-[10px] text-[var(--color-text-muted)] truncate">{acct.handle}</p>
            </div>
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background: {platformColor(acct.platform)}"></span>
          </a>
        {/each}
        <a
          href="/settings?tab=account"
          onclick={() => showPopover = false}
          class="flex items-center gap-2 px-3 py-2 text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors text-xs"
        >
          + Add account
        </a>
      </div>
    {/if}
  </div>
{/if}
