<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Package, Loader2, UserPlus, Users, ExternalLink } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import type { Account } from '$lib/types';

  interface StarterPack {
    uri: string;
    cid: string;
    creator: { handle: string; displayName?: string; avatar?: string };
    record: { name: string; description?: string };
    listItemCount?: number;
    joinedAllTimeCount?: number;
    joinedWeekCount?: number;
    indexedAt: string;
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let searchQuery = $state('');
  let searching = $state(false);
  let packs: StarterPack[] = $state([]);
  let myPacks: StarterPack[] = $state([]);
  let client: BlueskyClient | null = $state(null);

  onMount(async () => {
    try {
      accounts = await listAccounts();
      const bskyAcct = accounts.find(a => a.platform === 'bluesky');
      if (bskyAcct) {
        const creds = JSON.parse(await getDecryptedCredentials(bskyAcct.id));
        client = new BlueskyClient(bskyAcct.handle, creds.app_password);
        await client.login();

        // Load user's own starter packs
        const agent = client.getAgent();
        const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: bskyAcct.handle });
        myPacks = (resp.data.starterPacks ?? []) as unknown as StarterPack[];
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function search() {
    if (!searchQuery.trim() || !client) return;
    searching = true;
    try {
      const agent = client.getAgent();
      const allPacks: StarterPack[] = [];
      const seen = new Set<string>();

      // Strategy 1: Search actors and fetch their starter packs
      const actors = await client.searchActors(searchQuery);
      for (const actor of actors.slice(0, 8)) {
        try {
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: actor.handle });
          for (const sp of resp.data.starterPacks ?? []) {
            const pack = sp as unknown as StarterPack;
            if (!seen.has(pack.uri)) {
              // Filter: only include packs whose name or description matches the query
              const q = searchQuery.toLowerCase();
              const nameMatch = pack.record.name?.toLowerCase().includes(q);
              const descMatch = pack.record.description?.toLowerCase().includes(q);
              const creatorMatch = pack.creator.handle.toLowerCase().includes(q) ||
                pack.creator.displayName?.toLowerCase().includes(q);
              if (nameMatch || descMatch || creatorMatch) {
                seen.add(pack.uri);
                allPacks.push(pack);
              }
            }
          }
        } catch {}
      }

      // Strategy 2: If query looks like a handle, search that specific actor
      if (searchQuery.includes('.') || searchQuery.includes('@')) {
        try {
          const handle = searchQuery.replace(/^@/, '');
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: handle });
          for (const sp of resp.data.starterPacks ?? []) {
            const pack = sp as unknown as StarterPack;
            if (!seen.has(pack.uri)) {
              seen.add(pack.uri);
              allPacks.push(pack);
            }
          }
        } catch {}
      }

      packs = allPacks;
      if (allPacks.length === 0) {
        error = `No starter packs found for "${searchQuery}". Try searching by creator handle or pack topic.`;
      }
    } catch (e) {
      error = String(e);
    } finally {
      searching = false;
    }
  }

  function getPackUrl(pack: StarterPack): string {
    const rkey = pack.uri.split('/').pop();
    const handle = pack.creator.handle;
    return `https://bsky.app/starter-pack/${handle}/${rkey}`;
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Package size={24} />
    <h1 class="text-2xl font-bold">Starter Packs</h1>
    <span class="text-xs px-2 py-0.5 bg-[var(--color-bluesky)]/20 text-[var(--color-bluesky)] rounded">Bluesky</span>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Search -->
  <form onsubmit={(e) => { e.preventDefault(); search(); }} class="mb-6">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search for starter packs by creator..."
        class="flex-1 px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]"
      />
      <button type="submit" disabled={searching || !client} class="px-5 py-3 bg-[var(--color-bluesky)] text-white text-sm font-medium rounded-lg disabled:opacity-50">
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}Search{/if}
      </button>
    </div>
  </form>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
    <!-- My starter packs -->
    {#if myPacks.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Your Starter Packs</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {#each myPacks as pack}
          <a href={getPackUrl(pack)} target="_blank" rel="noopener noreferrer" class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-medium text-sm">{pack.record.name}</h3>
              <ExternalLink size={12} class="text-[var(--color-text-muted)]" />
            </div>
            {#if pack.record.description}
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-2 mb-2">{pack.record.description}</p>
            {/if}
            <div class="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
              <span class="flex items-center gap-1"><Users size={10} /> {pack.listItemCount ?? '?'} members</span>
              {#if pack.joinedAllTimeCount}
                <span class="flex items-center gap-1"><UserPlus size={10} /> {pack.joinedAllTimeCount} joined</span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}

    <!-- Search results -->
    {#if packs.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Search Results</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each packs as pack}
          <a href={getPackUrl(pack)} target="_blank" rel="noopener noreferrer" class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors">
            <div class="flex items-start gap-3">
              {#if pack.creator.avatar}
                <img src={pack.creator.avatar} alt="" class="w-8 h-8 rounded-full" />
              {/if}
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm">{pack.record.name}</h3>
                <p class="text-xs text-[var(--color-text-muted)]">by @{pack.creator.handle}</p>
                {#if pack.record.description}
                  <p class="text-xs text-[var(--color-text-muted)] line-clamp-2 mt-1">{pack.record.description}</p>
                {/if}
                <div class="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
                  <span><Users size={10} class="inline" /> {pack.listItemCount ?? '?'} members</span>
                  {#if pack.joinedAllTimeCount}<span><UserPlus size={10} class="inline" /> {pack.joinedAllTimeCount} joined</span>{/if}
                </div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

    {#if !loading && !client}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Package size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-sm text-[var(--color-text-muted)]">Add a Bluesky account in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to browse starter packs.</p>
      </div>
    {/if}
  {/if}
</div>
