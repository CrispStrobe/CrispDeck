<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { listAccounts } from '$lib/db';
  import { Rss, PenSquare, Users, ScanSearch, Columns3, Bell, Search, TrendingUp, BarChart3 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import type { Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    // Check if user prefers direct-to-feed mode
    const homeMode = localStorage.getItem('crispdeck-home-mode') ?? 'dashboard';
    if (homeMode === 'feed') {
      goto('/feed', { replaceState: true });
      return;
    }
    if (homeMode === 'deck') {
      goto('/deck', { replaceState: true });
      return;
    }

    try {
      accounts = await listAccounts();
    } catch (e) {
      console.error('Failed to load accounts:', e);
    } finally {
      loading = false;
    }
  });

  const bskyAccounts = $derived(accounts.filter(a => a.platform === 'bluesky'));
  const mastoAccounts = $derived(accounts.filter(a => a.platform === 'mastodon'));
</script>

<svelte:head><title>CrispDeck</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">{i18n.t.nav.dashboard}</h1>

  {#if loading}
    <p class="text-[var(--color-text-muted)]">{i18n.t.common.loading}</p>
  {:else}
    <!-- Account summary -->
    <div class="grid grid-cols-2 gap-4 mb-8">
      <div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></div>
          <span class="text-sm font-medium">{i18n.t.common.bluesky}</span>
        </div>
        <p class="text-2xl font-bold">{bskyAccounts.length}</p>
        <p class="text-xs text-[var(--color-text-muted)]">
          {i18n.t.dashboard.accountsConnected.replace('{count}', String(bskyAccounts.length))}
        </p>
      </div>
      <div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></div>
          <span class="text-sm font-medium">{i18n.t.common.mastodon}</span>
        </div>
        <p class="text-2xl font-bold">{mastoAccounts.length}</p>
        <p class="text-xs text-[var(--color-text-muted)]">
          {i18n.t.dashboard.accountsConnected.replace('{count}', String(mastoAccounts.length))}
        </p>
      </div>
    </div>

    <!-- Quick actions -->
    <h2 class="text-lg font-semibold mb-3">{i18n.t.dashboard.quickActions}</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <a href="/feed" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Rss size={20} />
        <span>{i18n.t.nav.feed}</span>
      </a>
      <a href="/compose" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <PenSquare size={20} />
        <span>{i18n.t.nav.compose}</span>
      </a>
      <a href="/deck" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Columns3 size={20} />
        <span>{i18n.t.nav.deck}</span>
      </a>
      <a href="/notifications" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Bell size={20} />
        <span>{i18n.t.nav.notifications}</span>
      </a>
      <a href="/trending" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <TrendingUp size={20} />
        <span>{i18n.t.nav.trending}</span>
      </a>
      <a href="/search" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Search size={20} />
        <span>{i18n.t.nav.search}</span>
      </a>
      <a href="/identities" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Users size={20} />
        <span>{i18n.t.nav.identities}</span>
      </a>
      <a href="/analytics" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <BarChart3 size={20} />
        <span>{i18n.t.nav.analytics}</span>
      </a>
      <a href="/identities?scan=1" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <ScanSearch size={20} />
        <span>{i18n.t.dashboard.scanIdentities}</span>
      </a>
    </div>

    {#if accounts.length === 0}
      <div class="mt-8 p-6 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
        <p class="text-[var(--color-text-muted)] mb-3">{i18n.t.feed.addAccountsFirst}</p>
        <a href="/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-md text-sm font-medium transition-colors">
          {i18n.t.settings.addAccount}
        </a>
      </div>
    {/if}
  {/if}
</div>
