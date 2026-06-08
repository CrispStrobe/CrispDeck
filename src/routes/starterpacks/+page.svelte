<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Package, Loader2, UserPlus, Users, ExternalLink } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
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
  let clientEntries: Map<number, ClientEntry> = new Map();
  let bskyEntry: ClientEntry | null = $state(null);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      const bskyAcct = accounts.find(a => a.platform === 'bluesky');
      if (bskyAcct) {
        bskyEntry = clientEntries.get(bskyAcct.id) ?? null;
        if (bskyEntry) {
          // Load user's own starter packs
          const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: bskyAcct.handle });
          myPacks = (resp.data.starterPacks ?? []) as unknown as StarterPack[];
        }
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function search() {
    if (!searchQuery.trim() || !bskyEntry) return;
    searching = true;
    error = '';
    try {
      const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
      const bskyClient = bskyEntry.client as BlueskyClient;
      const allPacks: StarterPack[] = [];
      const seen = new Set<string>();

      // Strategy 1: Search posts mentioning "starter pack" + query
      // This finds people sharing/discussing starter packs about the topic
      try {
        const searchResp = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery + ' starter pack')}&limit=30`
        );
        if (searchResp.ok) {
          const searchData = await searchResp.json();
          const handles = new Set<string>();
          for (const post of searchData.posts ?? []) {
            handles.add(post.author.handle);
            // Also extract @mentions from text
            const mentions = (post.record?.text ?? '').matchAll(/@([\w.-]+)/g);
            for (const m of mentions) handles.add(m[1]);
          }
          // Fetch starter packs from all discovered handles
          for (const handle of [...handles].slice(0, 15)) {
            try {
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
        }
      } catch {}

      // Strategy 2: Search actors and fetch their starter packs
      const actors = await bskyClient.searchActors(searchQuery);
      for (const actor of actors.slice(0, 10)) {
        try {
          const resp = await agent.api.app.bsky.graph.getActorStarterPacks({ actor: actor.handle });
          for (const sp of resp.data.starterPacks ?? []) {
            const pack = sp as unknown as StarterPack;
            if (!seen.has(pack.uri)) {
              seen.add(pack.uri);
              allPacks.push(pack);
            }
          }
        } catch {}
      }

      // Strategy 3: Direct handle lookup
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

      // Sort by relevance: packs whose name/desc matches the query rank first, then by member count
      const q = searchQuery.toLowerCase();
      allPacks.sort((a, b) => {
        const aMatch = (a.record.name?.toLowerCase().includes(q) ? 2 : 0) +
          (a.record.description?.toLowerCase().includes(q) ? 1 : 0);
        const bMatch = (b.record.name?.toLowerCase().includes(q) ? 2 : 0) +
          (b.record.description?.toLowerCase().includes(q) ? 1 : 0);
        if (aMatch !== bMatch) return bMatch - aMatch;
        return (b.listItemCount ?? 0) - (a.listItemCount ?? 0);
      });

      packs = allPacks;
      if (allPacks.length === 0) {
        error = `No starter packs found for "${searchQuery}". Try a different topic or creator handle.`;
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

<svelte:head><title>CrispDeck — Starter Packs</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Lists & Feeds tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/lists" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Lists</a>
    <a href="/starterpacks" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Starter Packs</a>
    <a href="/feed-builder" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Feed Builder</a>
  </div>

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
      <button type="submit" disabled={searching || !bskyEntry} class="px-5 py-3 bg-[var(--color-bluesky)] text-white text-sm font-medium rounded-lg disabled:opacity-50">
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}Search{/if}
      </button>
    </div>
  </form>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
    <!-- My starter packs -->
    {#if myPacks.length > 0}
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">{i18n.t.starterPacks.yourPacks}</h2>
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
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">{i18n.t.starterPacks.searchResults}</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each packs as pack}
          <a href={getPackUrl(pack)} target="_blank" rel="noopener noreferrer" class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-bluesky)] transition-colors">
            <div class="flex items-start gap-3">
              {#if pack.creator.avatar}
                <img loading="lazy" src={pack.creator.avatar} alt="" class="w-8 h-8 rounded-full" />
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

    {#if !loading && !bskyEntry}
      <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <Package size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-sm text-[var(--color-text-muted)]">Add a Bluesky account in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to browse starter packs.</p>
      </div>
    {/if}
  {/if}
</div>
