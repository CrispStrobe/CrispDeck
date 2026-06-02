<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts } from '$lib/db';
  import { Rss, PenSquare, Users, ScanSearch } from '@lucide/svelte';
  import type { Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
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

<div class="p-6 max-w-4xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Dashboard</h1>

  {#if loading}
    <p class="text-[var(--color-text-muted)]">Loading...</p>
  {:else}
    <!-- Account summary -->
    <div class="grid grid-cols-2 gap-4 mb-8">
      <div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></div>
          <span class="text-sm font-medium">Bluesky</span>
        </div>
        <p class="text-2xl font-bold">{bskyAccounts.length}</p>
        <p class="text-xs text-[var(--color-text-muted)]">
          {bskyAccounts.length === 1 ? 'account' : 'accounts'} connected
        </p>
      </div>
      <div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></div>
          <span class="text-sm font-medium">Mastodon</span>
        </div>
        <p class="text-2xl font-bold">{mastoAccounts.length}</p>
        <p class="text-xs text-[var(--color-text-muted)]">
          {mastoAccounts.length === 1 ? 'account' : 'accounts'} connected
        </p>
      </div>
    </div>

    <!-- Quick actions -->
    <h2 class="text-lg font-semibold mb-3">Quick Actions</h2>
    <div class="grid grid-cols-2 gap-3">
      <a href="/feed" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Rss size={20} />
        <span>View Feed</span>
      </a>
      <a href="/compose" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <PenSquare size={20} />
        <span>Compose Post</span>
      </a>
      <a href="/identities" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <Users size={20} />
        <span>Identity Map</span>
      </a>
      <a href="/identities?scan=1" class="flex items-center gap-3 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg p-4 border border-[var(--color-border)] transition-colors">
        <ScanSearch size={20} />
        <span>Scan for Identities</span>
      </a>
    </div>

    {#if accounts.length === 0}
      <div class="mt-8 p-6 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
        <p class="text-[var(--color-text-muted)] mb-3">No accounts connected yet.</p>
        <a href="/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-md text-sm font-medium transition-colors">
          Add Account
        </a>
      </div>
    {/if}
  {/if}
</div>
